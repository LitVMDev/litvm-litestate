import { ConnectBar } from "./Common";
import { href, type Route } from "../lib/useRoute";

/// A pulse line — the check-in is the heartbeat this whole system listens for.
function Mark() {
  return (
    <svg
      className="mark"
      viewBox="0 0 32 32"
      width="28"
      height="28"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path
        d="M5 16h4.5l3-7 4 14 3-7H26"
        fill="none"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SiteHeader({ route }: { route: Route }) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a className="brand" href={href.home}>
          <Mark />
          <span className="brand-text">
            <span className="wordmark">LitEstate</span>
            <span className="chain-tag">Testnet</span>
          </span>
        </a>

        <nav className="site">
          <a href={href.home} aria-current={route === "home" ? "page" : undefined}>
            Overview
          </a>
          <a href={href.how} aria-current={route === "how" ? "page" : undefined}>
            How it works
          </a>
          <a href={href.app} aria-current={route === "app" ? "page" : undefined}>
            App
          </a>
        </nav>

        <div className="header-actions">
          <ConnectBar compact />
        </div>
      </div>
    </header>
  );
}
