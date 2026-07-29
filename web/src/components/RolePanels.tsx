import { EstateAbi } from "../abis/Estate";
import { EstateVaultAbi } from "../abis/EstateVault";
import {
  BPS_TOTAL,
  DistributionMode,
  EstateState,
  bpsToPercent,
  formatZkLtc,
  timeUntil,
  type EstateInfo,
} from "../lib/estate";
import { useNow } from "../lib/useEstate";
import type { Approver, Beneficiary } from "../lib/useEstate";
import { useTx } from "../lib/useTx";
import { useState } from "react";
import { Notice, Panel, Stat, TxStatus } from "./Common";
import { Confirm } from "./Confirm";

/// Shown to a connected wallet that is an active approver on this estate.
export function ApproverPanel({
  estate,
  info,
  approvers,
  mode,
  viewer,
  refetch,
}: {
  estate: `0x${string}`;
  info: EstateInfo;
  approvers: Approver[];
  /// 0 = Automatic, 1 = ApprovalRequired
  mode?: number;
  viewer: `0x${string}`;
  refetch: () => void;
}) {
  const now = useNow();
  const [reviewing, setReviewing] = useState(false);
  const tx = useTx(() => {
    setReviewing(false);
    refetch();
  });

  const me = approvers.find(
    (a) => a.active && a.wallet.toLowerCase() === viewer.toLowerCase()
  );
  if (!me) return null;

  const state = info.state as EstateState;
  const windowLeft = timeUntil(info.approvalEnds, now);
  const canApprove =
    state === EstateState.AwaitingApproval && !me.approved && windowLeft !== null;

  // An estate created for automatic release never enters AwaitingApproval, so
  // this wallet is listed as an approver but has nothing it can ever approve.
  const automatic = mode === DistributionMode.Automatic;

  return (
    <Panel
      title="You are an approver"
      hint={
        automatic
          ? "This estate releases automatically, so there is nothing for you to approve."
          : "Your approval helps release this estate to its beneficiaries."
      }
    >
      {automatic && (
        <Notice>
          The owner set this estate to release automatically. Once its check-in
          deadline and grace period pass, anyone can trigger distribution — no
          approvals are collected, so you will not be asked to act.
        </Notice>
      )}

      {me.approved && <Notice tone="ok">You have already approved.</Notice>}

      {!automatic && state === EstateState.Active && (
        <Notice>
          The owner is still checking in. There is nothing to approve yet.
        </Notice>
      )}

      {!automatic && state === EstateState.GracePeriod && (
        <Notice tone="warn">
          The owner has missed a check-in. Approval opens once the grace period
          ends.
        </Notice>
      )}

      {state === EstateState.AwaitingApproval && (
        <Notice tone={windowLeft ? "warn" : "error"}>
          {info.approvalCount} of {info.requiredApprovals} approvals received.{" "}
          {windowLeft ? (
            <>
              <strong>{windowLeft}</strong> left to act — if the window closes
              without enough approvals, this estate can never be distributed.
            </>
          ) : (
            <>
              The window has closed. This estate can no longer be distributed.
            </>
          )}
        </Notice>
      )}

      {!automatic && (
        <>
          <TxStatus {...tx} />

          <div className="actions">
            <button
              onClick={() => setReviewing(true)}
              disabled={!canApprove || tx.isPending || tx.isConfirming}
            >
              Approve distribution
            </button>
          </div>
        </>
      )}

      <Confirm
        open={reviewing}
        title="Approve this release?"
        intro="You are confirming that this estate should be released to its beneficiaries. Approval cannot be withdrawn."
        rows={[
          { k: "Approvals so far", v: `${info.approvalCount} of ${info.requiredApprovals}` },
          {
            k: "After yours",
            v: `${info.approvalCount + 1} of ${info.requiredApprovals}${
              info.approvalCount + 1 >= info.requiredApprovals ? " — releases the estate" : ""
            }`,
          },
        ]}
        acknowledge="I understand this cannot be undone."
        confirmLabel="Approve"
        onConfirm={() =>
          tx.send({
            address: estate,
            abi: EstateAbi,
            functionName: "approveDistribution",
          })
        }
        onCancel={() => setReviewing(false)}
      />
    </Panel>
  );
}

