import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarBlank } from "@phosphor-icons/react";
import {
  ClaimTable,
  CopyButton,
  IntegrationStatus,
  Lifecycle,
  Metric,
  NetworkMeta,
  Notice,
  PrimaryButton,
  StatusBadge,
} from "../components.jsx";
import { lockSpend } from "../lib/data/fidraActions.js";
import {
  getInitialIntegrationStatus,
  getInitialMandateDetail,
  loadMandateDetail,
} from "../lib/data/fidraAdapter.js";
import { formatBpsPercent, formatTimestamp, formatUsdc, truncateHex } from "../lib/contracts/types.js";

const tabs = [
  { id: "needs-action", label: "Needs action" },
  { id: "all", label: "All" },
  { id: "locked", label: "Locked" },
];

function EvidenceFact({ label, children }) {
  return <div className="evidence-fact"><dt>{label}</dt><dd>{children}</dd></div>;
}

function ExplorerLink({ href, children, title }) {
  return <a className="evidence-link" href={href} target="_blank" rel="noreferrer" title={title}>{children}<span aria-hidden="true">↗</span></a>;
}

function LiveSmokeEvidence({ evidence }) {
  const frontendConfirmed = evidence.contractEvidenceMatches && evidence.ledgerMatches;
  const freezeGates = [
    ["Source published and verified on ArcScan", evidence.sourceVerificationRecorded, evidence.sourceVerificationRecorded ? "Recorded" : "Not recorded"],
    [`Live Mode confirms mandate ${evidence.mandateId} and spend ${evidence.spendId}`, frontendConfirmed, frontendConfirmed ? "Confirmed this refresh" : "State mismatch"],
    ["Permanent AdvanceVault independently confirmed", false, "Required"],
    ["Owner confirms authorization should be frozen", false, "Required"],
  ];

  return (
    <section className="live-evidence-panel" aria-labelledby="live-evidence-heading">
      <div className="live-evidence-header">
        <div>
          <span className="evidence-kicker">Arc Testnet · read-only evidence</span>
          <h2 id="live-evidence-heading">Live Smoke Evidence</h2>
        </div>
        <span className={`evidence-read-state ${frontendConfirmed ? "is-confirmed" : "is-mismatch"}`}>
          {frontendConfirmed ? "Contract state matches ledger" : "Review live state"}
        </span>
      </div>

      <p className="live-evidence-copy">
        Fidra’s live smoke proves that a locked claim can be sold to AdvanceVault, the parent mandate can be revoked, and settlement still pays the vault because locked receivables are irrevocable.
      </p>

      <div className="live-evidence-layout">
        <div>
          <dl className="evidence-facts">
            <EvidenceFact label={`Mandate ${evidence.mandateId} status`}><StatusBadge state={evidence.mandateStatus} /></EvidenceFact>
            <EvidenceFact label={`Spend ${evidence.spendId} status`}><StatusBadge state={evidence.spendStatus} /></EvidenceFact>
            <EvidenceFact label="Original vendor"><code title={evidence.originalVendor}>{truncateHex(evidence.originalVendor)}</code></EvidenceFact>
            <EvidenceFact label="Final payee"><code title={evidence.finalPayee}>{truncateHex(evidence.finalPayee)}</code><small>AdvanceVault</small></EvidenceFact>
            <EvidenceFact label="Face amount"><strong>{formatUsdc(evidence.faceAmount)} USDC</strong></EvidenceFact>
            <EvidenceFact label="Vendor advance"><strong>{formatUsdc(evidence.advanceAmount)} USDC</strong></EvidenceFact>
            <EvidenceFact label="Realized spread"><strong>{formatUsdc(evidence.realizedSpread)} USDC</strong></EvidenceFact>
            <EvidenceFact label="Vault liquidity"><strong>{formatUsdc(evidence.vaultAvailableLiquidity)} USDC</strong></EvidenceFact>
            <EvidenceFact label="Discount"><strong>{formatBpsPercent(evidence.discountBps)}</strong></EvidenceFact>
            <EvidenceFact label="Authorization frozen"><strong>{evidence.authorizationFrozen ? "Yes" : "No"}</strong></EvidenceFact>
          </dl>

          <div className="evidence-links" aria-label="ArcScan evidence links">
            <ExplorerLink href={evidence.managerExplorerUrl} title={evidence.managerAddress}>MandateManager {truncateHex(evidence.managerAddress)}</ExplorerLink>
            <ExplorerLink href={evidence.vaultExplorerUrl} title={evidence.vaultAddress}>AdvanceVault {truncateHex(evidence.vaultAddress)}</ExplorerLink>
            <ExplorerLink href={evidence.settlementTransactionUrl} title={evidence.settlementTransactionHash}>Settlement {truncateHex(evidence.settlementTransactionHash)}</ExplorerLink>
          </div>

          <p className="evidence-check-meta">
            Last checked at Arc block <strong>{evidence.lastCheckedBlock?.toString() || "Unavailable"}</strong>. Settlement recorded in block <strong>{evidence.settlementBlock}</strong>.
          </p>
        </div>

        <aside className="freeze-gate" aria-labelledby="freeze-gate-heading">
          <div className="freeze-gate-heading">
            <div><span>Admin safety</span><h3 id="freeze-gate-heading">Freeze gate</h3></div>
            <strong className="freeze-state">Unfrozen</strong>
          </div>
          <p>Vault rotation remains open. Do not call <code>freezeAuthorizedAdvanceVault</code> until every prerequisite is complete.</p>
          <ul>
            {freezeGates.map(([label, complete, state]) => (
              <li key={label}>
                <span>{label}</span>
                <strong className={complete ? "is-complete" : "is-pending"}>{state}</strong>
              </li>
            ))}
          </ul>
          <div className="freeze-call-state"><span>Freeze transaction</span><strong>Blocked pending review</strong></div>
        </aside>
      </div>
    </section>
  );
}

