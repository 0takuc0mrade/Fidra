import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PlatformActionError,
  certifyPlatformBatch,
  certifyPlatformClaim,
  createPlatformClaim,
  settlePlatformClaim,
} from "../src/lib/v1/platformActions.js";
import { availablePlatformCredit, platformCapabilities } from "../src/lib/v1/platformPolicy.js";

const SETTLEMENT_WALLET = `0x${"1".repeat(40)}`;
const WORKER = `0x${"2".repeat(40)}`;
const TX_HASH = `0x${"a".repeat(64)}`;

function clients({ active = true, authorizedSettlement = true } = {}) {
  const simulations = [];
  const writes = [];
  const platform = {
    settlementWallet: SETTLEMENT_WALLET,
    active,
    creditLimit: 3_000_000n,
    outstandingExposure: 1_000_000n,
    reserveBalance: 400_000n,
    advanceFeeBps: 100n,
  };
  const readClient = {
    readContract: async ({ functionName }) => {
      if (functionName === "getPlatform") return platform;
      if (functionName === "isAuthorizedSettlementPayer") return authorizedSettlement;
      if (functionName === "getClaim") return { platformId: 1n, faceValue: 1_000_000n };
      throw new Error(`unexpected read ${functionName}`);
    },
    simulateContract: async (request) => {
      simulations.push(request);
      return { request, result: request.functionName === "createClaim" ? 6n : undefined };
    },
    waitForTransactionReceipt: async ({ hash }) => ({ status: "success", transactionHash: hash, logs: [] }),
  };
  const walletClient = {
    getChainId: async () => 5_042_002,
    requestAddresses: async () => [SETTLEMENT_WALLET],
    writeContract: async (request) => { writes.push(request); return TX_HASH; },
  };
  return { readClient, walletClient, simulations, writes, platform };
}

function claimInput(suffix = "one") {
  return {
    worker: WORKER,
    faceValue: "1.00",
    dueDate: new Date(Date.now() + 86_400_000).toISOString(),
    taskReference: `task-${suffix}`,
    evidenceReference: `evidence-${suffix}`,
  };
}

test("single claim creation and certification simulate before writing", async () => {
  const context = clients();
  const created = await createPlatformClaim(1, claimInput(), context);
  const certified = await certifyPlatformClaim(1, 6, context);
  assert.equal(created.claimId, "6");
  assert.equal(created.explorerUrl, `https://testnet.arcscan.app/tx/${TX_HASH}`);
  assert.equal(certified.receipt.status, "success");
  assert.deepEqual(context.simulations.map((request) => request.functionName), ["createClaim", "certifyClaim"]);
  assert.equal(context.writes.length, 2);
});

test("batch certification uses the bounded atomic V1 function", async () => {
  const context = clients();
  await certifyPlatformBatch(1, [claimInput("one"), claimInput("two")], context);
  const request = context.simulations[0];
  assert.equal(request.functionName, "createAndCertifyClaimsBatch");
  assert.equal(request.args[1].length, 2);
  assert.equal(request.args[2][0], 1_000_000n);
  assert.equal(context.writes.length, 1);
});

test("platform summary computes unused credit from exposure", () => {
  const context = clients();
  assert.equal(availablePlatformCredit(context.platform), 2_000_000n);
});

test("paused platforms cannot create or certify new exposure", async () => {
  const context = clients({ active: false });
  const capabilities = platformCapabilities(context.platform);
  assert.equal(capabilities.createClaim, false);
  assert.equal(capabilities.certifyClaim, false);
  assert.equal(capabilities.certifyBatch, false);
  await assert.rejects(() => certifyPlatformClaim(1, 6, context), (error) => error instanceof PlatformActionError && error.code === "platform_paused");
  assert.equal(context.writes.length, 0);
});

test("paused platform may approve USDC and settle an existing obligation", async () => {
  const context = clients({ active: false, authorizedSettlement: true });
  assert.equal(platformCapabilities(context.platform).settleExisting, true);
  const result = await settlePlatformClaim(1, 6, context);
  assert.equal(result.approval.receipt.status, "success");
  assert.equal(result.settlement.receipt.status, "success");
  assert.deepEqual(context.simulations.map((request) => request.functionName), ["approve", "settleClaim"]);
  assert.equal(context.writes.length, 2);
});
