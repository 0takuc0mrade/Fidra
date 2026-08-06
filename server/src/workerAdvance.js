import { getAddress, isAddress } from "viem";

export const CLAIM_STATUS = Object.freeze({
  None: 0,
  Pending: 1,
  Certified: 2,
  Cancelled: 3,
  Advanced: 4,
  Settled: 5,
  Defaulted: 6,
});

export const PURCHASE_STATUS = Object.freeze({
  None: 0,
  Outstanding: 1,
  Settled: 2,
  Defaulted: 3,
});

export class WorkerAdvanceError extends Error {
  constructor(code, message, status = 409, details = {}) {
    super(message);
    this.name = "WorkerAdvanceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function sameAddress(a, b) {
  if (!a || !b || !isAddress(a, { strict: false }) || !isAddress(b, { strict: false })) return false;
  return getAddress(a) === getAddress(b);
}

export function computeV1Advance(faceValue, advanceFeeBps) {
  const face = BigInt(faceValue);
  const bps = BigInt(advanceFeeBps);
  const feeAmount = (face * bps) / 10_000n;
  return { feeAmount, advanceAmount: face - feeAmount };
}

function minimumAdvance(value, computed) {
  if (value === undefined || value === null || value === "") return computed;
  try {
    const parsed = BigInt(value);
    if (parsed < 0n || parsed > computed) throw new Error("out of range");
    return parsed;
  } catch {
    throw new WorkerAdvanceError(
      "invalid_minimum_advance",
      "minimumAdvanceAmount must be a non-negative USDC-unit integer no greater than the live quote.",
      422,
      { advanceAmount: computed.toString() },
    );
  }
}

export function validateWorkerAdvance(snapshot, connectedWallet, requestedMinimum) {
  if (snapshot.chainId !== snapshot.expectedChainId) {
    throw new WorkerAdvanceError(
      "wrong_chain",
      `Arc RPC returned chain ${snapshot.chainId}; expected ${snapshot.expectedChainId}.`,
      502,
    );
  }
  const { claim, purchase, platform } = snapshot;
  if (!claim || Number(claim.status) === CLAIM_STATUS.None) {
    throw new WorkerAdvanceError("claim_not_found", "The earnings claim does not exist.", 404);
  }
  if (!sameAddress(claim.worker, connectedWallet)) {
    throw new WorkerAdvanceError(
      "worker_wallet_mismatch",
      "The connected Circle wallet is not the worker named by this claim.",
      409,
      { connectedWallet, expectedWorker: claim.worker },
    );
  }
  if (Number(purchase?.status ?? 0) !== PURCHASE_STATUS.None) {
    throw new WorkerAdvanceError("claim_already_purchased", "This claim has already received an advance.");
  }
  if (Number(claim.status) !== CLAIM_STATUS.Certified) {
    throw new WorkerAdvanceError(
      "claim_not_certified",
      "Only a certified earnings claim can receive an instant payout.",
      409,
      { claimStatus: Number(claim.status) },
    );
  }
  if (BigInt(claim.dueDate) <= BigInt(snapshot.blockTimestamp)) {
    throw new WorkerAdvanceError("claim_expired", "The claim's normal payout date has passed.", 409, {
      dueDate: claim.dueDate.toString(),
      blockTimestamp: snapshot.blockTimestamp.toString(),
    });
  }
  if (!platform) {
    throw new WorkerAdvanceError("platform_inactive", "The claim's platform is not registered or available.");
  }
  if (!platform.active) {
    throw new WorkerAdvanceError("platform_paused", "The platform is paused and cannot create new exposure.");
  }
  if (BigInt(platform.reserveBalance) === 0n) {
    throw new WorkerAdvanceError("reserve_requirement_not_met", "The platform has no reserve available for new advances.");
  }
  const newExposure = BigInt(platform.outstandingExposure) + BigInt(claim.faceValue);
  if (newExposure > BigInt(platform.creditLimit)) {
    throw new WorkerAdvanceError("credit_limit_exceeded", "The platform has insufficient unused credit for this claim.", 409, {
      creditLimit: platform.creditLimit.toString(),
      outstandingExposure: platform.outstandingExposure.toString(),
      requestedFaceValue: claim.faceValue.toString(),
    });
  }

  const quote = computeV1Advance(claim.faceValue, platform.advanceFeeBps);
  if (quote.advanceAmount <= 0n) {
    throw new WorkerAdvanceError("invalid_quote", "The live claim quote has no payable advance.");
  }
  if (quote.advanceAmount > BigInt(snapshot.accountedCash)) {
    throw new WorkerAdvanceError("insufficient_accounted_liquidity", "Fidra's accounted liquidity is below this payout.");
  }
  if (quote.advanceAmount > BigInt(snapshot.actualCash)) {
    throw new WorkerAdvanceError("insufficient_actual_liquidity", "Fidra's actual USDC custody is below this payout.");
  }

  return {
    ...quote,
    minimumAdvanceAmount: minimumAdvance(requestedMinimum, quote.advanceAmount),
  };
}
