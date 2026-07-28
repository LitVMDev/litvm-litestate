# LitEstate — web UI

A static single-page app for creating, managing, approving and claiming from
LitEstate estates on LitVM's LiteForge testnet.

## Why it is built this way

An estate plan has to outlive the software that created it. If this project's
hosting, its maintainers, or its funding disappear, a beneficiary must still be
able to claim what they were left. So:

- **No backend.** `npm run build` emits plain static files. Serve them from
  anywhere — IPFS, S3, a USB stick, `python3 -m http.server`.
- **Direct wallet connection on desktop.** The injected connector (MetaMask,
  Rabby, Brave, …) talks to the page with nothing in between.
- **WalletConnect for mobile only.** Mobile browsers cannot inject a provider —
  no wallet ships an extension for them — so a phone cannot connect without it.
  It carries only the connection handshake; reads and signing still go direct,
  and desktop users never touch it. Set `VITE_WC_PROJECT_ID` to enable it;
  leave it unset and the option disappears.
- **No analytics, no API keys.** The only network calls are to the LiteForge
  RPC and your own wallet.
- **Relative asset paths** (`base: "./"`), so the build works from a
  subdirectory or an `ipfs://<cid>/` gateway path without rebuilding.

The relay is a real dependency, so the guarantee is narrower than "no third
parties": a beneficiary on a **desktop** browser can always claim from a saved
copy of this build with no service involved. A beneficiary on a phone needs
WalletConnect to be reachable, or must use their wallet app's own browser.

## Setup

```bash
npm install

# Generate ABIs from the compiled contracts (run forge build in the repo root first)
npm run abis

cp .env.example .env.local
# then set VITE_FACTORY_ADDRESS to your deployed EstateFactory
```

`VITE_*` values are inlined at build time — there is no runtime configuration
server, so a rebuild is needed after changing them.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on http://localhost:5173 |
| `npm run dev:lan` | Same, but also served on your LAN IP (for phone testing) |
| `npm run build` | Static production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run abis` | Regenerate `src/abis/*` from `../out` |

Re-run `npm run abis` whenever the contracts change, or the UI will call a
stale ABI.

## Testing with a wallet

Because this build uses the **injected connector only**, a wallet must inject a
provider into the page running the app. That rules out connecting a phone
wallet to a desktop browser — that specifically needs WalletConnect, which we
deliberately do not bundle.

**On desktop:** install the MetaMask (or Rabby/Brave) extension and import the
account holding your zkLTC. The app's "Switch to LiteForge" button will add the
network for you.

**On a phone, without WalletConnect:** MetaMask mobile has a built-in browser
that injects a provider, so the injected connector works inside it.

```bash
npm run dev:lan     # prints a Network: http://192.168.x.x:5173 URL
```

With the phone on the same WiFi, open that URL in **MetaMask app → Browser
tab**. Two caveats: the in-app browser is more prominent on Android than iOS
and has moved between MetaMask versions, and a plain `http://` LAN address is
not a secure context, so some browser APIs are restricted. Wallet injection
generally still works; if something misbehaves, that is usually why.

**Mobile browsers** now work through WalletConnect: the connect screen offers
"Use a mobile wallet", which deep-links into the wallet app. This costs roughly
1.5 MB of additional bundle (lazily chunked) and puts a hosted relay in the
connection path — accepted because otherwise a phone cannot connect at all.

## Pages

Hash-based routing (`#/`, `#/how`, `#/app`) rather than paths — a hash works on
any static host, including IPFS gateways, with no server rewrite rules.

- **`#/` Overview** — the pre-connect landing page. Explains the problem, the
  three-step model, and what makes this different. Redirects to the app once a
  wallet connects, since there is nothing left to explain at that point.
- **`#/how` How it works** — the full explanation in plain language: lifecycle
  timeline, roles, shares and the residuary remainder, approval rules, what
  locks and when, and an honest list of the ways an estate can go wrong.
- **`#/app` App** — the working dashboard.

## Review steps

Every write goes through a `<Confirm>` dialog showing exactly what is about to
happen, **except** two deliberate exceptions:

- **Check in** — safe, repeatable, and the single thing users must never find
  annoying. Friction here would actively harm the product.
- **Claim** — moves your own money to your own wallet; there is nothing to get
  wrong.

Irreversible actions (adding a beneficiary or approver, approving a release,
distributing) additionally require ticking an acknowledgement before the
confirm button enables.

## What the UI covers

The app reads the connected wallet's relationship to an estate and shows only
what applies:

- **Owner** — create an estate, add/remove beneficiaries and approvers, set a
  residuary beneficiary, fund and withdraw, and check in.
- **Approver** — see whether approval is open and approve distribution.
- **Beneficiary** — see a claimable balance once distributed, and claim it.
- **Anyone** — trigger distribution once an estate is ready. This only moves
  funds into each beneficiary's claimable balance; it cannot redirect them.

Estates you created are listed from the factory registry (`estatesOf(owner)`),
which is a mapping read and stays instant regardless of chain age.

**Beneficiaries and approvers must be given the estate address.** They appear in
no on-chain index, so there is nothing to look them up by. A log scan was built
and then removed: LiteForge produces ~126 million blocks a year at ~0.25s per
block, so a scan taking 10 seconds today would take ~3.8 hours after one year
and ~75 hours after twenty. It degrades exactly when it matters most — years
later, once the owner has died.

The owner view therefore shows the estate and vault addresses prominently with
copy buttons, and reminds the owner to distribute them every time a beneficiary
or approver is added.

## Things worth knowing

- **Balances are zkLTC**, LitVM's native gas token — a 1:1 representation of
  LTC locked on the Litecoin mainchain. You cannot send L1 LTC to a vault;
  bridge to zkLTC first. Testnet zkLTC comes from the Caldera Hub faucet.
- **Deposits are rejected until an estate is fully configured** — it needs at
  least one recipient and, if it requires approval, enough approvers to satisfy
  its rule. The UI shows this as a warning before you try.
- **Approvers hold a real veto.** If the approval window closes without enough
  approvals, the estate can never be distributed. The create form warns about
  this.
- **Terms lock when the check-in deadline passes.** Beneficiaries, approvers
  and timings cannot be changed once the estate leaves the Active state.
