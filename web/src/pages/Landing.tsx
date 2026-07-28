import { href } from "../lib/useRoute";

export function Landing() {
  return (
    <>
      <div className="hero">
        <div className="eyebrow">On-chain estate planning</div>
        <h2>Make sure your crypto reaches the people you choose.</h2>
        <p className="lede">
          If you stop checking in, LitEstate releases your funds to the
          beneficiaries you named — no lawyer, no company, and nobody who can
          take your money or change your mind for you.
        </p>
        <div className="cta">
          {/* Connecting lives in the header, so this is a plain route link -
              two "Connect wallet" buttons on one screen reads as a mistake. */}
          <a className="primary-link" href={href.app}>
            Get started
          </a>
          <a className="ghost" href={href.how}>
            Read how it works
          </a>
        </div>
      </div>

      <section className="section">
        <h3>The problem</h3>
        <div className="prose" style={{ maxWidth: 660 }}>
          <p>
            Crypto held in a wallet you alone control disappears with you.
            Without your keys, nobody can reach it — not your family, not a
            court, not the people who wrote the software. Estimates of
            permanently lost coins run into the millions.
          </p>
          <p>
            The usual answers are uncomfortable. Give someone your seed phrase
            and they can take everything today. Leave it with a custodian and
            you are trusting a company to still exist, and to hand it over.
          </p>
        </div>
      </section>

      <section className="section">
        <h3>How LitEstate works</h3>
        <div className="cards">
          <div className="card">
            <div className="num">1</div>
            <h4>You set the terms</h4>
            <p>
              Choose how often you will check in, who inherits, and what share
              each person receives. You keep full control of the funds the whole
              time and can change your mind whenever you like.
            </p>
          </div>
          <div className="card">
            <div className="num">2</div>
            <h4>You check in</h4>
            <p>
              A single transaction that says “still here”. Each one resets the
              clock. Nothing happens as long as you keep checking in — you can
              withdraw everything at any moment.
            </p>
          </div>
          <div className="card">
            <div className="num">3</div>
            <h4>If you stop, it releases</h4>
            <p>
              Miss a check-in and a grace period begins, giving you time to come
              back. If that also passes, your beneficiaries can claim exactly
              the shares you set.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <h3>What makes this different</h3>
        <div className="cards">
          <div className="card">
            <h4>Nobody holds your keys</h4>
            <p>
              Your funds sit in a contract only you can withdraw from while you
              are checking in. No seed phrase is ever shared, and no
              administrator exists who could seize or freeze it.
            </p>
          </div>
          <div className="card">
            <h4>Optional human approval</h4>
            <p>
              You can require trusted people — a solicitor, an executor, a
              relative — to confirm before anything is released, so a missed
              check-in alone is never enough.
            </p>
          </div>
          <div className="card">
            <h4>Built to outlive us</h4>
            <p>
              This page is a static file with no backend. On a computer, a
              browser wallet talks to it directly — your beneficiaries can claim
              from any copy of it even if this project disappears entirely.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <h3>Before you rely on it</h3>
        <div className="prose" style={{ maxWidth: 660 }}>
          <div className="warn-box">
            <strong>This is testnet software and has not been audited.</strong>
            It runs on LitVM's LiteForge test network using test zkLTC, which
            has no real value. Please do not put anything you care about into it
            yet.
          </div>
          <p>
            It is also worth understanding the ways an estate can go wrong
            before you set one up — approvers who never respond, terms that lock
            when the deadline passes, and what happens to any share you leave
            unallocated. All of it is explained plainly in{" "}
            <a href={href.how}>how it works</a>.
          </p>
        </div>
      </section>
    </>
  );
}
