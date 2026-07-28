import type { ReactNode } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { liteforge } from "../wagmi";
import { shortAddress } from "../lib/estate";

/// A labelled input with an always-visible explanation. Descriptions are shown
/// rather than hidden behind tooltips: most people setting this up have never
/// used a dead man's switch before, and the consequences of misunderstanding a
/// field are permanent.
export function Field({
  label,
  help,
  range,
  rangeBad,
  error,
  children,
}: {
  label: string;
  help?: ReactNode;
  range?: ReactNode;
  rangeBad?: boolean;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {range && <div className={rangeBad ? "range bad" : "range"}>{range}</div>}
      {help && <p className="help">{help}</p>}
      {error && (
        <p className="help" style={{ color: "var(--urgent)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

export function Panel({
  title,
  hint,
  children,
}: {
  title?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      {title && <h2>{title}</h2>}
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "error" | "warn" | "ok";
  children: ReactNode;
}) {
  const cls = tone === "info" ? "notice" : `notice ${tone}`;
  return <div className={cls}>{children}</div>;
}

export function Stat({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

export function AddressLink({ address }: { address?: string }) {
  if (!address || address === "0x0000000000000000000000000000000000000000") {
    return <span className="muted">Not set</span>;
  }
  return (
    <a
      className="mono"
      href={`${liteforge.blockExplorers.default.url}/address/${address}`}
      target="_blank"
      rel="noreferrer"
    >
      {shortAddress(address)}
    </a>
  );
}

/// Wallet connection plus a guard for being on the wrong network. Uses the
/// injected connector only - no third-party relay is involved.
///
/// `compact` trims it for the header bar: the network badge is dropped and the
/// disconnect control becomes an icon, so the address stays readable on a
/// phone without the row wrapping.
export function ConnectBar({ compact = false }: { compact?: boolean }) {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const injected = connectors[0];
  const wrongChain = isConnected && chainId !== liteforge.id;

  if (!isConnected) {
    return (
      <div>
        <button
          onClick={() => injected && connect({ connector: injected })}
          disabled={isPending || !injected}
        >
          {isPending ? "Connecting…" : compact ? "Connect" : "Connect wallet"}
        </button>
        {!injected && (
          <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            No browser wallet detected.
          </div>
        )}
        {error && (
          <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            {error.message}
          </div>
        )}
      </div>
    );
  }

  if (compact) {
    return (
      <div className="account">
        {wrongChain ? (
          <button onClick={() => switchChain({ chainId: liteforge.id })}>
            Wrong network
          </button>
        ) : (
          <>
            <span className="dot" aria-hidden="true" />
            <span className="mono">{shortAddress(address)}</span>
            <button
              className="icon"
              onClick={() => disconnect()}
              title="Disconnect"
              aria-label="Disconnect wallet"
            >
              ×
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      {wrongChain ? (
        <button onClick={() => switchChain({ chainId: liteforge.id })}>
          Switch to LiteForge
        </button>
      ) : (
        <span className="badge ok">LiteForge</span>
      )}
      <span className="mono muted">{shortAddress(address)}</span>
      <button className="secondary" onClick={() => disconnect()}>
        Disconnect
      </button>
    </div>
  );
}

/// Prompts the wallet to add + switch to LiteForge. wagmi falls back to
/// wallet_addEthereumChain when the wallet does not know the chain yet, so
/// this works even on a fresh MetaMask install.
export function SwitchToLiteForge() {
  const { switchChain, isPending, error } = useSwitchChain();

  return (
    <>
      <button
        onClick={() => switchChain({ chainId: liteforge.id })}
        disabled={isPending}
      >
        {isPending ? "Check your wallet…" : "Switch to LiteForge"}
      </button>
      {error && (
        <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          {error.message}
        </div>
      )}
    </>
  );
}

/// Wraps a write action: shows pending/confirming state and decoded errors.
export function TxStatus({
  isPending,
  isConfirming,
  isSuccess,
  error,
}: {
  isPending: boolean;
  isConfirming: boolean;
  isSuccess: boolean;
  error: string | null;
}) {
  if (error) return <Notice tone="error">{error}</Notice>;
  if (isPending) return <Notice>Confirm in your wallet…</Notice>;
  if (isConfirming) return <Notice>Waiting for confirmation…</Notice>;
  if (isSuccess) return <Notice tone="ok">Done.</Notice>;
  return null;
}
