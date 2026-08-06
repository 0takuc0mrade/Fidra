import { readFile } from "node:fs/promises";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  getAddress,
  http,
  keccak256,
  parseEventLogs,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const usdcAbi = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
];

async function abi(name) {
  return JSON.parse(await readFile(new URL(`../../shared/abis/${name}.json`, import.meta.url), "utf8"));
}

function receiptRecord(receipt, explorer) {
  return {
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    explorerUrl: `${explorer}/tx/${receipt.transactionHash}`,
    status: receipt.status,
  };
}

function statsRecord(raw) {
  const keys = [
    "accountedCash", "actualCash", "accountedAssets", "totalAdvancePrincipal",
    "outstandingPrincipal", "outstandingFaceValue", "totalSettledFaceValue",
    "totalDefaultRecoveries", "totalRealizedProfit", "totalRealizedLoss",
    "totalContractualShortfall", "totalLiquidityDeposited",
    "totalLiquidityWithdrawn", "netLiquidityContributed",
  ];
  return Object.fromEntries(keys.map((key, index) => [key, (raw[key] ?? raw[index]).toString()]));
}

export class SandboxPlatformError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = "SandboxPlatformError";
    this.code = code;
    this.status = status;
  }
}

export class SandboxPlatformService {
  constructor(config, { publicClient = null, walletClient = null, account = null } = {}) {
    this.config = config;
    this._publicClient = publicClient;
    this._walletClient = walletClient;
    this._account = account;
    this._abis = null;
  }

