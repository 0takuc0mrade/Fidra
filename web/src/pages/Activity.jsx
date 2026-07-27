import { useMemo, useState } from "react";
import { Bank, CheckCircle, FileText, LockKey, MagnifyingGlass, ShieldCheck } from "@phosphor-icons/react";
import { CopyButton } from "../components.jsx";

const events = [
  { type: "Claim locked", icon: LockKey, title: "Claim #204 became irrevocable", detail: "1,000.00 USDC moved from available to reserved under Q3 Procurement.", actor: "Maya Chen", address: "0x5B60…9C18", time: "12m ago", tx: "0x42d7…aa91", group: "Today" },
  { type: "Request submitted", icon: FileText, title: "Request #206 submitted", detail: "ProcureBot requested 420.00 USDC for Atlas Supply.", actor: "ProcureBot", address: "0xA91E…42D7", time: "3m ago", tx: "0x8f21…91ab", group: "Today" },
  { type: "Proof recorded", icon: ShieldCheck, title: "Proof commitment recorded for #205", detail: "An immutable audit reference was attached before approval.", actor: "ProcureBot", address: "0xA91E…42D7", time: "9m ago", tx: "0x1a40…ee72", group: "Today" },
  { type: "Mandate funded", icon: Bank, title: "Mandate #1042 funded", detail: "5,000.00 ERC-20 USDC credited to Q3 Procurement.", actor: "Northstar Labs", address: "0x71C4…9A20", time: "Jun 30", tx: "0x66be…1420", group: "Earlier" },
  { type: "Claim released", icon: CheckCircle, title: "Claim #201 released", detail: "600.00 USDC settled to the current payee, Meridian Freight.", actor: "Maya Chen", address: "0x5B60…9C18", time: "Jun 28", tx: "0x09c1…bd33", group: "Earlier" },
];

function Activity({ showNotice }) {
  const [filter, setFilter] = useState("All events");
  const [query, setQuery] = useState("");
  const types = ["All events", ...new Set(events.map((event) => event.type))];
  const visible = useMemo(() => events.filter((event) => {
    const matchesFilter = filter === "All events" || event.type === filter;
    const needle = query.trim().toLowerCase();
    const matchesQuery = !needle || `${event.title} ${event.detail} ${event.actor} ${event.tx}`.toLowerCase().includes(needle);
    return matchesFilter && matchesQuery;
  }), [filter, query]);

  return (
    <>
      <header className="page-header">
        <div className="page-title-row"><div><h1>Activity</h1><p>Canonical mandate and claim state changes</p></div></div>
      </header>

      <section className="activity-toolbar" aria-label="Activity filters">
        <label className="search-field"><MagnifyingGlass aria-hidden="true" /><span className="sr-only">Search activity</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search event, actor, or transaction" /></label>
        <label className="select-field"><span>Event type</span><select value={filter} onChange={(event) => setFilter(event.target.value)}>{types.map((type) => <option key={type}>{type}</option>)}</select></label>
        <label className="select-field"><span>Mandate</span><select defaultValue="all"><option value="all">All mandates</option><option>Q3 Procurement · #1042</option></select></label>
      </section>

      <section className="activity-panel" aria-labelledby="activity-feed-heading">
        <div className="dashboard-panel-heading"><div><h2 id="activity-feed-heading">Audit trail</h2><p>{visible.length} events · Local demo data</p></div><span className="network-pill">Arc Testnet</span></div>
        {visible.length ? ["Today", "Earlier"].map((group) => {
          const groupEvents = visible.filter((event) => event.group === group);
          if (!groupEvents.length) return null;
          return <div className="activity-group" key={group}><h3>{group}</h3><div className="activity-list">{groupEvents.map(({ icon: Icon, ...event }) => (
            <article className="activity-item" key={event.tx}>
              <span className="activity-icon"><Icon aria-hidden="true" /></span>
              <div className="activity-copy"><div><strong>{event.title}</strong><time>{event.time}</time></div><p>{event.detail}</p><span>{event.actor} · <code>{event.address}</code></span></div>
              <div className="activity-tx"><code>{event.tx}</code><CopyButton value={event.tx} onCopy={() => showNotice(`${event.tx} copied`)} /></div>
            </article>
          ))}</div></div>;
        }) : <div className="empty-state"><strong>No matching activity</strong><span>Adjust the filters to see more events.</span></div>}
      </section>
    </>
  );
}

export default Activity;
