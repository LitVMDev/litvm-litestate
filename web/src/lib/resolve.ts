import type { PublicClient } from "viem";
import { EstateAbi } from "../abis/Estate";
import { EstateVaultAbi } from "../abis/EstateVault";

export type Resolved =
  | { kind: "estate"; estate: `0x${string}` }
  | { kind: "vault"; estate: `0x${string}`; vault: `0x${string}` }
  | { kind: "unknown" };

/// Accepts either an estate or a vault address and returns the estate.
///
/// People are given whichever address they happened to be told, and a
/// beneficiary is arguably more likely to hold the *vault* address since that
/// is where funds were sent. Requiring them to know which is which would be a
/// pointless obstacle at the moment they are trying to claim.
///
/// `estate()` exists only on the vault and `getEstateInfo()` only on the
/// estate, so the two are cleanly distinguishable.
export async function resolveToEstate(
  client: PublicClient,
  address: `0x${string}`
): Promise<Resolved> {
  // Try vault first: its estate() getter is a single cheap call.
  try {
    const estate = (await client.readContract({
      address,
      abi: EstateVaultAbi,
      functionName: "estate",
    })) as `0x${string}`;

    if (estate && estate !== "0x0000000000000000000000000000000000000000") {
      return { kind: "vault", estate, vault: address };
    }
  } catch {
    // Not a vault — fall through.
  }

  try {
    await client.readContract({
      address,
      abi: EstateAbi,
      functionName: "getEstateInfo",
    });
    return { kind: "estate", estate: address };
  } catch {
    return { kind: "unknown" };
  }
}
