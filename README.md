# Fidra

**Embedded instant-payout infrastructure for irregular-work platforms.**

Fidra lets platforms offer workers immediate USDC after completed earnings are final. A platform certifies a worker's claim, the worker may sell that certified claim to Fidra for an instant advance, and the platform settles the full obligation on its normal payout schedule.

Fidra takes platform risk, never worker risk. A worker's advance is a completed sale—not a loan—and is never repaid or clawed back from the worker.

## Fidra V1.1

V1.1 is the current protocol milestone. It is an independent protocol pivot built around three contracts:

- `PlatformRegistry` registers approved settlement wallets, platform status, credit limits, purchased-claim exposure, reserves, settlement operators, and advance fees.
- `EarningsManager` records immutable platform-certified worker earnings claims, including bounded atomic batch certification.
- `AdvanceVaultV2` purchases certified, unexpired claims; pays workers in USDC; accepts authorized platform settlement; and resolves overdue claims against platform reserves.

The current lifecycle is:

```text
Platform creates claim
        │
        ▼
Pending ──cancel──▶ Cancelled
   │
   └──certify──▶ Certified ──worker sells──▶ Advanced
                                                │
                              platform pays ────┼──▶ Settled
                              overdue default ─└──▶ Defaulted
```

Credit exposure begins only when Fidra purchases a claim. Certification alone does not consume platform credit.

## Accounting model

V1.1 books purchased claims at the advance principal Fidra actually paid, not at contractual face value.

```text
accountedAssets = accountedCash + outstandingPrincipal

accountedAssets
=
netLiquidityContributed
+ totalRealizedProfit
- totalRealizedLoss
```

The vault separately exposes accounted cash and actual token custody. External token transfers can create a visible surplus, and any deficit remains visible rather than being masked by an available-liquidity calculation.

Successful platform settlement realizes `faceValue - advanceAmount` as profit. Default recovery is compared with advance principal:

- recovery above principal is realized profit;
- recovery below principal is realized loss;
- face value not recovered is contractual shortfall;
- every default remains `Defaulted`, including one fully covered by reserves.

These checks establish accounting conservation and cash reconciliation. V1.1 does not yet model LP shares or withdrawal liabilities and does not claim complete economic-solvency accounting.

Read [the V1.1 product specification](docs/V1_PRODUCT_SPEC.md) and [V1.1 architecture](docs/V1_ARCHITECTURE.md) for the complete state transitions and invariants.

## V1.1 status

Implemented locally:

- single and bounded batch claim creation/certification;
- exact worker ownership and one-purchase checks;
- purchase-time credit exposure and reserve-presence enforcement;
- rejection of expired claims;
- platform-wallet and authorized-operator settlement;
- repayment by paused platforms for existing claims;
- distinct settled and defaulted terminal states;
- principal-based settlement/default accounting;
- actual/accounted cash and reserve reconciliation views;
- deterministic unit/fuzz tests; and
- handler-based stateful invariant tests.

V1.1 has not been deployed. A controlled Arc Testnet deployment is being
prepared from commit `b2477d047f95f60288ec12e099f7b857492fd410`.
Broadcast remains fail-closed until the required role wallets, small test
amounts, clean deployment-tooling commit, and complete validation gate are all
confirmed. See [the V1.1 Arc Testnet runbook](docs/V1_1_ARC_TESTNET_DEPLOYMENT.md).

Excluded from V1.1:

- frontend work;
- Circle integration;
- Gateway, CCTP, Paymaster, or USYC;
- batch advance purchases;
- LP shares, withdrawal liabilities, or yield distribution; and
- cross-chain settlement.

## Repository structure

```text
fidra/
├── contracts/
│   ├── src/
│   │   ├── PlatformRegistry.sol
│   │   ├── EarningsManager.sol
│   │   └── AdvanceVaultV2.sol
│   └── test/
│       ├── FidraV1.t.sol
│       └── FidraV11Invariant.t.sol
├── docs/
│   ├── V1_PRODUCT_SPEC.md
│   ├── V1_ARCHITECTURE.md
│   └── V1_1_ARC_TESTNET_DEPLOYMENT.md
├── deployments/
├── server/     # legacy v0 integration evidence; untouched by V1.1
├── web/        # legacy v0 interface evidence; untouched by V1.1
└── shared/     # legacy v0 shared artifacts
```

## Development

```bash
cd contracts
forge fmt --check
forge test
```

The invariant campaign is configured in `contracts/foundry.toml`.

## Legacy V0

Fidra v0 financed approved vendor purchase receivables for agentic commerce using `MandateManager` and `AdvanceVault`. Those contracts remain unmodified as legacy Arc Testnet evidence and are not imported, upgraded, or redeployed by V1.1.

Recorded legacy deployment:

| Parameter | Value |
|---|---|
| Network | Arc Testnet (`5042002`) |
| MandateManager | [`0xEfA2…9EF2`](https://testnet.arcscan.app/address/0xEfA2b3e70138810eA51552177c3f1AE5ab249EF2) |
| AdvanceVault | [`0x5F7B…8C8B`](https://testnet.arcscan.app/address/0x5F7Bec9eC341F816182a56D8E033cac63DBd8C8B) |
| Evidence ledger | [`deployments/arc-testnet/latest.json`](deployments/arc-testnet/latest.json) |

The v0 frontend, Circle boundary, documentation, and deployment scripts remain in the repository solely as historical evidence. They do not describe or implement the current Fidra product direction.
