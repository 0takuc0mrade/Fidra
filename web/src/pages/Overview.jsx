import { ArrowRight, CheckCircle, Clock, LockKey, WarningCircle } from "@phosphor-icons/react";
import { Metric, PrimaryButton, StatusBadge } from "../components.jsx";

const mandates = [
  { id: 1042, name: "Q3 Procurement", owner: "Northstar Labs", funded: "5,000.00", available: "3,000.00", reserved: "1,000.00", action: "2" },
  { id: 1038, name: "Cloud operations", owner: "Northstar Labs", funded: "8,500.00", available: "2,150.00", reserved: "2,350.00", action: "1" },
  { id: 1031, name: "Logistics pilot", owner: "Vela Commerce", funded: "5,000.00", available: "1,100.00", reserved: "1,500.00", action: "0" },
];

const recent = [
  { icon: LockKey, title: "Claim #204 locked", detail: "1,000.00 USDC reserved · Q3 Procurement", time: "12m ago" },
  { icon: CheckCircle, title: "Claim #201 released", detail: "600.00 USDC settled to Meridian Freight", time: "Jun 28" },
  { icon: Clock, title: "Request #206 submitted", detail: "420.00 USDC · Atlas Supply", time: "3m ago" },
];

function Overview({ navigate }) {
  return (
    <>
      <header className="page-header">
        <div className="page-title-row">
          <div><h1>Overview</h1><p>Working capital and mandate obligations on Arc</p></div>
          <PrimaryButton type="button" onClick={() => navigate("/mandates/1042")}>Open mandate #1042</PrimaryButton>
        </div>
      </header>

      <section className="metrics-band overview-metrics" aria-label="Portfolio accounting">
        <Metric label="Total funded" value="18,500.00" supporting="Across 3 active mandates" />
        <Metric label="Available" value="6,250.00" supporting="Uncommitted USDC" />
        <Metric label="Reserved" value="4,850.00" tone="reserved" supporting="Backing locked claims" locked />
        <Metric label="Released" value="7,400.00" tone="released" supporting="Settled to payees" />
      </section>

      <div className="overview-grid">
        <section className="dashboard-panel portfolio-health" aria-labelledby="health-heading">
          <div className="dashboard-panel-heading"><div><h2 id="health-heading">Reserve coverage</h2><p>Locked obligations are fully backed by ERC-20 USDC.</p></div><strong>100%</strong></div>
          <progress max="100" value="100">100%</progress>
          <div className="health-breakdown">
            <div><span>Locked claim face value</span><strong>4,850.00 USDC</strong></div>
            <div><span>Reserved mandate funds</span><strong>4,850.00 USDC</strong></div>
            <div><span>Coverage deficit</span><strong className="positive-value">0.00 USDC</strong></div>
          </div>
        </section>
        <section className="dashboard-panel attention-panel" aria-labelledby="attention-heading">
          <div className="dashboard-panel-heading"><div><h2 id="attention-heading">Needs attention</h2><p>Decisions that can change future obligations.</p></div><span className="count-badge">3</span></div>
          <button type="button" onClick={() => navigate("/mandates/1042")}><WarningCircle /><span><strong>Review request #206</strong><small>Atlas Supply · 420.00 USDC</small></span><ArrowRight /></button>
          <button type="button" onClick={() => navigate("/mandates/1042")}><Clock /><span><strong>Mandate #1038 expires soon</strong><small>Cloud operations · 8 days remaining</small></span><ArrowRight /></button>
        </section>
      </div>

      <div className="overview-lower-grid">
        <section className="dashboard-panel mandate-list-panel" aria-labelledby="mandates-heading">
          <div className="dashboard-panel-heading"><div><h2 id="mandates-heading">Active mandates</h2><p>Funded purchasing authority and current reserve position.</p></div></div>
          <div className="overview-table" role="table" aria-label="Active mandates">
            <div className="overview-row overview-head" role="row"><span>Mandate</span><span>Owner</span><span>Funded</span><span>Available</span><span>Reserved</span><span>Needs action</span></div>
            {mandates.map((mandate) => (
              <button className="overview-row" type="button" role="row" key={mandate.id} onClick={() => navigate("/mandates/1042")}>
                <span data-label="Mandate"><strong>{mandate.name}</strong><small>#{mandate.id} · <StatusBadge state="Active" /></small></span>
                <span data-label="Owner">{mandate.owner}</span>
                <span data-label="Funded">{mandate.funded}</span>
                <span data-label="Available">{mandate.available}</span>
                <span data-label="Reserved">{mandate.reserved}</span>
                <span data-label="Needs action">{mandate.action}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="dashboard-panel recent-panel" aria-labelledby="recent-heading">
          <div className="dashboard-panel-heading"><div><h2 id="recent-heading">Recent activity</h2><p>Latest canonical state changes.</p></div><button className="button-link" type="button" onClick={() => navigate("/activity")}>View all</button></div>
          <div className="recent-list">
            {recent.map(({ icon: Icon, title, detail, time }) => <div className="recent-item" key={title}><span className="event-icon"><Icon /></span><span><strong>{title}</strong><small>{detail}</small></span><time>{time}</time></div>)}
          </div>
        </section>
      </div>
    </>
  );
}

export default Overview;
