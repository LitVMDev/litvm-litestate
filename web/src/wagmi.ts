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
    [liteforge.id]: http(),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}

export const FACTORY_ADDRESS = (import.meta.env.VITE_FACTORY_ADDRESS ??
  "") as `0x${string}`;

export function isFactoryConfigured(): boolean {
  return (
    /^0x[0-9a-fA-F]{40}$/.test(FACTORY_ADDRESS) &&
    FACTORY_ADDRESS !== "0x0000000000000000000000000000000000000000"
  );
}
