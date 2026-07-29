import { useState } from "react";
import { parseEther, isAddress } from "viem";
import { useSendTransaction, useWaitForTransactionReceipt } from "wagmi";

import { EstateAbi } from "../abis/Estate";
import { EstateVaultAbi } from "../abis/EstateVault";
import {
  ApprovalRule,
  BPS_TOTAL,
  DistributionMode,
  EstateState,
  MAX_APPROVERS,
  bpsToPercent,
  describeConfigGap,
  explainError,
  formatZkLtc,
  type EstateInfo,
} from "../lib/estate";
import type { Approver, Beneficiary } from "../lib/useEstate";
import { useTx } from "../lib/useTx";
import { useEstateLimits } from "../lib/useEstateLimits";
import { AddressLink, Field, Notice, Panel, TxStatus } from "./Common";
import { ShareAddress } from "./ShareAddress";
import { Confirm, Mono } from "./Confirm";

/// parseEther throws on malformed input ("1..5", "1e5", too many decimals),
/// which would take the whole panel down. Returns null instead so callers can
/// treat it as "not a valid amount yet".
function safeParseEther(value: string): bigint | null {
  if (!value.trim()) return null;
  try {
    const wei = parseEther(value);
    return wei < 0n ? null : wei;
  } catch {
    return null;
  }
}

/// The contract refuses the owner as beneficiary, residuary or approver.
/// Checked here too so the user is told before paying gas for a revert.
function isSelf(candidate: string, owner: string): boolean {
  return isAddress(candidate) && candidate.toLowerCase() === owner.toLowerCase();
}

const SELF_WARNING = "That is this estate's own address — you cannot leave it to yourself.";

export function OwnerPanel({
  estate,
  owner,
  vault,
  info,
  beneficiaries,
  approvers,
  policy,
  mode,
  vaultBalance,
  distributed,
  refetch,
}: {
  estate: `0x${string}`;
  owner: `0x${string}`;
  vault?: `0x${string}`;
  info: EstateInfo;
  beneficiaries: readonly Beneficiary[];
  approvers: Approver[];
  /// [rule, threshold, approvalWindow] — rule 0=AnyOne 1=All 2=Threshold
  policy?: readonly [number, number, bigint];
  /// 0 = Automatic, 1 = ApprovalRequired
  mode?: number;
  vaultBalance?: bigint;
  distributed?: boolean;
  refetch: () => void;
}) {
  const state = info.state as EstateState;
  const editable = state === EstateState.Active;

  // Check-in is rendered above the estate status by AppView, not here - it is
  // the primary action and earns the top of the page.
  return (
    <>
      {!editable && !distributed && (
        <Notice tone="warn">
          The check-in deadline has passed, so beneficiaries, approvers and
          timings can no longer be changed. This is deliberate: once the estate
          enters its distribution phase, its terms are locked.
          {/* Freezing is not permanent until a release is actually due —
              while the estate is only *asking* whether the owner is gone, a
              check-in is the answer, and it restores editing. */}
          {(state === EstateState.GracePeriod ||
            state === EstateState.AwaitingApproval) && (
            <>
              {" "}
              <strong>Checking in unlocks them again</strong> — it proves you are
              still here, which is the only thing being asked.
            </>
          )}
        </Notice>
      )}

      <ShareAddress
        estate={estate}
        vault={vault}
        hasRecipients={
          info.beneficiaryCount > 0 ||
          info.residuaryBeneficiary !== "0x0000000000000000000000000000000000000000"
        }
      />

      <TimingCard estate={estate} info={info} editable={editable} refetch={refetch} />

      <BeneficiariesCard
        estate={estate}
        owner={owner}
        info={info}
        beneficiaries={beneficiaries}
        editable={editable}
        vaultBalance={vaultBalance}
        refetch={refetch}
      />

      <ApproversCard
        estate={estate}
        owner={owner}
        approvers={approvers}
        policy={policy}
        mode={mode}
        info={info}
        editable={editable}
        refetch={refetch}
      />

      {vault && (
        <FundingCard
          vault={vault}
          vaultBalance={vaultBalance}
          info={info}
          mode={mode}
          distributed={distributed}
          refetch={refetch}
        />
      )}
    </>
  );
}

