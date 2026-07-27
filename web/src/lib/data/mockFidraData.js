import { identities, initialClaims, policy } from "../../data.js";
import { getAddressConfiguration } from "../contracts/addresses.js";

const AGENT_ADDRESS = "0xA91E0000000000000000000000000000000042D7";
const APPROVER_ADDRESS = "0x5B60000000000000000000000000000000009C18";
const BUSINESS_ADDRESS = "0x71C4000000000000000000000000000000009A20";
const MOCK_VAULT_ADDRESS = "0xF1D200000000000000000000000000000000A117";

const vendorAddresses = Object.freeze({
  "Atlas Supply": "0xA71A500000000000000000000000000000005001",
  "Northwind Components": "0xB044000000000000000000000000000000005002",
  "Meridian Freight": "0xC3D100000000000000000000000000000005003",
  "Cedar Office": "0xCE0A000000000000000000000000000000005004",
});

const ZERO_HASH = `0x${"00".repeat(32)}`;
const PROOF_HASH = `0x${"8f".repeat(32)}`;
const EXTERNAL_REF_HASH = `0x${"42".repeat(32)}`;

function toUnits(amount) {
  return BigInt(Math.round(amount * 1_000_000));
}

function mockClaim(claim) {
  const vendor = vendorAddresses[claim.vendor];
  const hasProof = claim.state !== "Requested";
  const releaseDueAt = claim.state === "Locked"
    ? BigInt(Math.floor(Date.UTC(2026, 6, 18) / 1000))
    : 0n;

  return {
    ...claim,
    requestId: BigInt(claim.id),
    mandateId: 1042n,
    agent: AGENT_ADDRESS,
    vendor,
    vendorLabel: claim.vendor,
    payee: vendor,
    payeeLabel: claim.vendor,
    amountUnits: toUnits(claim.amount),
    proofHash: hasProof ? PROOF_HASH : ZERO_HASH,
    externalRefHash: EXTERNAL_REF_HASH,
    status: claim.state,
    releaseDueAt,
    createdAt: 1_783_950_000n,
    approvedAt: claim.state === "Requested" ? 0n : 1_783_950_300n,
    lockedAt: claim.state === "Locked" || claim.state === "Released" ? 1_783_950_600n : 0n,
    releasedAt: claim.state === "Released" ? 1_783_951_200n : 0n,
    advanceAssigned: false,
  };
}

export function getMockIntegrationStatus(lastRefreshAt = new Date()) {
  const addressConfiguration = getAddressConfiguration();
  return {
    mode: "demo",
    modeLabel: "Demo Mode",
    contractsConfigured: addressConfiguration.configured,
    contractLabel: addressConfiguration.configured ? "Configured" : "Addresses missing",
    managerStatus: "Demo data",
    vaultStatus: "Demo data",
    authorizationStatus: "Simulated",
    frozenStatus: "No · demo",
    liquidityStatus: "Simulated",
    discountStatus: "1% demo quote",
    rpcStatus: "Not queried in demo",
    walletStatus: "Not connected",
    readOnly: true,
    lastRefreshAt,
  };
}

export function getMockMandateDetail(mandateId = 1042) {
  const claims = initialClaims.map(mockClaim);
  return {
    source: "mock",
    mandate: {
      id: BigInt(mandateId),
      name: "Q3 Procurement",
      business: BUSINESS_ADDRESS,
      businessLabel: "Northstar Labs",
      agent: AGENT_ADDRESS,
      agentLabel: "ProcureBot",
      approver: APPROVER_ADDRESS,
      approverLabel: "Maya Chen",
      totalBudget: 5_000_000_000n,
      reserved: 1_000_000_000n,
      spent: 1_000_000_000n,
      availableBudget: 3_000_000_000n,
      expiresAt: BigInt(Math.floor(Date.UTC(2026, 8, 30) / 1000)),
      defaultReleaseDelaySeconds: 259_200n,
      maxPerPurchase: 1_250_000_000n,
      proofRequired: true,
      status: "Active",
      metadataHash: `0x${"10".repeat(32)}`,
      authorizedAdvanceVault: MOCK_VAULT_ADDRESS,
      authorizedVaultFrozen: false,
    },
    claims,
    claimsAvailable: true,
    identities: identities.map((entry) => [...entry]),
    policy: policy.map((entry) => [...entry]),
    integration: getMockIntegrationStatus(),
  };
}
