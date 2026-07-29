import { formatEther } from "viem";

/// Mirrors Estate.EstateState. Order must match the Solidity enum.
export enum EstateState {
  Active = 0,
  GracePeriod = 1,
  AwaitingApproval = 2,
  ReadyForDistribution = 3,
  Distributed = 4,
}

export const STATE_LABEL: Record<EstateState, string> = {
  [EstateState.Active]: "Active",
  [EstateState.GracePeriod]: "Grace period",
  [EstateState.AwaitingApproval]: "Awaiting approval",
  [EstateState.ReadyForDistribution]: "Ready for distribution",
  [EstateState.Distributed]: "Distributed",
};

export const STATE_TONE: Record<EstateState, "ok" | "warn" | "urgent" | "done"> =
  {
    [EstateState.Active]: "ok",
    [EstateState.GracePeriod]: "warn",
    [EstateState.AwaitingApproval]: "urgent",
    [EstateState.ReadyForDistribution]: "urgent",
    [EstateState.Distributed]: "done",
  };

/// Mirrors Types.sol DistributionMode.
export enum DistributionMode {
  Automatic = 0,
  ApprovalRequired = 1,
}

/// Mirrors Types.sol ApprovalRule.
export enum ApprovalRule {
  AnyOne = 0,
  All = 1,
  Threshold = 2,
}

export const APPROVAL_RULE_LABEL: Record<ApprovalRule, string> = {
  [ApprovalRule.AnyOne]: "Any one approver",
  [ApprovalRule.All]: "All approvers",
  [ApprovalRule.Threshold]: "A set number of approvers",
};

/// Limits are per-factory immutables read from the chain, not constants -
/// a testnet factory can allow much shorter periods than a production one.
/// These are only the fallbacks shown before the factory read resolves.
export type Limits = {
  minHeartbeatDays: number;
  maxHeartbeatDays: number;
  minGraceDays: number;
  maxGraceDays: number;
  minApprovalWindowDays: number;
  maxApprovalWindowDays: number;
};

export const FALLBACK_LIMITS: Limits = {
  minHeartbeatDays: 30,
  maxHeartbeatDays: 5 * 365,
  minGraceDays: 7,
  maxGraceDays: 365,
  minApprovalWindowDays: 7,
  maxApprovalWindowDays: 365,
};

/// MAX_APPROVERS is a genuine contract constant, so it stays hardcoded.
export const MAX_APPROVERS = 5;

const SECONDS_PER_DAY = 86_400n;

export function toDays(seconds: bigint): number {
  return Number(seconds / SECONDS_PER_DAY);
}

export const BPS_TOTAL = 10_000;

export type EstateInfo = {
  state: number;
  lastCheckIn: bigint;
  heartbeatEnds: bigint;
  graceEnds: bigint;
  approvalEnds: bigint;
  beneficiaryCount: number;
  approverCount: number;
  approvalCount: number;
  requiredApprovals: number;
  totalAllocatedBps: number;
  residuaryBeneficiary: `0x${string}`;
  fullyConfigured: boolean;
};

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/// Why the vault is refusing deposits, phrased as the thing to go and fix.
/// Mirrors Estate.isFullyConfigured(), in the same order, so the sentence
/// names the condition the contract actually failed on - keep the two in step.
///
/// Returns null when the estate is fine, or when the gap depends on settings
/// the caller has not loaded yet, so callers keep a generic fallback.
export function describeConfigGap(
  info: EstateInfo,
  mode?: DistributionMode
): string | null {
  if (info.fullyConfigured) return null;

  const hasResiduary = info.residuaryBeneficiary !== ZERO_ADDRESS;
  const unallocated = BPS_TOTAL - Number(info.totalAllocatedBps);

  if (info.beneficiaryCount === 0 && !hasResiduary) {
    return "This estate has no recipients. Add a beneficiary, or name a residuary beneficiary to receive everything.";
  }

  if (unallocated > 0 && !hasResiduary) {
    return `Shares total ${bpsToPercent(info.totalAllocatedBps)}, so ${bpsToPercent(
      unallocated
    )} has nowhere to go. Share out the rest between your beneficiaries, or name a residuary beneficiary to receive it.`;
  }

  if (mode === DistributionMode.ApprovalRequired) {
    if (info.approverCount === 0) {
      return "This estate requires approval before it can be released, but it has no approvers. Add at least one.";
    }

    if (info.approverCount < info.requiredApprovals) {
      const short = info.requiredApprovals - info.approverCount;
      return `This estate needs ${info.requiredApprovals} approvals but has ${info.approverCount} approver${
        info.approverCount === 1 ? "" : "s"
      }. Add ${short} more, or it could never be released.`;
    }
  }

  return null;
}

