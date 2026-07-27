import { useMemo, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { ClaimTable, Notice, PrimaryButton, StatusBadge } from "../components.jsx";
import { initialClaims } from "../data.js";

const filters = ["All", "Requested", "Approved", "Locked", "Released", "Rejected"];

function Claims({ navigate, showNotice }) {
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(205);

  const filtered = useMemo(() => initialClaims.filter((claim) => {
    const matchesFilter = filter === "All" || claim.state === filter;
    const needle = query.trim().toLowerCase();
    const matchesQuery = !needle || `${claim.id} ${claim.vendor} ${claim.state}`.toLowerCase().includes(needle);
    return matchesFilter && matchesQuery;
  }), [filter, query]);

  const selected = initialClaims.find((claim) => claim.id === selectedId) ?? initialClaims[0];

  return (
    <>
      <header className="page-header">
        <div className="page-title-row">
          <div><h1>Claims</h1><p>Requests and receivables across active mandates</p></div>
          <PrimaryButton type="button" onClick={() => navigate("/mandates/1042")}>Open mandate #1042</PrimaryButton>
        </div>
      </header>

      <section className="claim-summary" aria-label="Claim status summary">
        {filters.slice(1).map((state) => <button type="button" key={state} className={filter === state ? "is-active" : ""} onClick={() => setFilter(state)}><StatusBadge state={state} /><strong>{initialClaims.filter((claim) => claim.state === state).length}</strong></button>)}
      </section>

      <div className="claims-workspace">
        <section className="claims-panel claims-page-panel" aria-labelledby="claims-list-heading">
          <div className="claims-toolbar">
            <div><h2 id="claims-list-heading">All claims</h2><span>{filtered.length} records</span></div>
            <label className="search-field"><MagnifyingGlass aria-hidden="true" /><span className="sr-only">Search claims</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search request or vendor" /></label>
          </div>
          <div className="filter-pills" role="tablist" aria-label="Filter claims by state">
            {filters.map((state) => <button type="button" role="tab" aria-selected={filter === state} className={filter === state ? "is-active" : ""} key={state} onClick={() => setFilter(state)}>{state}</button>)}
          </div>
          {filtered.length ? <ClaimTable claims={filtered} selectedId={selectedId} onSelect={setSelectedId} onAction={() => navigate("/mandates/1042")} /> : <div className="empty-state"><strong>No matching claims</strong><span>Clear the search or choose another state.</span></div>}
        </section>

        <aside className="claim-detail-panel" aria-labelledby="claim-detail-heading">
          <div className="detail-heading"><div><span>Selected claim</span><h2 id="claim-detail-heading">#{selected.id}</h2></div><StatusBadge state={selected.state} /></div>
          <dl>
            <div><dt>Mandate</dt><dd>Q3 Procurement · #1042</dd></div>
            <div><dt>Vendor</dt><dd>{selected.vendor}</dd></div>
            <div><dt>Current payee</dt><dd>{selected.vendor}</dd></div>
            <div><dt>Face amount</dt><dd>{selected.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} USDC</dd></div>
            <div><dt>Proof commitment</dt><dd><code>0x8f21…91ab</code></dd></div>
            <div><dt>Release deadline</dt><dd>{selected.state === "Locked" ? "Jul 18 2026" : "Set at lock"}</dd></div>
          </dl>
          <Notice />
          <button className="button-outline detail-action" type="button" onClick={() => navigate("/mandates/1042")}>View in mandate</button>
          <button className="button-link detail-copy" type="button" onClick={() => showNotice("Claim reference copied")}>Copy claim reference</button>
        </aside>
      </div>
    </>
  );
}

export default Claims;
