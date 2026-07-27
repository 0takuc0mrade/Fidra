import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeAdvance,
  evaluateSellEligibility,
  formatUsdcUnits,
  mapBuyClaimStatus,
  quoteDeadline,
  sameAddress,
} from "../src/lib/circle/buyClaim.js";

const VENDOR = `0x${"1".repeat(40)}`;
const OTHER = `0x${"2".repeat(40)}`;

test("computeAdvance matches the deployed 1% discount with floor division", () => {
  const { advanceUnits, spreadUnits } = computeAdvance(1_000_000n, 100);
  assert.equal(advanceUnits, 990_000n);
  assert.equal(spreadUnits, 10_000n);
});

test("formatUsdcUnits renders 6-decimal units without trailing zeros", () => {
  assert.equal(formatUsdcUnits(990_000n), "0.99");
  assert.equal(formatUsdcUnits(1_000_000n), "1");
  assert.equal(formatUsdcUnits(1_234_500n), "1.2345");
});

test("eligibility flags a payee mismatch and never falls back to another address", () => {
  const result = evaluateSellEligibility({
    walletsConfigured: true,
    wallet: { address: VENDOR },
    gasReady: true,
    claim: { status: "Locked", payee: OTHER, alreadyPurchased: false },
  });
  assert.equal(result.eligible, false);
  assert.equal(result.state, "payee_mismatch");
  assert.equal(result.currentPayee, OTHER);
  assert.equal(result.walletAddress, VENDOR);
});

test("eligibility surfaces not_configured and funding_required states honestly", () => {
  assert.equal(evaluateSellEligibility({ walletsConfigured: false }).state, "not_configured");
  assert.equal(
    evaluateSellEligibility({ walletsConfigured: true, wallet: { address: VENDOR }, gasReady: false, claim: {} }).state,
    "funding_required",
  );
});

test("eligibility passes only for a locked, unpurchased, payee-matched claim", () => {
  const result = evaluateSellEligibility({
    walletsConfigured: true,
    wallet: { address: VENDOR },
    gasReady: true,
    claim: { status: "Locked", payee: VENDOR.toLowerCase(), alreadyPurchased: false },
  });
  assert.equal(result.eligible, true);
  assert.equal(result.state, "ready");
});

test("mapBuyClaimStatus returns a confirmed receipt only with a real hash and link", () => {
  const confirmed = mapBuyClaimStatus({ status: "confirmed", txHash: "0xabc", explorerUrl: "https://x/tx/0xabc" });
  assert.deepEqual(confirmed, { state: "confirmed", txHash: "0xabc", explorerUrl: "https://x/tx/0xabc" });

  const confirmedNoHash = mapBuyClaimStatus({ status: "confirmed", txHash: null });
  assert.equal(confirmedNoHash.state, "pending");
});

test("mapBuyClaimStatus never fabricates a hash for a failed transaction", () => {
  const failed = mapBuyClaimStatus({ status: "failed", errorReason: "reverted" });
  assert.equal(failed.state, "failed");
  assert.equal(failed.txHash, null);
  assert.equal(failed.explorerUrl, null);
  assert.equal(failed.errorReason, "reverted");
});

test("mapBuyClaimStatus treats in-flight states as pending", () => {
  assert.equal(mapBuyClaimStatus({ status: "pending" }).state, "pending");
  assert.equal(mapBuyClaimStatus(null).state, "pending");
});

test("sameAddress is case-insensitive and rejects malformed input", () => {
  assert.equal(sameAddress(VENDOR, VENDOR.toUpperCase().replace("0X", "0x")), true);
  assert.equal(sameAddress(VENDOR, OTHER), false);
  assert.equal(sameAddress(VENDOR, "not-an-address"), false);
  assert.equal(sameAddress(undefined, VENDOR), false);
});

test("quoteDeadline returns a future unix timestamp", () => {
  const now = 1_000_000_000_000;
  assert.equal(quoteDeadline(600, now), Math.floor(now / 1000) + 600);
});
