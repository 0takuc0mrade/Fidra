export const MANDATE_STATUS_LABELS = Object.freeze({
  0: "None",
  1: "Active",
  2: "Revoked",
});

export const REQUEST_STATUS_LABELS = Object.freeze({
  0: "None",
  1: "Requested",
  2: "Approved",
  3: "Locked",
  4: "Released",
  5: "Rejected",
});

/**
 * @typedef {Object} FidraMandate
 * @property {bigint} id
 * @property {string} business
 * @property {string} agent
 * @property {string} approver
 * @property {bigint} totalBudget
 * @property {bigint} reserved
 * @property {bigint} spent
 * @property {bigint} availableBudget
 * @property {bigint} expiresAt
 * @property {bigint} maxPerPurchase
 * @property {boolean} proofRequired
 * @property {string} status
 */

/**
 * @typedef {Object} FidraClaim
 * @property {bigint} id
 * @property {bigint} mandateId
 * @property {string} agent
 * @property {string} vendor
 * @property {string} payee
 * @property {bigint} amount
 * @property {string} proofHash
 * @property {string} externalRefHash
 * @property {string} status
 * @property {bigint} releaseDueAt
 */

export const FIDRA_DATA_MODES = Object.freeze({
  demo: "demo",
  live: "live",
});

export const PLATFORM_STATUS_LABELS = Object.freeze({
  0: "None",
  1: "Active",
  2: "Paused",
});

export const EARNINGS_CLAIM_STATUS_LABELS = Object.freeze({
  0: "None",
  1: "Pending",
  2: "Certified",
  3: "Cancelled",
  4: "Advanced",
  5: "Settled",
  6: "Defaulted",
});

export const PURCHASE_STATUS_LABELS = Object.freeze({
  0: "None",
  1: "Outstanding",
  2: "Settled",
  3: "Defaulted",
});

export const CIRCLE_CHALLENGE_STATES = Object.freeze({
  notConfigured: "not_configured",
  ready: "quote_available",
  awaitingApproval: "awaiting_approval",
  rejected: "challenge_rejected",
  pending: "transaction_pending",
  confirmed: "transaction_confirmed",
  failed: "transaction_failed",
  timedOut: "transaction_timed_out",
});

/**
 * @typedef {Object} FidraV1Platform
 * @property {bigint} id
 * @property {string} settlementWallet
 * @property {bigint} creditLimit
 * @property {bigint} outstandingExposure
 * @property {bigint} reserveBalance
 * @property {bigint} advanceFeeBps
 * @property {string} status
 */

/**
 * @typedef {Object} FidraV1EarningsClaim
 * @property {bigint} id
 * @property {bigint} platformId
 * @property {string} worker
 * @property {bigint} faceValue
 * @property {bigint} dueDate
 * @property {string} externalTaskIdHash
 * @property {string} evidenceHash
 * @property {string} status
 */

/**
 * @typedef {Object} FidraV1VaultQuote
 * @property {bigint} claimId
 * @property {bigint} faceValue
 * @property {bigint} feeAmount
 * @property {bigint} advanceAmount
 * @property {bigint} advanceFeeBps
 * @property {bigint} blockNumber
 */

/**
 * @typedef {Object} FidraArcReceipt
 * @property {string} transactionHash
 * @property {string} from
 * @property {string} to
 * @property {bigint} blockNumber
 * @property {string} explorerUrl
 */

/**
 * @typedef {Object} FidraV1AccountingStats
 * @property {bigint} accountedCash
 * @property {bigint} actualCash
 * @property {bigint} accountedAssets
 * @property {bigint} outstandingPrincipal
 * @property {bigint} outstandingFaceValue
 * @property {bigint} totalRealizedProfit
 * @property {bigint} totalRealizedLoss
 * @property {bigint} totalContractualShortfall
 */

/**
 * @typedef {Object} WorkerWalletMismatch
 * @property {"worker_wallet_mismatch"} status
 * @property {string} connectedWallet
 * @property {string} expectedWorker
 */
