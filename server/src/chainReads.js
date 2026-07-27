import { readFile } from "node:fs/promises";
import { createPublicClient, defineChain, getAddress, http, isAddress } from "viem";

// RequestStatus enum ordering must match contracts/src/MandateManager.sol.
export const REQUEST_STATUS = Object.freeze({
  0: "None",
  1: "Requested",
  2: "Approved",
  3: "Locked",
  4: "Released",
  5: "Rejected",
});

async function loadAbi(name) {
  const url = new URL(`../../shared/abis/${name}.json`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

/**
 * Reads MandateManager / AdvanceVault state on Arc so buyClaim preparation can be
 * validated server-side before a Circle challenge is ever created. This never signs
 * or submits anything; it is a read-only guard.
 */
export class ChainReads {
  constructor(config) {
    this.config = config;
    this._client = null;
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
    this._client = createPublicClient({ chain, transport: http(this.config.arcRpcUrl, { timeout: 8_000 }) });
    return this._client;
  }

  async abis() {
    if (this._abis) return this._abis;
    const [mandateManager, advanceVault] = await Promise.all([
      loadAbi("MandateManager"),
      loadAbi("AdvanceVault"),
    ]);
    this._abis = { mandateManager, advanceVault };
    return this._abis;
  }

  async getSpendRequest(requestId) {
    const client = await this.client();
    const { mandateManager } = await this.abis();
    const raw = await client.readContract({
      address: this.config.mandateManagerAddress,
      abi: mandateManager,
      functionName: "getSpendRequest",
      args: [BigInt(requestId)],
    });
    return {
      mandateId: raw.mandateId,
      agent: raw.agent,
      vendor: raw.vendor,
      payee: raw.payee,
      amount: raw.amount,
      status: REQUEST_STATUS[Number(raw.status)] ?? "Unknown",
      lockedAt: raw.lockedAt,
      releaseDueAt: raw.releaseDueAt,
      advanceAssigned: raw.advanceAssigned,
    };
  }

  async getClaimPurchase(requestId) {
    const client = await this.client();
    const { advanceVault } = await this.abis();
    const raw = await client.readContract({
      address: this.config.advanceVaultAddress,
      abi: advanceVault,
      functionName: "getClaimPurchase",
      args: [BigInt(requestId)],
    });
    return { seller: raw.seller, settled: raw.settled };
  }
}

/**
 * Computes the advance amount for the deployed fixed discount, in 6-decimal USDC units.
 * Mirrors AdvanceVault.buyClaim: advance = face * (10000 - discountBps) / 10000 (floor).
 */
export function computeAdvance(faceAmountUnits, discountBps) {
  const face = BigInt(faceAmountUnits);
  const bps = BigInt(discountBps);
  const advance = (face * (10_000n - bps)) / 10_000n;
  return { advanceUnits: advance, spreadUnits: face - advance };
}

export function sameAddress(a, b) {
  if (!a || !b || !isAddress(a, { strict: false }) || !isAddress(b, { strict: false })) return false;
  return getAddress(a) === getAddress(b);
}
