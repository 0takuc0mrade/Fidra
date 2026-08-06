import { useEffect, useState } from "react";
import { List, Moon, Sun, X } from "@phosphor-icons/react";
import { FidraMark, PrimaryButton, navItems } from "./components.jsx";
import Activity from "./pages/Activity.jsx";
import Claims from "./pages/Claims.jsx";
import Landing from "./pages/Landing.jsx";
import MandateDetail from "./pages/MandateDetail.jsx";
import Overview from "./pages/Overview.jsx";
import VendorOnboarding from "./pages/VendorOnboarding.jsx";
import WorkerPayout from "./pages/WorkerPayout.jsx";
import PlatformConsole from "./pages/PlatformConsole.jsx";
import TryFidra from "./pages/TryFidra.jsx";
import { FIDRA_MODE_STORAGE_KEY, fidraConfig } from "./lib/config.js";

const demoMandateRoute = "/mandates/1042";
const liveEvidenceRoute = `/mandates/${fidraConfig.liveEvidenceMandateId}`;
const staticRoutes = new Set([
  "/", "/try", "/worker", "/worker/claims", "/platform", "/platform/claims", "/platform/claims/new",
  "/platform/batches", "/platform/settlements", "/platform/evidence", "/overview", demoMandateRoute,
  liveEvidenceRoute, "/claims", "/activity", "/vendor-onboarding",
]);

