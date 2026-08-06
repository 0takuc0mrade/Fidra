import { readFile } from "node:fs/promises";
import {
  createPublicClient,
  decodeFunctionData,
  defineChain,
  getAddress,
  http,
  parseAbiItem,
} from "viem";
import { CLAIM_STATUS, PURCHASE_STATUS, sameAddress } from "./workerAdvance.js";

const usdcAbi = [{
  type: "function",
  name: "balanceOf",
  stateMutability: "view",
  inputs: [{ name: "account", type: "address" }],
  outputs: [{ name: "", type: "uint256" }],
}];

async function loadAbi(name) {
  return JSON.parse(await readFile(new URL(`../../shared/abis/${name}.json`, import.meta.url), "utf8"));
}

function claimRecord(raw) {
  return {
    platformId: raw.platformId,
    worker: raw.worker,
    faceValue: raw.faceValue,
    dueDate: raw.dueDate,
    taskHash: raw.taskHash,
    evidenceHash: raw.evidenceHash,
    status: Number(raw.status),
  };
}

function purchaseRecord(raw) {
  return {
    claimId: raw.claimId,
    platformId: raw.platformId,
    worker: raw.worker,
    faceValue: raw.faceValue,
    advanceAmount: raw.advanceAmount,
    fee: raw.fee,
    dueDate: raw.dueDate,
    purchasedAt: raw.purchasedAt,
    status: Number(raw.status),
  };
}

function platformRecord(raw) {
  return {
    settlementWallet: raw.settlementWallet,
    active: raw.active,
    creditLimit: raw.creditLimit,
    outstandingExposure: raw.outstandingExposure,
    reserveBalance: raw.reserveBalance,
    advanceFeeBps: raw.advanceFeeBps,
  };
}

function revertedWith(error, expectedName) {
  let current = error;
  while (current) {
    if (current.data?.errorName === expectedName || current.errorName === expectedName) return true;
    if (typeof current.shortMessage === "string" && current.shortMessage.includes(expectedName)) return true;
    current = current.cause;
  }
  return false;
}

export class ArcVerificationPendingError extends Error {
  constructor(message = "The transaction is not indexed on Arc yet.") {
    super(message);
    this.name = "ArcVerificationPendingError";
  }
}

export class V1ChainReads {
  constructor(config, { client = null } = {}) {
    this.config = config;
    this._client = client;
    this._abis = null;
  }

  async client() {
    if (this._client) return this._client;
    const chain = defineChain({
      id: this.config.arcChainId,
      name: "Arc Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [this.config.arcRpcUrl] } },
    });
    this._client = createPublicClient({ chain, transport: http(this.config.arcRpcUrl, { timeout: 8_000, retryCount: 1 }) });
    return this._client;
  }

  async abis() {
    if (this._abis) return this._abis;
    const [platformRegistry, earningsManager, advanceVaultV2] = await Promise.all([
      loadAbi("PlatformRegistry"),
      loadAbi("EarningsManager"),
      loadAbi("AdvanceVaultV2"),
    ]);
    this._abis = { platformRegistry, earningsManager, advanceVaultV2 };
    return this._abis;
  }

  async getWorkerAdvanceSnapshot(claimId) {
    const client = await this.client();
    const { platformRegistry, earningsManager, advanceVaultV2 } = await this.abis();
    const chainId = await client.getChainId();
    const blockNumber = await client.getBlockNumber();
    const block = await client.getBlock({ blockNumber });
    let rawClaim;
    try {
      rawClaim = await client.readContract({
        address: this.config.v1EarningsManagerAddress,
        abi: earningsManager,
        functionName: "getClaim",
        args: [BigInt(claimId)],
        blockNumber,
      });
    } catch (error) {
      if (!revertedWith(error, "ClaimNotFound")) throw error;
      return {
        chainId,
        expectedChainId: this.config.arcChainId,
        blockNumber,
        blockTimestamp: block.timestamp,
        claim: null,
      };
    }

    const claim = claimRecord(rawClaim);
    const [rawPurchase, accountedCash, actualCash] = await Promise.all([
      client.readContract({
        address: this.config.v1AdvanceVaultAddress,
        abi: advanceVaultV2,
        functionName: "getPurchase",
        args: [BigInt(claimId)],
        blockNumber,
      }),
      client.readContract({
        address: this.config.v1AdvanceVaultAddress,
        abi: advanceVaultV2,
        functionName: "accountedCash",
        blockNumber,
      }),
      client.readContract({
        address: this.config.usdcAddress,
        abi: usdcAbi,
        functionName: "balanceOf",
        args: [this.config.v1AdvanceVaultAddress],
        blockNumber,
      }),
    ]);
    let rawPlatform = null;
    try {
      rawPlatform = await client.readContract({
        address: this.config.v1PlatformRegistryAddress,
        abi: platformRegistry,
        functionName: "getPlatform",
        args: [claim.platformId],
        blockNumber,
      });
    } catch (error) {
      if (!revertedWith(error, "PlatformNotFound")) throw error;
      // The validator maps a missing/unreadable registered platform to platform_inactive.
    }

    return {
      chainId,
      expectedChainId: this.config.arcChainId,
      blockNumber,
      blockTimestamp: block.timestamp,
      claim,
      purchase: purchaseRecord(rawPurchase),
      platform: rawPlatform ? platformRecord(rawPlatform) : null,
      accountedCash,
      actualCash,
    };
  }

