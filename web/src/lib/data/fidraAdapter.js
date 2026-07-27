import { fidraConfig } from "../config.js";
import { getLiveIntegrationStatus, getLiveMandateDetail } from "./liveFidraData.js";
import { getMockIntegrationStatus, getMockMandateDetail } from "./mockFidraData.js";

const defaultMandateId = fidraConfig.demoMode ? 1042 : fidraConfig.liveEvidenceMandateId;

export function getInitialIntegrationStatus() {
  return fidraConfig.demoMode ? getMockIntegrationStatus() : getLiveIntegrationStatus();
}

export function getInitialMandateDetail(mandateId = defaultMandateId) {
  return fidraConfig.demoMode ? getMockMandateDetail(mandateId) : null;
}

export async function loadMandateDetail(mandateId = defaultMandateId) {
  return fidraConfig.demoMode
    ? getMockMandateDetail(mandateId)
    : getLiveMandateDetail(mandateId, fidraConfig.liveEvidenceSpendId);
}

export const adapterMode = fidraConfig.demoMode ? "demo" : "live";
