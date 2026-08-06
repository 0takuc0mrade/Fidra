import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_RPC_URL,
  ARC_TESTNET_EXPLORER_URL,
  ARC_USDC_ADDRESS,
  FIDRA_ADVANCE_VAULT_ADDRESS,
  FIDRA_LIVE_EVIDENCE_MANDATE_ID,
  FIDRA_LIVE_EVIDENCE_SPEND_ID,
  FIDRA_MANDATE_MANAGER_ADDRESS,
  FIDRA_V1_ADVANCE_VAULT_ADDRESS,
  FIDRA_V1_EARNINGS_MANAGER_ADDRESS,
  FIDRA_V1_LIVE_PLATFORM_ID,
  FIDRA_V1_PLATFORM_REGISTRY_ADDRESS,
} from "../../../shared/constants.js";
import { resolveDataMode } from "./dataMode.js";

const viteEnv = import.meta.env ?? {};

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

const runtimeMode = resolveDataMode({
  query: typeof window === "undefined" ? "" : window.location.search,
  stored: (() => {
    if (typeof window === "undefined") return null;
    try { return window.localStorage.getItem(FIDRA_MODE_STORAGE_KEY); } catch { return null; }
  })(),
  envDemoMode: readBoolean(viteEnv.VITE_DEMO_MODE, false),
});

export const fidraConfig = Object.freeze({
  demoMode: runtimeMode === "demo",
  rpcUrl: viteEnv.VITE_ARC_RPC_URL?.trim() || ARC_TESTNET_RPC_URL,
  chainId: readChainId(viteEnv.VITE_CHAIN_ID),
  blockExplorerUrl: viteEnv.VITE_ARC_BLOCK_EXPLORER_URL?.trim() || ARC_TESTNET_EXPLORER_URL,
  usdcAddress: viteEnv.VITE_USDC_ADDRESS?.trim() || ARC_USDC_ADDRESS,
  mandateManagerAddress: viteEnv.VITE_MANDATE_MANAGER_ADDRESS?.trim() || FIDRA_MANDATE_MANAGER_ADDRESS,
  advanceVaultAddress: viteEnv.VITE_ADVANCE_VAULT_ADDRESS?.trim() || FIDRA_ADVANCE_VAULT_ADDRESS,
  v1PlatformRegistryAddress: viteEnv.VITE_V1_PLATFORM_REGISTRY_ADDRESS?.trim() || FIDRA_V1_PLATFORM_REGISTRY_ADDRESS,
  v1EarningsManagerAddress: viteEnv.VITE_V1_EARNINGS_MANAGER_ADDRESS?.trim() || FIDRA_V1_EARNINGS_MANAGER_ADDRESS,
  v1AdvanceVaultAddress: viteEnv.VITE_V1_ADVANCE_VAULT_ADDRESS?.trim() || FIDRA_V1_ADVANCE_VAULT_ADDRESS,
  v1LivePlatformId: readPositiveInteger(viteEnv.VITE_V1_LIVE_PLATFORM_ID, FIDRA_V1_LIVE_PLATFORM_ID),
  liveEvidenceMandateId: readPositiveInteger(
    viteEnv.VITE_LIVE_EVIDENCE_MANDATE_ID,
    FIDRA_LIVE_EVIDENCE_MANDATE_ID,
  ),
  liveEvidenceSpendId: readPositiveInteger(
    viteEnv.VITE_LIVE_EVIDENCE_SPEND_ID,
    FIDRA_LIVE_EVIDENCE_SPEND_ID,
  ),
});

export const fidraMode = fidraConfig.demoMode ? "demo" : "live";