  async verifyWorkerAdvance(txHash, expected) {
    const client = await this.client();
    const { earningsManager, advanceVaultV2 } = await this.abis();
    let receipt;
    let transaction;
    try {
      [receipt, transaction] = await Promise.all([
        client.getTransactionReceipt({ hash: txHash }),
        client.getTransaction({ hash: txHash }),
      ]);
    } catch {
      throw new ArcVerificationPendingError();
    }
    if (receipt.status !== "success") throw new Error("Arc receipt reverted.");
    if (!sameAddress(receipt.from, expected.worker)) throw new Error("Arc receipt sender does not match the worker wallet.");
    if (!receipt.to || !sameAddress(receipt.to, this.config.v1AdvanceVaultAddress)) {
      throw new Error("Arc receipt target does not match AdvanceVaultV2.");
    }
    let call;
    try {
      call = decodeFunctionData({ abi: advanceVaultV2, data: transaction.input });
    } catch {
      throw new Error("Arc transaction calldata is not a recognized AdvanceVaultV2 call.");
    }
    if (call.functionName !== "purchaseAdvance" || BigInt(call.args[0]) !== BigInt(expected.claimId)) {
      throw new Error("Arc transaction did not purchase the expected claim.");
    }

    const [rawClaim, rawPurchase] = await Promise.all([
      client.readContract({
        address: this.config.v1EarningsManagerAddress,
        abi: earningsManager,
        functionName: "getClaim",
        args: [BigInt(expected.claimId)],
        blockNumber: receipt.blockNumber,
      }),
      client.readContract({
        address: this.config.v1AdvanceVaultAddress,
        abi: advanceVaultV2,
        functionName: "getPurchase",
        args: [BigInt(expected.claimId)],
        blockNumber: receipt.blockNumber,
      }),
    ]);
    const claim = claimRecord(rawClaim);
    const purchase = purchaseRecord(rawPurchase);
    if (claim.status !== CLAIM_STATUS.Advanced || purchase.status !== PURCHASE_STATUS.Outstanding) {
      throw new Error("Arc state does not show an outstanding worker advance.");
    }
    const exact = sameAddress(purchase.worker, expected.worker)
      && purchase.claimId === BigInt(expected.claimId)
      && purchase.platformId === BigInt(expected.platformId)
      && purchase.faceValue === BigInt(expected.faceValue)
      && purchase.advanceAmount === BigInt(expected.advanceAmount)
      && purchase.fee === BigInt(expected.feeAmount);
    if (!exact) throw new Error("Arc purchase state differs from the approved quote.");

    return {
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      from: getAddress(receipt.from),
      to: getAddress(receipt.to),
      claim,
      purchase,
    };
  }

  async recoverWorkerAdvance(expected) {
    const client = await this.client();
    const event = parseAbiItem("event AdvancePurchased(uint256 indexed claimId, uint256 indexed platformId, address indexed worker, uint256 faceValue, uint256 advanceAmount, uint256 fee)");
    const logs = await client.getLogs({
      address: this.config.v1AdvanceVaultAddress,
      event,
      args: { claimId: BigInt(expected.claimId), worker: getAddress(expected.worker) },
      fromBlock: BigInt(expected.quotedAtBlock),
      toBlock: "latest",
    });
    const match = logs.at(-1);
    if (!match?.transactionHash) throw new ArcVerificationPendingError();
    return this.verifyWorkerAdvance(match.transactionHash, expected);
  }
}
