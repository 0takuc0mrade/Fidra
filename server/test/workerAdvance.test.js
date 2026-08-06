import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLAIM_STATUS,
  PURCHASE_STATUS,
  WorkerAdvanceError,
  computeV1Advance,
  validateWorkerAdvance,
} from "../src/workerAdvance.js";

const WORKER = `0x${"1".repeat(40)}`;
const OTHER = `0x${"2".repeat(40)}`;

function snapshot(overrides = {}) {
  const base = {
    chainId: 5_042_002,
    expectedChainId: 5_042_002,
    blockNumber: 100n,
    blockTimestamp: 1_000n,
    claim: {
      platformId: 1n,
      worker: WORKER,
      faceValue: 1_000_000n,
      dueDate: 2_000n,
      status: CLAIM_STATUS.Certified,
    },
    purchase: { status: PURCHASE_STATUS.None },
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
  return {
    ...base,
    ...overrides,
    claim: overrides.claim === null ? null : { ...base.claim, ...overrides.claim },
    purchase: { ...base.purchase, ...overrides.purchase },
    platform: overrides.platform === null ? null : { ...base.platform, ...overrides.platform },
  };
}

function expectCode(code, callback) {
  assert.throws(callback, (error) => error instanceof WorkerAdvanceError && error.code === code);
}

test("valid V1 quote uses the deployed per-platform fee formula", () => {
  const quote = validateWorkerAdvance(snapshot(), WORKER, "980000");
  assert.deepEqual(computeV1Advance(1_000_000n, 100n), { feeAmount: 10_000n, advanceAmount: 990_000n });
  assert.equal(quote.advanceAmount, 990_000n);
  assert.equal(quote.feeAmount, 10_000n);
  assert.equal(quote.minimumAdvanceAmount, 980_000n);
});

test("wrong RPC chain is rejected before quote creation", () => {
  expectCode("wrong_chain", () => validateWorkerAdvance(snapshot({ chainId: 1 }), WORKER));
});

test("missing and uncertified claims are explicit", () => {
  expectCode("claim_not_found", () => validateWorkerAdvance(snapshot({ claim: null }), WORKER));
  expectCode("claim_not_certified", () => validateWorkerAdvance(snapshot({ claim: { status: CLAIM_STATUS.Pending } }), WORKER));
});

test("worker ownership is exact and returns both public addresses", () => {
  assert.throws(
    () => validateWorkerAdvance(snapshot(), OTHER),
    (error) => error.code === "worker_wallet_mismatch"
      && error.details.connectedWallet === OTHER
      && error.details.expectedWorker === WORKER,
  );
});

test("expired and already purchased claims are rejected", () => {
  expectCode("claim_expired", () => validateWorkerAdvance(snapshot({ claim: { dueDate: 1_000n } }), WORKER));
  expectCode("claim_already_purchased", () => validateWorkerAdvance(snapshot({ purchase: { status: PURCHASE_STATUS.Outstanding } }), WORKER));
});

test("paused or unavailable platforms are rejected", () => {
  expectCode("platform_paused", () => validateWorkerAdvance(snapshot({ platform: { active: false } }), WORKER));
  expectCode("platform_inactive", () => validateWorkerAdvance(snapshot({ platform: null }), WORKER));
});

test("credit and reserve requirements are enforced", () => {
  expectCode("credit_limit_exceeded", () => validateWorkerAdvance(snapshot({
    platform: { creditLimit: 1_500_000n, outstandingExposure: 1_000_000n },
  }), WORKER));
  expectCode("reserve_requirement_not_met", () => validateWorkerAdvance(snapshot({ platform: { reserveBalance: 0n } }), WORKER));
});

test("accounted and actual liquidity are checked separately", () => {
  expectCode("insufficient_accounted_liquidity", () => validateWorkerAdvance(snapshot({ accountedCash: 900_000n }), WORKER));
  expectCode("insufficient_actual_liquidity", () => validateWorkerAdvance(snapshot({ actualCash: 900_000n }), WORKER));
});

test("minimum advance must be an integer within the live quote", () => {
  expectCode("invalid_minimum_advance", () => validateWorkerAdvance(snapshot(), WORKER, "990001"));
  expectCode("invalid_minimum_advance", () => validateWorkerAdvance(snapshot(), WORKER, "not-units"));
  expectCode("invalid_minimum_advance", () => validateWorkerAdvance(snapshot(), WORKER, "-1"));
});
