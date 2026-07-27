import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeErrorResult,
  defineChain,
  http,
} from "viem";
import { fidraConfig } from "../config.js";
import { advanceVaultAbi, mandateManagerAbi } from "./abis.js";

export const arcTestnet = defineChain({
  id: fidraConfig.chainId,
  name: "Arc Testnet",
  nativeCurrency: {
    name: "USDC gas",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [fidraConfig.rpcUrl] },
  },
  testnet: true,
});

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(fidraConfig.rpcUrl, {
    retryCount: 1,
    timeout: 8_000,
  }),
});

export function getInjectedWalletClient() {
  if (typeof window === "undefined" || !window.ethereum) return null;
  return createWalletClient({ chain: arcTestnet, transport: custom(window.ethereum) });
}

export async function probeArcConnection() {
  const chainId = await publicClient.getChainId();
  if (chainId !== fidraConfig.chainId) {
    throw new Error(`Arc RPC returned chain ${chainId}; expected ${fidraConfig.chainId}.`);
  }
  const blockNumber = await publicClient.getBlockNumber();
  return { chainId, blockNumber };
}

function findErrorData(error) {
  let current = error;
  while (current) {
    if (typeof current.data === "string" && current.data.startsWith("0x")) return current.data;
    current = current.cause;
  }
  return null;
}

export function parseFidraError(error) {
  const data = findErrorData(error);
  if (data) {
    for (const abi of [mandateManagerAbi, advanceVaultAbi]) {
      try {
        const decoded = decodeErrorResult({ abi, data });
        return {
          name: decoded.errorName,
          args: decoded.args ?? [],
          message: decoded.errorName,
        };
      } catch {
        // Try the next curated ABI.
      }
    }
  }

  return {
    name: error?.name || "FidraClientError",
    args: [],
    message: error?.shortMessage || error?.message || "The contract request failed.",
  };
}