function MandateDetail({ mandateId, showNotice }) {
  const initialDetail = useMemo(() => getInitialMandateDetail(mandateId), [mandateId]);
  const [detail, setDetail] = useState(initialDetail);
  const [claims, setClaims] = useState(() => initialDetail?.claims ?? []);
  const [selectedId, setSelectedId] = useState(() => initialDetail?.claims?.[0]?.id ?? null);
  const [activeTab, setActiveTab] = useState("needs-action");
  const [transactionState, setTransactionState] = useState("idle");
  const [integration, setIntegration] = useState(getInitialIntegrationStatus);
  const [readState, setReadState] = useState(initialDetail ? "ready" : "loading");
  const [readError, setReadError] = useState("");

  const refreshData = useCallback(async () => {
    setReadState("loading");
    setReadError("");
    try {
      const nextDetail = await loadMandateDetail(mandateId);
      setDetail(nextDetail);
      setClaims(nextDetail.claims);
      setSelectedId((current) => (
        nextDetail.claims.some((claim) => claim.id === current)
          ? current
          : nextDetail.claims[0]?.id ?? null
      ));
      setIntegration(nextDetail.integration);
      setReadState("ready");
    } catch (error) {
      setReadError(error.message || "Fidra contract data could not be loaded.");
      if (error.integration) setIntegration(error.integration);
      setReadState("error");
    }
  }, [mandateId]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const selectedClaim = claims.find((claim) => claim.id === selectedId) ?? null;
  const filteredClaims = useMemo(() => {
    if (activeTab === "all" || activeTab === "needs-action") return claims;
    return claims.filter((claim) => claim.state === "Locked");
  }, [activeTab, claims]);

  const counts = {
    "needs-action": claims.filter((claim) => claim.tab === "needs-action").length,
    all: claims.length,
    locked: claims.filter((claim) => claim.state === "Locked").length,
  };

  const mandate = detail?.mandate ?? null;

  const lockClaim = async (claimOverride) => {
    const claimToLock = claimOverride?.id ? claimOverride : selectedClaim;
    if (!claimToLock || claimToLock.state !== "Approved" || transactionState === "pending") return;
    setSelectedId(claimToLock.id);
    setTransactionState("pending");

    try {
      await lockSpend(
        { requestId: claimToLock.requestId },
        { mockHandler: () => new Promise((resolve) => window.setTimeout(resolve, 900)) },
      );
      setClaims((current) => current.map((claim) => (
        claim.id === claimToLock.id
          ? {
            ...claim,
            state: "Locked",
            status: "Locked",
            detail: "Irrevocable · fully reserved",
            action: "Release payment",
            tab: "locked",
            lockedAt: BigInt(Math.floor(Date.now() / 1000)),
            releaseDueAt: BigInt(Math.floor(Date.now() / 1000) + 259_200),
          }
          : claim
      )));
      setDetail((current) => current ? {
        ...current,
        mandate: {
          ...current.mandate,
          availableBudget: current.mandate.availableBudget - claimToLock.amountUnits,
          reserved: current.mandate.reserved + claimToLock.amountUnits,
        },
      } : current);
      setTransactionState("success");
      showNotice(`Demo: claim #${claimToLock.id} locked. ${claimToLock.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} USDC is now reserved.`);
    } catch (error) {
      setTransactionState("idle");
      showNotice(error.message || "Claim locking is not available.");
    }
  };

  const handleAction = (claim) => {
    setSelectedId(claim.id);
    if (claim.state === "Approved") return lockClaim(claim);
    if (claim.state === "Requested") return showNotice(`Request #${claim.id} selected for review.`);
    showNotice(`Release for claim #${claim.id} is prepared as a read-only transaction stub.`);
  };

  const copyAddress = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      showNotice(`${truncateHex(value)} copied`);
    } catch {
      showNotice(`Copy ${value}`);
    }
  };

  const canLock = selectedClaim?.state === "Approved";
  const identityRows = detail?.identities ?? [];
  const policyRows = detail?.policy ?? [];

  return (
    <>
      <header className="page-header mandate-header">
        <div className="page-title-row">
          <div><h1>{mandate?.name || `Mandate #${mandateId}`}</h1><p>Mandate #{mandateId}</p></div>
          <PrimaryButton
            type="button"
            onClick={() => lockClaim()}
            disabled={!canLock || transactionState === "pending"}
            loading={transactionState === "pending"}
            success={transactionState === "success"}
          >
            {detail?.source === "live" ? "Read-only live evidence" : transactionState === "pending" ? "Locking claim…" : transactionState === "success" ? `Claim #${selectedClaim?.id} locked` : canLock ? `Lock claim #${selectedClaim.id}` : "Select approved claim"}
          </PrimaryButton>
        </div>
        <div className="mandate-meta" aria-label="Mandate metadata">
          <StatusBadge state={mandate?.status || "Active"} /><span className="meta-divider" />
          <span className="meta-item"><span className="meta-label">Owner</span><strong>{mandate?.businessLabel || truncateHex(mandate?.business)}</strong></span><span className="meta-divider" />
          <NetworkMeta /><span className="meta-divider" />
          <span className="meta-item"><CalendarBlank aria-hidden="true" /><span className="meta-label">Expiry</span><strong>{formatTimestamp(mandate?.expiresAt)}</strong></span>
        </div>
      </header>

      <IntegrationStatus status={integration} refreshing={readState === "loading"} onRefresh={refreshData} />

      {readError && (
        <div className="integration-error" role="alert">
          <strong>{integration.rpcStatus?.startsWith("Connected") ? "Mandate data unavailable" : "Contract reads unavailable"}</strong>
          <span>{readError}</span>
        </div>
      )}

      {detail?.source === "live" && detail.liveEvidence && <LiveSmokeEvidence evidence={detail.liveEvidence} />}

      {!mandate ? (
        readState === "loading" ? <div className="integration-loading" role="status">Loading mandate data…</div> : null
      ) : (
        <>
          <section className="metrics-band" aria-label="Mandate accounting">
            <Metric label="Total funded" value={formatUsdc(mandate.totalBudget)} />
            <Metric label="Available" value={formatUsdc(mandate.availableBudget)} supporting="Uncommitted mandate balance" />
            <Metric label="Reserved" value={formatUsdc(mandate.reserved)} tone="reserved" supporting="Backing locked receivables" locked />
            <Metric label="Released" value={formatUsdc(mandate.spent)} tone="released" supporting="Settled to payees" />
          </section>

          <div className="content-grid">
            <section className="claims-panel" aria-labelledby="claims-heading">
              <div className="panel-heading"><h2 id="claims-heading">Purchase requests and claims</h2></div>
              <div className="tabs" role="tablist" aria-label="Claim filters">
                {tabs.map((tab) => (
                  <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} className={activeTab === tab.id ? "is-active" : ""} onClick={() => setActiveTab(tab.id)}>
                    {tab.label} <span>{counts[tab.id]}</span>
                  </button>
                ))}
              </div>
              {filteredClaims.length ? (
                <ClaimTable claims={filteredClaims} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setTransactionState("idle"); }} onAction={handleAction} />
              ) : (
                <div className="empty-state">
                  <strong>{detail.claimsAvailable ? "No claims in this view" : "Live claim list not indexed"}</strong>
                  <span>{detail.claimsUnavailableReason || "Choose another claim filter."}</span>
                </div>
              )}
            </section>

            <aside className="policy-panel" aria-labelledby="policy-heading">
              <section>
                <h2 id="policy-heading">Mandate policy</h2>
                <div className="identity-list">
                  {identityRows.map(([label, name, address]) => (
                    <div className="identity-row" key={label}><span>{label}</span><strong>{name}</strong><code>{truncateHex(address)}</code><CopyButton value={address} onCopy={copyAddress} /></div>
                  ))}
                </div>
                <div className="policy-list">{policyRows.map(([label, value]) => <div className="policy-row" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
              </section>
              <section className="access-section">
                <h2>Your access</h2>
                <div className="policy-row"><span>Current role</span><strong>{detail.source === "mock" ? "Approver · demo" : "Observer"}</strong></div>
                <div className="policy-row permission-row"><span>Available permissions</span><strong>{detail.source === "mock" ? "Simulated lock action" : "Read contract state"}</strong></div>
                {detail.source === "mock" && (
                  <div className="advance-quote">
                    <strong>1% demo advance</strong>
                    <span>Get 99 USDC now instead of waiting for 100 USDC later.</span>
                  </div>
                )}
                <Notice />
              </section>
              {selectedClaim && (
                <section className="contract-record-section" aria-labelledby="contract-record-heading">
                  <h2 id="contract-record-heading">Selected claim record</h2>
                  <div className="policy-list">
                    <div className="policy-row"><span>Request</span><strong>#{selectedClaim.id}</strong></div>
                    <div className="policy-row"><span>Status</span><strong>{selectedClaim.status}</strong></div>
                    <div className="policy-row"><span>Vendor</span><code title={selectedClaim.vendor}>{truncateHex(selectedClaim.vendor)}</code></div>
                    <div className="policy-row"><span>Current payee</span><code title={selectedClaim.payee}>{truncateHex(selectedClaim.payee)}</code></div>
                    <div className="policy-row"><span>Amount</span><strong>{formatUsdc(selectedClaim.amountUnits)} USDC</strong></div>
                    <div className="policy-row"><span>Proof hash</span><code title={selectedClaim.proofHash}>{truncateHex(selectedClaim.proofHash)}</code></div>
                    <div className="policy-row"><span>External ref</span><code title={selectedClaim.externalRefHash}>{truncateHex(selectedClaim.externalRefHash)}</code></div>
                    <div className="policy-row"><span>Release due</span><strong>{formatTimestamp(selectedClaim.releaseDueAt, "Set at lock")}</strong></div>
                  </div>
                </section>
              )}
            </aside>
          </div>

          <Lifecycle selectedState={selectedClaim?.state} />
        </>
      )}
    </>
  );
}

export default MandateDetail;
