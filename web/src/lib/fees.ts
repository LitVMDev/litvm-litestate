import type { PublicClient } from "viem";

/// How far above the current base fee to set the cap.
///
/// LiteForge's base fee moves every block, and its own eth_gasPrice sometimes
/// reports *below* the current base fee — measured at 11,091,000 against a base
/// fee of 11,104,000. A wallet that derives its cap from either number lands
/// under the next block's base fee often enough to feel random: the node
/// rejects the transaction with "max fee per gas less than block base fee", and
/// the identical action succeeds when pressed again a few seconds later.
///
/// EIP-1559 charges base + priority and refunds the difference, so a cap well
/// above the going rate costs nothing — the only thing it buys is not losing a
/// coin toss against the next block.
const BASE_FEE_HEADROOM = 4n;

export type FeeOverrides = {
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
};

/// Fee caps to send with a write, read fresh at send time.
///
/// Returns nothing at all on any failure — a fee lookup that did not work must
/// never be the reason an action cannot be attempted. The wallet's own estimate
/// is the fallback, which is exactly the behaviour this replaces.
export async function feeOverrides(client?: PublicClient): Promise<FeeOverrides> {
  if (!client) return {};

  try {
    const block = await client.getBlock({ blockTag: "latest" });

    // Pre-1559 chain: legacy gasPrice applies and these fields would be
    // rejected. Leave the wallet to it.
    if (block.baseFeePerGas == null) return {};

    let priority = 0n;
    try {
      priority = await client.estimateMaxPriorityFeePerGas();
    } catch {
      // LiteForge answers eth_maxPriorityFeePerGas with 0x0 anyway; a chain
      // that does not implement it at all is fine with zero too.
    }

    return {
      maxPriorityFeePerGas: priority,
      maxFeePerGas: block.baseFeePerGas * BASE_FEE_HEADROOM + priority,
    };
  } catch {
    return {};
  }
}
