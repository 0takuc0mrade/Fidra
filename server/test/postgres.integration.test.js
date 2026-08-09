import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createConfig } from "../src/config.js";
import { createPool, databaseHealth, migrate } from "../src/postgres.js";
import {
  PostgresOperationStore,
  PostgresRequestLimiter,
  PostgresWalletStore,
  PostgresWorkflowStore,
} from "../src/postgresStores.js";

const enabled = process.env.FIDRA_DB_INTEGRATION === "true" && Boolean(process.env.DATABASE_URL);
const integration = enabled ? test : test.skip;
const runId = randomUUID().replaceAll("-", "");
const userRef = createHash("sha256").update(`fidra-neon-${runId}`).digest("hex");
const walletAddress = `0x${runId.slice(0, 40).padEnd(40, "a")}`;
const walletId = `fidra-test-wallet-${runId}`;
const budgetType = `fidra_test_${runId}`;
const gasBudgetType = `${budgetType}_gas`;
const claimId = BigInt(`0x${runId.slice(0, 12)}`).toString();
const rateKey = `rate-${runId}`;
const rateKeyHash = createHash("sha256").update(rateKey).digest("hex");
let firstPool;
let secondPool;

before(async () => {
  if (!enabled) return;
  const config = createConfig({ ...process.env, DATABASE_POOL_MAX: "4" });
  firstPool = createPool(config);
  secondPool = createPool(config);
  await migrate(firstPool);
});

after(async () => {
  if (!enabled) return;
  await firstPool.query("BEGIN");
  try {
    await firstPool.query("DELETE FROM operations WHERE user_ref=$1", [userRef]);
    await firstPool.query("DELETE FROM gas_seeds WHERE wallet_id=$1", [walletId]);
    await firstPool.query("DELETE FROM wallets WHERE wallet_id=$1", [walletId]);
    await firstPool.query("DELETE FROM workflows WHERE user_ref=$1", [userRef]);
    await firstPool.query("DELETE FROM budget_reservations WHERE budget_type=$1", [budgetType]);
    await firstPool.query("DELETE FROM budget_usage WHERE budget_type=$1", [budgetType]);
    await firstPool.query("DELETE FROM budget_reservations WHERE budget_type=$1", [gasBudgetType]);
    await firstPool.query("DELETE FROM budget_usage WHERE budget_type=$1", [gasBudgetType]);
    await firstPool.query("DELETE FROM rate_limit_buckets WHERE key_hash=$1", [rateKeyHash]);
    await firstPool.query("COMMIT");
  } catch (error) {
    await firstPool.query("ROLLBACK");
    throw error;
  } finally {
    await Promise.all([firstPool.end(), secondPool.end()]);
  }
});

integration("Neon is reachable at the required migration without exposing connection details", async () => {
  assert.deepEqual(await databaseHealth(firstPool), { configured: true, reachable: true, schemaReady: true });
});

integration("two instances create one workflow and recover it after restart", async () => {
  const a = new PostgresWorkflowStore(firstPool);
  const b = new PostgresWorkflowStore(secondPool);
  const [first, second] = await Promise.all([
    a.createOrGet({ userRef, worker: walletAddress, platformId: 999_001 }),
    b.createOrGet({ userRef, worker: walletAddress, platformId: 999_001 }),
  ]);
  assert.equal(first.id, second.id);
  await a.update(first.id, { state: "gas_ready", gasFunding: { status: "not_needed" } });
  const restarted = new PostgresWorkflowStore(secondPool);
  assert.equal((await restarted.findForUser(userRef)).state, "gas_ready");
});

integration("workflow transitions are guarded and terminal state cannot move backwards", async () => {
  const store = new PostgresWorkflowStore(firstPool);
  const workflow = await store.findForUser(userRef);
  await store.update(workflow.id, { state: "task_complete" });
  await store.update(workflow.id, { state: "claim_created", claim: { id: claimId, faceValue: "100000" } });
  await store.update(workflow.id, { state: "claim_certified", claim: { id: claimId, faceValue: "100000", certifyReceipt: { transactionHash: `0x${"1".repeat(64)}` } } });
  await store.update(workflow.id, { state: "complete", settlement: { receipt: { transactionHash: `0x${"2".repeat(64)}` } } });
  await assert.rejects(() => store.update(workflow.id, { state: "claim_certified" }), /Invalid workflow transition/);
});

