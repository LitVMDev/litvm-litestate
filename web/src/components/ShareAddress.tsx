import { useState } from "react";
import { Notice } from "./Common";

/// The estate address is the only reliable way a beneficiary or approver can
/// ever reach this estate.
///
/// Nothing on-chain links them to it until distribution happens, and searching
/// the chain for it is not viable: at ~0.25s per block this network produces
/// ~126 million blocks a year, so a log scan that takes seconds today would
/// take hours within a year and days within a decade. There is no index to
/// query instead. So the address has to be recorded off-chain, by people, now.
export function ShareAddress({
  estate,
  vault,
  hasRecipients,
}: {
  estate: `0x${string}`;
  vault?: `0x${string}`;
  hasRecipients: boolean;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied("failed");
    }
  };

  return (
    <section className="share">
      <h2>Give this address to your beneficiaries</h2>
      <p>
        This is the only way they can ever reach your estate. Nothing links them
        to it on-chain until it is distributed, and there is no way to search for
        it — if nobody has the address when you are gone, the funds stay where
        they are indefinitely.
      </p>

      <div className="pair">
        <div className="addr-label">Estate address</div>
        <div className="addr-row">
          <div className="addr">{estate}</div>
          <button className="secondary" onClick={() => copy(estate, "estate")}>
            {copied === "estate" ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      {vault && (
        <div className="pair">
          <div className="addr-label">Vault address — also works</div>
          <div className="addr-row">
            <div className="addr">{vault}</div>
            <button className="secondary" onClick={() => copy(vault, "vault")}>
              {copied === "vault" ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {copied === "failed" && (
        <Notice tone="warn">
          Could not copy automatically — select the address above and copy it
          manually.
        </Notice>
      )}

      <p style={{ margin: "14px 0 0" }}>
        Somewhere they will still find it in years to come: alongside your will,
        with a solicitor, in a password manager they can access, or written down
        where your family looks.{" "}
        <strong>Do not rely on being able to tell them later.</strong>
      </p>

      {!hasRecipients && (
        <Notice tone="warn">
          You have not named anyone yet. Add your beneficiaries first, then share
          this address with them.
        </Notice>
      )}
    </section>
  );
}
