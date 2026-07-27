export function createCircleStatus(config, lastError = null) {
  const walletConfigurationError = config.configurationErrors.some((message) => message.includes("CIRCLE_"));
  const walletStatus = walletConfigurationError
    ? "error"
    : config.walletsConfigured ? "configured" : "not_configured";
  const gasSeedStatus = config.configurationErrors.some((message) => message.includes("VENDOR_GAS_SEED"))
    ? "error"
    : config.gasSeedConfigured ? "configured" : "not_configured";
  const missingEnvKeys = [...new Set([
    ...(config.walletsEnabled ? config.walletMissingKeys : ["CIRCLE_WALLETS_ENABLED"]),
    ...(config.gasSeedEnabled ? config.seedMissingKeys : ["VENDOR_GAS_SEED_ENABLED"]),
  ])];

  return {
    wallets: {
      status: lastError ? "error" : walletStatus,
      targetAccountType: "EOA",
      blockchain: "ARC-TESTNET",
      enabled: config.walletsEnabled,
    },
    authentication: {
      status: walletStatus,
      circleSupportedMethods: ["social", "email_otp", "pin"],
      implementedMethods: ["google", "email_otp"],
      google: config.circleGoogleClientId ? "configured" : "not_configured",
      emailOtp: config.walletsConfigured ? "circle_console_smtp_required" : "not_configured",
      pin: "not_implemented",
    },
    publicConfiguration: {
      appId: config.walletsConfigured ? config.circleAppId : null,
      googleClientId: config.walletsConfigured && config.circleGoogleClientId ? config.circleGoogleClientId : null,
    },
    gasSeed: {
      status: gasSeedStatus,
      asset: "Arc native USDC",
      amountUsdc: String(config.seedAmountUsdc),
      maximumUsdc: String(config.maxSeedAmountUsdc),
      oncePerWallet: config.seedOncePerWallet,
    },
    transactions: {
      buyClaim: walletStatus === "configured" ? "user_approval_required" : walletStatus,
      submitProof: "not_implemented",
      requestSpend: "not_implemented",
      contractAddress: config.advanceVaultAddress,
      discountBps: config.advanceVaultDiscountBps,
    },
    paymaster: { status: "not_configured", roadmap: "planned" },
    gateway: { status: "not_configured", roadmap: "planned" },
    cctp: { status: "not_configured", roadmap: "planned" },
    missingEnvKeys,
    environment: config.circleEnvironment,
    chainId: config.arcChainId,
    rpcUrl: config.arcRpcUrl,
    usdcAddress: config.usdcAddress,
    configurationErrors: config.configurationErrors,
    error: lastError ? "Circle request failed. Check server logs and configuration." : null,
  };
}
