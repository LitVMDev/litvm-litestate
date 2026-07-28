import { useEffect, useState } from "react";
import { isAddress } from "viem";
import { useAccount, usePublicClient, useReadContract } from "wagmi";

import { EstateFactoryAbi } from "./abis/EstateFactory";
import { FACTORY_ADDRESS, isFactoryConfigured, liteforge } from "./wagmi";
import { ConnectBar, Field, Notice, Panel, SwitchToLiteForge } from "./components/Common";
import { SiteHeader } from "./components/SiteHeader";
import { CreateEstate } from "./components/CreateEstate";
import { EstateStatus } from "./components/EstateStatus";
import { OwnerPanel } from "./components/OwnerPanel";
import { ApproverPanel, BeneficiaryPanel, DistributePanel } from "./components/RolePanels";
import { CheckIn } from "./components/CheckIn";
import { Landing } from "./pages/Landing";
import { HowItWorks } from "./pages/HowItWorks";
import { useEstate } from "./lib/useEstate";
import { useDiscovery, type Role } from "./lib/useDiscovery";
import { resolveToEstate } from "./lib/resolve";
import { href, useRoute } from "./lib/useRoute";
import { shortAddress } from "./lib/estate";

const LAST_ESTATE_KEY = "litestate.lastEstate";

