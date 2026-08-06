import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowSquareOut, CheckCircle, CircleNotch, WarningCircle } from "@phosphor-icons/react";
import { PrimaryButton, StatusBadge } from "../components.jsx";
import { formatBpsPercent, formatTimestamp, formatUsdc, truncateHex } from "../lib/contracts/types.js";
import {
  certifyPlatformBatch,
  certifyPlatformClaim,
  createPlatformClaim,
  settlePlatformClaim,
} from "../lib/v1/platformActions.js";
import { loadV1Dashboard } from "../lib/v1/liveV1Data.js";
import { fidraConfig } from "../lib/config.js";
import { availablePlatformCredit, platformCapabilities } from "../lib/v1/platformPolicy.js";

const emptyClaim = Object.freeze({ worker: "", faceValue: "", dueDate: "", taskReference: "", evidenceReference: "" });

function PlatformSummary({ dashboard }) {
  const { platform } = dashboard;
  const availableCredit = availablePlatformCredit(platform);
  return (
    <section className="v1-platform-summary" aria-label="Platform account summary">
      <div className="v1-platform-state">
        <span><strong>Platform {platform.id.toString()}</strong><small>Settlement and risk controls</small></span>
        <StatusBadge state={platform.status} />
        <p>{platform.active ? "New earnings may be certified and advanced." : "New exposure is blocked. Existing obligations remain repayable."}</p>
      </div>
      <dl className="v1-capital-ledger">
        <div><dt>Credit limit</dt><dd>{formatUsdc(platform.creditLimit)} USDC</dd><small>{formatUsdc(availableCredit)} available</small></div>
        <div><dt>Outstanding exposure</dt><dd>{formatUsdc(platform.outstandingExposure)} USDC</dd><small>Settlement obligation</small></div>
        <div><dt>Reserve</dt><dd>{formatUsdc(platform.reserveBalance)} USDC</dd><small>{platform.reserveBalance === 0n ? "Restore before new advances" : "Available for default recovery"}</small></div>
        <div><dt>Advance fee</dt><dd>{formatBpsPercent(platform.advanceFeeBps)}</dd><small>Per certified claim</small></div>
      </dl>
    </section>
  );
}

function PlatformTabs({ route, navigate }) {
  const tabs = [
    ["/platform", "Overview"],
    ["/platform/claims", "Claims"],
    ["/platform/claims/new", "New claim"],
    ["/platform/batches", "Batch certification"],
    ["/platform/settlements", "Settlements"],
    ["/platform/evidence", "V1.1 failure evidence"],
  ];
  return <nav className="v1-tabs" aria-label="Platform sections">{tabs.map(([path, label]) => <button className={route === path ? "is-active" : ""} type="button" key={path} onClick={() => navigate(path)}>{label}</button>)}</nav>;
}

