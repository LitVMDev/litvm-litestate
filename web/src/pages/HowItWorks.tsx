import { href } from "../lib/useRoute";

export function HowItWorks() {
  return (
    <div className="prose">
      <h2 style={{ fontSize: 30, letterSpacing: "-0.02em", margin: "8px 0 10px" }}>
        How LitEstate works
      </h2>
      <p className="muted" style={{ fontSize: 17 }}>
        Everything below in plain language. If anything here is unclear, treat
        that as a reason not to proceed until it is.
      </p>

      <div className="toc">
        <ul>
          <li><a href="#idea">The basic idea</a></li>
          <li><a href="#roles">Who is involved</a></li>
          <li><a href="#lifecycle">The lifecycle</a></li>
          <li><a href="#checkin">Checking in</a></li>
          <li><a href="#shares">Shares and the remainder</a></li>
          <li><a href="#approval">Approval rules</a></li>
          <li><a href="#funding">Funding and withdrawing</a></li>
          <li><a href="#claiming">Claiming</a></li>
          <li><a href="#locks">What locks, and when</a></li>
          <li><a href="#wrong">How this can go wrong</a></li>
          <li><a href="#money">What the money actually is</a></li>
        </ul>
      </div>

      <h3 id="idea">The basic idea</h3>
      <p>
        LitEstate is a “dead man's switch” for crypto. You put funds into a
        vault that only you can withdraw from, and you promise to press a button
        every so often. Pressing it means “I am still here”.
      </p>
      <p>
        As long as you keep pressing it, nothing changes. If you stop — because
        you have died, lost access, or simply forgotten — the contract eventually
        concludes you are gone and lets the people you named claim their shares.
      </p>
      <p>
        There is no company in the middle. The rules are enforced by a contract
        on a public blockchain, and once deployed nobody, including us, can
        change them.
      </p>

      <h3 id="roles">Who is involved</h3>
      <h4>The owner — you</h4>
      <p>
        You create the estate, decide the terms, put money in, and check in. You
        can withdraw everything at any time right up until the moment the estate
        is distributed. Nobody else can move your funds.
      </p>

      <h4>Beneficiaries</h4>
      <p>
        The people who inherit. Each is given a share as a percentage. They can
        do nothing at all until the estate is released — they cannot see or
        touch the funds before that, and they cannot trigger anything early.
      </p>

      <h4>Approvers (optional)</h4>
      <p>
        Trusted people who must confirm before funds are released — a solicitor,
        an executor, a family member. They cannot take the money and cannot
        redirect it. Their only power is to say “yes, this should go ahead”, or
        to withhold that.
      </p>
      <div className="warn-box">
        <strong>Approvers can block a release permanently.</strong>
        If you require approval and the approvers never give it within the
        window you set, the estate can never be distributed. Choose people who
        will actually act, and prefer a rule they can satisfy easily.
      </div>

      <h3 id="lifecycle">The lifecycle</h3>
      <p>
        Every estate moves through these stages in order. It can only move
        forward, except that checking in takes you back to the start.
      </p>

      <div className="timeline">
        <div className="tl-step ok">
          <h4>Active</h4>
          <p>
            Normal state. You are checking in on schedule. You can change
            anything — add or remove beneficiaries and approvers, adjust
            shares and timings, deposit, withdraw.
          </p>
        </div>
        <div className="tl-step warn">
          <h4>Grace period</h4>
          <p>
            You have missed a check-in. This is your safety net: a window you
            chose, during which you can still check in and reset everything to
            normal. Nothing is released yet.
          </p>
          <p>
            <strong>The estate's terms are now frozen.</strong> Beneficiaries,
            approvers and timings can no longer be edited — only a check-in can
            unfreeze them.
          </p>
        </div>
        <div className="tl-step urgent">
          <h4>Awaiting approval</h4>
          <p>
            Only if you required approval. The grace period has passed and
            approvers can now confirm the release. If enough approve within the
            window, the estate becomes releasable.
          </p>
          <p>
            <strong>You can still check in at this point.</strong> The estate is
            asking whether you are gone, and a check-in answers it — any
            approvals already given are cancelled and everything returns to
            normal.
          </p>
        </div>
        <div className="tl-step urgent">
          <h4>Ready for distribution</h4>
          <p>
            The conditions are met. Anyone at all can now press distribute —
            this does not give them your money, it simply calculates each
            beneficiary's share and sets it aside for them.
          </p>
        </div>
        <div className="tl-step done">
          <h4>Distributed</h4>
          <p>
            Final. Each beneficiary can claim their share whenever they like;
            there is no deadline. Deposits and withdrawals are closed.
          </p>
        </div>
      </div>

      <h3 id="checkin">Checking in</h3>
      <p>
        A check-in is one transaction. It costs a small network fee and resets
        your clock to zero.
      </p>
      <p>
        You choose the interval — say 180 days. If you check in on day 100, you
        have another 180 days from that point. Miss it entirely and the grace
        period starts.
      </p>
      <div className="example">
        <strong>Example</strong>
        Check-in interval 180 days, grace period 30 days. You last checked in on
        1 January. You have until 30 June to check in normally. From 30 June to
        30 July you are in the grace period and can still recover the estate by
        checking in. After 30 July you cannot, and release begins.
      </div>

      <h3 id="shares">Shares and the remainder</h3>
      <p>
        Each beneficiary gets a percentage of whatever is in the vault at the
        moment of distribution — not a fixed amount. If the vault holds 100 and
        Alice has 25%, Alice receives 25.
      </p>
      <p>
        You do not have to allocate all 100%. But anything you leave unallocated
        must have somewhere to go, so if your shares total less than 100% you
        must name a <strong>residuary beneficiary</strong> — the person who
        receives whatever is left over.
      </p>
      <div className="example">
        <strong>Example</strong>
        Vault holds 100. Alice 50%, Bob 10%, residuary beneficiary Carol.
        <br />
        Alice gets 50, Bob gets 10, and Carol gets the remaining 40.
      </div>
      <p>
        The vault will refuse deposits until this adds up — either allocate the
        full 100%, or name a residuary beneficiary. This is deliberate: it means
        no portion of your estate can ever end up with no destination.
      </p>
      <p>
        <strong>You cannot leave anything to yourself.</strong> The owner's own
        address is rejected as a beneficiary, as a residuary beneficiary, and as
        an approver.
      </p>

      <h3 id="approval">Approval rules</h3>
      <p>
        When you create an estate you choose whether release is automatic or
        needs human approval.
      </p>
      <h4>Distribute automatically</h4>
      <p>
        No approvers. Once the grace period passes, the estate is immediately
        releasable. Simplest, and nothing can jam it.
      </p>
      <h4>Require approval</h4>
      <p>Pick one of three rules:</p>
      <ul>
        <li>
          <strong>Any one approver</strong> — a single approval is enough.
          Safest against people being unreachable.
        </li>
        <li>
          <strong>All approvers</strong> — every active approver must agree.
          This tracks however many you currently have, so removing one lowers
          the bar rather than making it impossible.
        </li>
        <li>
          <strong>A set number</strong> — for example 2 of 3. You must add at
          least that many approvers before the vault will accept any deposit.
        </li>
      </ul>
      <p>
        You also set an <strong>approval window</strong>: how long approvers
        have to act once the grace period ends. If the window closes without
        enough approvals, the estate is stuck — see{" "}
        <a href="#wrong">how this can go wrong</a>.
      </p>

      <h3 id="funding">Funding and withdrawing</h3>
      <p>
        Deposit by sending funds to the vault address. Withdraw at any time
        before distribution — it is your money throughout, and no waiting period
        or approval applies to you.
      </p>
      <p>
        <strong>The vault refuses deposits until the estate is complete.</strong>{" "}
        It needs at least one recipient, and — if you required approval — enough
        approvers to satisfy your rule. This prevents funding an estate that
        could never pay out.
      </p>

      <h3 id="claiming">Claiming</h3>
      <p>
        After distribution, each beneficiary's share is set aside for them
        individually. They claim it themselves with their own wallet; nothing is
        pushed automatically.
      </p>
      <p>
        This matters because one beneficiary being unreachable — or using a
        wallet that cannot receive funds — cannot block anyone else. Each share
        is independent, and there is no deadline to claim.
      </p>
      <div className="warn-box">
        <strong>Beneficiaries need a small amount of the network's currency.</strong>
        Claiming is a transaction, so it costs a fee. Someone whose wallet is
        completely empty cannot claim until they have a little to cover it.
      </div>

      <h3 id="locks">What locks, and when</h3>
      <p>
        Two moments matter, and neither can be undone by anyone:
      </p>
      <ol>
        <li>
          <strong>When you miss a check-in</strong>, the terms freeze.
          Beneficiaries, shares, approvers and timings can no longer change.
          Checking in during the grace period unfreezes them.
        </li>
        <li>
          <strong>When the estate becomes releasable</strong> — either the grace
          period ends with no approval required, or enough approvers agree —
          you can no longer check in. Until that moment you can always rebut it.
          You can still withdraw funds afterwards, but you cannot restore the
          estate to Active.
        </li>
      </ol>
      <p>
        Set your terms carefully, and give yourself a grace period long enough
        to cover a holiday, a hospital stay, or a lost phone.
      </p>

      <h3 id="wrong">How this can go wrong</h3>
      <p>
        Being straightforward about the failure modes, because most of them
        cannot be fixed after the fact.
      </p>
      <ul>
        <li>
          <strong>A wrong address is permanent.</strong> Beneficiary addresses
          are not checked against anything — a valid address that belongs to the
          wrong person, or to nobody, is accepted silently. Once the terms
          freeze, it cannot be corrected.
        </li>
        <li>
          <strong>Approvers who never act jam the estate.</strong> If the
          approval window closes without enough approvals, distribution becomes
          impossible and your beneficiaries cannot claim. A living owner can
          check in to reset the whole thing, or simply withdraw — but if you are
          gone, the funds stay locked.
        </li>
        <li>
          <strong>Anyone with your keys is you.</strong> The contract cannot
          tell you apart from someone who has stolen your wallet. They could
          check in forever, or withdraw everything.
        </li>
        <li>
          <strong>Beneficiaries must know the estate exists.</strong> Nothing
          notifies anyone. Tell your beneficiaries the estate's address, or
          leave it somewhere they will find it.
        </li>
        <li>
          <strong>Nothing here is legal advice.</strong> This is a contract on a
          blockchain, not a will. How it interacts with inheritance law where you
          live is a question for a solicitor.
        </li>
      </ul>

      <h3 id="money">What the money actually is</h3>
      <p>
        LitEstate runs on LitVM, a network built on top of Litecoin. Its
        currency is <strong>zkLTC</strong>, which represents Litecoin held on the
        main Litecoin chain one-for-one.
      </p>
      <p>
        You cannot send ordinary Litecoin directly to a vault — the Litecoin
        network has no concept of these contracts, and the address formats are
        different. Litecoin is bridged into zkLTC first, and it is zkLTC that
        the vault holds.
      </p>
      <p className="muted" style={{ fontSize: 14, marginTop: 28 }}>
        Ready to look around? <a href={href.app}>Open the app</a> — you can
        connect a wallet and explore without committing to anything.
      </p>
    </div>
  );
}
