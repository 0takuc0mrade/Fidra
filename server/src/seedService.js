import { createPublicClient, createWalletClient, defineChain, formatEther, getAddress, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export class GasSeedError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "GasSeedError";
    this.status = status;
  }
}

export class GasSeedService {
  constructor(config, walletStore) {
    this.config = config;
    this.walletStore = walletStore;
  }

  clients() {
    if (!this.config.gasSeedConfigured) {
      throw new GasSeedError("Arc testnet gas seeding is not configured.", 503);
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(this.config.seedPrivateKey)) {
      throw new GasSeedError("Operator seed signer is invalid.", 503);
    }
    const chain = defineChain({
      id: this.config.arcChainId,
      name: "Arc Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [this.config.arcRpcUrl] } },
    });
    const transport = http(this.config.arcRpcUrl);
    const account = privateKeyToAccount(this.config.seedPrivateKey);
    return {
      account,
      publicClient: createPublicClient({ chain, transport }),
      walletClient: createWalletClient({ account, chain, transport }),
    };
  }

  async seed(wallet, context = {}) {
    const metadata = await this.walletStore.get(wallet.id);
    if (this.config.seedOncePerWallet && metadata?.gasSeed?.transactionHash) {
      return { ...metadata.gasSeed, status: "already_seeded" };
    }

    const target = parseEther(String(this.config.seedAmountUsdc));
    const maximum = parseEther(String(this.config.maxSeedAmountUsdc));
    const { account, publicClient, walletClient } = this.clients();
    if (getAddress(account.address) === getAddress(this.config.protocolOwnerAddress)) {
      throw new GasSeedError("The gas funding signer must not be the protocol owner.", 503);
    }
    if (this.config.sandboxPlatformPrivateKey && /^0x[0-9a-fA-F]{64}$/.test(this.config.sandboxPlatformPrivateKey)) {
      const platformAccount = privateKeyToAccount(this.config.sandboxPlatformPrivateKey);
      if (getAddress(account.address) === getAddress(platformAccount.address)) {
        throw new GasSeedError("The gas funding signer must differ from the sandbox platform signer.", 503);
      }
    }
    const chainId = await publicClient.getChainId();
    if (chainId !== 5_042_002 || chainId !== this.config.arcChainId) throw new GasSeedError("Gas seeding is restricted to Arc Testnet.", 503);
    const existingBalance = await publicClient.getBalance({ address: wallet.address });
    if (existingBalance >= target) {
      const result = {
        status: "not_needed",
        reason: "Wallet already has at least the configured native gas balance.",
        nativeBalanceUsdc: formatEther(existingBalance),
      };
      await this.walletStore.recordSeed(wallet.id, result);
      return result;
    }

    const amount = target - existingBalance;
    if (amount <= 0n || amount > maximum) throw new GasSeedError("The requested gas top-up exceeds the per-wallet maximum.", 429);
    const dailyTotal = await this.walletStore.dailyConfirmedSeedTotal();
    if (dailyTotal + Number(formatEther(amount)) > this.config.seedDailyBudgetUsdc) {
      throw new GasSeedError("The daily Arc testnet gas budget has been reached.", 429);
    }
    const funderBalance = await publicClient.getBalance({ address: account.address });
    const reserve = parseEther(String(this.config.seedWalletReserveUsdc));
    if (funderBalance < amount + reserve) throw new GasSeedError("The gas funding wallet is below its reserve threshold.", 503);
    const transactionHash = await walletClient.sendTransaction({
      account,
      to: wallet.address,
      value: amount,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash, confirmations: 1 });
    if (receipt.status !== "success") throw new GasSeedError("Arc gas seed transaction reverted.", 502);
    const result = {
      status: "confirmed",
      amountUsdc: formatEther(amount),
      targetBalanceUsdc: String(this.config.seedAmountUsdc),
      transactionHash,
      blockNumber: receipt.blockNumber.toString(),
      explorerUrl: `https://testnet.arcscan.app/tx/${transactionHash}`,
      requestKeyHash: context.requestKeyHash ?? null,
    };
    await this.walletStore.recordSeed(wallet.id, result);
    return result;
  }
}