function PlatformClaims({ claims, title = "V1 earnings claims" }) {
  return (
    <section className="v1-claim-list">
      <div className="v1-section-heading"><div><h2>{title}</h2><p>Live EarningsManager and AdvanceVaultV2 state</p></div></div>
      <div className="v1-table" role="table" aria-label="Platform earnings claims">
        <div className="v1-table-row v1-platform-table-row v1-table-head" role="row">
          <span role="columnheader">Claim</span><span role="columnheader">Worker</span><span role="columnheader">Face value</span><span role="columnheader">Due</span><span role="columnheader">Claim status</span><span role="columnheader">Advance</span>
        </div>
        {claims.map((claim) => (
          <div className="v1-table-row v1-platform-table-row" role="row" key={claim.id}>
            <span role="cell" data-label="Claim"><strong>#{claim.id}</strong><small>{claim.purpose}</small></span>
            <code role="cell" data-label="Worker">{truncateHex(claim.worker, 8, 6)}</code>
            <span role="cell" data-label="Face value">{formatUsdc(claim.faceValue)} USDC</span>
            <span role="cell" data-label="Due">{formatTimestamp(claim.dueDate)}</span>
            <span role="cell" data-label="Claim status"><StatusBadge state={claim.status} /></span>
            <span role="cell" data-label="Advance">{claim.purchase.status === "None" ? "Not purchased" : `${claim.purchase.status} · ${formatUsdc(claim.purchase.advanceAmount)} USDC`}
              <span className="v1-row-receipts">
                {claim.receipts?.created && <a href={claim.receipts.created.explorerUrl} target="_blank" rel="noreferrer">Created <ArrowSquareOut /></a>}
                {claim.receipts?.advanced && <a href={claim.receipts.advanced.explorerUrl} target="_blank" rel="noreferrer">Advance <ArrowSquareOut /></a>}
                {claim.receipts?.resolved && <a href={claim.receipts.resolved.explorerUrl} target="_blank" rel="noreferrer">Resolved <ArrowSquareOut /></a>}
              </span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReceiptNotice({ action, onRetry }) {
  if (!action.message) return null;
  return (
    <div className={`v1-flow-message v1-flow-${action.tone}`} role={action.tone === "error" ? "alert" : "status"}>
      {action.tone === "success" ? <CheckCircle /> : action.tone === "error" ? <WarningCircle /> : null}
      <span>{action.message}{action.explorerUrl ? <> <a href={action.explorerUrl} target="_blank" rel="noreferrer">View Arc receipt <ArrowSquareOut /></a></> : null}</span>
      {onRetry ? <button className="button-link" type="button" onClick={onRetry}>Retry Arc read</button> : null}
    </div>
  );
}

function SingleClaimForm({ platform, refresh }) {
  const capabilities = platformCapabilities(platform);
  const [claim, setClaim] = useState(emptyClaim);
  const [certifyId, setCertifyId] = useState("");
  const [busy, setBusy] = useState("");
  const [action, setAction] = useState({});
  const update = (key) => (event) => setClaim((current) => ({ ...current, [key]: event.target.value }));
  const run = async (kind) => {
    setBusy(kind);
    setAction({ tone: "neutral", message: "Validate signer, simulate, and wait for Arc confirmation…" });
    try {
      const result = kind === "create"
        ? await createPlatformClaim(platform.id, claim)
        : await certifyPlatformClaim(platform.id, certifyId);
      setAction({ tone: "success", message: kind === "create" ? `Draft claim ${result.claimId ? `#${result.claimId} ` : ""}created.` : `Claim #${certifyId} certified.`, explorerUrl: result.explorerUrl });
      if (kind === "create") { setClaim(emptyClaim); if (result.claimId) setCertifyId(result.claimId); }
      await refresh();
    } catch (error) { setAction({ tone: "error", message: error.message }); }
    finally { setBusy(""); }
  };
  return (
    <section className="v1-form-panel">
      <div className="v1-section-heading"><div><h2>Create a worker earnings claim</h2><p>Creates Pending state first. Certification is a separate irreversible action.</p></div></div>
      {!platform.active && <ReceiptNotice action={{ tone: "error", message: "Platform 1 is paused. New claims and certifications are blocked, but settlement remains available." }} />}
      <div className="v1-form-grid">
        <label>Worker address<input value={claim.worker} onChange={update("worker")} placeholder="0x…" /></label>
        <label>Earnings (USDC)<input inputMode="decimal" value={claim.faceValue} onChange={update("faceValue")} placeholder="1.00" /></label>
        <label>Normal payout date<input type="datetime-local" value={claim.dueDate} onChange={update("dueDate")} /></label>
        <label>External task reference<input value={claim.taskReference} onChange={update("taskReference")} placeholder="task-10482" /></label>
        <label className="v1-field-wide">Evidence reference<input value={claim.evidenceReference} onChange={update("evidenceReference")} placeholder="ipfs://… or platform evidence ID" /></label>
      </div>
      <PrimaryButton type="button" loading={busy === "create"} disabled={!capabilities.createClaim || Boolean(busy)} onClick={() => run("create")}>Create draft claim</PrimaryButton>
      <div className="v1-certify-row">
        <label htmlFor="certify-claim-id">Claim ID to certify</label>
        <input id="certify-claim-id" inputMode="numeric" value={certifyId} onChange={(event) => setCertifyId(event.target.value)} placeholder="6" />
        <PrimaryButton type="button" loading={busy === "certify"} disabled={!capabilities.certifyClaim || !certifyId || Boolean(busy)} onClick={() => run("certify")}>Certify claim</PrimaryButton>
      </div>
      <p className="v1-risk-copy">Certification is final: the worker, value, due date, task hash, and evidence hash cannot be edited or revoked afterward.</p>
      <ReceiptNotice action={action} />
    </section>
  );
}

function BatchForm({ platform, refresh }) {
  const capabilities = platformCapabilities(platform);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState({});
  const submit = async () => {
    setBusy(true);
    try {
      const inputs = JSON.parse(value);
      const result = await certifyPlatformBatch(platform.id, inputs);
      setAction({ tone: "success", message: `Atomically certified claims ${result.claimIds.map((id) => `#${id}`).join(", ")}.`, explorerUrl: result.explorerUrl });
      await refresh();
    } catch (error) { setAction({ tone: "error", message: error.message }); }
    finally { setBusy(false); }
  };
  return (
    <section className="v1-form-panel">
      <div className="v1-section-heading"><div><h2>Atomic batch certification</h2><p>One transaction, one ClaimCreated and ClaimCertified event per item. Maximum 50.</p></div></div>
      <label className="v1-json-label">Claims JSON
        <textarea rows="12" value={value} onChange={(event) => setValue(event.target.value)} placeholder={'[{\n  "worker": "0x…",\n  "faceValue": "1.00",\n  "dueDate": "2026-08-10T12:00",\n  "taskReference": "task-10482",\n  "evidenceReference": "proof-10482"\n}]'} />
      </label>
      <PrimaryButton type="button" loading={busy} disabled={!capabilities.certifyBatch || busy || !value.trim()} onClick={submit}>Create and certify batch</PrimaryButton>
      {!platform.active && <p className="v1-helper-copy">Batch submission is disabled while the platform is paused.</p>}
      <ReceiptNotice action={action} />
    </section>
  );
}

function SettlementForm({ platform, claims, refresh }) {
  const [claimId, setClaimId] = useState("");
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState({});
  const outstanding = claims.filter((claim) => claim.status === "Advanced" && claim.purchase.status === "Outstanding");
  const settle = async () => {
    setBusy(true);
    try {
      const result = await settlePlatformClaim(platform.id, claimId);
      setAction({ tone: "success", message: `Claim #${claimId} settled. USDC approval and settlement both confirmed.`, explorerUrl: result.settlement.explorerUrl });
      await refresh();
    } catch (error) { setAction({ tone: "error", message: error.message }); }
    finally { setBusy(false); }
  };
  return (
    <section className="v1-form-panel">
      <div className="v1-section-heading"><div><h2>Settle an existing obligation</h2><p>Paused platforms may still repay claims that were already advanced.</p></div><StatusBadge state={platform.status} /></div>
      {outstanding.length ? <PlatformClaims claims={outstanding} title="Upcoming settlements" /> : <div className="v1-inline-empty"><strong>No outstanding claims</strong><span>The verified deployment currently has zero exposure.</span></div>}
      <div className="v1-certify-row">
        <label htmlFor="settle-claim-id">Outstanding claim ID</label>
        <input id="settle-claim-id" inputMode="numeric" value={claimId} onChange={(event) => setClaimId(event.target.value)} placeholder="6" />
        <PrimaryButton type="button" loading={busy} disabled={!claimId || busy} onClick={settle}>Approve USDC and settle</PrimaryButton>
      </div>
      <p className="v1-helper-copy">The connected wallet must be the registered settlement wallet or an authorized settlement operator. Each transaction is simulated first.</p>
      <ReceiptNotice action={action} />
    </section>
  );
}

export default function PlatformConsole({ route, navigate }) {
  const [dashboard, setDashboard] = useState(null);
  const [state, setState] = useState({ loading: true, error: "" });
  const platformId = route === "/platform/evidence" ? 1 : fidraConfig.v1LivePlatformId;
  const load = useCallback(async () => {
    setState({ loading: true, error: "" });
    try { setDashboard(await loadV1Dashboard(platformId)); setState({ loading: false, error: "" }); }
    catch (error) { setState({ loading: false, error: error.message }); }
  }, [platformId]);
  useEffect(() => { void load(); }, [load]);
  const resolvedRoute = useMemo(() => route === "/platform" ? "/platform" : route, [route]);
  return (
    <>
      <header className="page-header v1-page-header v1-platform-header"><div className="page-title-row"><div><h1>Platform operations</h1><p>Certified earnings, exposure and settlement · Arc Testnet</p></div><span className="mode-badge mode-live">V1.1 Live</span></div></header>
      <PlatformTabs route={resolvedRoute} navigate={navigate} />
      {state.loading && <div className="v1-loading"><CircleNotch className="spin" /><span>Reading platform state from Arc…</span></div>}
      {state.error && <ReceiptNotice action={{ tone: "error", message: "Arc Testnet state could not be loaded. Check the RPC connection, then retry." }} onRetry={load} />}
      {dashboard && <PlatformSummary dashboard={dashboard} />}
      {dashboard && route === "/platform" && (
        <div className="v1-platform-overview">
          <PlatformClaims claims={dashboard.claims} title="Recent protocol evidence" />
          <section className="v1-operating-note"><h2>Current operating state</h2><p>{dashboard.platform.active ? `Platform ${dashboard.platform.id} is active. Authorized platform users may create and certify earnings; purchased claims remain platform settlement obligations.` : `Platform ${dashboard.platform.id} is paused. New certification and exposure are blocked, while existing obligations remain repayable.`}</p><dl><div><dt>Settlement wallet</dt><dd><code>{truncateHex(dashboard.platform.settlementWallet, 12, 10)}</code></dd></div><div><dt>Last read</dt><dd>Block {dashboard.blockNumber.toString()}</dd></div></dl></section>
        </div>
      )}
      {dashboard && route === "/platform/claims" && <PlatformClaims claims={dashboard.claims} />}
      {dashboard && route === "/platform/claims/new" && <SingleClaimForm platform={dashboard.platform} refresh={load} />}
      {dashboard && route === "/platform/batches" && <BatchForm platform={dashboard.platform} refresh={load} />}
      {dashboard && route === "/platform/settlements" && <SettlementForm platform={dashboard.platform} claims={dashboard.claims} refresh={load} />}
      {dashboard && route === "/platform/evidence" && <><PlatformClaims claims={dashboard.claims} title="Read-only V1.1 failure evidence" /><section className="v1-operating-note"><h2>Reserve-backed default proof</h2><p>Claim 4 defaulted after its due date, drew the remaining reserve, recorded realized loss and contractual shortfall, and automatically paused platform 1. Claim 5 then proved that a paused platform can still settle an existing obligation. This route exposes no mutation controls.</p></section></>}
    </>
  );
}
