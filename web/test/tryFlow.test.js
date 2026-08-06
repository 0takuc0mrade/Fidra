import assert from "node:assert/strict";
import { test } from "node:test";
import { demoRecoveryAction, demoWorkflowFlags } from "../src/lib/v1/demoFlow.js";

const receipt = { transactionHash: `0x${"a".repeat(64)}`, explorerUrl: `https://testnet.arcscan.app/tx/0x${"a".repeat(64)}` };

test("fresh tester progresses through gas, claim, approval, settlement and completion", () => {
  assert.equal(demoWorkflowFlags({ state: "wallet_ready" }).gasReady, false);
  assert.equal(demoWorkflowFlags({ state: "gas_ready", gasFunding: { status: "not_needed" } }).gasReady, true);
  assert.equal(demoWorkflowFlags({ state: "claim_certified", claim: { certifyReceipt: receipt } }).claimReady, true);
  assert.equal(demoWorkflowFlags({ state: "arc_pending", claim: { certifyReceipt: receipt }, advance: { operationId: "op" } }).approvalPending, true);
  assert.equal(demoWorkflowFlags({ state: "advance_confirmed", advance: { receipt } }).settlementPending, true);
  assert.equal(demoWorkflowFlags({ state: "complete", settlement: { receipt } }).complete, true);
});

test("refresh recovery resumes Arc polling or automatic settlement", () => {
  assert.equal(demoRecoveryAction({ state: "arc_pending", advance: { operationId: "operation-1" } }), "poll_advance");
  assert.equal(demoRecoveryAction({ state: "advance_confirmed", advance: { receipt } }), "settle");
  assert.equal(demoRecoveryAction({ state: "complete", settlement: { receipt } }), null);
});

test("an already-funded wallet is gas-ready without a funding receipt", () => {
  const flags = demoWorkflowFlags({ state: "gas_ready", gasFunding: { status: "not_needed" } });
  assert.equal(flags.gasReady, true);
  assert.equal(flags.claimReady, false);
});
