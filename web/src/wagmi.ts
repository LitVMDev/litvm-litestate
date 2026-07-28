import { defineChain } from "viem";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

/// LitVM's LiteForge testnet. Native currency is zkLTC - a 1:1 representation
/// of LTC locked on the Litecoin mainchain - so every `value` in this app is
/// denominated in zkLTC, not ETH and not L1 LTC.
export const liteforge = defineChain({
  id: 4441,
  name: "LitVM LiteForge Testnet",
  nativeCurrency: { name: "zkLTC", symbol: "zkLTC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://liteforge.rpc.caldera.xyz/http"] },
  },
  blockExplorers: {
    default: {
      name: "LiteForge Explorer",
      url: "https://liteforge.explorer.caldera.xyz",
    },
  },
  testnet: true,
});

/// Injected connector only - no WalletConnect, so there is no projectId, no
/// relay server and no third-party service in the critical path. A beneficiary
/// with MetaMask/Rabby and a copy of this static build can always claim, even
/// if every service around this project has disappeared.
///
/// Adding WalletConnect later for mobile support is a small change, but it
/// introduces a hosted relay dependency - a deliberate trade-off, not a default.
export const config = createConfig({
  chains: [liteforge],
  connectors: [injected()],
  transports: {
    // The default 10s timeout is too short for this RPC: a log scan over a
    // wide block range routinely takes longer, and every request would die
    // before the node answered.
    [liteforge.id]: http(undefined, { timeout: 30_000, retryCount: 2 }),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}

export const FACTORY_ADDRESS = (import.meta.env.VITE_FACTORY_ADDRESS ?? "") as `0x${string}`;

/// Every factory ever deployed, oldest first, each with the block it was
/// created in.
///
/// Contracts are immutable, so a bug fix means deploying a *new* factory at a
/// new address. Estates created by older factories keep working forever, but
/// they are invisible to the new factory's registry — so the app scans all of
/// them when looking for a wallet's estates.
///
/// The deploy block matters: an estate cannot predate its factory, so this
/// bounds a log scan to a few thousand blocks instead of the chain's 34M.
/// Never remove an entry; that would orphan everyone who used it.
export const KNOWN_FACTORIES: { address: `0x${string}`; deployBlock: bigint; label: string }[] = [
  {
    address: "0xc800bb6b98E1fFAD4A54c4E39023A7D4EF91472F",
    deployBlock: 34302031n,
    label: "v1",
  },
  {
    address: "0x0154ef95526e6f6901f78C8235c28aa1C05d0e15",
    deployBlock: 34389907n,
    label: "v2",
  },
];

/// Earliest block any estate could exist in.
export const EARLIEST_ESTATE_BLOCK = KNOWN_FACTORIES.reduce(
  (min, f) => (f.deployBlock < min ? f.deployBlock : min),
  KNOWN_FACTORIES[0]?.deployBlock ?? 0n
);

export function isFactoryConfigured(): boolean {
  return (
    /^0x[0-9a-fA-F]{40}$/.test(FACTORY_ADDRESS) &&
    FACTORY_ADDRESS !== "0x0000000000000000000000000000000000000000"
  );
}
