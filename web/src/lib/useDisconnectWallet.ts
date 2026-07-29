import { useCallback, useRef, useState } from "react";
import { useConfig, useDisconnect } from "wagmi";

/// How long to wait for the connector to acknowledge before clearing the
/// connection locally anyway.
const FORCE_AFTER_MS = 2500;

/// Disconnecting, but without waiting on the wallet's permission to do it.
///
/// wagmi's disconnect() asks the connector to tear the session down and only
/// clears its own state once that resolves. An injected wallet answers in
/// milliseconds; WalletConnect has to reach the phone over the relay, which can
/// take seconds and never answers at all when the session is already dead on
/// the other side. Until then wagmi still reports `connected`, so the header
/// pill sits there looking live and the user taps it again and again.
///
/// Whether this browser holds a session is this browser's business, so the
/// remote acknowledgement is a courtesy, not a precondition. Ask for it, and if
/// it has not arrived by FORCE_AFTER_MS drop the connection locally regardless
/// - the connector's own teardown carries on in the background, and the wallet
/// app ends up with a stale session at worst, which it already handles.
export function useDisconnectWallet() {
  const config = useConfig();
  const { disconnectAsync } = useDisconnect();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  const forget = useCallback(() => {
    config.setState((state) => ({
      ...state,
      connections: new Map(),
      current: null,
      status: "disconnected",
    }));
  }, [config]);

  const disconnectWallet = useCallback(async () => {
    // A second tap must not queue a second teardown - that is what made this
    // feel unresponsive in the first place.
    if (busy.current) return;

    busy.current = true;
    setPending(true);

    const finish = () => {
      busy.current = false;
      setPending(false);
    };

    const timer = window.setTimeout(() => {
      forget();
      finish();
    }, FORCE_AFTER_MS);

    try {
      await disconnectAsync();
    } catch {
      // A connector that refuses, or that has already gone away, must not
      // leave the page claiming to be connected.
      forget();
    } finally {
      window.clearTimeout(timer);
      finish();
    }
  }, [disconnectAsync, forget]);

  return { disconnectWallet, pending };
}
