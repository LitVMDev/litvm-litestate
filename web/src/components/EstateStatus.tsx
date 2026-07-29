import {
  EstateState,
  STATE_LABEL,
  STATE_TONE,
  bpsToPercent,
  formatZkLtc,
  timeUntil,
  type EstateInfo,
} from "../lib/estate";
import { useNow } from "../lib/useEstate";
import { AddressLink, Notice, Panel, Stat } from "./Common";

/// The at-a-glance view every role sees: where the estate is in its lifecycle
/// and what deadline matters next.
export function EstateStatus({
  info,
  vaultBalance,
  estate,
  vault,
  distributed,
  hideDeadline = false,
}: {
  info: EstateInfo;
  vaultBalance?: bigint;
  estate: `0x${string}`;
  vault?: `0x${string}`;
  distributed?: boolean;
  /// Owners get the dedicated check-in card above this, which already shows
  /// the countdown - no need to print the same number twice.
  hideDeadline?: boolean;
}) {
  const now = useNow();
  const state = info.state as EstateState;

  const checkInLeft = timeUntil(info.heartbeatEnds, now);
  const graceLeft = timeUntil(info.graceEnds, now);
  const approvalLeft = timeUntil(info.approvalEnds, now);

  let deadlineLabel = "Check-in due in";
  let deadlineValue = checkInLeft ?? "Overdue";

  if (state === EstateState.GracePeriod) {
    deadlineLabel = "Grace ends in";
    deadlineValue = graceLeft ?? "Ended";
  } else if (state === EstateState.AwaitingApproval) {
    deadlineLabel = "Approval window closes in";
    deadlineValue = approvalLeft ?? "Closed";
  } else if (
    state === EstateState.ReadyForDistribution ||
    state === EstateState.Distributed
  ) {
    deadlineLabel = "Status";
    deadlineValue = STATE_LABEL[state];
  }

  const unallocated = 10_000 - Number(info.totalAllocatedBps);

  return (
    <Panel>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <div>
          <span className={`badge ${STATE_TONE[state]}`}>{STATE_LABEL[state]}</span>
          <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>
            Estate <AddressLink address={estate} />
            {vault && (
              <>
                {" · "}Vault <AddressLink address={vault} />
              </>
            )}
          </span>
        </div>
      </div>

      <div className={`balance${!vaultBalance || vaultBalance === 0n ? " empty-vault" : ""}`}>
        <div>
          <span className="cap">Vault balance</span>
          <span className="figure">
            <span className="n">{formatZkLtc(vaultBalance)}</span>
            <span className="unit">zkLTC</span>
          </span>
        </div>
        <div className="aside">
          {!vaultBalance || vaultBalance === 0n
            ? "Nothing to distribute yet"
            : distributed
              ? "Set aside for beneficiaries to claim"
              : `Shared out as ${bpsToPercent(info.totalAllocatedBps)} allocated shares`}
        </div>
      </div>

      <div className="stats">
        {!hideDeadline && <Stat k={deadlineLabel} v={deadlineValue} />}
        <Stat k="Beneficiaries" v={info.beneficiaryCount} />
        <Stat
          k="Allocated"
          v={bpsToPercent(info.totalAllocatedBps)}
        />
      </div>

      {state === EstateState.AwaitingApproval && (
        <Notice tone="warn">
          {info.approvalCount} of {info.requiredApprovals} required approvals
          received.{" "}
          {approvalLeft
            ? `Approvers have ${approvalLeft} left to act.`
            : "The approval window has closed — this estate can no longer be distributed."}
        </Notice>
      )}

      {!info.fullyConfigured && !distributed && (
        <Notice tone="warn">
          <strong>This estate cannot accept deposits yet.</strong> It needs at
          least one recipient, and — if it requires approval — enough approvers
          to satisfy its rule. The vault rejects funds until both are true.
        </Notice>
      )}

      {info.fullyConfigured && unallocated > 0 && !distributed && (
        <Notice>
          {bpsToPercent(unallocated)} of the vault is unallocated. It will go to{" "}
          {info.residuaryBeneficiary !==
          "0x0000000000000000000000000000000000000000" ? (
            <>
              the residuary beneficiary (
              <AddressLink address={info.residuaryBeneficiary} />)
            </>
          ) : (
            "the last beneficiary in the list, since no residuary beneficiary is set"
          )}
          .
        </Notice>
      )}

      {distributed && (
        <Notice tone="ok">
          This estate has been distributed. Beneficiaries can claim their share
          below.
        </Notice>
      )}
    </Panel>
  );
}
