import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDataMode } from "../src/lib/dataMode.js";
import {
  deriveWorkerClaimState,
  mapWorkerTransactionStatus,
  workerQuote,
} from "../src/lib/circle/workerPayout.js";

const WORKER = `0x${"1".repeat(40)}`;
const OTHER = `0x${"2".repeat(40)}`;
const claim = { worker: WORKER, faceValue: 1_000_000n, dueDate: 2_000n, status: "Certified" };
const purchase = { status: "None" };
const platform = { active: true, advanceFeeBps: 100n };

function state(overrides = {}) {
  return deriveWorkerClaimState({
    circleConfigured: true,
    wallet: { address: WORKER },
    claim,
    purchase,
    platform,
    nowSeconds: 1_000n,
    ...overrides,
  });
}

test("worker display quote shows earnings, available-now amount, and transparent fee", () => {
  const quote = workerQuote(claim, platform);
  assert.equal(quote.face, "1");
  assert.equal(quote.advance, "0.99");
  assert.equal(quote.fee, "0.01");
  assert.equal(quote.advanceUnits, 990_000n);
});

test("worker eligibility surfaces missing configuration and wallet", () => {
  assert.equal(state({ circleConfigured: false }), "not_configured");
  assert.equal(state({ wallet: null }), "wallet_required");
});

test("worker eligibility rejects exact wallet mismatch", () => {
  assert.equal(state({ wallet: { address: OTHER } }), "worker_wallet_mismatch");
});

test("claim status, expiry, and paused-platform states are explicit", () => {
  assert.equal(state({ claim: { ...claim, status: "Pending" } }), "claim_not_certified");
  assert.equal(state({ nowSeconds: 2_000n }), "claim_expired");
  assert.equal(state({ platform: { ...platform, active: false } }), "platform_paused");
});

test("already paid claims cannot return to quote available", () => {
  assert.equal(state({ claim: { ...claim, status: "Advanced" } }), "claim_already_paid");
  assert.equal(state({ purchase: { status: "Outstanding" } }), "claim_already_paid");
  assert.equal(state(), "quote_available");
});

test("Circle and Arc transaction states never invent a receipt", () => {
  assert.deepEqual(mapWorkerTransactionStatus({ status: "awaiting_approval" }), { state: "awaiting_approval" });
  assert.deepEqual(mapWorkerTransactionStatus({ status: "transaction_pending" }), { state: "transaction_pending" });
  const failed = mapWorkerTransactionStatus({ status: "transaction_failed", errorReason: "reverted", txHash: "0xfake" });
  assert.equal(failed.state, "transaction_failed");
  assert.equal(failed.txHash, null);
  assert.equal(failed.explorerUrl, null);
  assert.equal(mapWorkerTransactionStatus({ status: "transaction_confirmed", txHash: "0xhash" }).state, "transaction_pending");
});

test("verified confirmed receipt is mapped only with hash and explorer URL", () => {
  const confirmed = mapWorkerTransactionStatus({
    status: "transaction_confirmed",
    txHash: "0xconfirmed",
    explorerUrl: "https://testnet.arcscan.app/tx/0xconfirmed",
    receipt: { blockNumber: "1" },
  });
  assert.equal(confirmed.state, "transaction_confirmed");
  assert.equal(confirmed.txHash, "0xconfirmed");
  assert.equal(confirmed.receipt.blockNumber, "1");
});

test("Live Mode is default and Demo Mode requires explicit opt-in", () => {
  assert.equal(resolveDataMode(), "live");
  assert.equal(resolveDataMode({ query: "?mode=demo" }), "demo");
  assert.equal(resolveDataMode({ stored: "demo" }), "demo");
  assert.equal(resolveDataMode({ query: "?mode=live", stored: "demo", envDemoMode: true }), "live");
});
