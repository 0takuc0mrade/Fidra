import deploymentEvidence from "../../../../deployments/arc-testnet/v1.1-latest.json" with { type: "json" };
import { fidraConfig } from "../config.js";
import { getV1AddressConfiguration } from "../contracts/addresses.js";
import { advanceVaultV2Abi, earningsManagerAbi, platformRegistryAbi } from "../contracts/abis.js";
import { publicClient } from "../contracts/client.js";
import {
  asBigInt,
  earningsClaimStatusLabel,
  purchaseStatusLabel,
} from "../contracts/types.js";

function claimRecord(claimId, raw) {
  return {
    id: Number(claimId),
    platformId: asBigInt(raw.platformId),
    worker: raw.worker,
    faceValue: asBigInt(raw.faceValue),
    dueDate: asBigInt(raw.dueDate),
    taskHash: raw.taskHash,
    evidenceHash: raw.evidenceHash,
    statusCode: Number(raw.status),
    status: earningsClaimStatusLabel(raw.status),
  };
}

function purchaseRecord(raw) {
  return {
    claimId: asBigInt(raw.claimId),
    platformId: asBigInt(raw.platformId),
    worker: raw.worker,
    faceValue: asBigInt(raw.faceValue),
    advanceAmount: asBigInt(raw.advanceAmount),
    fee: asBigInt(raw.fee),
    dueDate: asBigInt(raw.dueDate),
    purchasedAt: asBigInt(raw.purchasedAt),
    settlementAmount: asBigInt(raw.platformSettlementAmount),
    reserveRecovery: asBigInt(raw.reserveRecoveryAmount),
    realizedProfit: asBigInt(raw.realizedProfit),
    realizedLoss: asBigInt(raw.realizedLoss),
    contractualShortfall: asBigInt(raw.contractualShortfall),
    statusCode: Number(raw.status),
    status: purchaseStatusLabel(raw.status),
  };
}

function platformRecord(platformId, raw) {
  return {
    id: Number(platformId),
    settlementWallet: raw.settlementWallet,
    active: raw.active,
    status: raw.active ? "Active" : "Paused",
    creditLimit: asBigInt(raw.creditLimit),
    outstandingExposure: asBigInt(raw.outstandingExposure),
    reserveBalance: asBigInt(raw.reserveBalance),
    advanceFeeBps: asBigInt(raw.advanceFeeBps),
  };
}

function statsRecord(raw) {
  const fields = [
    "accountedCash", "actualCash", "accountedAssets", "totalAdvancePrincipal", "outstandingPrincipal",
    "outstandingFaceValue", "totalSettledFaceValue", "totalDefaultRecoveries", "totalRealizedProfit",
    "totalRealizedLoss", "totalContractualShortfall", "totalLiquidityDeposited", "totalLiquidityWithdrawn",
    "netLiquidityContributed",
  ];
  return Object.fromEntries(fields.map((field, index) => [field, asBigInt(raw?.[field] ?? raw?.[index])]));
}

function eventReceipt(event) {
  return event?.transactionHash ? {
    transactionHash: event.transactionHash,
    blockNumber: event.blockNumber,
    explorerUrl: `${fidraConfig.blockExplorerUrl}/tx/${event.transactionHash}`,
  } : null;
}

async function assertLiveV1() {
  const configuration = getV1AddressConfiguration();
  if (!configuration.configured) throw new Error(`V1 live mode is missing ${configuration.missing.join(", ")}.`);
  const chainId = await publicClient.getChainId();
  if (chainId !== fidraConfig.chainId) throw new Error(`Arc RPC returned chain ${chainId}; expected ${fidraConfig.chainId}.`);
  return configuration.addresses;
}

export async function loadV1Claim(claimId, { blockNumber } = {}) {
  const addresses = await assertLiveV1();
  const resolvedBlock = blockNumber ?? await publicClient.getBlockNumber();
  const [rawClaim, rawPurchase] = await Promise.all([
    publicClient.readContract({
      address: addresses.v1EarningsManager,
      abi: earningsManagerAbi,
      functionName: "getClaim",
      args: [BigInt(claimId)],
      blockNumber: resolvedBlock,
    }),
    publicClient.readContract({
      address: addresses.v1AdvanceVault,
      abi: advanceVaultV2Abi,
      functionName: "getPurchase",
      args: [BigInt(claimId)],
      blockNumber: resolvedBlock,
    }),
  ]);
  const claim = claimRecord(claimId, rawClaim);
  const rawPlatform = await publicClient.readContract({
    address: addresses.v1PlatformRegistry,
    abi: platformRegistryAbi,
    functionName: "getPlatform",
    args: [claim.platformId],
    blockNumber: resolvedBlock,
  });
  return {
    blockNumber: resolvedBlock,
    claim,
    purchase: purchaseRecord(rawPurchase),
    platform: platformRecord(claim.platformId, rawPlatform),
  };
}

