export function platformCapabilities(platform) {
  const active = Boolean(platform?.active);
  return {
    createClaim: active,
    certifyClaim: active,
    certifyBatch: active,
    settleExisting: Boolean(platform),
  };
}

export function availablePlatformCredit(platform) {
  if (!platform) return 0n;
  const available = BigInt(platform.creditLimit) - BigInt(platform.outstandingExposure);
  return available > 0n ? available : 0n;
}
