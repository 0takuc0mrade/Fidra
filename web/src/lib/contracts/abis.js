import mandateManagerAbi from "../../../../shared/abis/MandateManager.json";
import advanceVaultAbi from "../../../../shared/abis/AdvanceVault.json";

const usdcReadAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
];

export { advanceVaultAbi, mandateManagerAbi, usdcReadAbi };
