import { computeAdvance, formatUsdcUnits, sameAddress } from "./buyClaim.js";

export function workerQuote(claim, platform) {
  if (!claim || !platform) return null;
  const { advanceUnits, spreadUnits } = computeAdvance(claim.faceValue, platform.advanceFeeBps);
  return {
    faceUnits: BigInt(claim.faceValue),
    advanceUnits,
    feeUnits: spreadUnits,
    face: formatUsdcUnits(claim.faceValue),
    advance: formatUsdcUnits(advanceUnits),
    fee: formatUsdcUnits(spreadUnits),
  };
}

export function deriveWorkerClaimState({ circleConfigured, wallet, claim, purchase, platform, nowSeconds }) {
  if (!circleConfigured) return "not_configured";
  if (!wallet?.address) return "wallet_required";
  if (!claim) return "loading";
  if (!sameAddress(wallet.address, claim.worker)) return "worker_wallet_mismatch";
  if (["Advanced", "Settled", "Defaulted"].includes(claim.status) || purchase?.status !== "None") return "claim_already_paid";
  if (claim.status !== "Certified") return "claim_not_certified";
  if (BigInt(claim.dueDate) <= BigInt(nowSeconds)) return "claim_expired";
  if (!platform?.active) return "platform_paused";
  return "quote_available";
}

export function mapWorkerTransactionStatus(payload) {
  const status = payload?.status;
  if (status === "awaiting_approval") return { state: "awaiting_approval" };
  if (status === "transaction_pending") return { state: "transaction_pending" };
  if (status === "transaction_confirmed" && payload.txHash && payload.explorerUrl) {
    return { state: "transaction_confirmed", txHash: payload.txHash, explorerUrl: payload.explorerUrl, receipt: payload.receipt };
  }
  if (["transaction_failed", "transaction_timed_out"].includes(status)) {
    return { state: status, errorReason: payload.errorReason ?? null, txHash: null, explorerUrl: null };
  }
  return { state: "transaction_pending", txHash: null, explorerUrl: null };
}