  async clients() {
    if (!this.config.sandboxWritesEnabled) throw new SandboxPlatformError("sandbox_disabled", "Sandbox writes are disabled.", 503);
    if (this.config.arcChainId !== 5_042_002) throw new SandboxPlatformError("wrong_chain", "Sandbox writes are restricted to Arc Testnet.", 503);
    if (!this._account) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(this.config.sandboxPlatformPrivateKey)) {
        throw new SandboxPlatformError("sandbox_not_configured", "The sandbox platform signer is not configured.", 503);
      }
      this._account = privateKeyToAccount(this.config.sandboxPlatformPrivateKey);
    }
    if (getAddress(this._account.address) === getAddress(this.config.protocolOwnerAddress)) {
      throw new SandboxPlatformError("unsafe_signer", "The sandbox platform signer must not be the protocol owner.", 503);
    }
    const chain = defineChain({
      id: this.config.arcChainId,
      name: "Arc Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [this.config.arcRpcUrl] } },
    });
    const transport = http(this.config.arcRpcUrl, { timeout: 8_000, retryCount: 1 });
    this._publicClient ??= createPublicClient({ chain, transport });
    this._walletClient ??= createWalletClient({ account: this._account, chain, transport });
    const chainId = await this._publicClient.getChainId();
    if (chainId !== this.config.arcChainId) throw new SandboxPlatformError("wrong_chain", "Arc RPC returned an unexpected chain.", 503);
    return { account: this._account, publicClient: this._publicClient, walletClient: this._walletClient };
  }

  async abis() {
    this._abis ??= Object.fromEntries(await Promise.all([
      "PlatformRegistry", "EarningsManager", "AdvanceVaultV2",
    ].map(async (name) => [name, await abi(name)])));
    return this._abis;
  }

  async context({ allowPaused = false } = {}) {
    if (this.config.sandboxPlatformId <= 2) {
      throw new SandboxPlatformError("unsafe_platform", "The public sandbox must use a fresh platform ID greater than 2.", 503);
    }
    const clients = await this.clients();
    const { PlatformRegistry } = await this.abis();
    const platform = await clients.publicClient.readContract({
      address: this.config.v1PlatformRegistryAddress,
      abi: PlatformRegistry,
      functionName: "getPlatform",
      args: [BigInt(this.config.sandboxPlatformId)],
    });
    if (getAddress(platform.settlementWallet) !== getAddress(clients.account.address)) {
      throw new SandboxPlatformError("signer_mismatch", "The sandbox signer does not match the registered platform settlement wallet.", 503);
    }
    if (BigInt(platform.creditLimit) > BigInt(this.config.sandboxMaxCreditLimit)) {
      throw new SandboxPlatformError("unsafe_credit_limit", "The sandbox platform credit limit exceeds the configured safety maximum.", 503);
    }
    if (!allowPaused && BigInt(platform.reserveBalance) < BigInt(this.config.sandboxMinReserve)) {
      throw new SandboxPlatformError("insufficient_reserve", "The sandbox platform reserve is below the demo minimum.", 503);
    }
    if (Number(platform.advanceFeeBps) !== 100) {
      throw new SandboxPlatformError("unsafe_fee", "The public sandbox requires a 100-bps advance fee.", 503);
    }
    if (!allowPaused && !platform.active) throw new SandboxPlatformError("platform_paused", "The sandbox platform is paused.");
    return { ...clients, platform };
  }

  async write(context, request) {
    const simulation = await context.publicClient.simulateContract({ ...request, account: context.account });
    const hash = await context.walletClient.writeContract(simulation.request);
    const receipt = await context.publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== "success") throw new SandboxPlatformError("transaction_failed", "The Arc transaction reverted.", 502);
    return { receipt, result: simulation.result, public: receiptRecord(receipt, this.config.blockExplorerUrl) };
  }

  task(workflow) {
    const externalTaskId = `fidra-v1.4-demo-${workflow.id}`;
    return {
      externalTaskId,
      taskHash: keccak256(toBytes(externalTaskId)),
      evidenceHash: keccak256(toBytes(`completed:${externalTaskId}`)),
    };
  }

  async createClaim(workflow) {
    if (workflow.claim?.id) return workflow.claim;
    const context = await this.context();
    const { EarningsManager } = await this.abis();
    const faceValue = BigInt(this.config.sandboxClaimFaceValue);
    if (faceValue <= 0n || faceValue > BigInt(this.config.sandboxMaxClaimFaceValue)) {
      throw new SandboxPlatformError("claim_limit", "The configured demo claim exceeds its strict maximum.", 503);
    }
    const task = this.task(workflow);
    const dueDate = BigInt(Math.floor(Date.now() / 1000) + this.config.sandboxClaimDueSeconds);
    const taskUsed = await context.publicClient.readContract({
      address: this.config.v1EarningsManagerAddress, abi: EarningsManager,
      functionName: "isTaskHashUsed", args: [BigInt(this.config.sandboxPlatformId), task.taskHash],
    });
    if (taskUsed) {
      const logs = await context.publicClient.getContractEvents({
        address: this.config.v1EarningsManagerAddress, abi: EarningsManager, eventName: "ClaimCreated",
        args: { platformId: BigInt(this.config.sandboxPlatformId) },
        fromBlock: BigInt(this.config.v1DeploymentBlock), toBlock: "latest",
      });
      const recovered = logs.find((log) => log.args.taskHash === task.taskHash && getAddress(log.args.worker) === getAddress(workflow.worker));
      if (!recovered?.transactionHash) throw new SandboxPlatformError("claim_recovery_failed", "The task exists on Arc but its claim event could not be recovered.", 502);
      const recoveredReceipt = await context.publicClient.getTransactionReceipt({ hash: recovered.transactionHash });
      return {
        id: recovered.args.claimId.toString(), platformId: String(this.config.sandboxPlatformId),
        worker: getAddress(recovered.args.worker), faceValue: recovered.args.faceValue.toString(),
        dueDate: recovered.args.dueDate.toString(), taskHash: recovered.args.taskHash,
        evidenceHash: recovered.args.evidenceHash, createReceipt: receiptRecord(recoveredReceipt, this.config.blockExplorerUrl),
        recovered: true,
      };
    }
    const outcome = await this.write(context, {
      address: this.config.v1EarningsManagerAddress,
      abi: EarningsManager,
      functionName: "createClaim",
      args: [BigInt(this.config.sandboxPlatformId), getAddress(workflow.worker), faceValue, dueDate, task.taskHash, task.evidenceHash],
    });
    const events = parseEventLogs({ abi: EarningsManager, logs: outcome.receipt.logs, eventName: "ClaimCreated" });
    const event = events.find((item) => getAddress(item.args.worker) === getAddress(workflow.worker));
    if (!event?.args?.claimId) throw new SandboxPlatformError("claim_event_missing", "Claim creation did not emit the expected event.", 502);
    return {
      id: event.args.claimId.toString(), platformId: String(this.config.sandboxPlatformId),
      worker: getAddress(workflow.worker), faceValue: faceValue.toString(), dueDate: dueDate.toString(),
      taskHash: task.taskHash, evidenceHash: task.evidenceHash, createReceipt: outcome.public,
    };
  }

  async certifyClaim(claim) {
    if (claim.certifyReceipt) return claim;
    if (BigInt(claim.id) <= 6n) throw new SandboxPlatformError("historical_claim", "Historical claims cannot be mutated.", 403);
    const context = await this.context();
    const { EarningsManager } = await this.abis();
    const current = await context.publicClient.readContract({
      address: this.config.v1EarningsManagerAddress, abi: EarningsManager,
      functionName: "getClaim", args: [BigInt(claim.id)],
    });
    if (Number(current.status) >= 2) {
      const logs = await context.publicClient.getContractEvents({
        address: this.config.v1EarningsManagerAddress, abi: EarningsManager, eventName: "ClaimCertified",
        args: { claimId: BigInt(claim.id) }, fromBlock: BigInt(claim.createReceipt.blockNumber), toBlock: "latest",
      });
      const recovered = logs.at(-1);
      if (!recovered?.transactionHash) throw new SandboxPlatformError("certification_recovery_failed", "Certification state exists but its receipt could not be recovered.", 502);
      const recoveredReceipt = await context.publicClient.getTransactionReceipt({ hash: recovered.transactionHash });
      return { ...claim, certifyReceipt: receiptRecord(recoveredReceipt, this.config.blockExplorerUrl), recovered: true };
    }
    const outcome = await this.write(context, {
      address: this.config.v1EarningsManagerAddress,
      abi: EarningsManager,
      functionName: "certifyClaim",
      args: [BigInt(claim.id)],
    });
    return { ...claim, certifyReceipt: outcome.public };
  }

  async settle(workflow) {
    const claimId = BigInt(workflow.claim?.id ?? 0);
    if (claimId <= 6n) throw new SandboxPlatformError("historical_claim", "Historical claims cannot be settled by the sandbox service.", 403);
    if (workflow.settlement?.receipt) return workflow.settlement;
    const context = await this.context({ allowPaused: true });
    const { EarningsManager, AdvanceVaultV2 } = await this.abis();
    const [claim, purchase, statsBefore] = await Promise.all([
      context.publicClient.readContract({ address: this.config.v1EarningsManagerAddress, abi: EarningsManager, functionName: "getClaim", args: [claimId] }),
      context.publicClient.readContract({ address: this.config.v1AdvanceVaultAddress, abi: AdvanceVaultV2, functionName: "getPurchase", args: [claimId] }),
      context.publicClient.readContract({ address: this.config.v1AdvanceVaultAddress, abi: AdvanceVaultV2, functionName: "vaultStats" }),
    ]);
    if (BigInt(claim.platformId) !== BigInt(this.config.sandboxPlatformId) || getAddress(claim.worker) !== getAddress(workflow.worker)) {
      throw new SandboxPlatformError("claim_mismatch", "The workflow claim does not match the sandbox platform and worker.", 403);
    }
    if (Number(claim.status) === 5 && Number(purchase.status) === 2) {
      const logs = await context.publicClient.getContractEvents({
        address: this.config.v1AdvanceVaultAddress, abi: AdvanceVaultV2, eventName: "ClaimSettledEvent",
        args: { claimId }, fromBlock: BigInt(workflow.advance.receipt.blockNumber), toBlock: "latest",
      });
      const recovered = logs.at(-1);
      if (!recovered?.transactionHash) throw new SandboxPlatformError("settlement_recovery_failed", "Settlement state exists but its receipt could not be recovered.", 502);
      const recoveredReceipt = await context.publicClient.getTransactionReceipt({ hash: recovered.transactionHash });
      const statsAfter = await context.publicClient.readContract({ address: this.config.v1AdvanceVaultAddress, abi: AdvanceVaultV2, functionName: "vaultStats" });
      return { approvalReceipt: null, receipt: receiptRecord(recoveredReceipt, this.config.blockExplorerUrl), platformExposure: context.platform.outstandingExposure.toString(), statsBefore: null, statsAfter: statsRecord(statsAfter), recovered: true };
    }
    if (Number(claim.status) !== 4 || Number(purchase.status) !== 1) {
      throw new SandboxPlatformError("claim_not_outstanding", "Only the workflow's outstanding advanced claim can be settled.");
    }
    let approvalReceipt = null;
    const allowance = await context.publicClient.readContract({
      address: this.config.usdcAddress, abi: usdcAbi, functionName: "allowance",
      args: [context.account.address, this.config.v1AdvanceVaultAddress],
    });
    if (allowance < claim.faceValue) {
      const approval = await this.write(context, {
        address: this.config.usdcAddress, abi: usdcAbi, functionName: "approve",
        args: [this.config.v1AdvanceVaultAddress, claim.faceValue],
      });
      approvalReceipt = approval.public;
    }
    const settlement = await this.write(context, {
      address: this.config.v1AdvanceVaultAddress, abi: AdvanceVaultV2,
      functionName: "settleClaim", args: [claimId],
    });
    const [finalClaim, finalPurchase, platform, statsAfter] = await Promise.all([
      context.publicClient.readContract({ address: this.config.v1EarningsManagerAddress, abi: EarningsManager, functionName: "getClaim", args: [claimId] }),
      context.publicClient.readContract({ address: this.config.v1AdvanceVaultAddress, abi: AdvanceVaultV2, functionName: "getPurchase", args: [claimId] }),
      context.publicClient.readContract({ address: this.config.v1PlatformRegistryAddress, abi: (await this.abis()).PlatformRegistry, functionName: "getPlatform", args: [BigInt(this.config.sandboxPlatformId)] }),
      context.publicClient.readContract({ address: this.config.v1AdvanceVaultAddress, abi: AdvanceVaultV2, functionName: "vaultStats" }),
    ]);
    if (Number(finalClaim.status) !== 5 || Number(finalPurchase.status) !== 2) {
      throw new SandboxPlatformError("settlement_verification_failed", "Arc did not confirm the expected settled state.", 502);
    }
    return {
      approvalReceipt, receipt: settlement.public,
      platformExposure: platform.outstandingExposure.toString(),
      statsBefore: statsRecord(statsBefore), statsAfter: statsRecord(statsAfter),
    };
  }

  async snapshot(workflow) {
    const context = await this.context({ allowPaused: true });
    const { PlatformRegistry, EarningsManager, AdvanceVaultV2 } = await this.abis();
    const [platform, stats, workerBalance] = await Promise.all([
      context.publicClient.readContract({ address: this.config.v1PlatformRegistryAddress, abi: PlatformRegistry, functionName: "getPlatform", args: [BigInt(this.config.sandboxPlatformId)] }),
      context.publicClient.readContract({ address: this.config.v1AdvanceVaultAddress, abi: AdvanceVaultV2, functionName: "vaultStats" }),
      context.publicClient.getBalance({ address: getAddress(workflow.worker) }),
    ]);
    let claim = null;
    let purchase = null;
    if (workflow.claim?.id) {
      [claim, purchase] = await Promise.all([
        context.publicClient.readContract({ address: this.config.v1EarningsManagerAddress, abi: EarningsManager, functionName: "getClaim", args: [BigInt(workflow.claim.id)] }),
        context.publicClient.readContract({ address: this.config.v1AdvanceVaultAddress, abi: AdvanceVaultV2, functionName: "getPurchase", args: [BigInt(workflow.claim.id)] }),
      ]);
    }
    return {
      platform: {
        id: String(this.config.sandboxPlatformId), active: platform.active,
        creditLimit: platform.creditLimit.toString(), exposure: platform.outstandingExposure.toString(),
        reserve: platform.reserveBalance.toString(), feeBps: platform.advanceFeeBps.toString(),
      },
      claimStatus: claim ? Number(claim.status) : null,
      purchaseStatus: purchase ? Number(purchase.status) : null,
      workerBalanceNativeUsdc: formatEther(workerBalance),
      vault: statsRecord(stats),
    };
  }
}
