import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { explainError } from "./estate";

/// A read issued the instant a receipt arrives can still be served by a node
/// that has not applied that block yet, and the stale answer then sits in the
/// query cache. Sweeping again shortly afterwards covers that lag.
const LAG_SWEEP_MS = 2_500;

/// Wraps writeContract + receipt waiting into one hook with decoded errors,
/// so every action in the UI reports failure the same way.
export function useTx(onConfirmed?: () => void) {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  const [dismissed, setDismissed] = useState(false);
  const queryClient = useQueryClient();

  // Held in a ref so the effect always calls the current callback without
  // needing it as a dependency — callers pass inline closures, which would
  // otherwise re-run the effect on every render.
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;

  useEffect(() => {
    if (!isSuccess) return;

    onConfirmedRef.current?.();

    // Invalidate everything rather than a hand-picked list: a single write can
    // move state read by several components (balances, counts, derived
    // lifecycle state), and missing one shows the user stale data with no
    // indication anything is wrong.
    queryClient.invalidateQueries();

    const sweep = setTimeout(() => queryClient.invalidateQueries(), LAG_SWEEP_MS);
    return () => clearTimeout(sweep);
  }, [isSuccess, queryClient]);

  const send = useCallback(
    (args: Parameters<typeof writeContract>[0]) => {
      setDismissed(false);
      reset();
      writeContract(args);
    },
    [writeContract, reset]
  );

  return {
    send,
    isPending,
    isConfirming,
    isSuccess: isSuccess && !dismissed,
    error: error ? explainError(error) : null,
    clear: () => {
      setDismissed(true);
      reset();
    },
  };
}
