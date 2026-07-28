import { useEffect, useState } from "react";
import { isAddress } from "viem";
import { useAccount, useReadContract } from "wagmi";

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

  const openLookup = () => {
    setSelected(lookup as `0x${string}`);
    setTab("manage");
    setLookup("");
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
              estate? Open it with the address you were given.
            </p>
            <div className="inline-form">
              <input
                placeholder="0x…"
                value={lookup}
                onChange={(e) => setLookup(e.target.value)}
              />
              <button className="secondary" onClick={openLookup} disabled={!isAddress(lookup)}>
                Open
              </button>
            </div>
          </div>
        </Panel>
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
                help="Beneficiaries and approvers: paste the address you were given."
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
                      disabled={!isAddress(lookup)}
                    >
                      Open
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
