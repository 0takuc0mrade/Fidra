import mandateManagerAbi from "../../../../shared/abis/MandateManager.json" with { type: "json" };
import advanceVaultAbi from "../../../../shared/abis/AdvanceVault.json" with { type: "json" };
import platformRegistryAbi from "../../../../shared/abis/PlatformRegistry.json" with { type: "json" };
import earningsManagerAbi from "../../../../shared/abis/EarningsManager.json" with { type: "json" };
import advanceVaultV2Abi from "../../../../shared/abis/AdvanceVaultV2.json" with { type: "json" };

const usdcReadAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
];

const usdcWriteAbi = [
  ...usdcReadAbi,
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
];

export {
  advanceVaultAbi,
  advanceVaultV2Abi,
  earningsManagerAbi,
  mandateManagerAbi,
  platformRegistryAbi,
  usdcReadAbi,
  usdcWriteAbi,
};
