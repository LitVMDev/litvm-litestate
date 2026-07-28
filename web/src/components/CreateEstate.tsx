import { useEffect, useState } from "react";
import { EstateFactoryAbi } from "../abis/EstateFactory";
import { FACTORY_ADDRESS, isFactoryConfigured } from "../wagmi";
import { APPROVAL_RULE_LABEL, ApprovalRule, DistributionMode, MAX_APPROVERS } from "../lib/estate";
import { useLimits } from "../lib/useLimits";
import { useTx } from "../lib/useTx";
import { href } from "../lib/useRoute";
import { Field, Notice, Panel, TxStatus } from "./Common";
import { Confirm } from "./Confirm";

const DAY = 86400n;

export function CreateEstate({ onCreated }: { onCreated: () => void }) {
  const { limits } = useLimits();

  const [heartbeatDays, setHeartbeatDays] = useState(180);
  const [graceDays, setGraceDays] = useState(30);
  const [mode, setMode] = useState<DistributionMode>(DistributionMode.ApprovalRequired);
  const [rule, setRule] = useState<ApprovalRule>(ApprovalRule.AnyOne);
  const [threshold, setThreshold] = useState(2);
  const [windowDays, setWindowDays] = useState(30);
  const [reviewing, setReviewing] = useState(false);

  const tx = useTx(() => {
    setReviewing(false);
    onCreated();
  });

  // A testnet factory may allow 1-day periods where production demands 30.
  // Once the real limits load, snap the defaults into whatever is permitted so
  // the form never opens in an invalid state.
  useEffect(() => {
    setHeartbeatDays((d) => Math.min(Math.max(d, limits.minHeartbeatDays), limits.maxHeartbeatDays));
    setGraceDays((d) => Math.min(Math.max(d, limits.minGraceDays), limits.maxGraceDays));
    setWindowDays((d) =>
      Math.min(Math.max(d, limits.minApprovalWindowDays), limits.maxApprovalWindowDays)
    );
  }, [
    limits.minHeartbeatDays,
    limits.maxHeartbeatDays,
    limits.minGraceDays,
    limits.maxGraceDays,
    limits.minApprovalWindowDays,
    limits.maxApprovalWindowDays,
  ]);

  const heartbeatOk =
    heartbeatDays >= limits.minHeartbeatDays && heartbeatDays <= limits.maxHeartbeatDays;
  const graceOk = graceDays >= limits.minGraceDays && graceDays <= limits.maxGraceDays;
  const windowOk =
    mode === DistributionMode.Automatic ||
    (windowDays >= limits.minApprovalWindowDays && windowDays <= limits.maxApprovalWindowDays);
  const thresholdOk =
    mode === DistributionMode.Automatic ||
    rule !== ApprovalRule.Threshold ||
    (threshold >= 1 && threshold <= MAX_APPROVERS);

  const valid = heartbeatOk && graceOk && windowOk && thresholdOk;
  const requiresApproval = mode === DistributionMode.ApprovalRequired;

  if (!isFactoryConfigured()) {
    return (
      <Panel title="Factory not configured">
        <Notice tone="error">
          <p style={{ margin: "0 0 8px" }}>
            No factory address is set, so this build cannot create estates.
          </p>
          <p style={{ margin: 0 }}>
            Deploy one with{" "}
            <code className="mono">
              forge script script/DeployFactory.s.sol --rpc-url litvm_testnet --broadcast
            </code>
            , then set <code className="mono">VITE_FACTORY_ADDRESS</code> in{" "}
            <code className="mono">web/.env.local</code> and rebuild.
          </p>
        </Notice>
      </Panel>
    );
  }

  function submit() {
    tx.send({
      address: FACTORY_ADDRESS,
      abi: EstateFactoryAbi,
      functionName: "createEstate",
      args: [
        {
          heartbeatInterval: BigInt(heartbeatDays) * DAY,
          gracePeriod: BigInt(graceDays) * DAY,
          mode,
        },
        {
          rule,
          threshold: rule === ApprovalRule.Threshold ? threshold : 0,
          approvalWindow: BigInt(windowDays) * DAY,
        },
      ],
    });
  }

  const ruleSummary =
    rule === ApprovalRule.AnyOne
      ? "Any one approver is enough"
      : rule === ApprovalRule.All
        ? "Every approver must agree"
        : `${threshold} approver${threshold === 1 ? "" : "s"} must agree`;

  return (
    <Panel
      title="Create an estate"
      hint="Every setting here is your own choice. You can change all of them later, for as long as you keep checking in."
    >
      <Field
        label="Check in every"
        range={`${limits.minHeartbeatDays}–${limits.maxHeartbeatDays} days allowed${
          heartbeatOk ? "" : " · out of range"
        }`}
        rangeBad={!heartbeatOk}
        help="How long you can go without proving you are still here. Each check-in is one transaction that resets this clock. Shorter means your estate reaches your beneficiaries sooner, but you have to remember more often."
      >
        <input
          type="number"
          value={heartbeatDays}
          min={limits.minHeartbeatDays}
          max={limits.maxHeartbeatDays}
          onChange={(e) => setHeartbeatDays(Number(e.target.value))}
        />
      </Field>

      <Field
        label="Grace period"
        range={`${limits.minGraceDays}–${limits.maxGraceDays} days allowed${
          graceOk ? "" : " · out of range"
        }`}
        rangeBad={!graceOk}
        help="Your safety net after a missed check-in. During this window you can still check in and put everything back to normal — nothing is released. Make it long enough to survive a holiday, a hospital stay or a lost phone."
      >
        <input
          type="number"
          value={graceDays}
          min={limits.minGraceDays}
          max={limits.maxGraceDays}
          onChange={(e) => setGraceDays(Number(e.target.value))}
        />
      </Field>

      <Field
        label="When the grace period ends"
        help={
          <>
            Whether your beneficiaries can claim straight away, or whether people
            you trust must confirm first.{" "}
            <a href={`${href.how}#approval`}>Read more about approval rules</a>.
          </>
        }
      >
        <select value={mode} onChange={(e) => setMode(Number(e.target.value) as DistributionMode)}>
          <option value={DistributionMode.Automatic}>
            Release automatically — no approval needed
          </option>
          <option value={DistributionMode.ApprovalRequired}>
            Require people I trust to approve first
          </option>
        </select>
      </Field>

      {requiresApproval && (
        <>
          <Field
            label="Approval rule"
            help={
              rule === ApprovalRule.AnyOne
                ? "A single approval releases the estate. Safest against approvers being unreachable, since only one needs to act."
                : rule === ApprovalRule.All
                  ? "Every approver must agree. This follows however many approvers you have at the time, so removing one lowers the bar rather than making it unreachable."
                  : "A fixed number must agree, like 2 of 3. You must add at least that many approvers before the vault will accept any deposit."
            }
          >
            <select value={rule} onChange={(e) => setRule(Number(e.target.value) as ApprovalRule)}>
              {Object.entries(APPROVAL_RULE_LABEL).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          {rule === ApprovalRule.Threshold && (
            <Field
              label="How many must approve"
              range={`1–${MAX_APPROVERS}${thresholdOk ? "" : " · out of range"}`}
              rangeBad={!thresholdOk}
              help="Set this no higher than the number of approvers you will realistically add — the estate cannot be funded until you have at least this many."
            >
              <input
                type="number"
                value={threshold}
                min={1}
                max={MAX_APPROVERS}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
            </Field>
          )}

          <Field
            label="Approval window"
            range={`${limits.minApprovalWindowDays}–${limits.maxApprovalWindowDays} days allowed${
              windowOk ? "" : " · out of range"
            }`}
            rangeBad={!windowOk}
            help="How long approvers have to act once the grace period ends. Give them enough time to notice, decide and act — if this window closes without enough approvals, the estate can never be released."
          >
            <input
              type="number"
              value={windowDays}
              min={limits.minApprovalWindowDays}
              max={limits.maxApprovalWindowDays}
              onChange={(e) => setWindowDays(Number(e.target.value))}
            />
          </Field>

          <Notice tone="warn">
            <strong>Approvers hold a real veto.</strong> If the window closes
            without enough approvals, your beneficiaries can never claim. Choose
            people who will actually act, and prefer a rule they can meet easily.
          </Notice>
        </>
      )}

      <TxStatus
        isPending={tx.isPending}
        isConfirming={tx.isConfirming}
        isSuccess={tx.isSuccess}
        error={tx.error}
      />

      <div className="actions">
        <button
          onClick={() => setReviewing(true)}
          disabled={!valid || tx.isPending || tx.isConfirming}
        >
          Review and create
        </button>
      </div>

      <Confirm
        open={reviewing}
        title="Review your estate"
        intro="Check these carefully. You can change any of them later while you are still checking in — but not once a check-in has been missed."
        rows={[
          { k: "Check in every", v: `${heartbeatDays} days` },
          { k: "Grace period", v: `${graceDays} days` },
          { k: "On release", v: requiresApproval ? "Approval required" : "Automatic" },
          ...(requiresApproval
            ? [
                { k: "Approval rule", v: ruleSummary },
                { k: "Approval window", v: `${windowDays} days` },
              ]
            : []),
          {
            k: "Longest silence before release",
            v: `${heartbeatDays + graceDays} days`,
          },
        ]}
        confirmLabel="Create estate"
        onConfirm={submit}
        onCancel={() => setReviewing(false)}
      />
    </Panel>
  );
}
