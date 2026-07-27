import { isAddressEqual } from "viem";
import deploymentRecord from "../../../../deployments/arc-testnet/latest.json";
import { ARC_TESTNET_EXPLORER_URL } from "../../../../shared/constants.js";
import { fidraConfig } from "../config.js";
import { getAddressConfiguration } from "../contracts/addresses.js";
import { advanceVaultAbi, mandateManagerAbi, usdcReadAbi } from "../contracts/abis.js";
import { parseFidraError, probeArcConnection, publicClient } from "../contracts/client.js";
import {
  asBigInt,
  formatBpsPercent,
  formatTimestamp,
  formatUsdc,
  mandateStatusLabel,
  requestStatusLabel,
  truncateHex,
  usdcUnitsToNumber,
} from "../contracts/types.js";

function tupleField(tuple, name, index) {
  return tuple?.[name] ?? tuple?.[index];
}

export function getLiveIntegrationStatus(overrides = {}) {
  const addressConfiguration = getAddressConfiguration();
  return {
    mode: "live",
    modeLabel: "Live Mode",
    contractsConfigured: addressConfiguration.configured,
    contractLabel: addressConfiguration.configured
      ? "Configured"
      : `Missing ${addressConfiguration.missing.join(" + ")}`,
    managerStatus: addressConfiguration.addresses.mandateManager ? "Configured" : "Missing address",
    vaultStatus: addressConfiguration.addresses.advanceVault ? "Configured" : "Missing address",
    authorizationStatus: "Not checked",
    frozenStatus: "Not checked",
    liquidityStatus: "Not checked",
    discountStatus: "Not checked",
    rpcStatus: "Checking Arc RPC",
    walletStatus: "Not connected",
    readOnly: true,
    lastRefreshAt: null,
    ...overrides,
  };
}

export class FidraLiveDataError extends Error {
  constructor(message, integration) {
    super(message);
    this.name = "FidraLiveDataError";
    this.integration = integration;
  }
}

function hasRuntimeCode(code) {
  return Boolean(code && code !== "0x");
}

function normalizePoolStats(rawStats) {
  return {
    liquidityDeposited: asBigInt(tupleField(rawStats, "liquidityDeposited", 0)),
    advanced: asBigInt(tupleField(rawStats, "advanced", 1)),
    faceValueAcquired: asBigInt(tupleField(rawStats, "faceValueAcquired", 2)),
    expectedSpread: asBigInt(tupleField(rawStats, "expectedSpread", 3)),
    repaymentsRecognized: asBigInt(tupleField(rawStats, "repaymentsRecognized", 4)),
    realizedSpread: asBigInt(tupleField(rawStats, "realizedSpread", 5)),
    liquidityAvailable: asBigInt(tupleField(rawStats, "liquidityAvailable", 6)),
  };
}

function normalizeSpendRequest(rawSpend, spendId) {
  return {
    requestId: BigInt(spendId),
    mandateId: asBigInt(tupleField(rawSpend, "mandateId", 0)),
    agent: tupleField(rawSpend, "agent", 1),
    vendor: tupleField(rawSpend, "vendor", 2),
    payee: tupleField(rawSpend, "payee", 3),
    amount: asBigInt(tupleField(rawSpend, "amount", 4)),
    proofHash: tupleField(rawSpend, "proofHash", 5),
    externalRefHash: tupleField(rawSpend, "externalRefHash", 6),
    status: requestStatusLabel(tupleField(rawSpend, "status", 7)),
    createdAt: asBigInt(tupleField(rawSpend, "createdAt", 8)),
    approvedAt: asBigInt(tupleField(rawSpend, "approvedAt", 9)),
    lockedAt: asBigInt(tupleField(rawSpend, "lockedAt", 10)),
    releaseDueAt: asBigInt(tupleField(rawSpend, "releaseDueAt", 11)),
    releasedAt: asBigInt(tupleField(rawSpend, "releasedAt", 12)),
    advanceAssigned: Boolean(tupleField(rawSpend, "advanceAssigned", 13)),
  };
}

function normalizeClaimPurchase(rawPurchase) {
  return {
    requestId: asBigInt(tupleField(rawPurchase, "requestId", 0)),
    seller: tupleField(rawPurchase, "seller", 1),
    faceAmount: asBigInt(tupleField(rawPurchase, "faceAmount", 2)),
    advanceAmount: asBigInt(tupleField(rawPurchase, "advanceAmount", 3)),
    expectedSpread: asBigInt(tupleField(rawPurchase, "expectedSpread", 4)),
    purchasedAt: asBigInt(tupleField(rawPurchase, "purchasedAt", 5)),
    settled: Boolean(tupleField(rawPurchase, "settled", 6)),
  };
}

