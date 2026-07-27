import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_RPC_URL,
  ARC_USDC_ADDRESS,
  FIDRA_ADVANCE_VAULT_ADDRESS,
  FIDRA_LIVE_EVIDENCE_MANDATE_ID,
  FIDRA_LIVE_EVIDENCE_SPEND_ID,
  FIDRA_MANDATE_MANAGER_ADDRESS,
} from "../../../shared/constants.js";

function readBoolean(value, fallback) {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function readChainId(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : ARC_TESTNET_CHAIN_ID;
}

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const FIDRA_MODE_STORAGE_KEY = "fidra-data-mode";

function readRuntimeDemoMode() {
  if (typeof window === "undefined") return null;
  const requested = new URLSearchParams(window.location.search).get("mode");
  if (requested === "demo") return true;
  if (requested === "live") return false;

  try {
    const saved = window.localStorage.getItem(FIDRA_MODE_STORAGE_KEY);
    if (saved === "demo") return true;
    if (saved === "live") return false;
  } catch {
    return null;
  }
  return null;
}

const runtimeDemoMode = readRuntimeDemoMode();

export const fidraConfig = Object.freeze({
  demoMode: runtimeDemoMode ?? readBoolean(import.meta.env.VITE_DEMO_MODE, false),
  rpcUrl: import.meta.env.VITE_ARC_RPC_URL?.trim() || ARC_TESTNET_RPC_URL,
  chainId: readChainId(import.meta.env.VITE_CHAIN_ID),
  usdcAddress: import.meta.env.VITE_USDC_ADDRESS?.trim() || ARC_USDC_ADDRESS,
  mandateManagerAddress: import.meta.env.VITE_MANDATE_MANAGER_ADDRESS?.trim() || FIDRA_MANDATE_MANAGER_ADDRESS,
  advanceVaultAddress: import.meta.env.VITE_ADVANCE_VAULT_ADDRESS?.trim() || FIDRA_ADVANCE_VAULT_ADDRESS,
  liveEvidenceMandateId: readPositiveInteger(
    import.meta.env.VITE_LIVE_EVIDENCE_MANDATE_ID,
    FIDRA_LIVE_EVIDENCE_MANDATE_ID,
  ),
  liveEvidenceSpendId: readPositiveInteger(
    import.meta.env.VITE_LIVE_EVIDENCE_SPEND_ID,
    FIDRA_LIVE_EVIDENCE_SPEND_ID,
  ),
});

export const fidraMode = fidraConfig.demoMode ? "demo" : "live";
