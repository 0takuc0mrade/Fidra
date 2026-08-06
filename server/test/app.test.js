import assert from "node:assert/strict";
import { createServer } from "node:http";
import { afterEach, test } from "node:test";
import { createApp } from "../src/app.js";
import { createConfig } from "../src/config.js";

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function start(config, overrides = {}) {
  const server = createServer(createApp(config, overrides));
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function authenticatedSessionStore({ withWallet = false } = {}) {
  const session = {
    id: "test-session",
    userToken: "circle-user-token",
    circleUserId: "circle-user-id",
    expiresAt: Date.now() + 60_000,
    ...(withWallet ? {
      wallet: {
        id: "wallet-id",
        address: `0x${"1".repeat(40)}`,
        blockchain: "ARC-TESTNET",
        accountType: "EOA",
        state: "LIVE",
      },
    } : {}),
  };
  return {
    get: () => session,
    update: (_id, values) => Object.assign(session, values),
    delete: () => {},
  };
}

test("status is fail-closed and never exposes secret environment values", async () => {
  const secret = "TEST_API_SECRET_MUST_NOT_LEAK";
  const config = createConfig({ CIRCLE_API_KEY: secret });
  const baseUrl = await start(config);
  const response = await fetch(`${baseUrl}/api/circle/status`);
  const body = await response.text();
  const payload = JSON.parse(body);
  assert.equal(response.status, 200);
  assert.equal(payload.wallets.status, "not_configured");
  assert.equal(payload.wallets.targetAccountType, "EOA");
  assert.equal(payload.gasSeed.status, "not_configured");
  assert.equal(body.includes(secret), false);
});

test("wallet creation refuses unauthenticated requests", async () => {
  const config = createConfig({ SERVER_ALLOWED_ORIGINS: "http://localhost:5173" });
  const baseUrl = await start(config);
  const response = await fetch(`${baseUrl}/api/circle/vendor/wallet`, {
    method: "POST",
    headers: { Origin: "http://localhost:5173", "Content-Type": "application/json" },
    body: "{}",
  });
  const payload = await response.json();
  assert.equal(response.status, 401);
  assert.equal(payload.status, "unauthenticated");
});

test("Circle start returns not_configured without calling Circle", async () => {
  const config = createConfig({ SERVER_ALLOWED_ORIGINS: "http://localhost:5173" });
  const baseUrl = await start(config);
  const response = await fetch(`${baseUrl}/api/circle/vendor/session/start`, {
    method: "POST",
    headers: { Origin: "http://localhost:5173", "Content-Type": "application/json" },
    body: JSON.stringify({ method: "google", deviceId: "device-1" }),
  });
  const payload = await response.json();
  assert.equal(response.status, 503);
  assert.equal(payload.status, "not_configured");
});

test("wallet creation cannot fabricate a wallet when Circle credentials are missing", async () => {
  const config = createConfig({ SERVER_ALLOWED_ORIGINS: "http://localhost:5173" });
  const baseUrl = await start(config, { sessionStore: authenticatedSessionStore() });
  const response = await fetch(`${baseUrl}/api/circle/vendor/wallet`, {
    method: "POST",
    headers: {
      Cookie: "fidra_vendor_session=test-session",
      Origin: "http://localhost:5173",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const payload = await response.json();
  assert.equal(response.status, 503);
  assert.equal(payload.status, "error");
  assert.equal("wallet" in payload, false);
});

test("gas seed returns not_configured and no hash when its signer is disabled", async () => {
  const config = createConfig({ SERVER_ALLOWED_ORIGINS: "http://localhost:5173" });
  const baseUrl = await start(config, { sessionStore: authenticatedSessionStore({ withWallet: true }) });
  const response = await fetch(`${baseUrl}/api/circle/vendor/seed-gas`, {
    method: "POST",
    headers: {
      Cookie: "fidra_vendor_session=test-session",
      Origin: "http://localhost:5173",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const payload = await response.json();
  assert.equal(response.status, 503);
  assert.equal(payload.status, "not_configured");
  assert.equal("transactionHash" in payload, false);
});

test("submit-proof and request-spend remain honest 501 stubs", async () => {
  const config = createConfig({ SERVER_ALLOWED_ORIGINS: "http://localhost:5173" });
  const baseUrl = await start(config);
  for (const path of ["/api/circle/vendor/transactions/submit-proof", "/api/circle/agent/transactions/request-spend"]) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", "Content-Type": "application/json" },
      body: "{}",
    });
    const payload = await response.json();
    assert.equal(response.status, 501);
    assert.equal(payload.status, "not_implemented");
    assert.equal("transactionHash" in payload, false);
  }
});

const VENDOR_ADDRESS = `0x${"1".repeat(40)}`;
const OTHER_ADDRESS = `0x${"2".repeat(40)}`;

function lockedSpend(overrides = {}) {
  return {
    mandateId: 1n,
    agent: OTHER_ADDRESS,
    vendor: VENDOR_ADDRESS,
    payee: VENDOR_ADDRESS,
    amount: 1_000_000n,
    status: "Locked",
    lockedAt: 100n,
    releaseDueAt: 999_999n,
    advanceAssigned: false,
    ...overrides,
  };
}

function chainReadsStub(spend, purchase = { seller: `0x${"0".repeat(40)}`, settled: false }) {
  return {
    getSpendRequest: async () => spend,
    getClaimPurchase: async () => purchase,
  };
}

async function postBuyClaim(baseUrl, body) {
  const response = await fetch(`${baseUrl}/api/circle/vendor/transactions/buy-claim`, {
    method: "POST",
    headers: {
      Cookie: "fidra_vendor_session=test-session",
      Origin: "http://localhost:5173",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

test("buy-claim preparation refuses an unauthenticated caller", async () => {
  const config = createConfig({ SERVER_ALLOWED_ORIGINS: "http://localhost:5173" });
  const baseUrl = await start(config);
  const response = await fetch(`${baseUrl}/api/circle/vendor/transactions/buy-claim`, {
    method: "POST",
    headers: { Origin: "http://localhost:5173", "Content-Type": "application/json" },
    body: "{}",
  });
  const payload = await response.json();
  assert.equal(response.status, 401);
  assert.equal(payload.status, "unauthenticated");
});

test("buy-claim preparation rejects a wallet that is not the current payee", async () => {
  const config = createConfig({ SERVER_ALLOWED_ORIGINS: "http://localhost:5173" });
  const baseUrl = await start(config, {
    sessionStore: authenticatedSessionStore({ withWallet: true }),
    chainReads: chainReadsStub(lockedSpend({ payee: OTHER_ADDRESS })),
    circleClient: { createContractExecutionChallenge: async () => { throw new Error("must not create a challenge"); } },
  });
  const { response, payload } = await postBuyClaim(baseUrl, { requestId: 2, deadline: Math.floor(Date.now() / 1000) + 600 });
  assert.equal(response.status, 409);
  assert.equal(payload.status, "payee_mismatch");
  assert.equal(payload.currentPayee, OTHER_ADDRESS);
  assert.equal(payload.walletAddress, VENDOR_ADDRESS);
});

test("buy-claim preparation rejects a non-Locked claim", async () => {
  const config = createConfig({ SERVER_ALLOWED_ORIGINS: "http://localhost:5173" });
  const baseUrl = await start(config, {
    sessionStore: authenticatedSessionStore({ withWallet: true }),
    chainReads: chainReadsStub(lockedSpend({ status: "Released" })),
    circleClient: { createContractExecutionChallenge: async () => { throw new Error("must not create a challenge"); } },
  });
  const { response, payload } = await postBuyClaim(baseUrl, { requestId: 2, deadline: Math.floor(Date.now() / 1000) + 600 });
  assert.equal(response.status, 409);
  assert.equal(payload.status, "not_locked");
});

test("buy-claim preparation rejects a stale deadline", async () => {
  const config = createConfig({ SERVER_ALLOWED_ORIGINS: "http://localhost:5173" });
  const baseUrl = await start(config, {
    sessionStore: authenticatedSessionStore({ withWallet: true }),
    chainReads: chainReadsStub(lockedSpend()),
    circleClient: { createContractExecutionChallenge: async () => { throw new Error("must not create a challenge"); } },
  });
  const { response, payload } = await postBuyClaim(baseUrl, { requestId: 2, deadline: Math.floor(Date.now() / 1000) - 10 });
  assert.equal(response.status, 422);
  assert.equal(payload.status, "deadline_invalid");
});

test("buy-claim preparation computes the deployed 1% advance and creates a challenge", async () => {
  const config = createConfig({ SERVER_ALLOWED_ORIGINS: "http://localhost:5173" });
  let challengeBody;
  const baseUrl = await start(config, {
    sessionStore: authenticatedSessionStore({ withWallet: true }),
    chainReads: chainReadsStub(lockedSpend()),
    circleClient: {
      createContractExecutionChallenge: async (_token, body) => { challengeBody = body; return { challengeId: "challenge-buy-1" }; },
    },
  });
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const { response, payload } = await postBuyClaim(baseUrl, { requestId: 2, deadline });
  assert.equal(response.status, 200);
  assert.equal(payload.status, "challenge_required");
  assert.equal(payload.challengeId, "challenge-buy-1");
  assert.equal(payload.faceAmount, "1000000");
  assert.equal(payload.advanceAmount, "990000");
  assert.equal(payload.expectedSpread, "10000");
  assert.equal(challengeBody.abiFunctionSignature, "buyClaim(uint256,uint256,uint256)");
  assert.equal(challengeBody.contractAddress, config.advanceVaultAddress);
  assert.deepEqual(challengeBody.abiParameters, ["2", "990000", String(deadline)]);
});

test("buy-claim status maps a failed Circle transaction without fabricating a hash", async () => {
  const config = createConfig({ SERVER_ALLOWED_ORIGINS: "http://localhost:5173" });
  const baseUrl = await start(config, {
    sessionStore: authenticatedSessionStore({ withWallet: true }),
    circleClient: { getTransaction: async () => ({ state: "FAILED", errorReason: "reverted" }) },
  });
  const response = await fetch(`${baseUrl}/api/circle/vendor/transactions/tx-123`, {
    headers: { Cookie: "fidra_vendor_session=test-session", Origin: "http://localhost:5173" },
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.status, "failed");
  assert.equal(payload.txHash, null);
  assert.equal(payload.explorerUrl, null);
});

test("buy-claim status returns a confirmed receipt with an ArcScan link on completion", async () => {
  const config = createConfig({ SERVER_ALLOWED_ORIGINS: "http://localhost:5173" });
  const hash = `0x${"c".repeat(64)}`;
  const baseUrl = await start(config, {
    sessionStore: authenticatedSessionStore({ withWallet: true }),
    circleClient: { getTransaction: async () => ({ state: "COMPLETE", txHash: hash }) },
  });
  const response = await fetch(`${baseUrl}/api/circle/vendor/transactions/tx-456`, {
    headers: { Cookie: "fidra_vendor_session=test-session", Origin: "http://localhost:5173" },
  });
  const payload = await response.json();
  assert.equal(payload.status, "confirmed");
  assert.equal(payload.txHash, hash);
  assert.equal(payload.explorerUrl, `https://testnet.arcscan.app/tx/${hash}`);
});

test("mock mode is rejected instead of fabricating Circle success", async () => {
  const config = createConfig({
    CIRCLE_WALLETS_ENABLED: "true",
    CIRCLE_MOCK_MODE: "true",
    CIRCLE_API_KEY: "secret",
    CIRCLE_APP_ID: "app-id",
  });
  const baseUrl = await start(config);
  const response = await fetch(`${baseUrl}/api/circle/status`);
  const payload = await response.json();
  assert.equal(payload.wallets.status, "error");
  assert.ok(payload.configurationErrors[0].includes("does not fabricate"));
});

function configuredWorkerConfig(overrides = {}) {
  return createConfig({
    CIRCLE_WALLETS_ENABLED: "true",
    CIRCLE_API_KEY: "test-circle-key",
    CIRCLE_APP_ID: "test-circle-app",
    SERVER_ALLOWED_ORIGINS: "http://localhost:5173",
    ...overrides,
  });
}

function v1Snapshot(overrides = {}) {
  const value = {
    chainId: 5_042_002,
    expectedChainId: 5_042_002,
    blockNumber: 123n,
    blockTimestamp: 1_000n,
    claim: {
      platformId: 1n,
      worker: VENDOR_ADDRESS,
      faceValue: 1_000_000n,
      dueDate: 2_000n,
      status: 2,
    },
    purchase: { status: 0 },
    platform: {
      active: true,
      creditLimit: 3_000_000n,
      outstandingExposure: 0n,
      reserveBalance: 400_000n,
      advanceFeeBps: 100n,
    },
    accountedCash: 3_000_000n,
    actualCash: 3_000_000n,
  };
  return { ...value, ...overrides };
}

async function postWorkerAdvance(baseUrl, body) {
  const response = await fetch(`${baseUrl}/api/circle/worker/transactions/purchase-advance`, {
    method: "POST",
    headers: {
      Cookie: "fidra_vendor_session=test-session",
      Origin: "http://localhost:5173",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

async function bindWorkerTransaction(baseUrl, operationId, transactionId) {
  const response = await fetch(`${baseUrl}/api/circle/worker/transactions/${operationId}`, {
    method: "POST",
    headers: {
      Cookie: "fidra_vendor_session=test-session",
      Origin: "http://localhost:5173",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ transactionId }),
  });
  return { response, payload: await response.json() };
}

async function getWorkerTransaction(baseUrl, operationId) {
  const response = await fetch(`${baseUrl}/api/circle/worker/transactions/${operationId}`, {
    headers: { Cookie: "fidra_vendor_session=test-session", Origin: "http://localhost:5173" },
  });
  return { response, payload: await response.json() };
}

test("V1 worker advance is fail-closed when Circle is not configured", async () => {
  const baseUrl = await start(createConfig({ SERVER_ALLOWED_ORIGINS: "http://localhost:5173" }), {
    sessionStore: authenticatedSessionStore({ withWallet: true }),
  });
  const { response, payload } = await postWorkerAdvance(baseUrl, { claimId: 1 });
  assert.equal(response.status, 503);
  assert.equal(payload.status, "circle_not_configured");
  assert.equal("txHash" in payload, false);
});

test("valid V1 worker advance creates exact purchaseAdvance calldata", async () => {
  let challengeBody;
  const baseUrl = await start(configuredWorkerConfig(), {
    sessionStore: authenticatedSessionStore({ withWallet: true }),
    v1ChainReads: { getWorkerAdvanceSnapshot: async () => v1Snapshot() },
    circleClient: {
      createContractExecutionChallenge: async (_token, body) => {
        challengeBody = body;
        return { challengeId: "challenge-v1" };
      },
    },
  });
  const { response, payload } = await postWorkerAdvance(baseUrl, { claimId: 7, minimumAdvanceAmount: "980000" });
  assert.equal(response.status, 200);
  assert.equal(payload.status, "challenge_required");
  assert.equal(payload.advanceAmount, "990000");
  assert.equal(payload.feeAmount, "10000");
  assert.equal(challengeBody.contractAddress, configuredWorkerConfig().v1AdvanceVaultAddress);
  assert.equal(challengeBody.abiFunctionSignature, "purchaseAdvance(uint256)");
  assert.deepEqual(challengeBody.abiParameters, ["7"]);
});

test("V1 worker-wallet mismatch never creates a Circle challenge", async () => {
  const baseUrl = await start(configuredWorkerConfig(), {
    sessionStore: authenticatedSessionStore({ withWallet: true }),
    v1ChainReads: { getWorkerAdvanceSnapshot: async () => v1Snapshot({ claim: { ...v1Snapshot().claim, worker: OTHER_ADDRESS } }) },
    circleClient: { createContractExecutionChallenge: async () => { throw new Error("must not be called"); } },
  });
  const { response, payload } = await postWorkerAdvance(baseUrl, { claimId: 1 });
  assert.equal(response.status, 409);
  assert.equal(payload.status, "worker_wallet_mismatch");
  assert.equal(payload.connectedWallet, VENDOR_ADDRESS);
  assert.equal(payload.expectedWorker, OTHER_ADDRESS);
});

async function preparedWorkerOperation({ circleState, verificationResult, verificationError } = {}) {
  const circleClient = {
    createContractExecutionChallenge: async () => ({ challengeId: "challenge-v1" }),
    getTransaction: async () => circleState ?? { state: "INITIATED" },
  };
  const v1ChainReads = {
    getWorkerAdvanceSnapshot: async () => v1Snapshot(),
    verifyWorkerAdvance: async () => {
      if (verificationError) throw verificationError;
      return verificationResult;
    },
  };
  const baseUrl = await start(configuredWorkerConfig(), {
    sessionStore: authenticatedSessionStore({ withWallet: true }),
    circleClient,
    v1ChainReads,
  });
  const prepared = await postWorkerAdvance(baseUrl, { claimId: 1 });
  await bindWorkerTransaction(baseUrl, prepared.payload.operationId, "circle-tx-1");
  return { baseUrl, operationId: prepared.payload.operationId };
}

test("Circle approval rejection remains failed without a hash", async () => {
  const { baseUrl, operationId } = await preparedWorkerOperation({ circleState: { state: "DENIED", errorReason: "user rejected" } });
  const { payload } = await getWorkerTransaction(baseUrl, operationId);
  assert.equal(payload.status, "transaction_failed");
  assert.equal(payload.txHash, null);
  assert.equal(payload.explorerUrl, null);
});

test("Circle transaction failure remains failed without a hash", async () => {
  const { baseUrl, operationId } = await preparedWorkerOperation({ circleState: { state: "FAILED", errorReason: "reverted" } });
  const { payload } = await getWorkerTransaction(baseUrl, operationId);
  assert.equal(payload.status, "transaction_failed");
  assert.equal(payload.errorReason, "reverted");
  assert.equal(payload.txHash, null);
});

test("confirmed worker receipt is returned only after exact Arc state verification", async () => {
  const hash = `0x${"a".repeat(64)}`;
  const { baseUrl, operationId } = await preparedWorkerOperation({
    circleState: { state: "COMPLETE", txHash: hash },
    verificationResult: {
      transactionHash: hash,
      blockNumber: 456n,
      from: VENDOR_ADDRESS,
      to: configuredWorkerConfig().v1AdvanceVaultAddress,
    },
  });
  const { payload } = await getWorkerTransaction(baseUrl, operationId);
  assert.equal(payload.status, "transaction_confirmed");
  assert.equal(payload.txHash, hash);
  assert.equal(payload.explorerUrl, `https://testnet.arcscan.app/tx/${hash}`);
  assert.equal(payload.receipt.blockNumber, "456");
});

test("a Circle hash without the expected Arc state is rejected", async () => {
  const hash = `0x${"b".repeat(64)}`;
  const { baseUrl, operationId } = await preparedWorkerOperation({
    circleState: { state: "COMPLETE", txHash: hash },
    verificationError: new Error("Arc state does not show an outstanding worker advance."),
  });
  const { payload } = await getWorkerTransaction(baseUrl, operationId);
  assert.equal(payload.status, "transaction_failed");
  assert.equal(payload.txHash, null);
  assert.equal(payload.explorerUrl, null);
  assert.match(payload.errorReason, /does not show/);
});

test("expired payout operation reports a timeout without a hash", async () => {
  const operationStore = {
    get: () => ({ status: "transaction_timed_out" }),
  };
  const baseUrl = await start(configuredWorkerConfig(), {
    sessionStore: authenticatedSessionStore({ withWallet: true }),
    operationStore,
  });
  const { payload } = await getWorkerTransaction(baseUrl, "expired-operation");
  assert.equal(payload.status, "transaction_timed_out");
  assert.equal(payload.txHash, null);
});
