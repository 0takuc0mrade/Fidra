import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { createApp } from "../src/app.js";
import { createConfig } from "../src/config.js";
import { DemoWorkflowStore } from "../src/demoWorkflowStore.js";

const servers = [];
const directories = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function start(config, overrides) {
  const server = createServer(createApp(config, overrides));
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function post(baseUrl, path, body = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { Origin: "http://localhost:5173", Cookie: "fidra_vendor_session=test", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("full mocked browser journey is durable and idempotent through automatic settlement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fidra-demo-app-"));
  directories.push(directory);
  const config = createConfig({
    CIRCLE_WALLETS_ENABLED: "true", CIRCLE_API_KEY: "sandbox-key", CIRCLE_APP_ID: "sandbox-app",
    SANDBOX_WRITES_ENABLED: "true", SANDBOX_PLATFORM_ID: "3",
    SANDBOX_PLATFORM_PRIVATE_KEY: "test-only-overridden-signer",
    DEMO_WORKFLOW_FILE: join(directory, "workflows.json"),
    SERVER_ALLOWED_ORIGINS: "http://localhost:5173",
  });
  const worker = `0x${"2".repeat(40)}`;
  const session = { id: "test", userToken: "token", circleUserId: "circle-user", emailHash: "email-hash",
    wallet: { id: "wallet", address: worker, blockchain: "ARC-TESTNET", accountType: "EOA", state: "LIVE" },
    expiresAt: Date.now() + 60_000 };
  const sessionStore = { get: () => session, update: (_id, values) => Object.assign(session, values), delete: () => {} };
  const workflowStore = new DemoWorkflowStore(config.demoWorkflowFile);
  let taskCreates = 0;
  let settlements = 0;
  const receipt = (character) => ({ transactionHash: `0x${character.repeat(64)}`, blockNumber: "100", explorerUrl: `https://testnet.arcscan.app/tx/0x${character.repeat(64)}`, status: "success" });
  const snapshot = (workflow) => ({ platform: { id: "3", active: true, creditLimit: "1000000", exposure: workflow.advance?.receipt && !workflow.settlement?.receipt ? "100000" : "0", reserve: "100000", feeBps: "100" },
    claimStatus: workflow.settlement?.receipt ? 5 : workflow.advance?.receipt ? 4 : workflow.claim?.certifyReceipt ? 2 : null,
    purchaseStatus: workflow.settlement?.receipt ? 2 : workflow.advance?.receipt ? 1 : 0,
    workerBalanceNativeUsdc: "0.04", vault: { accountedCash: "1000000", actualCash: "1000000", accountedAssets: "1000000" } });
  const sandboxService = {
    task: (workflow) => ({ externalTaskId: `task-${workflow.id}`, taskHash: `0x${"3".repeat(64)}`, evidenceHash: `0x${"4".repeat(64)}` }),
    createClaim: async (workflow) => { taskCreates += 1; return { id: "7", platformId: "3", worker, faceValue: "100000", dueDate: String(Math.floor(Date.now() / 1000) + 86_400), taskHash: workflow.task.taskHash, evidenceHash: workflow.task.evidenceHash, createReceipt: receipt("5") }; },
    certifyClaim: async (claim) => ({ ...claim, certifyReceipt: receipt("6") }),
    settle: async () => { settlements += 1; return { approvalReceipt: receipt("7"), receipt: receipt("8"), platformExposure: "0", statsBefore: {}, statsAfter: {} }; },
    snapshot: async (workflow) => snapshot(workflow),
  };
  const circleClient = {
    createContractExecutionChallenge: async () => ({ challengeId: "challenge-1" }),
    getTransaction: async () => { throw new Error("Circle status timeout after submission"); },
  };
  const v1ChainReads = {
    getWorkerAdvanceSnapshot: async () => ({ chainId: 5_042_002, expectedChainId: 5_042_002, blockNumber: 99n, blockTimestamp: BigInt(Math.floor(Date.now() / 1000)),
      claim: { platformId: 3n, worker, faceValue: 100000n, dueDate: BigInt(Math.floor(Date.now() / 1000) + 86_400), status: 2 },
      purchase: { status: 0 }, platform: { settlementWallet: `0x${"3".repeat(40)}`, active: true, creditLimit: 1000000n, outstandingExposure: 0n, reserveBalance: 100000n, advanceFeeBps: 100n },
      accountedCash: 1000000n, actualCash: 1000000n }),
    verifyWorkerAdvance: async () => ({ transactionHash: `0x${"9".repeat(64)}`, blockNumber: 101n, from: worker, to: config.v1AdvanceVaultAddress }),
    recoverWorkerAdvance: async () => ({ transactionHash: `0x${"9".repeat(64)}`, blockNumber: 101n, from: worker, to: config.v1AdvanceVaultAddress }),
  };
  const overrides = { sessionStore, workflowStore, sandboxService, circleClient, v1ChainReads,
    gasSeedService: { seed: async () => ({ status: "confirmed", amountUsdc: "0.04", transactionHash: `0x${"a".repeat(64)}`, blockNumber: "98", explorerUrl: `https://testnet.arcscan.app/tx/0x${"a".repeat(64)}` }) },
    walletStore: { get: async () => null },
  };
  const baseUrl = await start(config, overrides);

  let response = await post(baseUrl, "/api/demo/workflow");
  assert.equal((await response.json()).workflow.state, "wallet_ready");
  response = await post(baseUrl, "/api/demo/workflow/gas");
  assert.equal((await response.json()).workflow.state, "gas_ready");
  const firstTask = await (await post(baseUrl, "/api/demo/workflow/task")).json();
  const duplicateTask = await (await post(baseUrl, "/api/demo/workflow/task")).json();
  assert.equal(firstTask.workflow.claim.id, "7");
  assert.equal(duplicateTask.workflow.claim.id, "7");
  assert.equal(taskCreates, 1);

  const prepared = await (await post(baseUrl, "/api/circle/worker/transactions/purchase-advance", { claimId: 7, minimumAdvanceAmount: "99000" })).json();
  assert.equal(prepared.challengeId, "challenge-1");
  const duplicatePrepared = await (await post(baseUrl, "/api/circle/worker/transactions/purchase-advance", { claimId: 7, minimumAdvanceAmount: "99000" })).json();
  assert.equal(duplicatePrepared.operationId, prepared.operationId);
  assert.equal(duplicatePrepared.challengeId, prepared.challengeId);
  await post(baseUrl, `/api/circle/worker/transactions/${prepared.operationId}`, { transactionId: "circle-transaction-1" });
  const confirmed = await (await fetch(`${baseUrl}/api/circle/worker/transactions/${prepared.operationId}`, { headers: { Cookie: "fidra_vendor_session=test" } })).json();
  assert.equal(confirmed.status, "transaction_confirmed");
  assert.equal(confirmed.verification, "recovered_from_arc");

  const settled = await (await post(baseUrl, "/api/demo/workflow/settle")).json();
  const duplicateSettlement = await (await post(baseUrl, "/api/demo/workflow/settle")).json();
  assert.equal(settled.workflow.state, "complete");
  assert.equal(duplicateSettlement.workflow.settlement.receipt.transactionHash, settled.workflow.settlement.receipt.transactionHash);
  assert.equal(settlements, 1);
  const recovered = await (await fetch(`${baseUrl}/api/demo/workflow`, { headers: { Cookie: "fidra_vendor_session=test" } })).json();
  assert.equal(recovered.workflow.state, "complete");
  assert.equal(recovered.workflow.userRef, undefined);
});