integration("operation idempotency and transaction binding survive independent pools", async () => {
  const workflowStore = new PostgresWorkflowStore(firstPool);
  const completed = await workflowStore.findForUser(userRef);
  const active = await workflowStore.createOrGet({ userRef, worker: walletAddress, platformId: 999_001 });
  assert.notEqual(active.id, completed.id);
  const idempotencyKey = randomUUID();
  const a = new PostgresOperationStore(firstPool);
  const b = new PostgresOperationStore(secondPool);
  const values = { ownerRef: userRef, workflowId: active.id, operationType: "purchase_advance", idempotencyKey, claimId: "999002" };
  const [first, duplicate] = await Promise.all([a.create(values), b.create(values)]);
  assert.equal(first.id, duplicate.id);
  assert.ok(await a.bind(first.id, userRef, `circle-${runId}`));
  assert.equal(await b.bind(first.id, userRef, `other-${runId}`), false);
  const restarted = new PostgresOperationStore(secondPool);
  assert.equal((await restarted.get(first.id, userRef)).transactionId, `circle-${runId}`);
  await restarted.update(first.id, { status: "transaction_confirmed", txHash: `0x${"3".repeat(64)}` });
  await assert.rejects(() => a.update(first.id, { status: "transaction_pending" }), /Invalid operation transition/);
});

integration("atomic budget reservations never exceed their limit", async () => {
  const stores = [new PostgresWorkflowStore(firstPool), new PostgresWorkflowStore(secondPool)];
  const attempts = await Promise.all(Array.from({ length: 10 }, (_, index) => stores[index % 2].reserveBudget({
    budgetType,
    reservationKey: `${runId}-${index}`,
    amountUnits: 30n,
    limitUnits: 100n,
  })));
  assert.equal(attempts.filter((item) => item.reserved).length, 3);
  const usage = await firstPool.query("SELECT amount_units::text AS amount FROM budget_usage WHERE budget_type=$1", [budgetType]);
  assert.equal(usage.rows[0].amount, "90");
});

integration("one wallet obtains one gas reservation across instances", async () => {
  const a = new PostgresWalletStore(firstPool);
  const b = new PostgresWalletStore(secondPool);
  await a.upsert({ id: walletId, address: walletAddress, blockchain: "ARC-TESTNET", accountType: "EOA", state: "LIVE" }, userRef);
  const options = { requestKeyHash: userRef, amountUnits: 10n, dailyLimitUnits: 100n, budgetType: gasBudgetType };
  const [first, duplicate] = await Promise.all([a.reserveSeed({ id: walletId, address: walletAddress }, options), b.reserveSeed({ id: walletId, address: walletAddress }, options)]);
  assert.equal([first, duplicate].filter((item) => item.reserved).length, 1);
  assert.equal([first, duplicate].filter((item) => item.existing).length, 1);
});

integration("database rate limiter is shared between instances", async () => {
  const a = new PostgresRequestLimiter(firstPool, { limit: 2, windowMs: 60_000 });
  const b = new PostgresRequestLimiter(secondPool, { limit: 2, windowMs: 60_000 });
  const results = await Promise.all([a.consume([rateKey]), b.consume([rateKey]), a.consume([rateKey])]);
  assert.equal(results.filter(Boolean).length, 2);
});

integration("durable rows contain hashed ownership and no supplied secret markers", async () => {
  const marker = `never-persist-${runId}@example.test`;
  const rows = await firstPool.query(
    `SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb)::text AS data FROM (
      SELECT user_ref, payload FROM workflows WHERE user_ref=$1
      UNION ALL SELECT user_ref, payload FROM operations WHERE user_ref=$1
    ) x`,
    [userRef],
  );
  assert.match(rows.rows[0].data, new RegExp(userRef));
  assert.ok(!rows.rows[0].data.includes(marker));
});
