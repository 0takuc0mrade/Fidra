import { getAddress } from "viem";

const DEFAULTS = Object.freeze({
  arcChainId: 5_042_002,
  arcRpcUrl: "https://rpc.testnet.arc.network",
  blockExplorerUrl: "https://testnet.arcscan.app",
  usdcAddress: "0x3600000000000000000000000000000000000000",
  mandateManagerAddress: "0xEfA2b3e70138810eA51552177c3f1AE5ab249EF2",
  advanceVaultAddress: "0x5F7Bec9eC341F816182a56D8E033cac63DBd8C8B",
  v1PlatformRegistryAddress: "0x20EcB05d90D4F24F8Fcf2785BdE240796B8b1af3",
  v1EarningsManagerAddress: "0xdC1C359fC174Fb8C7cDcbE0e09447d123dD9cD57",
  v1AdvanceVaultAddress: "0x12604e5acD074D3499C9ac4D2cbb4Bd39ECE49c5",
});

function booleanValue(value, fallback = false) {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function addressValue(value, fallback) {
  try {
    return getAddress(value?.trim() || fallback);
  } catch {
    return getAddress(fallback);
  }
}

function splitOrigins(value) {
  return new Set((value || "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean));
}

export function createConfig(env = process.env) {
  const walletsEnabled = booleanValue(env.CIRCLE_WALLETS_ENABLED, false);
  const mockMode = booleanValue(env.CIRCLE_MOCK_MODE, false);
  const gasSeedEnabled = booleanValue(env.WORKER_GAS_SEED_ENABLED ?? env.VENDOR_GAS_SEED_ENABLED, false);
  const seedAmountUsdc = positiveNumber(env.WORKER_GAS_SEED_USDC ?? env.VENDOR_GAS_SEED_USDC, 0.1);
  const maxSeedAmountUsdc = positiveNumber(env.MAX_WORKER_GAS_SEED_USDC ?? env.MAX_VENDOR_GAS_SEED_USDC, 0.2);
  const walletMissingKeys = [
    ["CIRCLE_API_KEY", env.CIRCLE_API_KEY],
    ["CIRCLE_APP_ID", env.CIRCLE_APP_ID],
  ].filter(([, value]) => !value?.trim()).map(([key]) => key);
  const seedMissingKeys = gasSeedEnabled && !env.OPERATOR_SEED_PRIVATE_KEY?.trim()
    ? ["OPERATOR_SEED_PRIVATE_KEY"]
    : [];
  const configurationErrors = [];
  if (mockMode) configurationErrors.push("CIRCLE_MOCK_MODE is not supported because Fidra does not fabricate Circle success states.");
  if (seedAmountUsdc > maxSeedAmountUsdc) configurationErrors.push("WORKER_GAS_SEED_USDC exceeds MAX_WORKER_GAS_SEED_USDC.");

  return Object.freeze({
    port: positiveInteger(env.PORT, 8787),
    circleBaseUrl: "https://api.circle.com",
    circleEnvironment: env.CIRCLE_ENV?.trim() || "sandbox",
    circleApiKey: env.CIRCLE_API_KEY?.trim() || "",
    circleAppId: env.CIRCLE_APP_ID?.trim() || "",
    circleGoogleClientId: env.CIRCLE_GOOGLE_CLIENT_ID?.trim() || "",
    walletsEnabled,
    mockMode,
    walletMissingKeys,
    walletsConfigured: walletsEnabled && !mockMode && walletMissingKeys.length === 0,
    gasSeedEnabled,
    seedPrivateKey: env.OPERATOR_SEED_PRIVATE_KEY?.trim() || "",
    seedAmountUsdc,
    maxSeedAmountUsdc,
    seedOncePerWallet: booleanValue(env.SEED_ONCE_PER_WALLET, true),
    seedMissingKeys,
    gasSeedConfigured: gasSeedEnabled && seedMissingKeys.length === 0 && seedAmountUsdc <= maxSeedAmountUsdc,
    configurationErrors,
    arcChainId: positiveInteger(env.ARC_CHAIN_ID, DEFAULTS.arcChainId),
    arcRpcUrl: env.ARC_RPC_URL?.trim() || DEFAULTS.arcRpcUrl,
    blockExplorerUrl: env.ARC_BLOCK_EXPLORER_URL?.trim() || DEFAULTS.blockExplorerUrl,
    usdcAddress: addressValue(env.USDC_ADDRESS, DEFAULTS.usdcAddress),
    mandateManagerAddress: addressValue(env.MANDATE_MANAGER_ADDRESS, DEFAULTS.mandateManagerAddress),
    advanceVaultAddress: addressValue(env.ADVANCE_VAULT_ADDRESS, DEFAULTS.advanceVaultAddress),
    advanceVaultDiscountBps: positiveInteger(env.ADVANCE_VAULT_DISCOUNT_BPS, 100),
    v1PlatformRegistryAddress: addressValue(env.V1_PLATFORM_REGISTRY_ADDRESS, DEFAULTS.v1PlatformRegistryAddress),
    v1EarningsManagerAddress: addressValue(env.V1_EARNINGS_MANAGER_ADDRESS, DEFAULTS.v1EarningsManagerAddress),
    v1AdvanceVaultAddress: addressValue(env.V1_ADVANCE_VAULT_ADDRESS, DEFAULTS.v1AdvanceVaultAddress),
    arcVerificationTimeoutMs: positiveInteger(env.ARC_VERIFICATION_TIMEOUT_SECONDS, 120) * 1000,
    sessionTtlMs: positiveInteger(env.SESSION_TTL_SECONDS, 86_400) * 1000,
    secureCookies: booleanValue(env.SESSION_COOKIE_SECURE, env.NODE_ENV === "production"),
    allowedOrigins: splitOrigins(env.SERVER_ALLOWED_ORIGINS),
    metadataFile: env.WORKER_WALLET_METADATA_FILE?.trim()
      || env.VENDOR_WALLET_METADATA_FILE?.trim()
      || new URL("../data/worker-wallets.json", import.meta.url),
  });
}

export const config = createConfig();
