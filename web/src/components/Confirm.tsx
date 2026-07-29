import { useEffect, useState, type ReactNode } from "react";

import { FeeNote } from "./Common";

export type SummaryRow = { k: string; v: ReactNode };

/// A review step shown before anything is signed. Every write in this app goes
/// through one: the estate's terms lock when the check-in deadline passes, and
/// several actions cannot be undone at all, so a mistyped address or a wrong
/// share is worth one extra click to catch.
export function Confirm({
  open,
  title,
  intro,
  rows,
  acknowledge,
  confirmLabel = "Confirm",
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  intro?: ReactNode;
  rows: SummaryRow[];
  /// When set, the user must tick this before confirming. Reserve it for
  /// actions that cannot be reversed.
  acknowledge?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [acked, setAcked] = useState(false);

  useEffect(() => {
    if (open) setAcked(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const blocked = Boolean(acknowledge) && !acked;

  return (
    <div
      className="backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {intro && <p className="dialog-hint">{intro}</p>}

        <div className="summary">
          {rows.map((r, i) => (
            <div className="summary-row" key={i}>
              <span className="k">{r.k}</span>
              <span className="v">{r.v}</span>
            </div>
          ))}
        </div>

        {acknowledge && (
          <label className="ack">
            <input
              type="checkbox"
              checked={acked}
              onChange={(e) => setAcked(e.target.checked)}
            />
            <span>{acknowledge}</span>
          </label>
        )}

        {/* The last thing read before the wallet opens, which is where the
            ceiling and any fee warning will appear. */}
        <FeeNote />

        <div className="dialog-actions">
          <button className="secondary" onClick={onCancel}>
            Go back
          </button>
          <button
            className={danger ? "danger" : undefined}
            onClick={onConfirm}
            disabled={blocked}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/// Small helper so long addresses stay readable inside a summary row.
export function Mono({ children }: { children: ReactNode }) {
  return <span className="mono">{children}</span>;
}
