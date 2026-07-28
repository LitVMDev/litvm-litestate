import { useReadContract } from "wagmi";
import { EstateFactoryAbi } from "../abis/EstateFactory";
import { FACTORY_ADDRESS, isFactoryConfigured } from "../wagmi";
import { FALLBACK_LIMITS, toDays, type Limits } from "./estate";

/// Reads the bounds this factory imposes on every estate it creates. A
/// testnet factory typically allows 1-day periods where production requires
/// 30 days, so these must never be hardcoded in the UI.
export function useLimits(): { limits: Limits; isLoading: boolean } {
  const { data, isLoading } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: EstateFactoryAbi,
    functionName: "limits",
    query: { enabled: isFactoryConfigured(), staleTime: Infinity },
  });

  if (!data) return { limits: FALLBACK_LIMITS, isLoading };

  const l = data as {
    minHeartbeat: bigint;
    maxHeartbeat: bigint;
    minGrace: bigint;
    maxGrace: bigint;
    minApprovalWindow: bigint;
    maxApprovalWindow: bigint;
  };

  return {
    isLoading,
    limits: {
      minHeartbeatDays: toDays(l.minHeartbeat),
      maxHeartbeatDays: toDays(l.maxHeartbeat),
      minGraceDays: toDays(l.minGrace),
      maxGraceDays: toDays(l.maxGrace),
      minApprovalWindowDays: toDays(l.minApprovalWindow),
      maxApprovalWindowDays: toDays(l.maxApprovalWindow),
    },
  };
}