function releaseDelayLabel(seconds) {
  const delay = Number(seconds);
  if (delay < 60) return `${delay} seconds`;
  if (delay < 3_600) return `${delay / 60} minutes`;
  if (delay < 86_400) return `${delay / 3_600} hours`;
  return `${delay / 86_400} days`;
}

function explorerAddressUrl(address) {
  return `${ARC_TESTNET_EXPLORER_URL}/address/${address}`;
}

export async function getLiveDeploymentStatus() {
  const addressConfiguration = getAddressConfiguration();
  if (!addressConfiguration.configured) {
    throw new FidraLiveDataError(
      `Live mode not configured. Add ${addressConfiguration.missing.join(" and ")} addresses to web/.env.local.`,
      getLiveIntegrationStatus({ rpcStatus: "Not checked" }),
    );
  }

  const { mandateManager: managerAddress, advanceVault: vaultAddress, usdc: usdcAddress } = addressConfiguration.addresses;

  try {
    const connection = await probeArcConnection();
    const [
      managerCode,
      vaultCode,
      managerOwner,
      managerUsdc,
      authorizedAdvanceVault,
      authorizedVaultFrozen,
      vaultOwner,
      vaultUsdc,
      vaultManager,
      discountBps,
      availableLiquidity,
      rawPoolStats,
      usdcDecimals,
    ] = await Promise.all([
      publicClient.getBytecode({ address: managerAddress }),
      publicClient.getBytecode({ address: vaultAddress }),
      publicClient.readContract({ address: managerAddress, abi: mandateManagerAbi, functionName: "owner" }),
      publicClient.readContract({ address: managerAddress, abi: mandateManagerAbi, functionName: "usdc" }),
      publicClient.readContract({ address: managerAddress, abi: mandateManagerAbi, functionName: "authorizedAdvanceVault" }),
      publicClient.readContract({ address: managerAddress, abi: mandateManagerAbi, functionName: "authorizedVaultFrozen" }),
      publicClient.readContract({ address: vaultAddress, abi: advanceVaultAbi, functionName: "owner" }),
      publicClient.readContract({ address: vaultAddress, abi: advanceVaultAbi, functionName: "usdc" }),
      publicClient.readContract({ address: vaultAddress, abi: advanceVaultAbi, functionName: "mandateManager" }),
      publicClient.readContract({ address: vaultAddress, abi: advanceVaultAbi, functionName: "discountBps" }),
      publicClient.readContract({ address: vaultAddress, abi: advanceVaultAbi, functionName: "availableLiquidity" }),
      publicClient.readContract({ address: vaultAddress, abi: advanceVaultAbi, functionName: "poolStats" }),
      publicClient.readContract({ address: usdcAddress, abi: usdcReadAbi, functionName: "decimals" }),
    ]);

    const poolStats = normalizePoolStats(rawPoolStats);
    const managerCodePresent = hasRuntimeCode(managerCode);
    const vaultCodePresent = hasRuntimeCode(vaultCode);
    const authorizationMatches = isAddressEqual(authorizedAdvanceVault, vaultAddress);
    const managerLinkMatches = isAddressEqual(vaultManager, managerAddress);
    const usdcMatches = isAddressEqual(managerUsdc, usdcAddress) && isAddressEqual(vaultUsdc, usdcAddress);
    const ownersMatch = isAddressEqual(managerOwner, vaultOwner);
    const decimalsMatch = Number(usdcDecimals) === 6;
    const deploymentHealthy = managerCodePresent
      && vaultCodePresent
      && authorizationMatches
      && managerLinkMatches
      && usdcMatches
      && ownersMatch
      && decimalsMatch;

    const integration = getLiveIntegrationStatus({
      contractsConfigured: deploymentHealthy,
      contractLabel: deploymentHealthy ? "Verified onchain" : "Configuration mismatch",
      managerStatus: managerCodePresent ? "Configured · onchain" : "No runtime code",
      vaultStatus: vaultCodePresent && managerLinkMatches ? "Configured · onchain" : "Configuration mismatch",
      authorizationStatus: authorizationMatches ? "Matches deployed vault" : "Mismatch",
      frozenStatus: authorizedVaultFrozen ? "Yes" : "No",
      liquidityStatus: `${formatUsdc(availableLiquidity)} USDC`,
      discountStatus: formatBpsPercent(discountBps),
      rpcStatus: `Connected · block ${connection.blockNumber.toString()}`,
      lastCheckedBlock: connection.blockNumber,
      lastRefreshAt: new Date(),
      deployment: {
        managerAddress,
        vaultAddress,
        managerOwner,
        vaultOwner,
        authorizedAdvanceVault,
        authorizedVaultFrozen,
        discountBps: asBigInt(discountBps),
        availableLiquidity: asBigInt(availableLiquidity),
        poolStats,
        usdcDecimals: Number(usdcDecimals),
        lastCheckedBlock: connection.blockNumber,
      },
    });

    if (!deploymentHealthy) {
      throw new FidraLiveDataError("Arc deployment reads completed, but the configured contracts do not match.", integration);
    }

    return integration;
  } catch (error) {
    if (error instanceof FidraLiveDataError) throw error;
    const parsed = parseFidraError(error);
    throw new FidraLiveDataError(
      `Arc deployment read failed: ${parsed.message}`,
      getLiveIntegrationStatus({ rpcStatus: "Unavailable" }),
    );
  }
}