/// What a named beneficiary — or the residuary beneficiary — would receive if
/// the estate were released right now.
///
/// Shown before distribution only; afterwards the amount is real and settled,
/// and BeneficiaryPanel takes over with a claim button.
///
/// The figure is deliberately framed as an illustration rather than an
/// entitlement. Every input to it can still change: the owner may re-cut the
/// shares, remove a beneficiary outright, or empty the vault, all without
/// anyone's permission, right up until the moment of release. Presenting it as
/// "your inheritance" would be a promise this contract does not make.
export function YourShare({
  info,
  beneficiaries,
  vaultBalance,
  viewer,
  distributed,
}: {
  info: EstateInfo;
  beneficiaries: readonly Beneficiary[];
  vaultBalance?: bigint;
  viewer?: `0x${string}`;
  distributed?: boolean;
}) {
  if (!viewer || distributed) return null;

  const me = viewer.toLowerCase();
  const named = beneficiaries.find((b) => b.active && b.wallet.toLowerCase() === me);
  const isResiduary = info.residuaryBeneficiary.toLowerCase() === me;

  if (!named && !isResiduary) return null;

  // The residuary beneficiary takes whatever the named shares do not cover, so
  // someone can hold both a fixed share and the remainder.
  const namedBps = named?.shareBps ?? 0;
  const residuaryBps = isResiduary ? BPS_TOTAL - Number(info.totalAllocatedBps) : 0;
  const totalBps = namedBps + residuaryBps;

  const balance = vaultBalance ?? 0n;

  // Same integer maths the vault uses in distribute(), so the illustration
  // cannot read higher than what would actually be set aside.
  const worth = (balance * BigInt(totalBps)) / BigInt(BPS_TOTAL);

  const state = info.state as EstateState;

  return (
    <Panel
      title="Your share of this estate"
      hint="An illustration of where things stand today — not an amount set aside for you."
    >
      <div className="stats">
        <Stat k="Your share" v={bpsToPercent(totalBps)} />
        <Stat k="Worth right now" v={`${formatZkLtc(worth)} zkLTC`} />
        <Stat k="Vault holds" v={`${formatZkLtc(balance)} zkLTC`} />
      </div>

      {named && isResiduary && residuaryBps > 0 && (
        <Notice>
          That is {bpsToPercent(namedBps)} as a named beneficiary plus the{" "}
          {bpsToPercent(residuaryBps)} left unallocated, which comes to you as
          the residuary beneficiary.
        </Notice>
      )}

      {!named && isResiduary && (
        <Notice>
          You are the residuary beneficiary: you receive whatever is not
          allocated to a named share — {bpsToPercent(residuaryBps)} of the vault
          as it stands.
        </Notice>
      )}

      {balance === 0n && (
        <Notice tone="warn">
          The vault is empty at the moment, so this share is currently worth
          nothing. That can change at any time — the owner can pay in and
          withdraw freely until the estate is released.
        </Notice>
      )}

      <Notice tone="warn">
        <strong>Nothing here is yours yet, and none of it is fixed.</strong> Your
        share is a percentage of whatever the vault holds at the moment of
        release, not a fixed amount, so this figure moves with the balance.{" "}
        {state === EstateState.Active ? (
          <>
            Until release the owner can also re-cut the shares, remove you
            outright, or withdraw the funds entirely, without needing anyone's
            agreement.
          </>
        ) : (
          <>
            The terms are now frozen — shares and beneficiaries can no longer be
            edited — but the owner can still withdraw the vault's funds until a
            distribution actually happens, and a single check-in from them
            unfreezes everything again.
          </>
        )}{" "}
        Treat it as an indication only.
      </Notice>
    </Panel>
  );
}

/// Anyone may trigger distribution once the estate is ready - it only moves
/// funds into each beneficiary's claimable balance, it does not redirect them.
export function DistributePanel({
  vault,
  info,
  vaultBalance,
  distributed,
  refetch,
}: {
  vault?: `0x${string}`;
  info: EstateInfo;
  vaultBalance?: bigint;
  distributed?: boolean;
  refetch: () => void;
}) {
  const [reviewing, setReviewing] = useState(false);
  const tx = useTx(() => {
    setReviewing(false);
    refetch();
  });

  const ready = (info.state as EstateState) === EstateState.ReadyForDistribution;
  if (!ready || distributed || !vault) return null;

  const empty = !vaultBalance || vaultBalance === 0n;

  return (
    <Panel
      title="Ready to distribute"
      hint="Anyone can run this. It records each beneficiary's share so they can claim it."
    >
      {empty && (
        <Notice tone="warn">
          The vault is empty, so there is nothing to distribute yet.
        </Notice>
      )}

      <TxStatus {...tx} />

      <div className="actions">
        <button
          onClick={() => setReviewing(true)}
          disabled={empty || tx.isPending || tx.isConfirming}
        >
          Distribute {formatZkLtc(vaultBalance)} zkLTC
        </button>
      </div>

      <Confirm
        open={reviewing}
        danger
        title="Release this estate?"
        intro="This sets aside each beneficiary's share so they can claim it. It happens once and cannot be reversed — after this the vault accepts no more deposits and the owner can no longer withdraw."
        rows={[
          { k: "Amount to distribute", v: `${formatZkLtc(vaultBalance)} zkLTC` },
          { k: "Beneficiaries", v: info.beneficiaryCount },
          { k: "Allocated", v: `${Number(info.totalAllocatedBps) / 100}%` },
        ]}
        acknowledge="I understand this is final and cannot be undone."
        confirmLabel="Release estate"
        onConfirm={() =>
          tx.send({
            address: vault,
            abi: EstateVaultAbi,
            functionName: "distribute",
          })
        }
        onCancel={() => setReviewing(false)}
      />
    </Panel>
  );
}

/// Shown to any wallet with a non-zero claimable balance on this vault.
export function BeneficiaryPanel({
  vault,
  myClaimable,
  refetch,
}: {
  vault?: `0x${string}`;
  myClaimable?: bigint;
  refetch: () => void;
}) {
  const tx = useTx(refetch);

  if (!vault || myClaimable === undefined || myClaimable === 0n) return null;

  return (
    <Panel
      title="You have funds to claim"
      hint="Your share was set aside when this estate was distributed. Claiming transfers it to your wallet."
    >
      <div className="stats">
        <div className="stat">
          <div className="k">Claimable</div>
          <div className="v">{formatZkLtc(myClaimable)} zkLTC</div>
        </div>
      </div>

      <TxStatus {...tx} />

      <div className="actions">
        <button
          onClick={() =>
            tx.send({
              address: vault,
              abi: EstateVaultAbi,
              functionName: "claim",
            })
          }
          disabled={tx.isPending || tx.isConfirming}
        >
          Claim {formatZkLtc(myClaimable)} zkLTC
        </button>
      </div>
    </Panel>
  );
}
