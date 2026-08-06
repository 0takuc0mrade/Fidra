import {
  ArrowRight,
  Check,
  CheckCircle,
  Circle,
  Clock,
  Copy,
  FileText,
  GlobeHemisphereWest,
  Info,
  ListChecks,
  LockKey,
  SpinnerGap,
  SquaresFour,
  Wallet,
  Lightning,
  Buildings,
} from "@phosphor-icons/react";

export const navItems = [
  { label: "Try Fidra", icon: ArrowRight, route: "/try", section: "Fidra V1" },
  { label: "Worker payouts", icon: Lightning, route: "/worker", section: "Fidra V1" },
  { label: "Platform", icon: Buildings, route: "/platform", section: "Fidra V1" },
  { label: "Overview", icon: SquaresFour, route: "/overview", section: "Legacy V0" },
  { label: "Mandates", icon: ListChecks, route: "/mandates/1042", section: "Legacy V0" },
  { label: "Claims", icon: FileText, route: "/claims", section: "Legacy V0" },
  { label: "Activity", icon: Clock, route: "/activity", section: "Legacy V0" },
  { label: "Vendor wallet", icon: Wallet, route: "/vendor-onboarding", section: "Legacy V0" },
];

export function FidraGlyph({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 28 28" aria-hidden="true">
      <rect x="3" y="7" width="17" height="7" rx="3.5" transform="rotate(-35 3 7)" />
      <rect x="10" y="15" width="17" height="7" rx="3.5" transform="rotate(-35 10 15)" />
    </svg>
  );
}

export function FidraMark({ onClick }) {
  const content = (
    <>
      <span className="brand-mark" aria-hidden="true">
        <FidraGlyph />
      </span>
      <span>Fidra</span>
    </>
  );

  if (onClick) {
    return <button className="brand brand-button" type="button" aria-label="Go to Fidra home" onClick={onClick}>{content}</button>;
  }

  return <div className="brand" aria-label="Fidra">{content}</div>;
}

export function StatusBadge({ state }) {
  const icon = state === "Active" ? <span className="status-dot" /> : null;
  return (
    <span className={`status-badge status-${state.toLowerCase()}`}>
      {icon}
      {state === "Locked" && <LockKey weight="fill" aria-hidden="true" />}
      {state}
    </span>
  );
}

