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
  v1PlatformRegistry: normalizeOptionalAddress(fidraConfig.v1PlatformRegistryAddress),
  v1EarningsManager: normalizeOptionalAddress(fidraConfig.v1EarningsManagerAddress),
  v1AdvanceVault: normalizeOptionalAddress(fidraConfig.v1AdvanceVaultAddress),
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

export function getV1AddressConfiguration() {
  const missing = [];
  if (!contractAddresses.usdc) missing.push("USDC");
  if (!contractAddresses.v1PlatformRegistry) missing.push("PlatformRegistry");
  if (!contractAddresses.v1EarningsManager) missing.push("EarningsManager");
  if (!contractAddresses.v1AdvanceVault) missing.push("AdvanceVaultV2");
  return { configured: missing.length === 0, missing, addresses: contractAddresses };
}