function BeneficiariesCard({
  estate,
  owner,
  info,
  beneficiaries,
  editable,
  vaultBalance,
  refetch,
}: {
  estate: `0x${string}`;
  owner: `0x${string}`;
  info: EstateInfo;
  beneficiaries: readonly Beneficiary[];
  editable: boolean;
  vaultBalance?: bigint;
  refetch: () => void;
}) {
  const [wallet, setWallet] = useState("");
  const [percent, setPercent] = useState("");
  const [residuary, setResiduary] = useState("");
  const [reviewAdd, setReviewAdd] = useState(false);
  const [editingId, setEditingId] = useState<bigint | null>(null);
  const [editPercent, setEditPercent] = useState("");
  const [reviewEdit, setReviewEdit] = useState(false);
  const [reviewResiduary, setReviewResiduary] = useState(false);
  const [reviewClearResiduary, setReviewClearResiduary] = useState(false);
  const [removing, setRemoving] = useState<Beneficiary | null>(null);

  const tx = useTx(() => {
    setWallet("");
    setPercent("");
    setReviewAdd(false);
    setRemoving(null);
    setReviewEdit(false);
    setEditingId(null);
    setEditPercent("");
    refetch();
  });
  const residuaryTx = useTx(() => {
    setResiduary("");
    setReviewResiduary(false);
    setReviewClearResiduary(false);
    refetch();
  });

  // Once the vault holds funds, an edit may not leave any portion of the
  // estate without a destination. Removing a beneficiary from a fully
  // allocated estate frees up their share, so it needs somewhere to go —
  // the contract reverts otherwise, and MetaMask reports that only as
  // "network fee unavailable" because it fails at gas estimation.
  const funded = (vaultBalance ?? 0n) > 0n;
  const hasResiduary =
    info.residuaryBeneficiary !== "0x0000000000000000000000000000000000000000";

  // Clearing the residuary while the vault is funded and shares total under
  // 100% leaves part of the estate with no destination — the contract reverts.
  // --- editing an existing share -------------------------------------
  const editing = beneficiaries.find((b) => b.id === editingId);
  const editBps = Math.round(Number(editPercent) * 100);
  const editTotal = editing
    ? Number(info.totalAllocatedBps) - editing.shareBps + editBps
    : 0;

  // Mirrors the contract: the new share must be above zero, the total must not
  // exceed 100%, and — while the vault holds funds with no residuary named —
  // must land exactly on 100%, or the freed portion would have no destination.
  const editError: string | null = !editing
    ? null
    : !Number.isFinite(editBps) || editBps <= 0
      ? "Enter a share above 0%."
      : editTotal > BPS_TOTAL
        ? `That would take the total to ${bpsToPercent(editTotal)}. The most this beneficiary can have is ${bpsToPercent(BPS_TOTAL - (Number(info.totalAllocatedBps) - editing.shareBps))}.`
        : funded && !hasResiduary && editTotal < BPS_TOTAL
          ? `That would leave ${bpsToPercent(BPS_TOTAL - editTotal)} unallocated. While the vault holds funds, name a residuary beneficiary first or keep the total at 100%.`
          : null;

  const editValid = Boolean(editing) && editPercent !== "" && !editError;

  const startEdit = (b: Beneficiary) => {
    setEditingId(b.id);
    setEditPercent(String(b.shareBps / 100));
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditPercent("");
  };

  // Removing the residuary is refused while the vault holds funds and shares
  // total under 100%, because the remainder would then have no destination.
  const clearBlockedReason: string | null =
    funded && Number(info.totalAllocatedBps) < BPS_TOTAL
      ? `Shares total ${bpsToPercent(info.totalAllocatedBps)}, so ${bpsToPercent(BPS_TOTAL - Number(info.totalAllocatedBps))} would have nowhere to go. Allocate the full 100% first, or withdraw the vault's funds.`
      : null;

  const clearingResiduaryBlocked =
    isAddress(residuary) &&
    residuary.toLowerCase() === "0x0000000000000000000000000000000000000000" &&
    funded &&
    Number(info.totalAllocatedBps) < BPS_TOTAL;

  const blockedReason = (b: Beneficiary): string | null => {
    if (!funded || hasResiduary) return null;

    const remainingCount = beneficiaries.length - 1;
    if (remainingCount === 0) {
      return "This is the only recipient, and the vault holds funds. Name a residuary beneficiary first, or withdraw the funds before removing them.";
    }
    if (Number(info.totalAllocatedBps) - b.shareBps < BPS_TOTAL) {
      return `Removing them would leave ${bpsToPercent(b.shareBps)} of the vault unallocated. Name a residuary beneficiary first, or withdraw the funds before removing them.`;
    }
    return null;
  };

  const bps = Math.round(Number(percent) * 100);
  const remaining = BPS_TOTAL - Number(info.totalAllocatedBps);
  const walletIsSelf = isSelf(wallet, owner);
  const residuaryIsSelf = isSelf(residuary, owner);

  // The contract rejects a wallet that is already an active beneficiary. A
  // removed one is fine to re-add, and `beneficiaries` holds only active
  // entries, so comparing against it matches the contract exactly.
  const walletIsDuplicate =
    isAddress(wallet) &&
    beneficiaries.some((b) => b.wallet.toLowerCase() === wallet.toLowerCase());

  const addValid =
    isAddress(wallet) &&
    !walletIsSelf &&
    !walletIsDuplicate &&
    bps > 0 &&
    bps <= remaining &&
    percent !== "";

  return (
    <Panel
      title="Beneficiaries"
      hint={`Shares are literal percentages of the vault. ${bpsToPercent(
        remaining
      )} still unallocated.`}
    >
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Wallet</th>
              <th className="num">Share</th>
              {editable && <th />}
            </tr>
          </thead>
          <tbody>
            {beneficiaries.length === 0 && (
              <tr>
                <td colSpan={3} className="empty">
                  No beneficiaries yet.
                </td>
              </tr>
            )}
            {beneficiaries.map((b) => (
              <tr key={String(b.id)}>
                <td>
                  <AddressLink address={b.wallet} />
                </td>
                <td className="num">
                  {editingId === b.id ? (
                    <input
                      type="number"
                      value={editPercent}
                      min={0.01}
                      step={0.01}
                      autoFocus
                      style={{ maxWidth: 110, textAlign: "right" }}
                      onChange={(e) => setEditPercent(e.target.value)}
                    />
                  ) : (
                    bpsToPercent(b.shareBps)
                  )}
                </td>
                {editable && (
                  <td className="num">
                    <div className="actions-cell" style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      {editingId === b.id ? (
                        <>
                          <button
                            onClick={() => setReviewEdit(true)}
                            disabled={!editValid || tx.isPending || tx.isConfirming}
                          >
                            Save
                          </button>
                          <button className="secondary" onClick={cancelEdit}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="secondary"
                            onClick={() => startEdit(b)}
                            disabled={tx.isPending || tx.isConfirming}
                          >
                            Edit share
                          </button>
                          <button
                            className="secondary"
                            onClick={() => setRemoving(b)}
                            disabled={Boolean(blockedReason(b)) || tx.isPending || tx.isConfirming}
                            title={blockedReason(b) ?? undefined}
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>


      {editing && editError && <Notice tone="error">{editError}</Notice>}

      {editable && funded && !hasResiduary && beneficiaries.some((b) => blockedReason(b)) && (
        <Notice tone="warn">
          <strong>Beneficiaries cannot be removed right now.</strong> The vault
          holds funds and every share is allocated, so removing anyone would
          leave part of the estate with no destination. Either:
          <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            <li>
              name a <strong>residuary beneficiary</strong> below — they receive
              whatever is unallocated, which frees you to change shares
              afterwards; or
            </li>
            <li>
              withdraw the vault's funds first, make the change, then deposit
              again.
            </li>
          </ul>
        </Notice>
      )}

      {beneficiaries.length > 0 && (
        <Notice>
          <strong>Have you given each of them the estate address?</strong> They
          cannot find it themselves — there is no way to search for an estate you
          are named in. It is at the top of this page.
        </Notice>
      )}

      {editable && (
        <>
          <TxStatus {...tx} />
          <div className="row" style={{ marginTop: 8 }}>
            <div className="field">
              <label>Beneficiary wallet</label>
              <input
                placeholder="0x…"
                value={wallet}
                onChange={(e) => setWallet(e.target.value)}
              />
              {walletIsSelf && (
                <div className="muted" style={{ fontSize: 12, marginTop: 4, color: "var(--urgent)" }}>
                  {SELF_WARNING}
                </div>
              )}
              {walletIsDuplicate && (
                <div className="muted" style={{ fontSize: 12, marginTop: 4, color: "var(--urgent)" }}>
                  This wallet is already a beneficiary. Change their share in the
                  table above instead of adding them twice.
                </div>
              )}
            </div>
            <div className="field">
              <label>Share (%)</label>
              <input
                type="number"
                placeholder="25"
                value={percent}
                min={0.01}
                step={0.01}
                onChange={(e) => setPercent(e.target.value)}
              />
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Up to {bpsToPercent(remaining)} available
              </div>
            </div>
          </div>
          <div className="actions">
            <button
              onClick={() => setReviewAdd(true)}
              disabled={!addValid || tx.isPending || tx.isConfirming}
            >
              Review and add
            </button>
          </div>

        </>
      )}

      <section className="subsection">
        <h3>Residuary beneficiary</h3>
        <p className="sub-hint">
          Receives whatever share of the vault you have not allocated to anyone
          above. Naming one is what lets your shares total less than 100%.
        </p>

        <div className={`current${hasResiduary ? "" : " unset"}`}>
          <span className="who">
            <span className="label">{hasResiduary ? "Nominated" : "Nobody nominated"}</span>
            <span className="value">
              {hasResiduary ? (
                <AddressLink address={info.residuaryBeneficiary} />
              ) : (
                <span className="muted">Shares must total exactly 100%</span>
              )}
            </span>
          </span>
          <span className="amount">
            <span className="n">{bpsToPercent(remaining)}</span>
            <span className="cap">{hasResiduary ? "they receive" : "unallocated"}</span>
          </span>
        </div>

        {remaining > 0 && !hasResiduary && (
          <Notice tone="warn">
            Shares total {bpsToPercent(info.totalAllocatedBps)}, so{" "}
            {bpsToPercent(remaining)} has no destination. The vault will not
            accept deposits until you nominate someone here or allocate the full
            100%.
          </Notice>
        )}

        {editable && (
          <>
            <TxStatus {...residuaryTx} />

            <Field
              label={hasResiduary ? "Replace with" : "Nominate someone"}
              error={
                residuaryIsSelf
                  ? SELF_WARNING
                  : clearingResiduaryBlocked
                    ? "Use the Remove button below rather than entering an empty address."
                    : undefined
              }
              help="Anyone except yourself. They can also be one of the beneficiaries above."
            >
              <input
                placeholder="0x…"
                value={residuary}
                onChange={(e) => setResiduary(e.target.value)}
              />
            </Field>

            <div className="actions">
              <button
                onClick={() => setReviewResiduary(true)}
                disabled={
                  !isAddress(residuary) ||
                  residuaryIsSelf ||
                  clearingResiduaryBlocked ||
                  residuaryTx.isPending ||
                  residuaryTx.isConfirming
                }
              >
                {hasResiduary ? "Review and replace" : "Review and nominate"}
              </button>

              {hasResiduary && (
                <button
                  className="secondary"
                  onClick={() => setReviewClearResiduary(true)}
                  disabled={
                    Boolean(clearBlockedReason) ||
                    residuaryTx.isPending ||
                    residuaryTx.isConfirming
                  }
                  title={clearBlockedReason ?? undefined}
                >
                  Remove
                </button>
              )}
            </div>

            {hasResiduary && clearBlockedReason && (
              <p className="help" style={{ color: "var(--urgent)", marginTop: 8 }}>
                {clearBlockedReason}
              </p>
            )}
          </>
        )}
      </section>

      <Confirm
        open={reviewAdd}
        title="Add this beneficiary?"
        intro="Addresses cannot be checked against a name or an identity. Compare it character by character against the one you were given."
        rows={[
          { k: "Wallet", v: <Mono>{wallet}</Mono> },
          { k: "Share", v: bpsToPercent(bps) },
          { k: "Allocated after this", v: bpsToPercent(Number(info.totalAllocatedBps) + bps) },
          {
            k: "Still unallocated",
            v: bpsToPercent(BPS_TOTAL - Number(info.totalAllocatedBps) - bps),
          },
        ]}
        acknowledge="I have checked this address is correct, and I will give this person the estate address to keep — without it they cannot reach the estate."
        confirmLabel="Add beneficiary"
        onConfirm={() =>
          tx.send({
            address: estate,
            abi: EstateAbi,
            functionName: "addBeneficiary",
            args: [wallet as `0x${string}`, bps],
          })
        }
        onCancel={() => setReviewAdd(false)}
      />

      <Confirm
        open={reviewResiduary}
        title="Set residuary beneficiary?"
        intro="This person receives whatever share of the vault you have not allocated to anyone else."
        rows={[
          { k: "Wallet", v: <Mono>{residuary}</Mono> },
          { k: "They would receive", v: bpsToPercent(remaining) },
          ...(info.residuaryBeneficiary !== "0x0000000000000000000000000000000000000000"
            ? [{ k: "Replaces", v: <Mono>{info.residuaryBeneficiary}</Mono> }]
            : []),
        ]}
        acknowledge="I have checked this address is correct."
        confirmLabel="Set residuary"
        onConfirm={() =>
          residuaryTx.send({
            address: estate,
            abi: EstateAbi,
            functionName: "setResiduaryBeneficiary",
            args: [residuary as `0x${string}`],
          })
        }
        onCancel={() => setReviewResiduary(false)}
      />

      <Confirm
        open={reviewEdit && Boolean(editing)}
        title="Change this share?"
        intro="Shares are literal percentages of whatever the vault holds when the estate is released."
        rows={
          editing
            ? [
                { k: "Wallet", v: <Mono>{editing.wallet}</Mono> },
                { k: "Current share", v: bpsToPercent(editing.shareBps) },
                { k: "New share", v: bpsToPercent(editBps) },
                { k: "Allocated after this", v: bpsToPercent(editTotal) },
                {
                  k: "Still unallocated",
                  v: bpsToPercent(BPS_TOTAL - editTotal),
                },
              ]
            : []
        }
        confirmLabel="Update share"
        onConfirm={() =>
          editing &&
          tx.send({
            address: estate,
            abi: EstateAbi,
            functionName: "updateBeneficiary",
            args: [editing.id, editBps],
          })
        }
        onCancel={() => setReviewEdit(false)}
      />

      <Confirm
        open={reviewClearResiduary}
        danger
        title="Remove the residuary beneficiary?"
        intro="Nobody will be nominated to receive unallocated funds. You can name someone again at any time while the estate is active."
        rows={[
          { k: "Currently", v: <Mono>{info.residuaryBeneficiary}</Mono> },
          { k: "Shares allocated", v: bpsToPercent(info.totalAllocatedBps) },
          {
            k: "After removal",
            v:
              Number(info.totalAllocatedBps) === BPS_TOTAL
                ? "Fully allocated — nothing left over"
                : `${bpsToPercent(BPS_TOTAL - Number(info.totalAllocatedBps))} would be unallocated`,
          },
        ]}
        confirmLabel="Remove residuary"
        onConfirm={() =>
          residuaryTx.send({
            address: estate,
            abi: EstateAbi,
            functionName: "setResiduaryBeneficiary",
            args: ["0x0000000000000000000000000000000000000000"],
          })
        }
        onCancel={() => setReviewClearResiduary(false)}
      />

      <Confirm
        open={removing !== null}
        danger
        title="Remove this beneficiary?"
        intro="They will receive nothing when the estate is released. You can add them back while you are still checking in."
        rows={
          removing
            ? [
                { k: "Wallet", v: <Mono>{removing.wallet}</Mono> },
                { k: "Losing share of", v: bpsToPercent(removing.shareBps) },
                {
                  k: "Allocated after this",
                  v: bpsToPercent(Number(info.totalAllocatedBps) - removing.shareBps),
                },
              ]
            : []
        }
        confirmLabel="Remove beneficiary"
        onConfirm={() =>
          removing &&
          tx.send({
            address: estate,
            abi: EstateAbi,
            functionName: "removeBeneficiary",
            args: [removing.id],
          })
        }
        onCancel={() => setRemoving(null)}
      />
    </Panel>
  );
}

function ApproversCard({
  estate,
  owner,
  approvers,
  policy,
  mode,
  info,
  editable,
  refetch,
}: {
  estate: `0x${string}`;
  owner: `0x${string}`;
  policy?: readonly [number, number, bigint];
  mode?: number;
  approvers: Approver[];
  info: EstateInfo;
  editable: boolean;
  refetch: () => void;
}) {
  const [wallet, setWallet] = useState("");
  const [reviewAdd, setReviewAdd] = useState(false);
  const [removing, setRemoving] = useState<Approver | null>(null);

  const tx = useTx(() => {
    setWallet("");
    setReviewAdd(false);
    setRemoving(null);
    refetch();
  });

  const active = approvers.filter((a) => a.active);
  const approverIsSelf = isSelf(wallet, owner);
  const approverIsDuplicate =
    isAddress(wallet) &&
    active.some((a) => a.wallet.toLowerCase() === wallet.toLowerCase());

  // Release mode is fixed at construction, so an Automatic estate can never
  // use approvers: requiredApprovals() stays 0 and getState() goes straight to
  // ReadyForDistribution, which makes approveDistribution() always revert.
  // Offering an add form here would sell a control that does nothing.
  const automatic = mode === DistributionMode.Automatic;

  // The contract refuses a removal that leaves a quorum nobody could reach.
  // AnyOne and All track the live count so they only fail at zero; a fixed
  // Threshold fails as soon as the count drops below it.
  const removalBlockedReason = (): string | null => {
    if (mode !== DistributionMode.ApprovalRequired) return null;

    const remaining = active.length - 1;

    if (remaining === 0) {
      return "This estate requires approval, so it must keep at least one approver. Add a replacement before removing this one.";
    }
    if (policy && policy[0] === ApprovalRule.Threshold && policy[1] > remaining) {
      return `This estate needs ${policy[1]} approvals, so it must keep at least ${policy[1]} approvers. Add a replacement before removing this one.`;
    }
    return null;
  };

  const removalBlocked = removalBlockedReason();

  // Under the All rule the bar follows the live approver count, so the number
  // on the confirmation has to be the one that will hold after this add - not
  // today's requiredApprovals, which is still 0 while the list is empty.
  const requiredAfterAdd =
    policy && policy[0] === ApprovalRule.All
      ? active.length + 1
      : info.requiredApprovals;

  const hint = automatic
    ? "This estate releases automatically, so it does not use approvers."
    : active.length === 0
      ? "None yet. This estate requires approval, so it cannot be funded or released until you add one."
      : `${active.length} active. This estate needs ${info.requiredApprovals} approval(s) to release.`;

  return (
    <Panel title="Approvers" hint={hint}>
      {automatic && (
        <Notice>
          <strong>You chose automatic release for this estate.</strong> Once the
          check-in deadline and grace period pass, anyone can trigger
          distribution and no approvals are collected. Release mode is fixed
          when the estate is created, so approvers can never be given a say
          here.
        </Notice>
      )}

      {automatic && active.length > 0 && (
        <Notice tone="warn">
          The approvers below have no effect on this estate — they cannot
          approve anything, and nothing waits on them. You can safely remove
          them.
        </Notice>
      )}

      {(!automatic || active.length > 0) && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Wallet</th>
                <th>Status</th>
                {editable && <th />}
              </tr>
            </thead>
            <tbody>
              {active.length === 0 && (
                <tr>
                  <td colSpan={3} className="empty">
                    No approvers yet.
                  </td>
                </tr>
              )}
              {active.map((a) => (
                <tr key={String(a.id)}>
                  <td>
                    <AddressLink address={a.wallet} />
                  </td>
                  <td>
                    {a.approved ? (
                      <span className="badge ok">Approved</span>
                    ) : (
                      <span className="muted">Not yet</span>
                    )}
                  </td>
                  {editable && (
                    <td className="num">
                      <button
                        className="secondary"
                        onClick={() => setRemoving(a)}
                        disabled={Boolean(removalBlocked) || tx.isPending || tx.isConfirming}
                        title={removalBlocked ?? undefined}
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editable && removalBlocked && (
        <Notice tone="warn">{removalBlocked}</Notice>
      )}

      {!automatic && active.length > 0 && (
        <Notice>
          <strong>Have you given each approver the estate address?</strong> They
          need it to approve when the time comes, and cannot find it themselves.
        </Notice>
      )}

      {/* Also covers removing an inert approver from an Automatic estate,
          where the add form below is not rendered at all. */}
      {editable && <TxStatus {...tx} />}

      {editable && !automatic && (
        <>
          <div className="field" style={{ marginTop: 12 }}>
            <label>Approver wallet</label>
            <input
              placeholder="0x…"
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
            />
            {approverIsSelf && (
              <div className="muted" style={{ fontSize: 12, marginTop: 4, color: "var(--urgent)" }}>
                You cannot be an approver on your own estate — approval only
                matters once you are no longer around to give it.
              </div>
            )}
            {approverIsDuplicate && (
              <div className="muted" style={{ fontSize: 12, marginTop: 4, color: "var(--urgent)" }}>
                This wallet is already an approver on this estate.
              </div>
            )}
          </div>
          <div className="actions">
            <button
              onClick={() => setReviewAdd(true)}
              disabled={
                !isAddress(wallet) ||
                approverIsSelf ||
                approverIsDuplicate ||
                active.length >= MAX_APPROVERS ||
                tx.isPending ||
                tx.isConfirming
              }
            >
              Review and add
            </button>
            {active.length >= MAX_APPROVERS && (
              <span className="muted" style={{ alignSelf: "center", fontSize: 13 }}>
                Maximum of {MAX_APPROVERS} reached.
              </span>
            )}
          </div>
        </>
      )}

      <Confirm
        open={reviewAdd}
        title="Add this approver?"
        intro="Approvers can confirm the release of your estate. They can never take or redirect the funds."
        rows={[
          { k: "Wallet", v: <Mono>{wallet}</Mono> },
          { k: "Approvers after this", v: active.length + 1 },
          { k: "Approvals needed to release", v: requiredAfterAdd },
        ]}
        acknowledge="I have checked this address, I trust this person to act when the time comes, and I will give them the estate address to keep."
        confirmLabel="Add approver"
        onConfirm={() =>
          tx.send({
            address: estate,
            abi: EstateAbi,
            functionName: "addApprover",
            args: [wallet as `0x${string}`],
          })
        }
        onCancel={() => setReviewAdd(false)}
      />

      <Confirm
        open={removing !== null}
        danger
        title="Remove this approver?"
        intro="They will no longer be able to approve the release of your estate."
        rows={
          removing
            ? [
                { k: "Wallet", v: <Mono>{removing.wallet}</Mono> },
                { k: "Approvers after this", v: active.length - 1 },
              ]
            : []
        }
        confirmLabel="Remove approver"
        onConfirm={() =>
          removing &&
          tx.send({
            address: estate,
            abi: EstateAbi,
            functionName: "removeApprover",
            args: [removing.id],
          })
        }
        onCancel={() => setRemoving(null)}
      />
    </Panel>
  );
}

function FundingCard({
  vault,
  vaultBalance,
  info,
  mode,
  distributed,
  refetch,
}: {
  vault: `0x${string}`;
  vaultBalance?: bigint;
  info: EstateInfo;
  /// 0 = Automatic, 1 = ApprovalRequired
  mode?: number;
  distributed?: boolean;
  refetch: () => void;
}) {
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [reviewWithdraw, setReviewWithdraw] = useState(false);

  const depositWei = safeParseEther(depositAmount);
  const withdrawWei = safeParseEther(withdrawAmount);

  const available = vaultBalance ?? 0n;
  const withdrawTooMuch = withdrawWei !== null && withdrawWei > available;
  const withdrawValid = withdrawWei !== null && withdrawWei > 0n && !withdrawTooMuch;
  const depositValid = depositWei !== null && depositWei > 0n;

  const {
    sendTransaction,
    data: depositHash,
    isPending: depositPending,
    error: depositError,
  } = useSendTransaction();
  const { isLoading: depositConfirming, isSuccess: depositDone } =
    useWaitForTransactionReceipt({ hash: depositHash });

  const withdrawTx = useTx(() => {
    setWithdrawAmount("");
    setReviewWithdraw(false);
    refetch();
  });

  if (depositDone) refetch();

  return (
    <Panel
      title="Funding"
      hint="Deposits are plain zkLTC transfers to the vault. Only you can withdraw, and only before distribution."
    >
      {!info.fullyConfigured && (
        <Notice tone="warn">
          <strong>The vault will reject deposits until this is fixed.</strong>{" "}
          {describeConfigGap(info, mode as DistributionMode | undefined) ??
            "The estate is not fully configured yet."}
          {available > 0n && (
            <>
              {" "}
              Anything already in the vault is unaffected — it stays yours to
              withdraw, and will still be distributed if the estate is released.
            </>
          )}
        </Notice>
      )}

      {distributed && (
        <Notice>This estate has been distributed — funding is closed.</Notice>
      )}

      <div className="row">
        <Field
          label="Deposit (zkLTC)"
          error={
            depositAmount.trim() && depositWei === null ? "That is not a valid amount." : undefined
          }
          help="Adds funds to the vault. Beneficiaries receive a percentage of whatever is here when the estate is released — not a fixed amount — so this can change any time."
        >
          <input
            type="number"
            placeholder="1.0"
            value={depositAmount}
            min={0}
            step="any"
            onChange={(e) => setDepositAmount(e.target.value)}
          />
        </Field>
        <Field
          label="Withdraw (zkLTC)"
          range={`Available: ${formatZkLtc(vaultBalance)} zkLTC`}
          rangeBad={withdrawTooMuch}
          error={
            withdrawTooMuch
              ? `That is more than the vault holds. The most you can withdraw is ${formatZkLtc(available)} zkLTC.`
              : withdrawAmount.trim() && withdrawWei === null
                ? "That is not a valid amount."
                : undefined
          }
          help="It stays your money. You can take any amount out at any time right up until the estate is distributed — no waiting period and no approval."
        >
          <input
            type="number"
            placeholder="1.0"
            value={withdrawAmount}
            min={0}
            step="any"
            onChange={(e) => setWithdrawAmount(e.target.value)}
          />
        </Field>
      </div>

      {depositError && <Notice tone="error">{explainError(depositError)}</Notice>}
      {depositPending && <Notice>Confirm the deposit in your wallet…</Notice>}
      {depositConfirming && <Notice>Waiting for confirmation…</Notice>}
      <TxStatus {...withdrawTx} />

      <div className="actions">
        <button
          onClick={() => depositWei !== null && sendTransaction({ to: vault, value: depositWei })}
          disabled={
            !depositValid ||
            !info.fullyConfigured ||
            distributed ||
            depositPending ||
            depositConfirming
          }
        >
          Deposit
        </button>
        <button
          className="secondary"
          onClick={() => setReviewWithdraw(true)}
          disabled={
            !withdrawValid || distributed || withdrawTx.isPending || withdrawTx.isConfirming
          }
        >
          Withdraw
        </button>
      </div>

      <Confirm
        open={reviewWithdraw}
        title="Withdraw from the vault?"
        intro="This returns funds to your own wallet."
        rows={[
          { k: "Amount", v: `${formatZkLtc(withdrawWei ?? 0n)} zkLTC` },
          { k: "Vault holds", v: `${formatZkLtc(available)} zkLTC` },
          {
            k: "Left in vault",
            v: `${formatZkLtc(available - (withdrawWei ?? 0n))} zkLTC`,
          },
        ]}
        confirmLabel="Withdraw"
        onConfirm={() =>
          withdrawWei !== null &&
          withdrawTx.send({
            address: vault,
            abi: EstateVaultAbi,
            functionName: "withdraw",
            args: [withdrawWei],
          })
        }
        onCancel={() => setReviewWithdraw(false)}
      />
    </Panel>
  );
}

const DAY_SECONDS = 86_400;

/// Editing the check-in interval and grace period.
///
/// Bounds come from the estate's own immutables, not the current factory —
/// an estate created by an older factory may permit different ranges.
function TimingCard({
  estate,
  info,
  editable,
  refetch,
}: {
  estate: `0x${string}`;
  info: EstateInfo;
  editable: boolean;
  refetch: () => void;
}) {
  const { limits } = useEstateLimits(estate);

  const currentHeartbeatDays = Math.round(
    (Number(info.heartbeatEnds) - Number(info.lastCheckIn)) / DAY_SECONDS
  );
  const currentGraceDays = Math.round(
    (Number(info.graceEnds) - Number(info.heartbeatEnds)) / DAY_SECONDS
  );

  const [heartbeat, setHeartbeat] = useState(String(currentHeartbeatDays));
  const [grace, setGrace] = useState(String(currentGraceDays));
  const [reviewing, setReviewing] = useState<"heartbeat" | "grace" | null>(null);

  const hbTx = useTx(() => {
    setReviewing(null);
    refetch();
  });
  const grTx = useTx(() => {
    setReviewing(null);
    refetch();
  });

  const hb = Number(heartbeat);
  const gr = Number(grace);

  const hbInRange =
    Number.isFinite(hb) && hb >= limits.minHeartbeatDays && hb <= limits.maxHeartbeatDays;
  const grInRange = Number.isFinite(gr) && gr >= limits.minGraceDays && gr <= limits.maxGraceDays;

  // Updating the interval restarts the clock, so the new deadline is always
  // the full period from now.

  const hbChanged = hbInRange && hb !== currentHeartbeatDays;
  const grChanged = grInRange && gr !== currentGraceDays;

  return (
    <Panel
      title="Timings"
      hint="How long you can go without checking in, and how long you have to recover after missing one."
    >
      {!editable && (
        <Notice tone="warn">
          Timings are frozen — they can only be changed while the estate is
          active. Check in to unfreeze them.
        </Notice>
      )}

      <div className="row">
        <Field
          label="Check in every (days)"
          range={`${limits.minHeartbeatDays}–${limits.maxHeartbeatDays} allowed · currently ${currentHeartbeatDays}`}
          rangeBad={!hbInRange}
          help={
            hbChanged
              ? `Saving this also counts as a check-in, so your next one would be due in ${hb} days.`
              : "Saving a new interval also counts as a check-in — the clock restarts from that moment."
          }
        >
          <input
            type="number"
            value={heartbeat}
            min={limits.minHeartbeatDays}
            max={limits.maxHeartbeatDays}
            disabled={!editable}
            onChange={(e) => setHeartbeat(e.target.value)}
          />
        </Field>

        <Field
          label="Grace period (days)"
          range={`${limits.minGraceDays}–${limits.maxGraceDays} allowed · currently ${currentGraceDays}`}
          rangeBad={!grInRange}
          help="Time to recover after a missed check-in. Shortening this is always safe — it starts from your check-in deadline, never from today."
        >
          <input
            type="number"
            value={grace}
            min={limits.minGraceDays}
            max={limits.maxGraceDays}
            disabled={!editable}
            onChange={(e) => setGrace(e.target.value)}
          />
        </Field>
      </div>

      <TxStatus {...hbTx} />
      <TxStatus {...grTx} />

      <div className="actions">
        <button
          onClick={() => setReviewing("heartbeat")}
          disabled={!editable || !hbChanged || hbTx.isPending || hbTx.isConfirming}
        >
          Update check-in interval
        </button>
        <button
          className="secondary"
          onClick={() => setReviewing("grace")}
          disabled={!editable || !grChanged || grTx.isPending || grTx.isConfirming}
        >
          Update grace period
        </button>
      </div>

      <Confirm
        open={reviewing === "heartbeat"}
        title="Change your check-in interval?"
        intro="Saving this also counts as a check-in, so the new interval starts from now."
        rows={[
          { k: "Current", v: `${currentHeartbeatDays} days` },
          { k: "New", v: `${hb} days` },
          { k: "Next check-in due in", v: `${hb} days` },
          { k: "Longest silence before release", v: `${hb + currentGraceDays} days` },
        ]}
        confirmLabel="Update interval"
        onConfirm={() =>
          hbTx.send({
            address: estate,
            abi: EstateAbi,
            functionName: "updateHeartbeat",
            args: [BigInt(hb) * BigInt(DAY_SECONDS)],
          })
        }
        onCancel={() => setReviewing(null)}
      />

      <Confirm
        open={reviewing === "grace"}
        title="Change your grace period?"
        intro="The window to recover your estate after missing a check-in."
        rows={[
          { k: "Current", v: `${currentGraceDays} days` },
          { k: "New", v: `${gr} days` },
          { k: "Longest silence before release", v: `${currentHeartbeatDays + gr} days` },
        ]}
        confirmLabel="Update grace period"
        onConfirm={() =>
          grTx.send({
            address: estate,
            abi: EstateAbi,
            functionName: "updateGracePeriod",
            args: [BigInt(gr) * BigInt(DAY_SECONDS)],
          })
        }
        onCancel={() => setReviewing(null)}
      />
    </Panel>
  );
}
