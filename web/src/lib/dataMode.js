export function resolveDataMode({ query = "", stored = null, envDemoMode = false } = {}) {
  const requested = new URLSearchParams(query).get("mode");
  if (requested === "demo" || requested === "live") return requested;
  if (stored === "demo" || stored === "live") return stored;
  return envDemoMode ? "demo" : "live";
}
