# Fidra

**Fidra turns approved-but-unreleased AI-agent purchase claims into instant USDC for vendors.**

Fidra is the receivables and working-capital layer for agentic commerce on Arc. A business escrows USDC into a controlled purchase mandate. An AI agent can request a purchase from a named vendor within that mandate. When the business approves and locks the request, the claim becomes an irrevocable, fully reserved onchain receivable. The vendor can hold it to settlement or sell it at a transparent discount to Fidra's `AdvanceVault` for immediate USDC. When the claim is released, its full face value is paid to the current payee, allowing the vault to earn the spread.

Fidra is not a generic wallet, invoice application, escrow product, marketplace, payment router, or basic agent spend-control tool. Its wedge begins after a controlled purchase has been approved: it makes the resulting payment delay financeable.

## The problem

AI agents can discover suppliers, negotiate, and initiate purchases continuously. Spend controls can constrain what an agent may request, but they do not solve the vendor's cash-flow problem. A valid purchase can still leave a supplier waiting through approval, reconciliation, delivery, or treasury release cycles.

That delay has a real cost. Small vendors may need cash immediately to buy inventory, pay workers, or fulfill the order. Traditional receivables finance is too manual and document-heavy for high-frequency agentic purchases, while an ordinary onchain invoice may still be cancellable, underfunded, or ambiguous about who gets paid.

Fidra creates the missing asset: a claim that is already approved, fully reserved, non-cancellable, assignable, and settled in USDC. The protocol does not finance an agent's intention. It finances a locked obligation.

## Why spend controls are only the first half

A mandate answers: **may this agent make this purchase?** Fidra additionally answers: **once approved, can the vendor treat the payment as a financeable receivable?**

The distinction drives the design:

- Before lock, the business retains control. It can reject a request, revoke a mandate, or recover uncommitted funds after expiry.
- At lock, the claim amount moves from available mandate balance to reserved balance.
- After lock, revocation and expiry cannot cancel the claim or reclaim its reserve.
- The vendor identity remains fixed for audit history, while the payee can change when the receivable is sold.
- Release sends face value to the current payee, not necessarily the original vendor.

## The working-capital wedge

Suppose an agent requests a 100 USDC purchase. The business locks the claim, reserving the full 100 USDC. The vendor can:

1. wait and receive 100 USDC at release; or
2. sell the claim to the deployed `AdvanceVault`, receive 99 USDC now at its fixed 1% discount, and assign the payee to the vault.

At release, the vault receives 100 USDC and earns a 1 USDC gross spread. In product terms: **Get 99 USDC now instead of waiting for 100 USDC later.** Production pricing must account for time, liquidity, operating costs, concentration, and risk. Fidra's initial underwriting boundary is intentionally narrow: the vault buys only claims in the `Locked` state, never requests or merely submitted invoices.

## Why Arc

Arc is a strong settlement environment for this product because it is EVM-compatible and purpose-built for stablecoin finance. USDC-denominated gas reduces the need for businesses, agents, and vendors to manage a separate volatile gas asset. Deterministic sub-second finality makes state changes such as lock, assignment, advance, and release fast to confirm. Circle's surrounding stack also gives Fidra a credible path from a focused Arc MVP to wallet abstraction, crosschain liquidity, and productive treasury capital.

### Arc Testnet

