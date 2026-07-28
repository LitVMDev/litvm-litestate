import { useCallback, useEffect, useState } from "react";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { explainError } from "./estate";

/// Wraps writeContract + receipt waiting into one hook with decoded errors,
/// so every action in the UI reports failure the same way.
export function useTx(onConfirmed?: () => void) {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isSuccess) onConfirmed?.();
    // onConfirmed is intentionally not a dependency: callers pass inline
    // closures, and re-running on every render would loop refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

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