export async function loadV1Dashboard(platformId = fidraConfig.v1LivePlatformId) {
  const addresses = await assertLiveV1();
  const blockNumber = await publicClient.getBlockNumber();
  const block = await publicClient.getBlock({ blockNumber });
  const [rawPlatform, rawStats, claimEvents, advanceEvents, settlementEvents, defaultEvents, registryCode, earningsCode, vaultCode] = await Promise.all([
    publicClient.readContract({
      address: addresses.v1PlatformRegistry,
      abi: platformRegistryAbi,
      functionName: "getPlatform",
      args: [BigInt(platformId)],
      blockNumber,
    }),
    publicClient.readContract({
      address: addresses.v1AdvanceVault,
      abi: advanceVaultV2Abi,
      functionName: "vaultStats",
      blockNumber,
    }),
    publicClient.getContractEvents({
      address: addresses.v1EarningsManager,
      abi: earningsManagerAbi,
      eventName: "ClaimCreated",
      args: { platformId: BigInt(platformId) },
      fromBlock: BigInt(deploymentEvidence.contracts.EarningsManager.deploymentBlock),
      toBlock: blockNumber,
    }),
    publicClient.getContractEvents({ address: addresses.v1AdvanceVault, abi: advanceVaultV2Abi, eventName: "AdvancePurchased", args: { platformId: BigInt(platformId) }, fromBlock: BigInt(deploymentEvidence.contracts.AdvanceVaultV2.deploymentBlock), toBlock: blockNumber }),
    publicClient.getContractEvents({ address: addresses.v1AdvanceVault, abi: advanceVaultV2Abi, eventName: "ClaimSettledEvent", args: { platformId: BigInt(platformId) }, fromBlock: BigInt(deploymentEvidence.contracts.AdvanceVaultV2.deploymentBlock), toBlock: blockNumber }),
    publicClient.getContractEvents({ address: addresses.v1AdvanceVault, abi: advanceVaultV2Abi, eventName: "DefaultTriggered", args: { platformId: BigInt(platformId) }, fromBlock: BigInt(deploymentEvidence.contracts.AdvanceVaultV2.deploymentBlock), toBlock: blockNumber }),
    publicClient.getBytecode({ address: addresses.v1PlatformRegistry, blockNumber }),
    publicClient.getBytecode({ address: addresses.v1EarningsManager, blockNumber }),
    publicClient.getBytecode({ address: addresses.v1AdvanceVault, blockNumber }),
  ]);
  const claimIds = [...new Set(claimEvents.map((event) => Number(event.args.claimId)))].slice(-250);
  const claims = await Promise.all(claimIds.map(async (claimId) => {
    const record = await loadV1Claim(claimId, { blockNumber });
    return {
      ...record.claim,
      purchase: record.purchase,
      purpose: deploymentEvidence.claims[String(claimId)]?.purpose ?? "Live platform claim",
      receipts: {
        created: eventReceipt(claimEvents.find((event) => Number(event.args.claimId) === claimId)),
        advanced: eventReceipt(advanceEvents.find((event) => Number(event.args.claimId) === claimId)),
        resolved: eventReceipt(settlementEvents.find((event) => Number(event.args.claimId) === claimId)
          ?? defaultEvents.find((event) => Number(event.args.claimId) === claimId)),
      },
    };
  }));
  return {
    chainId: fidraConfig.chainId,
    blockNumber,
    blockTimestamp: block.timestamp,
    addresses,
    platform: platformRecord(platformId, rawPlatform),
    stats: statsRecord(rawStats),
    claims,
    evidence: deploymentEvidence,
    runtimeCodePresent: Boolean(registryCode !== "0x" && earningsCode !== "0x" && vaultCode !== "0x"),
  };
}

export { deploymentEvidence };