| Parameter | Value |
| --- | --- |
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.network` |
| USDC ERC-20 interface | `0x3600000000000000000000000000000000000000` |
| MandateManager | [`0xEfA2…9EF2`](https://testnet.arcscan.app/address/0xEfA2b3e70138810eA51552177c3f1AE5ab249EF2) |
| AdvanceVault | [`0x5F7B…8C8B`](https://testnet.arcscan.app/address/0x5F7Bec9eC341F816182a56D8E033cac63DBd8C8B) |

Arc exposes native USDC for gas and an ERC-20 USDC interface for contracts. These surfaces can have different decimal behavior. **All Fidra contract balances, limits, discounts, reserves, transfers, events, tests, and API amounts must use the ERC-20 interface and 6-decimal USDC units.** Never derive protocol accounting from the native gas balance.

Official references: [Arc network](https://docs.arc.io/arc-chain), [connect to Arc](https://docs.arc.io/arc/references/connect-to-arc), and [Circle USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses).

## Circle stack: focused MVP, credible expansion

| Product | Role in Fidra | MVP status |
| --- | --- | --- |
| USDC on Arc | Mandate funding, vault liquidity, advances, and claim settlement | Core target for the live MVP |
| Circle User-Controlled Wallets | Email/Google vendor onboarding, an explicit EOA on `ARC-TESTNET`, and a real user-approved `AdvanceVault.buyClaim` | Real fail-closed integration code is present; disabled until sandbox credentials are configured; `buyClaim` is implemented (validated against live Arc state, no fabricated receipts), while `submitProof`/`requestSpend` remain stubbed |
| Gateway | A unified crosschain USDC balance from which businesses or the vault can source Arc liquidity | Planned; not required for the first local Arc loop |
| CCTP | Native USDC burn-and-mint movement into or out of Arc | Planned crosschain funding/withdrawal path |
| Circle Paymaster | ERC-4337 users pay gas in USDC without separately sourcing a native gas asset | Planned and support-dependent; Arc already uses USDC as native gas |
| USYC | Productive reserve asset for qualified, aggregated idle vault capital | Production upgrade only; excluded from the first live MVP |

Gateway and CCTP solve related but different liquidity workflows: Gateway exposes a unified balance and handles settlement, while CCTP is the direct burn-and-mint transport primitive. Neither belongs inside claim solvency accounting. The claim reserve must already be present as ERC-20 USDC on Arc when the claim locks.

USYC is not a decorative hackathon integration or collateral for individual claims. In a later production design, an eligible vault operator could allocate a conservative portion of aggregated idle pool capital to USYC while preserving enough immediately liquid USDC for advances and redemptions. Eligibility, supported networks, liquidity limits, pricing, and redemption risk require separate controls.

See [Circle/Arc integration](docs/CIRCLE_ARC_INTEGRATION.md) for boundaries and sources.

## Irrevocable means irrevocable

These invariants define the product:

- A request can enter `Locked` only while its parent mandate is active and unexpired.
- Locking reserves its full face amount in ERC-20 USDC.
- Once locked, mandate revocation or expiry cannot block assignment or release.
- Expired-fund reclaim can withdraw only unreserved balance.
- `AdvanceVault` can buy only a `Locked` claim and must atomically advance USDC and become its payee.
- The MVP owner configures the real `AdvanceVault` and can permanently freeze that address, closing further vault rotation.
- The original vendor is immutable audit identity; the payee is the mutable settlement beneficiary.
- Release always pays the current payee.
- A locked claim cannot be cancelled, reduced, double-sold, or released twice.
- A business or approver can release early; at immutable `releaseDueAt`, settlement becomes permissionless so the claim cannot be held hostage.

The `proofHash` is an audit and receipt gate. It binds offchain evidence to a request, but it does **not** prove real-world delivery, authenticity, quality, or legal enforceability. Approval remains an explicit business decision.

See [security invariants](docs/SECURITY_INVARIANTS.md) for the full threat model.

## MVP truth table

This repository includes locally tested Foundry implementations of `MandateManager` and the minimal operator-funded `AdvanceVault`, now deployed on Arc Testnet, plus guarded post-deploy scripts, a responsive React/Vite frontend, and a server-side Circle User-Controlled Wallet onboarding boundary. The deployment and first-smoke ledger are recorded in [`deployments/arc-testnet/latest.json`](deployments/arc-testnet/latest.json). The frontend defaults to read-only Live Mode and opens the settled mandate `1` / spend `1` evidence; a persistent UI switch makes the clearly labeled Demo Mode an explicit opt-in. Circle onboarding is disabled and reports `not_configured` until real sandbox credentials are supplied. Vendor `buyClaim` is a real user-approved contract-execution path (server-validated against live Arc state; email OTP is the primary tested auth method, Google is config-gated), while `submitProof` and `requestSpend` remain honest `not_implemented` stubs. Authorization is deliberately unfrozen, and no Circle success state or transaction hash is fabricated.

| Capability | Intended live MVP | Mocked, simulated, or planned |
| --- | --- | --- |
| Fund a mandate with ERC-20 USDC | Contract is deployed; the first 1 USDC Arc smoke mandate completed | Frontend write is still a stub |
| Submit, approve, lock, reject, assign, and release a claim | Contract is deployed and tested locally, including permissionless release at `releaseDueAt` | Live frontend transaction wiring and event indexing remain pending |
| Advance a locked claim from a funded vault | The deployed vault advanced 0.99 USDC against a 1 USDC claim and later recognized 0.01 USDC spread | LP shares, dynamic pricing, and frontend writes remain out of scope |
| Reserve and reclaim accounting | Covered by focused unit and fuzz tests | Full stateful handler-based invariants remain future hardening |
| `proofHash` | Implemented as an onchain field and approval gate | Evidence storage and delivery verification remain offchain |
| Frontend control plane | React 19 + Vite 6 app; default Live Mode reads deployment health, mandate 1, spend 1, vault accounting, and explorer evidence | Overview, Claims, and Activity require indexing and show no sample records in Live Mode; Demo Mode remains opt-in |
| Vendor wallet onboarding | Circle User-Controlled Wallet server/API and `/vendor-onboarding` UI explicitly request an `EOA` on `ARC-TESTNET`; Google/email paths use Circle's Web SDK | Disabled until real Circle sandbox credentials are configured; PIN-only identity and Circle contract execution are not implemented |
| Vendor gas seed | Optional server-side transfer of a tiny, capped Arc native USDC amount; off by default and recorded once per wallet | Manual Arc testnet gas funding is the fallback; it is separate from 6-decimal ERC-20 protocol accounting |
| Crosschain liquidity | — | Gateway and/or CCTP |
| Gas abstraction | — | Paymaster or sponsored gas, subject to Arc support/design |
| Yield on idle capital | — | USYC for qualified production capital only |
| Credit underwriting and legal enforcement | — | Outside the hackathon MVP |

## Repository structure

```text
fidra/
├── contracts/   # Foundry contracts, tests, and Arc deploy/check scripts
├── deployments/ # immutable-by-convention deployment records and explorer evidence
├── server/      # fail-closed Circle vendor onboarding and optional gas seed API
├── web/         # React/Vite landing page and responsive control-plane demo
├── docs/        # product, architecture, demo, integration, and security specs
└── shared/      # curated Foundry ABIs, Arc constants, status types, and ABI export script
```

Start with [the product specification](docs/PRODUCT_SPEC.md), then read [the architecture](docs/ARCHITECTURE.md), [Arc deployment runbook](docs/DEPLOYMENT.md), and [demo script](docs/DEMO_SCRIPT.md).

## Status

`MandateManager` and `AdvanceVault` are live on Arc Testnet and independently pass the repository's read-only configuration checker. The first live smoke claim completed end to end: a 1 USDC claim was locked, sold for 0.99 USDC, released after parent revocation, and settled for a 0.01 USDC realized spread. AdvanceVault now has 5.01 USDC of accounted and available liquidity. The default read-only frontend Live Mode shows this contract-backed evidence at `/mandates/1`, including the [settlement transaction](https://testnet.arcscan.app/tx/0xd80a21c1ae6e354bf64989c01a22487a3a62ebd3782026a9c2c0254a9d50dbe5); it does not substitute sample records when live reads fail.

The first real Circle product boundary is now implemented under `server/` and surfaced at `/vendor-onboarding`: Google or email authenticates a vendor, while wallet creation separately and explicitly targets a User-Controlled **EOA** on `ARC-TESTNET`. This distinction is required because Fidra's vendor sale path authorizes the caller through `msg.sender`; the vendor and initial payee must be the exact returned EOA. The service keeps the Circle API key and optional seed signer server-side, stores only non-secret wallet metadata on disk, and is disabled by default. MetaMask remains the sandbox fallback. Paymaster, Gateway, and CCTP remain status-only planned integrations.

Neither contract has been audited. Before freezing, publish and verify source on ArcScan if possible, independently confirm the permanent vault address, and obtain an explicit owner decision.
