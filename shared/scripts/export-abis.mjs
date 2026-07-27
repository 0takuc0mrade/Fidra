import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sharedDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(sharedDirectory, "..");
const outputDirectory = resolve(sharedDirectory, "abis");

const contracts = [
  {
    name: "MandateManager",
    artifact: resolve(repositoryRoot, "contracts/out/MandateManager.sol/MandateManager.json"),
    functions: new Set([
      "MAX_RELEASE_DELAY_SECONDS",
      "approveSpend",
      "assignClaim",
      "assignClaimForAdvance",
      "authorizedAdvanceVault",
      "authorizedVaultFrozen",
      "availableBudget",
      "createMandate",
      "freezeAuthorizedAdvanceVault",
      "getMandate",
      "getSpendRequest",
      "isVendorAllowed",
      "lockSpend",
      "owner",
      "reclaimExpired",
      "rejectSpend",
      "releaseSpend",
      "requestSpend",
      "revokeMandate",
      "setAuthorizedAdvanceVault",
      "submitProof",
      "usdc",
    ]),
  },
  {
    name: "AdvanceVault",
    artifact: resolve(repositoryRoot, "contracts/out/AdvanceVault.sol/AdvanceVault.json"),
    functions: new Set([
      "BPS_DENOMINATOR",
      "MAX_DISCOUNT_BPS",
      "availableLiquidity",
      "buyClaim",
      "depositLiquidity",
      "discountBps",
      "getClaimPurchase",
      "mandateManager",
      "markClaimSettled",
      "owner",
      "poolStats",
      "totalAdvanced",
      "totalExpectedSpread",
      "totalFaceValueAcquired",
      "totalLiquidityDeposited",
      "totalRealizedSpread",
      "totalRepaymentsRecognized",
      "usdc",
    ]),
  },
];

await mkdir(outputDirectory, { recursive: true });

for (const contract of contracts) {
  const artifact = JSON.parse(await readFile(contract.artifact, "utf8"));
  const abi = artifact.abi.filter((entry) => (
    entry.type === "event"
    || entry.type === "error"
    || (entry.type === "function" && contract.functions.has(entry.name))
  ));

  await writeFile(resolve(outputDirectory, `${contract.name}.json`), `${JSON.stringify(abi, null, 2)}\n`);
  process.stdout.write(`Exported ${contract.name}: ${abi.length} ABI entries\n`);
}
