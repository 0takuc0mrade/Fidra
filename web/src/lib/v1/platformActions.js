import { getAddress, isAddress, isHex, keccak256, parseEventLogs, parseUnits, toBytes } from "viem";
import { fidraConfig } from "../config.js";
import { getV1AddressConfiguration } from "../contracts/addresses.js";
import { advanceVaultV2Abi, earningsManagerAbi, platformRegistryAbi, usdcWriteAbi } from "../contracts/abis.js";
import { getInjectedWalletClient, publicClient } from "../contracts/client.js";

export class PlatformActionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PlatformActionError";
    this.code = code;
  }
}

export function referenceHash(value) {
  const text = String(value || "").trim();
  if (isHex(text, { strict: true }) && text.length === 66) return text;
  if (!text) throw new PlatformActionError("reference_required", "A task or evidence reference is required.");
  return keccak256(toBytes(text));
}

export function normalizeClaimInput(input) {
  if (!isAddress(input.worker, { strict: false })) throw new PlatformActionError("invalid_worker", "Enter a valid worker address.");
  const dueDate = BigInt(Math.floor(new Date(input.dueDate).getTime() / 1000));
  if (dueDate <= BigInt(Math.floor(Date.now() / 1000))) throw new PlatformActionError("invalid_due_date", "Normal payout must be in the future.");
  let faceValue;
  try { faceValue = parseUnits(String(input.faceValue), 6); } catch { throw new PlatformActionError("invalid_face_value", "Enter a valid USDC amount with at most six decimals."); }
  if (faceValue <= 0n) throw new PlatformActionError("invalid_face_value", "Claim earnings must be greater than zero.");
  return {
    worker: getAddress(input.worker),
    faceValue,
    dueDate,
    taskHash: referenceHash(input.taskReference),
    evidenceHash: referenceHash(input.evidenceReference),
  };
}

async function platformContext(platformId, { walletClient = getInjectedWalletClient(), readClient = publicClient, allowPaused = false, settlement = false } = {}) {
  if (!walletClient) throw new PlatformActionError("wallet_required", "Connect the trusted Arc Testnet platform wallet.");
  const chainId = await walletClient.getChainId();
  if (chainId !== fidraConfig.chainId) throw new PlatformActionError("wrong_chain", `Switch the wallet to Arc Testnet (${fidraConfig.chainId}).`);
  const [account] = await walletClient.requestAddresses();
  if (!account) throw new PlatformActionError("wallet_required", "Connect the trusted Arc Testnet platform wallet.");
  const { addresses, configured } = getV1AddressConfiguration();
  if (!configured) throw new PlatformActionError("not_configured", "The live V1 contract addresses are incomplete.");
  const platform = await readClient.readContract({
    address: addresses.v1PlatformRegistry,
    abi: platformRegistryAbi,
    functionName: "getPlatform",
    args: [BigInt(platformId)],
  });
  const authorized = settlement
    ? await readClient.readContract({
      address: addresses.v1PlatformRegistry,
      abi: platformRegistryAbi,
      functionName: "isAuthorizedSettlementPayer",
      args: [BigInt(platformId), account],
    })
    : getAddress(account) === getAddress(platform.settlementWallet);
  if (!authorized) throw new PlatformActionError("unauthorized_signer", "The connected signer is not authorized for this platform action.");
  if (!allowPaused && !platform.active) throw new PlatformActionError("platform_paused", "The platform is paused and cannot certify new earnings.");
  return { account: getAddress(account), addresses, platform, readClient, walletClient };
}

async function simulateWrite(context, request) {
  const simulation = await context.readClient.simulateContract({ ...request, account: context.account });
  const hash = await context.walletClient.writeContract(simulation.request);
  const receipt = await context.readClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new PlatformActionError("transaction_failed", "The Arc transaction reverted.");
  return { hash, receipt, result: simulation.result, explorerUrl: `${fidraConfig.blockExplorerUrl || "https://testnet.arcscan.app"}/tx/${hash}` };
}

export async function createPlatformClaim(platformId, input, clients) {
  const context = await platformContext(platformId, clients);
  const claim = normalizeClaimInput(input);
  const outcome = await simulateWrite(context, {
    address: context.addresses.v1EarningsManager,
    abi: earningsManagerAbi,
    functionName: "createClaim",
    args: [BigInt(platformId), claim.worker, claim.faceValue, claim.dueDate, claim.taskHash, claim.evidenceHash],
  });
  return { ...outcome, claimId: outcome.result?.toString() ?? null };
}

export async function certifyPlatformClaim(platformId, claimId, clients) {
  const context = await platformContext(platformId, clients);
  return simulateWrite(context, {
    address: context.addresses.v1EarningsManager,
    abi: earningsManagerAbi,
    functionName: "certifyClaim",
    args: [BigInt(claimId)],
  });
}

export async function certifyPlatformBatch(platformId, inputs, clients) {
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 50) {
    throw new PlatformActionError("invalid_batch", "Provide between 1 and 50 claims.");
  }
  const context = await platformContext(platformId, clients);
  const claims = inputs.map(normalizeClaimInput);
  const outcome = await simulateWrite(context, {
    address: context.addresses.v1EarningsManager,
    abi: earningsManagerAbi,
    functionName: "createAndCertifyClaimsBatch",
    args: [
      BigInt(platformId),
      claims.map((claim) => claim.worker),
      claims.map((claim) => claim.faceValue),
      claims.map((claim) => claim.dueDate),
      claims.map((claim) => claim.taskHash),
      claims.map((claim) => claim.evidenceHash),
    ],
  });
  const events = parseEventLogs({ abi: earningsManagerAbi, logs: outcome.receipt.logs, eventName: "ClaimCertified" });
  return { ...outcome, claimIds: events.map((event) => event.args.claimId.toString()) };
}

export async function settlePlatformClaim(platformId, claimId, clients) {
  const context = await platformContext(platformId, { ...clients, allowPaused: true, settlement: true });
  const claim = await context.readClient.readContract({
    address: context.addresses.v1EarningsManager,
    abi: earningsManagerAbi,
    functionName: "getClaim",
    args: [BigInt(claimId)],
  });
  if (BigInt(claim.platformId) !== BigInt(platformId)) throw new PlatformActionError("platform_mismatch", "This claim belongs to another platform.");
  const approval = await simulateWrite(context, {
    address: context.addresses.usdc,
    abi: usdcWriteAbi,
    functionName: "approve",
    args: [context.addresses.v1AdvanceVault, claim.faceValue],
  });
  const settlement = await simulateWrite(context, {
    address: context.addresses.v1AdvanceVault,
    abi: advanceVaultV2Abi,
    functionName: "settleClaim",
    args: [BigInt(claimId)],
  });
  return { approval, settlement };
}
