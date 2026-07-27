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
