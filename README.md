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

## V1.1 live status

V1.1 is deployed, source-verified, and smoke-tested on Arc Testnet:

| Contract | Address |
|---|---|
| PlatformRegistry | [`0x20Ec…1af3`](https://testnet.arcscan.app/address/0x20EcB05d90D4F24F8Fcf2785BdE240796B8b1af3) |
| EarningsManager | [`0xdC1C…cD57`](https://testnet.arcscan.app/address/0xdC1C359fC174Fb8C7cDcbE0e09447d123dD9cD57) |
| AdvanceVaultV2 | [`0x1260…49c5`](https://testnet.arcscan.app/address/0x12604e5acD074D3499C9ac4D2cbb4Bd39ECE49c5) |

The controlled live sequence validated:

- single and bounded batch claim creation/certification;
- exact worker ownership and one-purchase checks;
- purchase-time credit exposure and reserve-presence enforcement;
- rejection of expired claims;
- platform-wallet and authorized-operator settlement;
- repayment by paused platforms for existing claims;
- distinct settled and defaulted terminal states;
- principal-based settlement/default accounting;
- actual/accounted cash and reserve reconciliation views;
- deterministic unit/fuzz and handler-based stateful invariant tests;
- a 0.99 USDC advance against 1 USDC of earnings;
- successful platform settlement and realized spread;
- bounded atomic batch certification without exposure;
- reserve-backed default, realized loss, and contractual shortfall;
- automatic platform pause and rejection of new exposure; and
- repayment of an existing obligation while paused.

The confirmed ledger is [`deployments/arc-testnet/v1.1-latest.json`](deployments/arc-testnet/v1.1-latest.json). See [the deployment runbook](docs/V1_1_ARC_TESTNET_DEPLOYMENT.md) for the corresponding controlled procedure.

## V1.2 Circle worker payouts

V1.2 adapts the existing Circle User-Controlled Wallet boundary to certified V1.1 worker earnings. The server validates the exact worker EOA, claim status and due date, platform reserve/credit/status, and vault accounted and actual cash before it creates a Circle challenge for `purchaseAdvance(uint256)`. The worker approves in Circle's SDK; Fidra never signs for the worker.

Circle submission alone is not success. The server independently requires a successful Arc receipt plus the exact `Advanced` claim and `Outstanding` purchase state before returning a hash or ArcScan link.

The V1.2 product surfaces are:

- `/worker`, `/worker/claims`, and `/worker/claims/:claimId` for worker-controlled instant payouts;
- `/platform`, `/platform/claims`, `/platform/claims/new`, `/platform/batches`, and `/platform/settlements` for trusted platform operations.

Deployment and accounting evidence remains in the confirmed repository artifact and is intentionally not exposed as a product route.

Implementation, configuration, and live confirmation are separate statuses. The code and deterministic tests are implemented; when Circle credentials are absent, the live path remains visibly `not_configured` and no Circle transaction is claimed.

Excluded from V1.2:

- Gateway, CCTP, Paymaster, or USYC;
- batch advance purchases;
- LP shares, withdrawal liabilities, or yield distribution; and
- cross-chain settlement.

## V1.3 live Circle proof

V1.3 completed a real Circle-controlled worker advance and platform settlement
on Arc Testnet. Claim 6 paid 0.99 USDC gross to the exact Circle worker, then
settled for 1.00 USDC. Arc receipts, claim state, exposure and vault accounting
were independently reconciled; the worker was never a settlement payer.

## V1.4 self-service testnet experience

V1.4 adds `/try`: Circle email login, exact-wallet gas preparation, one bounded
demo task, certified 0.10-USDC earnings, worker-approved 0.099-USDC advance,
independent Arc verification, automatic platform settlement and a durable receipt
timeline. The workflow is idempotent across refreshes and server restarts and
recovers a successful Arc advance even when Circle status polling times out.

Sandbox writes and gas funding are disabled by default. Enabling them requires
two fresh dedicated testnet keys, a fresh platform ID greater than 2, one-time
owner bootstrap and a separate controlled live-browser test. See the
[terminal-action audit](docs/V1_4_TERMINAL_ACTION_AUDIT.md),
[architecture](docs/V1_4_ARCHITECTURE.md), and
[live runbook](docs/V1_4_LIVE_RUNBOOK.md).

## V1.5 public deployment preparation

V1.5 hosts the proven `/try` journey without changing the protocol. The target
architecture is a Cloudflare Pages frontend and a single paid Render Node
service with a persistent disk for durable workflow and gas-seed records.
Sandbox writes remain disabled until the hosted read-only, signer, origin,
cookie, persistence, balance, budget, and kill-switch preflight passes.

See the [public deployment specification](docs/PUBLIC_DEPLOYMENT.md). A public
URL is not yet recorded, and this testnet milestone is not production-ready.

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
│   ├── V1_1_ARC_TESTNET_DEPLOYMENT.md
│   ├── PUBLIC_DEPLOYMENT.md
│   └── V1_2_*.md
├── deployments/
├── server/     # Circle worker boundary plus isolated legacy V0 endpoints
├── web/        # V1 worker/platform/evidence UI plus labelled V0 evidence
└── shared/     # generated V1 and legacy V0 ABI/schema modules
```

## Development

```bash
cd contracts
forge fmt --check
forge test

cd ../server
npm test
npm run check

cd ../web
npm test
npm run build
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

The V0 contract and UI modules remain in the repository as explicitly labelled historical evidence. V1 modules use separate ABIs, addresses, routes, and reads and do not import the V0 contracts.
