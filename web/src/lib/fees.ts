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
/// The cap decides only whether a transaction can be included, never what it
/// costs: the charge is gasUsed * min(maxFeePerGas, baseFee + priority), and
/// the difference is not refunded so much as never taken. Measured on this
/// chain's own v3 factory deploy — cap 20,362,001, charged 10,125,000, exactly
/// half. So raising the cap costs nothing at settlement. It is not free of
/// consequence, though:
/// MetaMask compares the cap against its own suggestion and warns about a fee
/// higher than the network suggests, which is precisely the wrong thing for an
/// app asking to be trusted with an inheritance. So take the smallest cap the
/// chain's own behaviour justifies rather than a round number.
///
/// Measured over 513 consecutive blocks (about 100 seconds, since blocks here
/// are 0.2s): the base fee moved between 10,000,000 and 11,993,000 — a 20%
/// spread — with the largest single-block rise at 1.1%. But it rose at all on
/// 320 of those 512 boundaries, so a cap quoting the base fee exactly, which is
/// what the wallet does here, loses about three coin tosses in five.
///
/// 2x covers that 20% spread four times over, and is what ethers v6 has used as
/// its default for years (2 * baseFee + tip), so it is a thoroughly ordinary
/// number rather than an extravagant one.
///
/// It is chosen this generously because of the failure mode on the other side:
/// a cap the base fee outruns *before* submission is rejected cleanly and can
/// be retried, but one it outruns *after* submission leaves the transaction
/// sitting in the pool, which the user can only resolve by speeding it up in
/// their wallet. Being a little too high costs nothing; being a little too low
/// costs someone a stuck transaction.
///
/// No multiplier survives sustained congestion here. EIP-1559 lets the base fee
/// climb 12.5% per full block, and at 0.2s blocks that is 350x in ten seconds —
/// far beyond anything worth pre-paying for. That case is handled by the error
/// message and a retry, not by a bigger number.
const BASE_FEE_HEADROOM_PERCENT = 200n;

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
      maxFeePerGas: (block.baseFeePerGas * BASE_FEE_HEADROOM_PERCENT) / 100n + priority,
    };
  } catch {
    return {};
  }
}