export function bpsToPercent(bps: number | bigint): string {
  const n = Number(bps);
  const pct = n / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2)}%`;
}

export function formatZkLtc(wei: bigint | undefined): string {
  if (wei === undefined) return "—";
  const s = formatEther(wei);
  const n = Number(s);
  if (n === 0) return "0";
  if (n < 0.0001) return "<0.0001";
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function shortAddress(a?: string): string {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/// Human-readable time remaining. Returns null once the deadline has passed.
export function timeUntil(deadline: bigint, now: number): string | null {
  const secs = Number(deadline) - now;
  if (secs <= 0) return null;

  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);

  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${secs % 60}s`;
  return `${secs}s`;
}

/// Turns a contract revert into something a human can act on. Custom errors
/// come back as their name; anything else falls back to the raw message.
const ERROR_HELP: Record<string, string> = {
  NotOwner: "Only the estate owner can do that.",
  NotApprover: "This wallet is not an active approver on this estate.",
  NotVault: "Only the linked vault can call that.",
  InvalidOwner: "The owner address is not valid.",
  InvalidHeartbeat: "Check-in interval is outside the range this estate allows.",
  InvalidGracePeriod: "Grace period is outside the range this factory allows.",
  HeartbeatExpired:
    "The check-in deadline has passed, so the estate can no longer be edited.",
  InvalidBeneficiary:
    "That beneficiary is not valid — the owner cannot inherit their own estate, and shares must be above zero.",
  DuplicateBeneficiary: "That wallet is already a beneficiary.",
  AllocationExceeds100Percent: "Total shares cannot exceed 100%.",
  NoRecipients:
    "The estate must keep at least one recipient while the vault holds funds.",
  InvalidApprover: "That approver address is not valid.",
  DuplicateApprover: "That wallet is already an approver.",
  AlreadyApproved: "This approver has already approved.",
  ApprovalRequired: "The estate is not currently awaiting approval.",
  ApprovalWindowExpired:
    "The approval window has closed. This estate can no longer be distributed.",
  InvalidApprovalPolicy:
    "That approval rule cannot be satisfied by the current approvers.",
  InvalidApprovalWindow: "Approval window is outside the range this factory allows.",
  TooManyApprovers: `An estate can have at most ${MAX_APPROVERS} approvers.`,
  InvalidVault: "That vault address is not valid.",
  VaultAlreadySet: "This estate already has a vault.",
  EstateNotConfigured:
    "This estate cannot accept deposits yet — it needs at least one recipient and an approval rule its approvers can actually satisfy.",
  DistributionNotReady: "This estate is not ready to distribute yet.",
  DistributionAlreadyCompleted: "This estate has already been distributed.",
  DistributionFailed: "The transfer failed.",
  NothingToDistribute: "The vault is empty — there is nothing to distribute.",
  WithdrawalFailed: "The withdrawal failed — check the amount against the balance.",
  NothingToClaim: "This wallet has nothing to claim from this vault.",
  OwnerCannotApprove:
    "The estate owner cannot be one of its own approvers — approval only matters once they are no longer around.",
  ApproversNotUsed:
    "This estate was created to release automatically, so it does not use approvers. Release mode is fixed when the estate is created and cannot be changed.",
  ResiduaryBeneficiaryRequired:
    "Name a residuary beneficiary first. While shares total under 100%, someone must be nominated to receive the remainder.",
  InvalidLimits: "The limits configured for this factory are not coherent.",
};

export function explainError(err: unknown): string {
  const raw =
    err && typeof err === "object" && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);

  if (/user rejected|denied transaction/i.test(raw)) {
    return "Transaction rejected in wallet.";
  }

  for (const [name, help] of Object.entries(ERROR_HELP)) {
    if (raw.includes(name)) return help;
  }

  const firstLine = raw.split("\n")[0] ?? raw;
  return firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
}
