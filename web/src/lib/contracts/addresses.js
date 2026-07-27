import { getAddress, isAddress, zeroAddress } from "viem";
import { fidraConfig } from "../config.js";

export function normalizeOptionalAddress(value) {
  if (!value || !isAddress(value, { strict: false })) return null;
  const address = getAddress(value);
  return address === zeroAddress ? null : address;
}

export const contractAddresses = Object.freeze({
  usdc: normalizeOptionalAddress(fidraConfig.usdcAddress),
  mandateManager: normalizeOptionalAddress(fidraConfig.mandateManagerAddress),
  advanceVault: normalizeOptionalAddress(fidraConfig.advanceVaultAddress),
});

export function getAddressConfiguration() {
  const missing = [];
  if (!contractAddresses.usdc) missing.push("USDC");
  if (!contractAddresses.mandateManager) missing.push("MandateManager");
  if (!contractAddresses.advanceVault) missing.push("AdvanceVault");

  return {
    configured: missing.length === 0,
    missing,
    addresses: contractAddresses,
  };
}
