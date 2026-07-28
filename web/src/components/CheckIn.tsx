import { EstateAbi } from "../abis/Estate";
import { EstateState, timeUntil, type EstateInfo } from "../lib/estate";
import { useNow } from "../lib/useEstate";
import { useTx } from "../lib/useTx";
import { TxStatus } from "./Common";

/// The single action the whole system depends on, so it is given the top of
/// the page and the loudest styling — and it escalates in colour and language
/// as the deadline approaches rather than looking the same throughout.
///
/// Deliberately has no confirmation dialog: checking in is safe, repeatable and
/// the one thing a user must never find tedious.
export function CheckIn({
  estate,
  info,
  refetch,
}: {
  estate: `0x${string}`;
  info: EstateInfo;
  refetch: () => void;
}) {
  const now = useNow();
  const tx = useTx(refetch);

  const state = info.state as EstateState;
  const checkInLeft = timeUntil(info.heartbeatEnds, now);
  const graceLeft = timeUntil(info.graceEnds, now);

  // Rebutting is possible right up until the estate concludes the owner is
  // gone — including while approvers are still deciding.
  const canCheckIn =
    state === EstateState.Active ||
    state === EstateState.GracePeriod ||
    state === EstateState.AwaitingApproval;

  // How much of the current interval has been used up.
  const start = Number(info.lastCheckIn);
  const due = Number(info.heartbeatEnds);
  const elapsed = Math.min(Math.max((now - start) / Math.max(due - start, 1), 0), 1);

  // Nudge into "warn" for the last fifth of the interval, so the change is
  // visible well before it becomes a problem.
  let tone: "ok" | "warn" | "urgent" | "done" = "ok";
  if (state === EstateState.GracePeriod || state === EstateState.AwaitingApproval) tone = "urgent";
  else if (state === EstateState.Active && elapsed > 0.8) tone = "warn";
  else if (!canCheckIn) tone = "done";

  let headline: string;
  let sub: string;

  if (state === EstateState.Active) {
    headline = checkInLeft ?? "Due now";
    sub = "until your next check-in is due";
  } else if (state === EstateState.GracePeriod) {
    headline = graceLeft ?? "Grace period over";
    sub = "left to check in before your estate is released";
  } else if (state === EstateState.AwaitingApproval) {
    headline = "Approval under way";
    sub = "Your approvers are deciding whether to release your estate — check in now to stop it";
  } else if (state === EstateState.Distributed) {
    headline = "Estate distributed";
    sub = "This estate has been released to its beneficiaries.";
  } else {
    headline = "Check-in closed";
    sub = "The grace period has passed — this estate can no longer be recovered.";
  }

  return (
    <section className={`checkin ${tone}`}>
      <div className="eyebrow-row">
        <span className="pulse" aria-hidden="true" />
        <span className="label">
          {state === EstateState.GracePeriod || state === EstateState.AwaitingApproval
            ? "Action needed"
            : "Check in"}
        </span>
      </div>

      <div className="countdown">{headline}</div>
      <div className="countdown-sub">{sub}</div>

      {state === EstateState.Active && (
        <div
          className="bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(elapsed * 100)}
          aria-label="Time used since your last check-in"
        >
          <i style={{ width: `${Math.max(elapsed * 100, 2)}%` }} />
        </div>
      )}

      <TxStatus {...tx} />

      {canCheckIn && (
        <button
          className="primary-action"
          onClick={() => tx.send({ address: estate, abi: EstateAbi, functionName: "checkIn" })}
          disabled={tx.isPending || tx.isConfirming}
        >
          {tx.isConfirming ? "Checking in…" : "Check in now"}
        </button>
      )}

      <p className="foot">
        {state === EstateState.Active && (
          <>
            Checking in resets this clock and proves you are still here. Nothing
            is released while you keep doing it, and you can withdraw your funds
            at any time.
          </>
        )}
        {state === EstateState.GracePeriod && (
          <>
            <strong>You have missed a check-in.</strong> Your estate's terms are
            frozen and cannot be edited until you check in. If this window closes,
            your beneficiaries can claim and you will not be able to stop it.
          </>
        )}
        {state === EstateState.AwaitingApproval && (
          <>
            <strong>You can still stop this.</strong> Checking in proves you are
            here, cancels any approvals already given, and returns your estate to
            normal. Once enough approvers have agreed, it is too late.
          </>
        )}
        {!canCheckIn && state !== EstateState.Distributed && (
          <>
            Your approvers have agreed to release this estate, so it can no longer
            be recovered. You can still withdraw the vault's funds until someone
            distributes it.
          </>
        )}
      </p>
    </section>
  );
}
