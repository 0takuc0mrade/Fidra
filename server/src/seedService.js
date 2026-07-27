import { createPublicClient, createWalletClient, defineChain, formatEther, http, parseEther } from "viem";
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

  async seed(wallet) {
    const metadata = await this.walletStore.get(wallet.id);
    if (this.config.seedOncePerWallet && metadata?.gasSeed?.transactionHash) {
      return { ...metadata.gasSeed, status: "already_seeded" };
    }

    const amount = parseEther(String(this.config.seedAmountUsdc));
    const { account, publicClient, walletClient } = this.clients();
    const existingBalance = await publicClient.getBalance({ address: wallet.address });
    if (existingBalance >= amount) {
      const result = {
        status: "not_needed",
        reason: "Wallet already has at least the configured native gas balance.",
        nativeBalanceUsdc: formatEther(existingBalance),
      };
      await this.walletStore.recordSeed(wallet.id, result);
      return result;
    }

    const transactionHash = await walletClient.sendTransaction({
      account,
      to: wallet.address,
      value: amount,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash, confirmations: 1 });
    if (receipt.status !== "success") throw new GasSeedError("Arc gas seed transaction reverted.", 502);
    const result = {
      status: "confirmed",
      amountUsdc: String(this.config.seedAmountUsdc),
      transactionHash,
      blockNumber: receipt.blockNumber.toString(),
      explorerUrl: `https://testnet.arcscan.app/tx/${transactionHash}`,
    };
    await this.walletStore.recordSeed(wallet.id, result);
    return result;
  }
}
