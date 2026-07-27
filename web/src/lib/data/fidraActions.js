import { fidraConfig } from "../config.js";

export class FidraActionUnavailableError extends Error {
  constructor(action) {
    super(`${action} is read-only in this milestone. Live wallet transactions are not implemented yet.`);
    this.name = "FidraActionUnavailableError";
    this.action = action;
  }
}

export class FidraDemoActionUnavailableError extends Error {
  constructor(action) {
    super(`${action} has no demo handler yet. No state change or transaction was produced.`);
    this.name = "FidraDemoActionUnavailableError";
    this.action = action;
  }
}

function actionStub(action) {
  return async (payload = {}, options = {}) => {
    if (!fidraConfig.demoMode) throw new FidraActionUnavailableError(action);
    if (typeof options.mockHandler === "function") {
      return options.mockHandler(payload);
    }
    throw new FidraDemoActionUnavailableError(action);
  };
}

export const createMandate = actionStub("createMandate");
export const requestSpend = actionStub("requestSpend");
export const submitProof = actionStub("submitProof");
export const approveSpend = actionStub("approveSpend");
export const rejectSpend = actionStub("rejectSpend");
export const lockSpend = actionStub("lockSpend");
export const assignClaim = actionStub("assignClaim");
export const buyClaim = actionStub("buyClaim");
export const releaseSpend = actionStub("releaseSpend");
export const revokeMandate = actionStub("revokeMandate");
export const reclaimExpired = actionStub("reclaimExpired");
export const freezeAuthorizedAdvanceVault = actionStub("freezeAuthorizedAdvanceVault");

export const fidraActions = Object.freeze({
  createMandate,
  requestSpend,
  submitProof,
  approveSpend,
  rejectSpend,
  lockSpend,
  assignClaim,
  buyClaim,
  releaseSpend,
  revokeMandate,
  reclaimExpired,
  freezeAuthorizedAdvanceVault,
});