export async function getLiveMandateDetail(
  mandateId = fidraConfig.liveEvidenceMandateId,
  spendId = fidraConfig.liveEvidenceSpendId,
) {
  const integration = await getLiveDeploymentStatus();
  const addressConfiguration = getAddressConfiguration();

  try {
    const managerAddress = addressConfiguration.addresses.mandateManager;
    const vaultAddress = addressConfiguration.addresses.advanceVault;
    const [rawMandate, availableBudget, rawSpend, rawPurchase] = await Promise.all([
      publicClient.readContract({
        address: managerAddress,
        abi: mandateManagerAbi,
        functionName: "getMandate",
        args: [BigInt(mandateId)],
      }),
      publicClient.readContract({
        address: managerAddress,
        abi: mandateManagerAbi,
        functionName: "availableBudget",
        args: [BigInt(mandateId)],
      }),
      publicClient.readContract({
        address: managerAddress,
        abi: mandateManagerAbi,
        functionName: "getSpendRequest",
        args: [BigInt(spendId)],
      }),
      publicClient.readContract({
        address: vaultAddress,
        abi: advanceVaultAbi,
        functionName: "getClaimPurchase",
        args: [BigInt(spendId)],
      }),
    ]);

    const deployment = integration.deployment;
    const expiresAt = asBigInt(tupleField(rawMandate, "expiresAt", 6));
    const status = mandateStatusLabel(tupleField(rawMandate, "status", 10), expiresAt);
    const mandate = {
      id: BigInt(mandateId),
      name: `Mandate #${mandateId}`,
      business: tupleField(rawMandate, "business", 0),
      agent: tupleField(rawMandate, "agent", 1),
      approver: tupleField(rawMandate, "approver", 2),
      totalBudget: asBigInt(tupleField(rawMandate, "totalBudget", 3)),
      reserved: asBigInt(tupleField(rawMandate, "reserved", 4)),
      spent: asBigInt(tupleField(rawMandate, "spent", 5)),
      expiresAt,
      defaultReleaseDelaySeconds: asBigInt(tupleField(rawMandate, "defaultReleaseDelaySeconds", 7)),
      maxPerPurchase: asBigInt(tupleField(rawMandate, "maxPerPurchase", 8)),
      proofRequired: Boolean(tupleField(rawMandate, "proofRequired", 9)),
      status,
      metadataHash: tupleField(rawMandate, "metadataHash", 11),
      availableBudget: asBigInt(availableBudget),
      authorizedAdvanceVault: deployment.authorizedAdvanceVault,
      authorizedVaultFrozen: deployment.authorizedVaultFrozen,
    };

    const spend = normalizeSpendRequest(rawSpend, spendId);
    const purchase = normalizeClaimPurchase(rawPurchase);
    if (spend.mandateId !== BigInt(mandateId)) {
      throw new Error(`Configured spend #${spendId} belongs to mandate #${spend.mandateId.toString()}`);
    }
    if (purchase.requestId !== BigInt(spendId)) {
      throw new Error(`AdvanceVault has no purchase record for spend #${spendId}`);
    }

    const payeeIsVault = isAddressEqual(spend.payee, vaultAddress);
    const claim = {
      id: spendId,
      requestId: spend.requestId,
      mandateId: spend.mandateId,
      agent: spend.agent,
      vendor: spend.vendor,
      vendorLabel: truncateHex(spend.vendor),
      payee: spend.payee,
      payeeLabel: payeeIsVault ? "AdvanceVault" : truncateHex(spend.payee),
      amount: usdcUnitsToNumber(spend.amount),
      amountUnits: spend.amount,
      proofHash: spend.proofHash,
      externalRefHash: spend.externalRefHash,
      state: spend.status,
      status: spend.status,
      detail: spend.status === "Released" ? "Settled to assigned payee" : "Read from MandateManager",
      action: null,
      submitted: formatTimestamp(spend.createdAt),
      tab: spend.status === "Locked" ? "locked" : "all",
      createdAt: spend.createdAt,
      approvedAt: spend.approvedAt,
      lockedAt: spend.lockedAt,
      releaseDueAt: spend.releaseDueAt,
      releasedAt: spend.releasedAt,
      advanceAssigned: spend.advanceAssigned,
    };

    const recordedSmoke = deploymentRecord.smokeFlow;
    const settlementTransaction = recordedSmoke.transactions.markClaimSettled;
    const contractEvidenceMatches = mandate.status === "Revoked"
      && spend.status === "Released"
      && payeeIsVault
      && spend.advanceAssigned
      && purchase.settled
      && purchase.faceAmount === spend.amount
      && deployment.poolStats.realizedSpread >= purchase.expectedSpread;
    const ledgerMatches = String(mandateId) === recordedSmoke.mandateId
      && String(spendId) === recordedSmoke.spendId
      && spend.externalRefHash.toLowerCase() === recordedSmoke.externalRefHash.toLowerCase()
      && spend.proofHash.toLowerCase() === recordedSmoke.proofHash.toLowerCase();

    const liveEvidence = {
      mandateId,
      spendId,
      mandateStatus: mandate.status,
      spendStatus: spend.status,
      originalVendor: spend.vendor,
      finalPayee: spend.payee,
      faceAmount: spend.amount,
      advanceAmount: purchase.advanceAmount,
      realizedSpread: purchase.settled ? purchase.expectedSpread : 0n,
      vaultAvailableLiquidity: deployment.availableLiquidity,
      authorizationFrozen: deployment.authorizedVaultFrozen,
      authorizedAdvanceVault: deployment.authorizedAdvanceVault,
      discountBps: deployment.discountBps,
      claimSettled: purchase.settled,
      managerAddress,
      vaultAddress,
      managerExplorerUrl: explorerAddressUrl(managerAddress),
      vaultExplorerUrl: explorerAddressUrl(vaultAddress),
      settlementTransactionHash: settlementTransaction.hash,
      settlementTransactionUrl: settlementTransaction.explorerUrl,
      settlementBlock: settlementTransaction.block,
      lastCheckedBlock: deployment.lastCheckedBlock,
      sourceVerificationRecorded: Boolean(deploymentRecord.sourceVerification?.verified),
      contractEvidenceMatches,
      ledgerMatches,
    };

    return {
      source: "live",
      mandate,
      claims: [claim],
      claimsAvailable: true,
      claimsUnavailableReason: "Only the configured live evidence spend is read directly; full claim enumeration still needs event indexing.",
      liveEvidence,
      identities: [
        ["Agent", truncateHex(mandate.agent), mandate.agent],
        ["Approver", truncateHex(mandate.approver), mandate.approver],
        ["Owner", truncateHex(mandate.business), mandate.business],
      ],
      policy: [
        ["Expiry", formatTimestamp(mandate.expiresAt)],
        ["Maximum purchase", `${formatUsdc(mandate.maxPerPurchase)} USDC`],
        ["Proof commitment", mandate.proofRequired ? "Required" : "Optional"],
        ["Release delay", releaseDelayLabel(mandate.defaultReleaseDelaySeconds)],
        ["AdvanceVault", mandate.authorizedVaultFrozen ? "Authorization frozen" : "Rotation open"],
      ],
      integration,
    };
  } catch (error) {
    if (error instanceof FidraLiveDataError) throw error;
    const parsed = parseFidraError(error);
    throw new FidraLiveDataError(
      `The live deployment is connected, but mandate #${mandateId} could not be read: ${parsed.message}.`,
      integration,
    );
  }
}
