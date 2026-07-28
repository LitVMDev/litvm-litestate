import { useState } from "react";
import { parseEther, isAddress } from "viem";
import { useSendTransaction, useWaitForTransactionReceipt } from "wagmi";

import { EstateAbi } from "../abis/Estate";
import { EstateVaultAbi } from "../abis/EstateVault";
import {
  BPS_TOTAL,
  EstateState,
  MAX_APPROVERS,
  bpsToPercent,
  explainError,
  formatZkLtc,
  type EstateInfo,
} from "../lib/estate";
import type { Approver, Beneficiary } from "../lib/useEstate";
import { useTx } from "../lib/useTx";
import { AddressLink, Field, Notice, Panel, TxStatus } from "./Common";
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
        </Notice>
      )}

      <BeneficiariesCard
        estate={estate}
        owner={owner}
        info={info}
        beneficiaries={beneficiaries}
        editable={editable}
        refetch={refetch}
      />

      <ApproversCard
        estate={estate}
        owner={owner}
        approvers={approvers}
        info={info}
        editable={editable}
        refetch={refetch}
      />

      {vault && (
        <FundingCard
          vault={vault}
          vaultBalance={vaultBalance}
          info={info}
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
  refetch,
}: {
  estate: `0x${string}`;
  owner: `0x${string}`;
  info: EstateInfo;
  beneficiaries: readonly Beneficiary[];
  editable: boolean;
  refetch: () => void;
}) {
  const [wallet, setWallet] = useState("");
  const [percent, setPercent] = useState("");
  const [residuary, setResiduary] = useState("");
  const [reviewAdd, setReviewAdd] = useState(false);
  const [reviewResiduary, setReviewResiduary] = useState(false);
  const [removing, setRemoving] = useState<Beneficiary | null>(null);

  const tx = useTx(() => {
    setWallet("");
    setPercent("");
    setReviewAdd(false);
    setRemoving(null);
    refetch();
  });
  const residuaryTx = useTx(() => {
    setResiduary("");
    setReviewResiduary(false);
    refetch();
  });

  const bps = Math.round(Number(percent) * 100);
  const remaining = BPS_TOTAL - Number(info.totalAllocatedBps);
  const walletIsSelf = isSelf(wallet, owner);
  const residuaryIsSelf = isSelf(residuary, owner);
  const addValid =
    isAddress(wallet) && !walletIsSelf && bps > 0 && bps <= remaining && percent !== "";

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
                <td className="num">{bpsToPercent(b.shareBps)}</td>
                {editable && (
                  <td className="num">
                    <button
                      className="secondary"
                      onClick={() => setRemoving(b)}
                      disabled={tx.isPending || tx.isConfirming}
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

      <div style={{ marginTop: 14 }}>
        <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
          Residuary beneficiary — receives anything left unallocated:{" "}
          <AddressLink address={info.residuaryBeneficiary} />
        </div>
      </div>

      {remaining > 0 &&
        info.residuaryBeneficiary === "0x0000000000000000000000000000000000000000" && (
          <Notice tone="warn">
            <strong>A residuary beneficiary is required.</strong> Shares total{" "}
            {bpsToPercent(info.totalAllocatedBps)}, so {bpsToPercent(remaining)} has
            no named destination. Name someone below, or allocate the full 100%
            — the vault will not accept deposits until one of those is true.
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

          <hr
            style={{
              border: 0,
              borderTop: "1px solid var(--border)",
              margin: "18px 0 14px",
            }}
          />

          <TxStatus {...residuaryTx} />
          <div className="field">
            <label>Set residuary beneficiary</label>
            <input
              placeholder="0x…"
              value={residuary}
              onChange={(e) => setResiduary(e.target.value)}
            />
            {residuaryIsSelf && (
              <div className="muted" style={{ fontSize: 12, marginTop: 4, color: "var(--urgent)" }}>
                {SELF_WARNING}
              </div>
            )}
          </div>
          <div className="actions">
            <button
              className="secondary"
              onClick={() => setReviewResiduary(true)}
              disabled={
                !isAddress(residuary) ||
                residuaryIsSelf ||
                residuaryTx.isPending ||
                residuaryTx.isConfirming
              }
            >
              Review and set
            </button>
          </div>
        </>
      )}

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
        acknowledge="I have checked this address is correct. If it is wrong, the funds cannot be recovered once the estate is released."
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
  info,
  editable,
  refetch,
}: {
  estate: `0x${string}`;
  owner: `0x${string}`;
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

  return (
    <Panel
      title="Approvers"
      hint={`${active.length} active. This estate needs ${info.requiredApprovals} approval(s) to release.`}
    >
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
                      disabled={tx.isPending || tx.isConfirming}
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

      {editable && (
        <>
          <TxStatus {...tx} />
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
          </div>
          <div className="actions">
            <button
              onClick={() => setReviewAdd(true)}
              disabled={
                !isAddress(wallet) ||
                approverIsSelf ||
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
          { k: "Approvals needed to release", v: info.requiredApprovals },
        ]}
        acknowledge="I have checked this address, and I trust this person to act when the time comes."
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
  distributed,
  refetch,
}: {
  vault: `0x${string}`;
  vaultBalance?: bigint;
  info: EstateInfo;
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
          The vault will reject deposits until the estate is fully configured.
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