function workerClaimId(route) {
  const match = route.match(/^\/worker\/claims\/(\d+)$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function isKnownRoute(route) {
  return staticRoutes.has(route) || Boolean(workerClaimId(route));
}

function resolveModeRoute(route) {
  if (!fidraConfig.demoMode && route === demoMandateRoute) return liveEvidenceRoute;
  return route;
}

function routeMandateId(route) {
  if (!route.startsWith("/mandates/")) return null;
  const parsed = Number(route.split("/").at(-1));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

const liveUnindexedRoutes = Object.freeze({
  "/overview": {
    title: "Overview",
    description: "Portfolio-wide live reads require mandate and claim event indexing.",
  },
  "/claims": {
    title: "Claims",
    description: "The configured smoke claim is available on its Mandate Detail record; general claim indexing is not enabled.",
  },
  "/activity": {
    title: "Activity",
    description: "A complete live activity feed requires indexed Arc events and is not enabled yet.",
  },
});

function LiveUnindexedPage({ route, navigate }) {
  const page = liveUnindexedRoutes[route];
  return (
    <>
      <header className="page-header">
        <div className="page-title-row">
          <div><h1>{page.title}</h1><p>Arc Testnet · read-only Live Mode</p></div>
          <PrimaryButton type="button" onClick={() => navigate(liveEvidenceRoute)}>Open live evidence</PrimaryButton>
        </div>
      </header>
      <section className="dashboard-panel live-unindexed-panel" aria-labelledby="live-unindexed-heading">
        <span className="mode-badge mode-live">Live Mode</span>
        <h2 id="live-unindexed-heading">No sample records shown</h2>
        <p>{page.description}</p>
        <p>Open mandate {fidraConfig.liveEvidenceMandateId} to inspect the settled, contract-read smoke evidence for spend {fidraConfig.liveEvidenceSpendId}.</p>
      </section>
    </>
  );
}

function App() {
  const [route, setRoute] = useState(() => isKnownRoute(window.location.pathname) ? window.location.pathname : "/");
  const [notice, setNotice] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [theme, setTheme] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get("theme");
    if (requested === "light" || requested === "dark") return requested;
    const saved = window.localStorage.getItem("fidra-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("fidra-theme", theme);
  }, [theme]);

  useEffect(() => {
    const handlePopState = () => setRoute(isKnownRoute(window.location.pathname) ? window.location.pathname : "/");
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = (nextRoute) => {
    const resolvedRoute = resolveModeRoute(nextRoute);
    if (!isKnownRoute(resolvedRoute)) return;
    setNotice("");
    window.history.pushState({}, "", resolvedRoute);
    setRoute(resolvedRoute);
    setMobileNavOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const showNotice = (message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  };

  const toggleDataMode = () => {
    const nextMode = fidraConfig.demoMode ? "live" : "demo";
    window.localStorage.setItem(FIDRA_MODE_STORAGE_KEY, nextMode);
    const nextRoute = routeMandateId(route)
      ? nextMode === "live" ? liveEvidenceRoute : demoMandateRoute
      : route;
    window.location.assign(nextRoute);
  };

  const activeNavRoute = route.startsWith("/mandates")
    ? "/mandates/1042"
    : route.startsWith("/worker") ? "/worker"
      : route.startsWith("/platform") ? "/platform" : route;
  const liveUnindexedPage = !fidraConfig.demoMode && liveUnindexedRoutes[route];
  const isV1Route = route === "/try" || route.startsWith("/worker") || route.startsWith("/platform");

  if (route === "/") {
    return <Landing navigate={navigate} theme={theme} toggleTheme={() => setTheme((current) => current === "dark" ? "light" : "dark")} toggleDataMode={toggleDataMode} />;
  }

  return (
    <div className={`app-shell ${isV1Route ? "app-shell-v1" : ""}`}>
      <aside className={`sidebar ${mobileNavOpen ? "is-open" : ""}`}>
        <div className="sidebar-top">
          <FidraMark onClick={() => navigate("/")} />
          <button className="mobile-close" type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}>
            <X />
          </button>
        </div>
        <nav aria-label="Primary navigation">
          {navItems.map(({ label, icon: Icon, route: itemRoute, section }, index) => (
            <div className="nav-entry" key={label}>
              {(index === 0 || navItems[index - 1].section !== section) && <span className="nav-section-label">{section}</span>}
              <button
                className={`nav-item ${activeNavRoute === itemRoute ? "is-active" : ""}`}
                type="button"
                aria-current={activeNavRoute === itemRoute ? "page" : undefined}
                onClick={() => navigate(itemRoute)}
              >
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button
            className="data-mode-toggle"
            type="button"
            aria-label={`Switch to ${fidraConfig.demoMode ? "Live" : "Demo"} Mode`}
            onClick={toggleDataMode}
          >
            <span className={`mode-badge ${fidraConfig.demoMode ? "" : "mode-live"}`}>{fidraConfig.demoMode ? "Demo Mode" : "Live Mode"}</span>
            <span>{fidraConfig.demoMode ? "Use Live" : "Use Demo"}</span>
          </button>
          <button
            className="theme-toggle"
            type="button"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
          </button>
        </div>
      </aside>

      <main className={`main-content ${isV1Route ? "v1-main-content" : ""}`}>
        <div className="mobile-brand-row">
          <button className="mobile-menu" type="button" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}>
            <List />
          </button>
          <FidraMark onClick={() => navigate("/")} />
        </div>
        {liveUnindexedPage ? (
          <LiveUnindexedPage route={route} navigate={navigate} />
        ) : (
          <>
            {route === "/overview" && <Overview navigate={navigate} />}
            {routeMandateId(route) && <MandateDetail mandateId={routeMandateId(route)} showNotice={showNotice} />}
            {route === "/claims" && <Claims navigate={navigate} showNotice={showNotice} />}
            {route === "/activity" && <Activity showNotice={showNotice} />}
            {route === "/vendor-onboarding" && <VendorOnboarding showNotice={showNotice} />}
            {(route === "/worker" || route === "/worker/claims" || workerClaimId(route)) && (
              <WorkerPayout claimId={workerClaimId(route)} navigate={navigate} showNotice={showNotice} />
            )}
            {route.startsWith("/platform") && <PlatformConsole route={route} navigate={navigate} />}
            {route === "/try" && <TryFidra showNotice={showNotice} />}
          </>
        )}
      </main>

      {mobileNavOpen && <button className="nav-scrim" type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
      <div className={`toast ${notice ? "is-visible" : ""}`} role="status" aria-live="polite">{notice}</div>
    </div>
  );
}

export default App;
