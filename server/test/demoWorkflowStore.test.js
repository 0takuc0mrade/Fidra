import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { DemoWorkflowStore } from "../src/demoWorkflowStore.js";
import { RequestLimiter } from "../src/requestLimiter.js";
import { createConfig } from "../src/config.js";
import { SandboxPlatformService } from "../src/sandboxPlatformService.js";

const directories = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

async function store() {
  const directory = await mkdtemp(join(tmpdir(), "fidra-workflows-"));
  directories.push(directory);
  return { directory, value: new DemoWorkflowStore(join(directory, "workflows.json")) };
}

test("fresh and returning users receive one active durable workflow", async () => {
  const { value } = await store();
  const first = await value.createOrGet({ userRef: "user-a", worker: `0x${"1".repeat(40)}`, platformId: 3 });
  const retried = await value.createOrGet({ userRef: "user-a", worker: `0x${"1".repeat(40)}`, platformId: 3 });
  assert.equal(retried.id, first.id);
  assert.equal((await value.findForUser("user-a")).state, "wallet_ready");
});

test("workflow survives a store restart without persisting Circle secrets", async () => {
  const { directory, value } = await store();
  const created = await value.createOrGet({ userRef: "hashed-user", worker: `0x${"2".repeat(40)}`, platformId: 3 });
  await value.update(created.id, { state: "arc_pending", advance: { operationId: "operation-1", transactionId: "circle-tx-1" } });
  const restarted = new DemoWorkflowStore(join(directory, "workflows.json"));
  const recovered = await restarted.findByOperationId("operation-1");
  const raw = await readFile(join(directory, "workflows.json"), "utf8");
  assert.equal(recovered.state, "arc_pending");
  assert.equal(raw.includes("userToken"), false);
  assert.equal(raw.includes("encryptionKey"), false);
});

test("completed user can begin a new workflow without rewriting history", async () => {
  const { value } = await store();
  const first = await value.createOrGet({ userRef: "user-b", worker: `0x${"3".repeat(40)}`, platformId: 3 });
  await value.update(first.id, { state: "complete" });
  const second = await value.createOrGet({ userRef: "user-b", worker: `0x${"3".repeat(40)}`, platformId: 3 });
  assert.notEqual(second.id, first.id);
  assert.equal((await value.readAll()).workflows[first.id].state, "complete");
});

test("daily certified face total supports the global demo budget", async () => {
  const { value } = await store();
  const workflow = await value.createOrGet({ userRef: "user-c", worker: `0x${"4".repeat(40)}`, platformId: 3 });
  await value.update(workflow.id, { claim: { faceValue: "100000", certifyReceipt: { transactionHash: `0x${"a".repeat(64)}` } } });
  assert.equal(await value.dailyCertifiedFaceTotal(), 100000n);
});

test("request limiter enforces wallet, user, session and IP keys atomically per window", () => {
  let now = 1_000;
  const limiter = new RequestLimiter({ limit: 2, windowMs: 100, now: () => now });
  const keys = ["wallet:a", "user:a", "session:a", "ip:a"];
  assert.equal(limiter.consume(keys), true);
  assert.equal(limiter.consume(keys), true);
  assert.equal(limiter.consume(keys), false);
  now += 101;
  assert.equal(limiter.consume(keys), true);
});

test("global sandbox kill switch fails closed before signer or network use", async () => {
  const service = new SandboxPlatformService(createConfig({ SANDBOX_WRITES_ENABLED: "false" }));
  await assert.rejects(service.clients(), (error) => error.code === "sandbox_disabled" && error.status === 503);
});