export function PrimaryButton({ children, loading, success, ...props }) {
  return (
    <button className={`button-primary ${success ? "is-success" : ""}`} aria-busy={loading || undefined} {...props}>
      {loading && <SpinnerGap className="spin" aria-hidden="true" />}
      {success && <Check aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Metric({ label, value, tone, supporting, locked, unit = "USDC" }) {
  return (
    <div className={`metric metric-${tone || "neutral"}`}>
      <span className="metric-label">{label}</span>
      <div className="metric-amount">
        {locked && <LockKey weight="fill" aria-hidden="true" />}
        <strong>{value}</strong>
        {unit && <span>{unit}</span>}
      </div>
      {supporting && <span className="metric-support">{supporting}</span>}
    </div>
  );
}

export function CopyButton({ value, onCopy }) {
  return (
    <button
      className="icon-button"
      type="button"
      aria-label={`Copy ${value}`}
      title={`Copy ${value}`}
      onClick={() => onCopy(value)}
    >
      <Copy aria-hidden="true" />
    </button>
  );
}

export function ClaimTable({ claims, selectedId, onSelect, onAction }) {
  return (
    <div className="claim-table" role="table" aria-label="Purchase requests and claims">
      <div className="claim-row claim-head" role="row">
        <span role="columnheader">Request</span>
        <span role="columnheader">Vendor</span>
        <span role="columnheader">Amount</span>
        <span role="columnheader">State</span>
        <span role="columnheader">Submitted</span>
        <span role="columnheader">Next action</span>
      </div>
      {claims.map((claim) => (
        <div
          className={`claim-row claim-data ${selectedId === claim.id ? "is-selected" : ""}`}
          key={claim.id}
          role="row"
          tabIndex={0}
          aria-selected={selectedId === claim.id}
          onClick={() => onSelect(claim.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect(claim.id);
            }
          }}
        >
          <strong role="cell">#{claim.id}</strong>
          <span role="cell" data-label="Vendor">{claim.vendorLabel || claim.vendor}</span>
          <span role="cell" data-label="Amount">{claim.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} USDC</span>
          <span className="claim-state" role="cell" data-label="State">
            <StatusBadge state={claim.state} />
            <small>{claim.detail}</small>
          </span>
          <span role="cell" data-label="Submitted">{claim.submitted}</span>
          <span className="claim-action" role="cell" data-label="Next action">
            {claim.action ? (
              <button
                className={claim.id === 205 ? "button-outline" : "button-link"}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onAction(claim);
                }}
              >
                {claim.action}
              </button>
            ) : (
              <span className="no-action">No action required</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function LifecycleArrow() {
  return (
    <span className="lifecycle-arrow" aria-hidden="true">
      <span />
      <ArrowRight weight="regular" />
    </span>
  );
}

export function Lifecycle({ selectedState }) {
  const locked = selectedState === "Locked" || selectedState === "Released";
  return (
    <section className="lifecycle-panel" aria-labelledby="lifecycle-heading">
      <div className="lifecycle-title-row">
        <h2 id="lifecycle-heading">Receivable lifecycle</h2>
        <div className="lifecycle-zone reversible"><span />Reversible<span /></div>
        <div className="lifecycle-zone irrevocable"><span />Irreversible obligation<span /></div>
      </div>
      <div className="lifecycle-flow">
        <div className="lifecycle-state">
          <Circle size={34} aria-hidden="true" />
          <div><strong>Requested</strong><span>Purchase request submitted</span></div>
        </div>
        <LifecycleArrow />
        <div className="lifecycle-state">
          <Circle size={34} aria-hidden="true" />
          <div><strong>Approved</strong><span>Approved by the designated approver</span></div>
        </div>
        <LifecycleArrow />
        <div className="point-of-return">
          <strong>POINT OF NO RETURN</strong>
          <span>Locking fully reserves the claim</span>
        </div>
        <LifecycleArrow />
        <div className={`lifecycle-state ${locked ? "is-current" : ""}`}>
          <span className="lifecycle-lock"><LockKey weight="fill" aria-hidden="true" /></span>
          <div><strong>Locked</strong><span>Irrevocable receivable backed by reserved funds</span></div>
        </div>
        <LifecycleArrow />
        <div className={`lifecycle-state lifecycle-released ${selectedState === "Released" ? "is-current" : ""}`}>
          <CheckCircle size={36} aria-hidden="true" />
          <div><strong>Released</strong><span>Funds settled to the current payee</span></div>
        </div>
        <div className="rejected-path">
          <span className="dashed-path" aria-hidden="true" />
          <span className="rejected-node"><Circle size={31} /></span>
          <div><strong>Rejected</strong><span>Closed before funds were locked</span></div>
        </div>
      </div>
    </section>
  );
}

export function NetworkMeta() {
  return (
    <span className="meta-item">
      <GlobeHemisphereWest aria-hidden="true" />
      <span className="meta-label">Network</span>
      <strong>Arc Testnet</strong>
    </span>
  );
}

export function Notice() {
  return (
    <div className="notice">
      <Info aria-hidden="true" />
      <span>Records a proof reference.<br />Fidra does not independently verify delivery.</span>
    </div>
  );
}

export function IntegrationStatus({ status, refreshing = false, onRefresh }) {
  const refreshedLabel = status.lastRefreshAt
    ? status.lastRefreshAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "Not refreshed";

  return (
    <section className="integration-status" aria-label="Fidra contract connection status">
      <span className={`mode-badge mode-${status.mode}`}>{status.modeLabel}</span>
      {status.managerStatus ? <span><strong>MandateManager</strong>{status.managerStatus}</span> : <span><strong>Contracts</strong>{status.contractLabel}</span>}
      {status.vaultStatus && <span><strong>AdvanceVault</strong>{status.vaultStatus}</span>}
      <span><strong>Arc RPC</strong>{status.rpcStatus}</span>
      {status.authorizationStatus && <span><strong>Authorized vault</strong>{status.authorizationStatus}</span>}
      {status.frozenStatus && <span><strong>Frozen</strong>{status.frozenStatus}</span>}
      {status.liquidityStatus && <span><strong>Vault liquidity</strong>{status.liquidityStatus}</span>}
      {status.discountStatus && <span><strong>Discount</strong>{status.discountStatus}</span>}
      <span><strong>Wallet</strong>{status.walletStatus}</span>
      <span><strong>Access</strong>{status.readOnly ? "Read-only mode" : "Transactions enabled"}</span>
      <span><strong>Last refresh</strong><time>{refreshedLabel}</time></span>
      {onRefresh && (
        <button className="button-link integration-refresh" type="button" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh reads"}
        </button>
      )}
    </section>
  );
}
