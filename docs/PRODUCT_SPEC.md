# Fidra Product Specification

## 1. Product statement

Fidra turns approved-but-unreleased AI-agent purchase claims into instant USDC for vendors.

It combines controlled purchase mandates with a narrow receivables market. The business pre-funds and constrains agent activity; the vendor receives a fully reserved claim once a request is approved and locked; and `AdvanceVault` can buy that claim for immediate liquidity.

## 2. Product boundary

Fidra is:

- a mandate-backed purchasing protocol for AI agents;
- a source of irrevocable, assignable onchain receivables;
- an instant-USDC advance mechanism for eligible locked claims; and
- a transparent settlement and audit trail.

Fidra is not:

- a general-purpose wallet or payment router;
- an invoice creation or accounts-receivable suite;
- a marketplace for goods or vendors;
- a delivery oracle or dispute-resolution court;
- unsecured lending to agents or vendors; or
- a promise that offchain evidence is true.

## 3. Users and jobs

### Business

Funds USDC, defines a bounded purchase mandate, reviews requests, locks approved claims, and releases completed claims. It needs agent automation without losing budget control or creating ambiguous liabilities.

### AI agent

Requests a purchase for a specific vendor, amount, and evidence hash within a mandate. It never receives unrestricted custody of the full mandate balance.

### Vendor

Supplies the product or service, receives a locked claim, and chooses either full payment later or discounted USDC now.

### AdvanceVault liquidity provider/operator

Supplies the liquidity used to buy locked claims and earns the difference between advance price and released face value. It accepts smart-contract, operational, timing, concentration, and evidence risks even though face value is fully reserved.

## 4. Core objects

### Mandate

| Field | Meaning |
| --- | --- |
| `business` | Owner and funder |
| `agent` | Address authorized to submit requests |
| `token` | Fixed Arc ERC-20 USDC interface |
| `deposited` | Total USDC funded into the mandate |
| `available` | Funded amount not committed to locked claims |
| `reserved` | Sum of face amounts for unreleased locked claims |
| `expiresAt` | Last timestamp at which a new request may be locked |
| `defaultReleaseDelaySeconds` | Bounded delay added at lock to produce the claim's settlement deadline |
| `status` | `Active`, `Revoked`, or `Expired` as derived/represented |
| policy fields | Optional request cap, vendor allowlist, category/metadata commitments, or total limit |

The accounting identity is:

```text
escrowed mandate USDC = available + reserved
reserved = sum(faceAmount of all unreleased Locked claims)
```

Transfers out on reclaim reduce `available`; transfers out on release reduce `reserved`.

### Purchase claim

| Field | Meaning |
| --- | --- |
| `mandateId` | Parent mandate |
| `vendor` | Immutable supplier identity for audit |
| `payee` | Mutable address entitled to settlement |
| `faceAmount` | Immutable 6-decimal ERC-20 USDC amount |
| `proofHash` | Immutable commitment to offchain receipt/evidence |
| `releaseDueAt` | Immutable permissionless settlement timestamp fixed at lock |
| `state` | `Requested`, `Locked`, `Released`, or terminal pre-lock rejection/cancellation |

`vendor` and initial `payee` are the same. Selling the receivable changes only `payee`.

### AdvanceVault

A USDC liquidity pool that quotes or applies an advance price, transfers that amount to the current payee, and atomically becomes the new payee. Its assets are liquid USDC plus acquired, unreleased claims. The initial vault should not accept arbitrary invoices or non-locked requests.

## 5. Lifecycle

### 5.1 Create and fund mandate

The business creates an active mandate with an agent, limits, and expiry, then deposits Arc ERC-20 USDC. Native gas balances are irrelevant to mandate accounting.

### 5.2 Submit request

The authorized agent supplies a vendor, face amount, `proofHash`, and request metadata. Submission does not reserve funds and does not create a financeable receivable.

### 5.3 Review and lock

The business approves by locking. Lock must atomically verify that:

- the caller is authorized;
- the mandate is active and `block.timestamp < expiresAt`;
- the request satisfies policy and has not already been finalized;
- `faceAmount > 0` and sufficient `available` balance exists; and
- a nonzero vendor, payee, and required evidence hash are present;
- the mandate has a valid, bounded default release delay.

Lock subtracts face value from `available`, adds it to `reserved`, fixes the settlement deadline, and moves the claim to `Locked`. That transition is the point of no return.

### 5.4 Hold or sell

The vendor can hold the claim. Alternatively, while it is locked and unreleased, it may call `AdvanceVault` with a minimum acceptable advance and quote deadline. Purchase is atomic: either the seller receives at least that minimum before the deadline and the vault becomes payee, or neither occurs.

### 5.5 Release

The business or approver may release a claim early. Anyone can trigger the same deterministic release path at or after `releaseDueAt`. Release decreases the parent mandate's `reserved`, transfers face value to the claim's current `payee`, and permanently marks the claim `Released` regardless of parent mandate revocation or expiry.

### 5.6 Revoke, expire, and reclaim

Revocation stops new locks but does not alter existing locked claims. Expiry also stops new locks. The business can reclaim only `available` USDC after the protocol's reclaim conditions are met. `reserved` is never reclaimable; it leaves only through claim release.

