import { defineChain } from "viem";
import { createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";

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

const WC_PROJECT_ID = import.meta.env.VITE_WC_PROJECT_ID as string | undefined;

/// `injected` is deliberately first: a browser wallet talks to this page
/// directly, with no third party anywhere in the path. That is what lets a
/// beneficiary claim from a copy of this static build even if every service
/// around the project has gone.
///
/// `walletConnect` exists only because mobile browsers cannot inject a
/// provider - no wallet ships an extension for them - so without it a phone
/// simply cannot connect. It routes the *connection handshake* through a
/// hosted relay; reads and signing still go direct. Desktop users never touch
/// it. Omitting the project ID drops the connector entirely rather than
/// shipping a broken button.
export const config = createConfig({
  chains: [liteforge],
  connectors: [
    injected(),
    ...(WC_PROJECT_ID
      ? [
          walletConnect({
            projectId: WC_PROJECT_ID,
            showQrModal: true,
            metadata: {
              name: "LitEstate",
              description: "On-chain estate planning for LitVM",
              url: typeof window !== "undefined" ? window.location.origin : "",
              icons: [],
            },
          }),
        ]
      : []),
  ],
  transports: {
    // viem defaults to a 10s request timeout, which this RPC can exceed when
    // it is busy — measured at ~15s for a heavy query. A spurious timeout on a
    // read makes the app look broken when the chain is merely slow, so allow
    // more headroom.
    [liteforge.id]: http(undefined, { timeout: 30_000 }),
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
