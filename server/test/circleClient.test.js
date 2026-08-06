import assert from "node:assert/strict";
import { test } from "node:test";
import { CircleClient } from "../src/circleClient.js";
import { createConfig } from "../src/config.js";
import { createCircleStatus } from "../src/status.js";

function configured(overrides = {}) {
  return createConfig({
    CIRCLE_WALLETS_ENABLED: "true",
    CIRCLE_API_KEY: "server-only-test-key",
    CIRCLE_APP_ID: "test-app-id",
    ...overrides,
  });
}

test("Circle wallet initialization explicitly requests an Arc Testnet EOA", async () => {
  const calls = [];
  const client = new CircleClient(configured(), async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ data: { challengeId: "challenge-1" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  await client.initializeUser("user-token", "idempotency-key");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.circle.com/v1/w3s/user/initialize");
  assert.equal(calls[0].options.headers["X-User-Token"], "user-token");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    idempotencyKey: "idempotency-key",
    accountType: "EOA",
    blockchains: ["ARC-TESTNET"],
  });
});

test("existing-user wallet creation also explicitly requests an Arc Testnet EOA", async () => {
  let requestBody;
  const client = new CircleClient(configured(), async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ data: { challengeId: "challenge-2" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  await client.createWallet("user-token", "idempotency-key", "vendor-ref");

  assert.equal(requestBody.accountType, "EOA");
  assert.deepEqual(requestBody.blockchains, ["ARC-TESTNET"]);
  assert.deepEqual(requestBody.metadata, [{ name: "Fidra worker", refId: "vendor-ref" }]);
});

test("an invalid gas seed cap does not misreport a valid Circle wallet configuration", () => {
  const status = createCircleStatus(configured({
    VENDOR_GAS_SEED_ENABLED: "true",
    OPERATOR_SEED_PRIVATE_KEY: `0x${"1".repeat(64)}`,
    VENDOR_GAS_SEED_USDC: "3",
    MAX_VENDOR_GAS_SEED_USDC: "2",
  }));

  assert.equal(status.wallets.status, "configured");
  assert.equal(status.gasSeed.status, "error");
  assert.equal(status.gasSeed.maximumUsdc, "2");
});
