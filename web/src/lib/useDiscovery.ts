import { useCallback, useState } from "react";
import { parseAbiItem } from "viem";
import { usePublicClient } from "wagmi";
import { EARLIEST_ESTATE_BLOCK, KNOWN_FACTORIES } from "../wagmi";

export type Role = "owner" | "beneficiary" | "approver";

export type Found = {
  estate: `0x${string}`;
  roles: Role[];
};

/// The RPC times out on a genesis-to-latest scan, so requests are chunked.
/// 100k blocks was verified to work against LiteForge; smaller is safer if the
/// node is under load.
const CHUNK = 100_000n;

const ESTATE_CREATED = parseAbiItem(
  "event EstateCreated(address indexed owner, address indexed estate, address indexed vault)"
);
const BENEFICIARY_ADDED = parseAbiItem(
  "event BeneficiaryAdded(uint256 indexed id, address indexed wallet, uint16 shareBps)"
);
const APPROVER_ADDED = parseAbiItem(
  "event ApproverAdded(uint256 indexed id, address indexed wallet)"
);

const CACHE_KEY = "litestate.discovered";

/// Finds every estate a wallet is connected to, by scanning event logs.
///
/// This exists because on-chain registries alone are not enough:
///
///  - The factory indexes estates by *owner* only, so a beneficiary or approver
///    appears in no registry at all and would otherwise have to be told their
///    estate address out of band.
///  - Contracts are immutable, so a bug fix means a new factory at a new
///    address. Estates from older factories still work but vanish from the new
///    factory's registry.
///
/// Both are solved the same way: the wallet address is an indexed topic on
/// EstateCreated, BeneficiaryAdded and ApproverAdded, so the logs can be
/// filtered by it directly. The beneficiary/approver scans deliberately pass no
/// contract address, matching those events on *any* estate from any factory.
export function useDiscovery(viewer?: `0x${string}`) {
  const client = usePublicClient();

  const [found, setFound] = useState<Found[]>(() => readCache(viewer));
  const [isScanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hasScanned, setHasScanned] = useState(false);

  const scan = useCallback(async () => {
    if (!client || !viewer) return;

    setScanning(true);
    setError(null);
    setProgress(0);

    try {
      const latest = await client.getBlockNumber();
      const roles = new Map<string, Set<Role>>();

      const add = (estate: string, role: Role) => {
        const key = estate.toLowerCase() as `0x${string}`;
        if (!roles.has(key)) roles.set(key, new Set());
        roles.get(key)!.add(role);
      };

      const ranges: [bigint, bigint][] = [];
      for (let from = EARLIEST_ESTATE_BLOCK; from <= latest; from += CHUNK) {
        const to = from + CHUNK - 1n > latest ? latest : from + CHUNK - 1n;
        ranges.push([from, to]);
      }

      for (const [i, [fromBlock, toBlock]] of ranges.entries()) {
        // Estates this wallet created — restricted to known factory addresses.
        const created = await client.getLogs({
          address: KNOWN_FACTORIES.map((f) => f.address),
          event: ESTATE_CREATED,
          args: { owner: viewer },
          fromBlock,
          toBlock,
        });
        created.forEach((l) => l.args.estate && add(l.args.estate, "owner"));

        // Estates naming this wallet — no address filter, so this matches any
        // estate ever created, including ones from factories we do not know.
        const asBeneficiary = await client.getLogs({
          event: BENEFICIARY_ADDED,
          args: { wallet: viewer },
          fromBlock,
          toBlock,
        });
        asBeneficiary.forEach((l) => add(l.address, "beneficiary"));

        const asApprover = await client.getLogs({
          event: APPROVER_ADDED,
          args: { wallet: viewer },
          fromBlock,
          toBlock,
        });
        asApprover.forEach((l) => add(l.address, "approver"));

        setProgress(Math.round(((i + 1) / ranges.length) * 100));
      }

      const result: Found[] = [...roles.entries()].map(([estate, set]) => ({
        estate: estate as `0x${string}`,
        roles: [...set],
      }));

      setFound(result);
      writeCache(viewer, result);
      setHasScanned(true);
    } catch (e) {
      setError(
        e instanceof Error && /timed out|timeout/i.test(e.message)
          ? "The network timed out while searching. Try again — it often succeeds on a second attempt."
          : "Could not search the network. Check your connection and try again."
      );
    } finally {
      setScanning(false);
      setProgress(0);
    }
  }, [client, viewer]);

  return { found, isScanning, progress, error, hasScanned, scan };
}

// Results are cached per wallet so a repeat visit does not re-scan. The chain
// is the source of truth; this only avoids redundant work.
function readCache(viewer?: `0x${string}`): Found[] {
  if (!viewer) return [];
  try {
    const raw = localStorage.getItem(`${CACHE_KEY}.${viewer.toLowerCase()}`);
    return raw ? (JSON.parse(raw) as Found[]) : [];
  } catch {
    return [];
  }
}

function writeCache(viewer: `0x${string}`, found: Found[]) {
  try {
    localStorage.setItem(`${CACHE_KEY}.${viewer.toLowerCase()}`, JSON.stringify(found));
  } catch {
    // Storage full or blocked — the scan still works, it just will not persist.
  }
}
