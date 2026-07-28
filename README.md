# LitEstate

On-chain estate planning for [LitVM](https://litvm.com), Litecoin's EVM rollup.

You put funds in a vault only you can withdraw from, and check in periodically.
If you stop checking in, the contract eventually concludes you are gone and
releases the funds to the beneficiaries you named — in the shares you set,
optionally gated on approval from people you trust.

No custodian, no company in the middle, and no administrator who can seize or
freeze anything.

> [!WARNING]
> **Unaudited, testnet only.** This runs on LitVM's LiteForge testnet using test
> zkLTC, which has no value. Do not put anything you care about into it. See
> [Known limitations](#known-limitations) — several failure modes are permanent
> and by design.

---

## How it works

An estate moves through these states. It only ever moves forward, except that
checking in returns it to Active.

| State | Meaning |
| --- | --- |
| **Active** | You are checking in on schedule. Everything is editable; you can deposit and withdraw freely. |
| **Grace period** | You missed a check-in. Terms are **frozen**, but checking in still restores the estate. |
| **Awaiting approval** | Grace elapsed and approval is required. Approvers can now act; you can no longer check in. |
| **Ready for distribution** | Conditions met. Anyone may trigger distribution — it only records each beneficiary's share, it cannot redirect funds. |
| **Distributed** | Final. Beneficiaries claim individually, with no deadline. |

**Shares are literal percentages of the vault.** If shares total under 100%, a
*residuary beneficiary* must be named to receive the remainder — so no portion
of an estate can ever be left without a destination.

**Approval is optional.** Choose `Automatic`, or require approvers under one of
three rules: `AnyOne`, `All` (tracks the live approver count), or a fixed
`Threshold`.

## Contracts

| Contract | Size | Role |
| --- | --- | --- |
| `Estate` | 9.3 KB | Terms and lifecycle: beneficiaries, approvers, heartbeat/grace/approval clocks. Never holds funds. |
| `EstateVault` | 3.4 KB | Holds native zkLTC. Pull-payment claims, so one unreachable beneficiary cannot block the others. |
| `EstateFactory` | 16.4 KB | Deployed once per chain. Creates an estate and its vault atomically and keeps a per-owner registry. |

The factory matters more than it looks: creating both contracts in one
transaction means they can never be left unwired, and it holds the time bounds
every estate it creates is subject to.

### Design decisions worth knowing

**Time bounds are per-factory immutables, not global constants.** A testnet
factory can permit 1-day periods where production requires 30 — same contract
bytecode, different constructor arguments, and **no runtime environment flag**
anywhere in the contracts. There is no `if (testMode)` branch to audit.

**An estate cannot be funded until it could actually pay out.** The vault
rejects deposits until `isFullyConfigured()` holds: at least one recipient, and
an approval rule the existing approvers can physically satisfy. This closes a
class of bug where a configuration mistake permanently locks funds.

**Payouts do not depend on insertion order.** An earlier design let the last
beneficiary absorb any unallocated remainder, which meant identical shares paid
out differently depending on the order they were added. Requiring a residuary
beneficiary removed that entirely.

**The owner can never be a beneficiary, residuary beneficiary, or approver.**
An estate whose quorum depends on the owner could only be approved by someone
who is, by premise, no longer around.

## Repository layout

```
src/                 Contracts
  Estate.sol           Terms and lifecycle
  EstateVault.sol      Custody and distribution
  EstateFactory.sol    Per-chain entry point + registry
  Types.sol            Shared structs and enums
  Errors.sol           Custom errors
  interfaces/
script/
  DeployFactory.s.sol  DeployFactory (production) / DeployFactoryTestnet (1-day minimums)
  CreateEstate.s.sol   Creates one estate via a deployed factory
test/                164 tests
  SecurityRegression.t.sol   Pins every security fix; documents accepted risks
web/                 Front end — see web/README.md
```

## Getting started

Requires [Foundry](https://book.getfoundry.sh/getting-started/installation).

```bash
git clone --recurse-submodules https://github.com/LitVMDev/litvm-litestate.git
cd litvm-litestate

forge build
forge test
```

The optimizer is **required**, not optional — without it `EstateFactory`
exceeds the 24 KB EIP-170 limit and cannot be deployed. `evm_version` is pinned
to `shanghai` to match LitVM; leaving it on auto-detect risks emitting opcodes
the chain does not implement.

## Deploying

```bash
# Store the deploying key encrypted rather than in an env var
cast wallet import litvm-deployer --interactive

# Testnet factory: 1-day minimum check-in, grace and approval windows
forge script script/DeployFactory.s.sol:DeployFactoryTestnet \
  --rpc-url litvm_testnet --broadcast --account litvm-deployer

# Production limits: 30-day check-in, 7-day grace and approval minimums
forge script script/DeployFactory.s.sol:DeployFactory \
  --rpc-url litvm_testnet --broadcast --account litvm-deployer
```

Users then create their own estates through the factory — via the web UI, or
`script/CreateEstate.s.sol` for CLI use. Deployment scripts deliberately carry
**no** per-user configuration; heartbeat interval, grace period and approval
policy are each owner's own choice.

### LiteForge testnet

| | |
| --- | --- |
| Chain ID | `4441` |
| RPC | `https://liteforge.rpc.caldera.xyz/http` |
| Explorer | https://liteforge.explorer.caldera.xyz |
| Currency | zkLTC |

zkLTC is LitVM's native gas token, representing Litecoin locked on the main
Litecoin chain 1:1. **You cannot send ordinary L1 Litecoin to a vault** — the
Litecoin network has no EVM and a different address format. Bridge to zkLTC
first. Testnet zkLTC comes from the Caldera Hub faucet.

## Known limitations

Stated plainly, because most cannot be fixed after the fact.

- **Approvers hold a genuine veto.** If the approval window closes without
  enough approvals, the estate can never be distributed. This is deliberate —
  approvers are a real gate, not merely an accelerator. A living owner can still
  withdraw; a deceased one cannot.
- **A wrong beneficiary address is permanent.** Addresses are not validated
  against any identity. Once terms freeze, mistakes cannot be corrected.
- **Anyone holding your keys is you.** No contract can distinguish a living
  owner from a stolen wallet.
- **Beneficiaries are not notified.** Nothing links a beneficiary to an estate
  on-chain until distribution. Tell them the estate address, or leave it
  somewhere they will find it.
- **Not legal advice.** This is a contract on a blockchain, not a will. How it
  interacts with inheritance law is a question for a solicitor.

## Front end

A static single-page app — no backend, no analytics, and no third-party wallet
relay in the path a beneficiary needs to claim. See
[`web/README.md`](web/README.md) for the stack, the reasoning behind those
constraints, and dev instructions.

## License

MIT
