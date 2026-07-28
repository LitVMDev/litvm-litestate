import { useReadContracts } from "wagmi";
import { EstateAbi } from "../abis/Estate";
import { FALLBACK_LIMITS, toDays, type Limits } from "./estate";

/// Reads the bounds from the ESTATE, not the factory.
///
/// Limits are immutables baked into each estate by whichever factory created
/// it. An estate from an older factory can therefore have different bounds from
/// the one the app currently points at, so validating an edit against
/// `useLimits()` (which reads the current factory) would let the form accept a
/// value the contract then rejects — or block one it would have allowed.
export function useEstateLimits(estate?: `0x${string}`): {
  limits: Limits;
  isLoading: boolean;
} {
  const { data, isLoading } = useReadContracts({
    contracts: estate
      ? [
          { address: estate, abi: EstateAbi, functionName: "MIN_HEARTBEAT" },
          { address: estate, abi: EstateAbi, functionName: "MAX_HEARTBEAT" },
          { address: estate, abi: EstateAbi, functionName: "MIN_GRACE" },
          { address: estate, abi: EstateAbi, functionName: "MAX_GRACE" },
        ]
      : [],
    query: { enabled: Boolean(estate), staleTime: Infinity },
  });

  const values = data?.map((d) => d.result as bigint | undefined);

  if (!values || values.some((v) => v === undefined)) {
    return { limits: FALLBACK_LIMITS, isLoading };
  }

  return {
    isLoading,
    limits: {
      ...FALLBACK_LIMITS,
      minHeartbeatDays: toDays(values[0]!),
      maxHeartbeatDays: toDays(values[1]!),
      minGraceDays: toDays(values[2]!),
      maxGraceDays: toDays(values[3]!),
    },
  };
}
