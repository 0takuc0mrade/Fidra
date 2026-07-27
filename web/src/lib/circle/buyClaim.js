// Framework-free helpers for the Circle vendor claim-sale flow.
// Kept pure so it can be unit-tested with `node --test` without Vite/JSX.

const USDC_DECIMALS = 6n;

/** Advance produced by the deployed fixed discount, matching AdvanceVault.buyClaim (floor division). */
export function computeAdvance(faceUnits, discountBps) {
  const face = BigInt(faceUnits);
  const bps = BigInt(discountBps);
  const advance = (face * (10_000n - bps)) / 10_000n;
  return { advanceUnits: advance, spreadUnits: face - advance };
}

/** Formats 6-decimal USDC units to a plain string (no grouping) for compact quote rows. */
export function formatUsdcUnits(units) {
  const value = BigInt(units);
  const base = 10n ** USDC_DECIMALS;
  const whole = value / base;
  const fraction = (value % base).toString().padStart(Number(USDC_DECIMALS), "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

/**
 * Determines whether the connected Circle EOA may sell a given locked claim.
 * Returns a structured reason so the UI can show honest, non-silent states.
 */
export function evaluateSellEligibility({ walletsConfigured, wallet, gasReady, claim }) {
  if (!walletsConfigured) return { eligible: false, state: "not_configured" };
  if (!wallet?.address) return { eligible: false, state: "wallet_required" };
  if (!gasReady) return { eligible: false, state: "funding_required" };
  if (!claim) return { eligible: false, state: "no_eligible_claim" };
  if (claim.status !== "Locked") return { eligible: false, state: "not_locked", claimStatus: claim.status };
  if (claim.alreadyPurchased) return { eligible: false, state: "already_purchased" };
  if (!sameAddress(claim.payee, wallet.address)) {
    return {
      eligible: false,
      state: "payee_mismatch",
      currentPayee: claim.payee,
      walletAddress: wallet.address,
    };
  }
  return { eligible: true, state: "ready" };
}

/**
 * Maps a backend buy-claim status payload to a UI transaction state.
 * A confirmed receipt (hash + explorer link) appears only when the backend
 * reports terminal success with a real hash; failures never carry a hash.
 */
export function mapBuyClaimStatus(payload) {
  if (!payload) return { state: "pending", txHash: null, explorerUrl: null };
  if (payload.status === "confirmed" && payload.txHash) {
    return { state: "confirmed", txHash: payload.txHash, explorerUrl: payload.explorerUrl ?? null };
  }
  if (payload.status === "failed") {
    return { state: "failed", txHash: null, explorerUrl: null, errorReason: payload.errorReason ?? null };
  }
  return { state: "pending", txHash: null, explorerUrl: null };
}

export function sameAddress(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (!/^0x[0-9a-fA-F]{40}$/.test(a) || !/^0x[0-9a-fA-F]{40}$/.test(b)) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/** Suggested quote deadline: now + `ttlSeconds`, in unix seconds. */
export function quoteDeadline(ttlSeconds = 600, now = Date.now()) {
  return Math.floor(now / 1000) + ttlSeconds;
}
