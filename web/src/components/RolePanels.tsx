import { EstateAbi } from "../abis/Estate";
import { EstateVaultAbi } from "../abis/EstateVault";
import {
  EstateState,
  formatZkLtc,
  timeUntil,
  type EstateInfo,
} from "../lib/estate";
import { useNow } from "../lib/useEstate";
import type { Approver } from "../lib/useEstate";
import { useTx } from "../lib/useTx";
import { useState } from "react";
import { Notice, Panel, TxStatus } from "./Common";
import { Confirm } from "./Confirm";

/// Shown to a connected wallet that is an active approver on this estate.
export function ApproverPanel({
  estate,
  info,
  approvers,
  viewer,
  refetch,
}: {
  estate: `0x${string}`;
  info: EstateInfo;
  approvers: Approver[];
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

  return (
    <Panel
      title="You are an approver"
      hint="Your approval helps release this estate to its beneficiaries."
    >
      {me.approved && <Notice tone="ok">You have already approved.</Notice>}

      {state === EstateState.Active && (
        <Notice>
          The owner is still checking in. There is nothing to approve yet.
        </Notice>
      )}

      {state === EstateState.GracePeriod && (
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

      <TxStatus {...tx} />

      <div className="actions">
        <button
          onClick={() => setReviewing(true)}
          disabled={!canApprove || tx.isPending || tx.isConfirming}
        >
          Approve distribution
        </button>
      </div>

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