export default function App() {
  const [route, navigate] = useRoute();
  const { isConnected } = useAccount();

  // Landing exists to explain the thing; once a wallet is connected there is
  // nothing left to sell, so send them straight to the app.
  useEffect(() => {
    if (isConnected && route === "home") navigate("app");
    // Only react to the connection flipping, not to later navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  return (
    <>
      <SiteHeader route={route} />

      <div className="wrap">
        {route === "home" && <Landing />}
        {route === "how" && <HowItWorks />}
        {route === "app" && <AppView />}

        <footer className="muted" style={{ fontSize: 12, marginTop: 40 }}>
          Static build — no server, no analytics, no third-party wallet relay.
          Keep a copy: this page plus a browser wallet is all a beneficiary needs
          to claim. Testnet software, unaudited.
        </footer>
      </div>
    </>
  );
}

function AppView() {
  const { address, isConnected, chainId } = useAccount();
  const [selected, setSelected] = useState<`0x${string}` | undefined>(() => {
    const saved = localStorage.getItem(LAST_ESTATE_KEY);
    return saved && isAddress(saved) ? (saved as `0x${string}`) : undefined;
  });
  const [tab, setTab] = useState<"manage" | "create">("manage");
  const [lookup, setLookup] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  const client = usePublicClient();
  // Set when a creation succeeds so we can jump to the new estate as soon as
  // the registry read catches up.
  const [awaitingNew, setAwaitingNew] = useState(false);

  const mine = useReadContract({
    address: FACTORY_ADDRESS,
    abi: EstateFactoryAbi,
    functionName: "estatesOf",
    args: address ? [address] : undefined,
    query: { enabled: isFactoryConfigured() && Boolean(address) },
  });

  const myEstates = (mine.data ?? []) as readonly `0x${string}`[];

  useEffect(() => {
    if (!selected && myEstates.length > 0) {
      setSelected(myEstates[myEstates.length - 1]);
    }
  }, [myEstates, selected]);

  // After creating, land the user on the estate they just made rather than
  // leaving them on an empty form wondering whether it worked.
  useEffect(() => {
    if (!awaitingNew || myEstates.length === 0) return;
    setSelected(myEstates[myEstates.length - 1]);
    setTab("manage");
    setAwaitingNew(false);
  }, [awaitingNew, myEstates]);

  useEffect(() => {
    if (selected) localStorage.setItem(LAST_ESTATE_KEY, selected);
  }, [selected]);

  const est = useEstate(selected, address);
  const discovery = useDiscovery(address);

  // Estates found by log scan that the factory registry does not know about —
  // older factory versions, or estates where this wallet is a beneficiary or
  // approver rather than the owner.
  const extraFound = discovery.found.filter(
    (f) => !myEstates.some((m) => m.toLowerCase() === f.estate.toLowerCase())
  );

  const isOwner =
    Boolean(address && est.owner) && address!.toLowerCase() === est.owner!.toLowerCase();

  const wrongChain = isConnected && chainId !== liteforge.id;

  if (!isConnected) {
    return (
      <Panel title="Connect a wallet to continue">
        <p className="hint">
          You need a browser wallet to use LitEstate. Nothing is shared with
          anyone — the app talks directly to the network from your browser.
        </p>
        <ConnectBar />
        <p className="help" style={{ marginTop: 14 }}>
          New to this? <a href={href.how}>Read how it works</a> first — it takes
          a few minutes and covers what cannot be undone later.
        </p>
      </Panel>
    );
  }

  if (wrongChain) {
    return (
      <Notice tone="warn">
        <p style={{ margin: "0 0 10px" }}>
          Your wallet is on the wrong network. LitEstate lives on LiteForge
          (chain {liteforge.id}) — your wallet will ask to add it the first time.
        </p>
        <SwitchToLiteForge />
      </Notice>
    );
  }

  // Accepts an estate OR a vault address — people hold whichever they were
  // given, and a beneficiary is likely to have the vault, since that is where
  // funds were sent.
  const openLookup = async () => {
    if (!client || !isAddress(lookup)) return;

    setLookupBusy(true);
    setLookupNote(null);

    const found = await resolveToEstate(client, lookup as `0x${string}`);

    if (found.kind === "unknown") {
      setLookupNote(
        "That address is not a LitEstate estate or vault on this network. Check you copied it correctly."
      );
    } else {
      if (found.kind === "vault") {
        setLookupNote("That was a vault address — opened the estate that owns it.");
      }
      setSelected(found.estate);
      setTab("manage");
      setLookup("");
    }

    setLookupBusy(false);
  };

  const nothingToShow = myEstates.length === 0 && !selected;

  return (
    <>
      {!isFactoryConfigured() && (
        <Notice tone="error">
          <strong>No factory address configured.</strong> Deploy one with{" "}
          <code className="mono">
            forge script script/DeployFactory.s.sol --rpc-url litvm_testnet --broadcast
          </code>{" "}
          then set <code className="mono">VITE_FACTORY_ADDRESS</code> in{" "}
          <code className="mono">web/.env.local</code>.
        </Notice>
      )}

      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "manage"}
          onClick={() => setTab("manage")}
        >
          Your estates
          {myEstates.length > 0 && <span className="count">{myEstates.length}</span>}
        </button>
        <button
          role="tab"
          aria-selected={tab === "create"}
          onClick={() => setTab("create")}
        >
          Create new
        </button>
      </div>

      {tab === "create" && (
        <CreateEstate
          onCreated={() => {
            setAwaitingNew(true);
            mine.refetch();
          }}
        />
      )}

      {tab === "manage" && nothingToShow && (
        <Panel>
          <div className="empty-state">
            <h3>You have no estates yet</h3>
            <p>
              An estate holds funds and releases them to people you choose if you
              stop checking in. Setting one up takes a minute.
            </p>
            <button onClick={() => setTab("create")}>Create your first estate</button>

            <div className="divider">or</div>

            <p style={{ marginBottom: 14 }}>
              Were you named as a beneficiary or approver on someone else's
              estate? Open it with the address you were given — either the
              estate or its vault works.
            </p>
            {lookupNote && (
              <Notice tone={lookupNote.startsWith("That was a vault") ? "ok" : "error"}>
                {lookupNote}
              </Notice>
            )}

            <div className="inline-form">
              <input
                placeholder="0x…"
                value={lookup}
                onChange={(e) => setLookup(e.target.value)}
              />
              <button
                className="secondary"
                onClick={openLookup}
                disabled={!isAddress(lookup) || lookupBusy}
              >
                {lookupBusy ? "Checking…" : "Open"}
              </button>
            </div>

            <p className="help" style={{ marginTop: 18 }}>
              Do not have the address? Use <strong>Search the network</strong>{" "}
              above — it finds any estate that names this wallet.
            </p>
          </div>
        </Panel>
      )}

      {tab === "manage" && (
        <FindEstates
          discovery={discovery}
          extra={extraFound}
          onOpen={(a) => {
            setSelected(a);
            setTab("manage");
          }}
        />
      )}

      {tab === "manage" && !nothingToShow && (
        <>
          <Panel>
            <div className="row" style={{ alignItems: "flex-end" }}>
              {myEstates.length > 0 && (
                <Field
                  label="Estate"
                  help={
                    isOwner
                      ? "You own this estate."
                      : selected
                        ? "You do not own this estate — you are viewing it as a beneficiary or approver."
                        : undefined
                  }
                >
                  <select
                    value={myEstates.includes(selected as `0x${string}`) ? selected : ""}
                    onChange={(e) => setSelected(e.target.value as `0x${string}`)}
                  >
                    {!myEstates.includes(selected as `0x${string}`) && (
                      <option value="">
                        {selected ? `${shortAddress(selected)} (not yours)` : "Select…"}
                      </option>
                    )}
                    {myEstates.map((a) => (
                      <option key={a} value={a}>
                        {shortAddress(a)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              <Field
                label="Open another by address"
                help="Beneficiaries and approvers: paste the address you were given — either the estate or its vault works."
              >
                <div className="row">
                  <input
                    placeholder="0x…"
                    value={lookup}
                    onChange={(e) => setLookup(e.target.value)}
                  />
                  <div style={{ flex: "0 0 auto" }}>
                    <button
                      className="secondary"
                      onClick={openLookup}
                      disabled={!isAddress(lookup) || lookupBusy}
                    >
                      {lookupBusy ? "Checking…" : "Open"}
                    </button>
                  </div>
                </div>
              </Field>
            </div>
          </Panel>

          {selected && est.isLoading && (
            <Panel>
              <div className="empty">Loading estate…</div>
            </Panel>
          )}

          {selected && !est.isLoading && !est.info && (
            <Notice tone="error">No estate found at that address on LiteForge.</Notice>
          )}

          {selected && est.info && (
            <>
              {isOwner && (
                <CheckIn estate={selected} info={est.info} refetch={est.refetch} />
              )}

              <EstateStatus
                info={est.info}
                vaultBalance={est.vaultBalance}
                estate={selected}
                vault={est.vault}
                distributed={est.distributed}
                hideDeadline={isOwner}
              />

              <BeneficiaryPanel
                vault={est.vault}
                myClaimable={est.myClaimable}
                refetch={est.refetch}
              />

              <DistributePanel
                vault={est.vault}
                info={est.info}
                vaultBalance={est.vaultBalance}
                distributed={est.distributed}
                refetch={est.refetch}
              />

              {address && (
                <ApproverPanel
                  estate={selected}
                  info={est.info}
                  approvers={est.approvers}
                  viewer={address}
                  refetch={est.refetch}
                />
              )}

              {isOwner && (
                <OwnerPanel
                  estate={selected}
                  owner={est.owner!}
                  vault={est.vault}
                  info={est.info}
                  beneficiaries={est.beneficiaries}
                  approvers={est.approvers}
                  vaultBalance={est.vaultBalance}
                  distributed={est.distributed}
                  refetch={est.refetch}
                />
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

/// Log-scan discovery. Kept behind an explicit button rather than run on load:
/// it makes several RPC round-trips, and most users arriving with an estate in
/// the factory registry never need it.
function FindEstates({
  discovery,
  extra,
  onOpen,
}: {
  discovery: ReturnType<typeof useDiscovery>;
  extra: { estate: `0x${string}`; roles: Role[] }[];
  onOpen: (a: `0x${string}`) => void;
}) {
  const ROLE_LABEL: Record<Role, string> = {
    owner: "You own it",
    beneficiary: "You are a beneficiary",
    approver: "You are an approver",
  };

  return (
    <Panel
      title="Search the network"
      hint="Finds every estate that names this wallet — including ones created by older versions, and estates where you are a beneficiary or approver rather than the owner."
    >
      {discovery.error && <Notice tone="error">{discovery.error}</Notice>}

      {extra.length > 0 && (
        <div className="table-scroll" style={{ marginBottom: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Estate</th>
                <th>Your role</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {extra.map((f) => (
                <tr key={f.estate}>
                  <td>
                    <span className="mono">{shortAddress(f.estate)}</span>
                  </td>
                  <td>
                    {f.roles.map((r) => (
                      <span key={r} className="badge ok" style={{ marginRight: 6 }}>
                        {ROLE_LABEL[r]}
                      </span>
                    ))}
                  </td>
                  <td className="num">
                    <button className="secondary" onClick={() => onOpen(f.estate)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {discovery.hasScanned && extra.length === 0 && !discovery.isScanning && (
        <Notice>
          No other estates found for this wallet. If you were expecting one, ask
          whoever set it up for the estate address and open it directly.
        </Notice>
      )}

      <div className="actions">
        <button onClick={discovery.scan} disabled={discovery.isScanning}>
          {discovery.isScanning
            ? `Searching… ${discovery.progress}%`
            : discovery.hasScanned
              ? "Search again"
              : "Search the network"}
        </button>
      </div>
    </Panel>
  );
}
