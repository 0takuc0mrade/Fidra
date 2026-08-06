const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim() || "";

export class CircleFrontendError extends Error {
  constructor(message, status, payload = null) {
    super(message);
    this.name = "CircleFrontendError";
    this.status = status;
    this.payload = payload;
  }
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: "include",
      headers: options.body ? { "Content-Type": "application/json", ...options.headers } : options.headers,
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new CircleFrontendError("Fidra’s Circle wallet server is unreachable.", 0);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new CircleFrontendError(payload.error || payload.message || "Circle wallet request failed.", response.status, payload);
  }
  return payload;
}

export const circleApi = Object.freeze({
  status: () => request("/api/circle/status"),
  session: () => request("/api/circle/vendor/session/callback"),
  startSession: (body) => request("/api/circle/vendor/session/start", { method: "POST", body }),
  completeSession: (body) => request("/api/circle/vendor/session/complete", { method: "POST", body }),
  logout: () => request("/api/circle/vendor/session/logout", { method: "POST", body: {} }),
  getWallet: () => request("/api/circle/vendor/wallet"),
  createWallet: () => request("/api/circle/vendor/wallet", { method: "POST", body: {} }),
  seedGas: () => request("/api/circle/vendor/seed-gas", { method: "POST", body: {} }),
  prepareBuyClaim: (body) => request("/api/circle/vendor/transactions/buy-claim", { method: "POST", body }),
  buyClaimStatus: (transactionId) => request(`/api/circle/vendor/transactions/${encodeURIComponent(transactionId)}`),
  workerSession: () => request("/api/circle/worker/session/callback"),
  startWorkerSession: (body) => request("/api/circle/worker/session/start", { method: "POST", body }),
  completeWorkerSession: (body) => request("/api/circle/worker/session/complete", { method: "POST", body }),
  logoutWorker: () => request("/api/circle/worker/session/logout", { method: "POST", body: {} }),
  getWorkerWallet: () => request("/api/circle/worker/wallet"),
  createWorkerWallet: () => request("/api/circle/worker/wallet", { method: "POST", body: {} }),
  seedWorkerGas: () => request("/api/circle/worker/seed-gas", { method: "POST", body: {} }),
  preparePurchaseAdvance: (body) => request("/api/circle/worker/transactions/purchase-advance", { method: "POST", body }),
  bindPurchaseAdvance: (operationId, transactionId) => request(
    `/api/circle/worker/transactions/${encodeURIComponent(operationId)}`,
    { method: "POST", body: { transactionId } },
  ),
  purchaseAdvanceStatus: (operationId) => request(`/api/circle/worker/transactions/${encodeURIComponent(operationId)}`),
  demoWorkflow: () => request("/api/demo/workflow"),
  startDemoWorkflow: () => request("/api/demo/workflow", { method: "POST", body: {} }),
  seedDemoGas: () => request("/api/demo/workflow/gas", { method: "POST", body: {} }),
  completeDemoTask: () => request("/api/demo/workflow/task", { method: "POST", body: {} }),
  settleDemo: () => request("/api/demo/workflow/settle", { method: "POST", body: {} }),
});
