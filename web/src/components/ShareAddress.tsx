import { useState } from "react";
import { Notice } from "./Common";

/// The estate address is the only reliable way a beneficiary or approver can
/// ever reach this estate.
///
/// There is no index to query: nothing maps a beneficiary's wallet to the
/// estates it appears in, and scanning for it does not stay viable — at ~0.2s
/// per block this network produces ~150 million blocks a year, so a log scan
/// that takes seconds today takes hours within a year. So the address has to be
/// recorded off-chain, by people, now.
///
/// Note this is findability, not privacy, and the copy below must not blur the
/// two. BeneficiaryAdded indexes the wallet, so anyone holding a beneficiary's
/// address can pull back every estate that names them with a single filtered
/// log query — verified against this chain. Everything else (balance, shares,
/// the other beneficiaries) is readable by anyone who has the estate address.
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
        This is the only way they can ever reach your estate: there is no
        directory and no way to look it up by name. If nobody has the address
        when you are gone, the funds stay where they are indefinitely.
      </p>
      <p className="share-note">
        It is not a secret, though. Anyone who has this address can see the
        balance, who your beneficiaries are and what each one is left — and
        anyone who knows a beneficiary's wallet address can find the estates
        that name it. Choose addresses accordingly.
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