## 6. Functional requirements

### Mandates

- Only the business can create, fund, revoke, and reclaim its mandate.
- Funding uses safe ERC-20 transfer semantics and balance-delta checks where appropriate.
- A revoked or expired mandate cannot create another locked liability.
- Reclaim cannot reduce contract balance below aggregate reserved obligations.

### Requests and claims

- Only the named agent can submit under the mandate.
- A submitted request has no guarantee of payment until locked.
- Lock is permitted only during the active window and only against available funds.
- Locked economic fields cannot be changed.
- Assignment changes payee, not vendor or proof.
- Release is single-use and always reads the current payee.

### Vault

- The vault buys only `Locked`, unreleased claims from their current payee.
- The local MVP purchase verifies canonical state, current payee, face value, fixed-discount advance amount, unique acquisition, available accounted liquidity, and authorized assignment.
- Advance and payee assignment occur atomically.
- The vault cannot purchase its own claim twice.
- Liquidity accounting distinguishes liquid USDC from claim face value and acquisition cost.
- MVP pricing may use a transparent fixed discount; it must not be described as risk-based underwriting.
- Signatures, quote nonces, withdrawals, and LP accounting are production hardening rather than current capabilities.

## 7. Non-functional requirements

- Use only the Arc ERC-20 USDC interface and 6-decimal integer units.
- Emit enough events to reconstruct mandate balances and the full claim chain of title.
- Use checks-effects-interactions, reentrancy protection where needed, and safe transfers.
- Provide invariant and stateful fuzz tests for solvency, lifecycle, and authorization.
- Keep admin powers minimal, explicit, timelocked in production, and unable to seize locked reserves.
- Make UI labels distinguish `Requested` from `Locked` without ambiguity.

## 8. MVP scope and honesty

### Intended real, live demo

- Arc Testnet contracts funded with test USDC through the official ERC-20 interface.
- Mandate create/fund, agent request, business lock, vendor advance, payee assignment, and release.
- Visible transaction hashes, contract reads, state transitions, reserve accounting, and vault spread.
- Tests demonstrating that revocation and reclaim cannot impair a locked claim.
- A fail-closed Circle User-Controlled Wallet onboarding path that, when real sandbox credentials are configured, authenticates a vendor and requests an explicit EOA on `ARC-TESTNET`.

### Mocked or deliberately excluded

- Real-world procurement integration and delivery verification.
- Production identity, compliance, legal assignment, collections, and dispute handling.
- Dynamic underwriting and market-based discount pricing.
- Circle wallet contract-call execution; vendor wallet creation is implemented, while `buyClaim`, `submitProof`, and agent `requestSpend` remain honest stubs.
- Gateway, CCTP, and Paymaster beyond explicit planned/status-only cards.
- USYC allocation, yield, and redemption.
- Production liquidity-provider deposits and withdrawals unless separately designed and tested.

At the current repository milestone, `MandateManager` and the minimal operator-funded `AdvanceVault` are implemented, unit-tested locally, and deployed on Arc Testnet. The authorized vault has a fixed 100 bps discount and remains deliberately unfrozen. Its first 1 USDC claim completed the full request, proof, approval, lock, 0.99 USDC advance, parent revocation, release, and settlement flow, producing 0.01 USDC realized spread and 5.01 USDC available liquidity. A responsive React/Vite frontend has explicit mock/live adapters; Live Mode reads deployment and mandate state, while actions remain simulated in Demo Mode and rejected as unimplemented in Live Mode.

The vendor onboarding MVP adds a server-side Circle User-Controlled Wallet integration and `/vendor-onboarding`. With real sandbox credentials, Google or email authenticates the vendor and a separate Circle challenge explicitly creates/retrieves an `EOA` on `ARC-TESTNET`. The exact returned address is the only valid Circle Vendor Wallet vendor/payee because the current contracts authorize by `msg.sender`. The integration is disabled by default, keeps secrets out of the browser, and never fakes success. Optional testnet gas seeding is capped, off by default, and transfers Arc native USDC only. MetaMask remains the fallback. Vendor `buyClaim` is a real user-approved Circle contract-execution call, validated server-side against live Arc state and confirmed only against a real receipt; vendor `submitProof`, agent `requestSpend`, Gateway, CCTP, Paymaster, and USYC remain stubbed, planned, or excluded as labeled.

## 9. Success criteria

The demo succeeds when a reviewer can answer all five questions from onchain state:

1. What was the agent allowed to request?
2. Which claim became irrevocable, and when?
3. How much USDC is reserved against it?
4. Who owns the right to payment now?
5. Did the vendor receive an advance and the vault later receive face value?

## 10. Open product decisions

- Who may approve and early-release besides the business (role, multisig, or policy module)?
- What production default release delay should each mandate class use within the implemented one-year maximum?
- Does the first vault permit only one assignment to Fidra, or general secondary transfers?
- What fixed discount and maximum tenor are appropriate for the demo?
- Which vendor allowlist or per-request limits are essential in v1?
- What legal terms connect onchain payee assignment to real-world receivable assignment?
