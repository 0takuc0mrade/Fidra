# Fidra v1 Product Specification — Embedded Instant Payouts

## 1. Product statement

Fidra v1 enables irregular-work platforms to offer instant USDC payouts to their workers. A platform certifies what a worker has earned; the worker sells that certified claim to a Fidra vault for immediate liquidity at a small fee; the platform settles the full face value on the due date.

The protocol shifts credit risk from workers to platforms. Workers never owe the vault. Platforms are responsible for settlement.

## 2. Product boundary

Fidra v1 is:

- a registry of approved payout platforms with credit limits and reserves;
- a certified-earnings claim ledger where platforms attest to worker compensation;
- an instant-advance vault that purchases certified claims for discounted USDC; and
- a settlement and default-management system with platform accountability.

Fidra v1 is not:

- a payroll system or employment contract;
- a lending protocol where workers borrow against future earnings;
- a marketplace, task router, or dispute-resolution court;
- a credit-scoring or underwriting engine; or
- a frontend, Circle integration, or cross-chain bridge (this milestone).

## 3. Relationship to Fidra v0

The v0 contracts (`MandateManager` and `AdvanceVault`) remain deployed and unmodified. They represent the original vendor purchase-receivable financing model. v1 is a clean protocol pivot; it does not upgrade, inherit from, or reference v0 contracts.

## 4. Users and jobs

### Platform operator

An approved gig/freelance/task platform (e.g., delivery, rideshare, freelance marketplace). Registers with Fidra governance, posts a USDC reserve, receives a credit limit, and certifies worker earnings. Responsible for settling claims by their due dates.

### Worker

An individual who performed work on a registered platform. After the platform certifies their earnings, the worker may sell the claim to the vault for immediate USDC minus a fee. The worker never owes anything to the vault.

### Vault / protocol operator

Supplies USDC liquidity to the vault. Earns the advance fee spread. Bears smart-contract and platform-default risk. Manages protocol parameters.

### Fidra governance (owner)

Registers platforms, sets credit limits, manages reserves, and pauses defaulting platforms.

## 5. Core objects

### Platform (in PlatformRegistry)

| Field | Meaning |
|---|---|
| `settlementWallet` | Address that receives settlement calls and where platform funds flow |
| `active` | Whether the platform can certify new claims and workers can take advances |
| `creditLimit` | Maximum total outstanding exposure allowed for this platform |
| `outstandingExposure` | Current sum of purchased-but-unsettled claim face values |
| `reserveBalance` | USDC reserve deposited by the platform as collateral |
| `advanceFeeBps` | Fee in basis points deducted from face value when a worker takes an advance |

### Claim (in EarningsManager)

| Field | Meaning |
|---|---|
| `platformId` | Registered platform that certified the earnings |
| `worker` | Address of the worker who earned the compensation |
| `faceValue` | Gross USDC amount the worker earned |
| `dueDate` | Timestamp by which the platform must settle |
| `taskHash` | Hash of the external task identifier for deduplication |
| `evidenceHash` | Hash of supporting evidence (timesheet, delivery proof, etc.) |
| `status` | `Pending`, `Certified`, `Cancelled`, `Advanced`, `Settled` |

### Vault accounting (in AdvanceVaultV2)

| Metric | Meaning |
|---|---|
| `availableLiquidity` | USDC ready to fund new advances |
| `totalAdvanced` | Cumulative USDC paid out to workers |
| `totalOutstanding` | Sum of face values of purchased, unsettled claims |
| `totalSettled` | Cumulative face value received through settlement |
| `totalRealizedSpread` | Cumulative fee revenue (face value minus advance amount) |

## 6. Lifecycle

### 6.1 Platform onboarding

Governance registers a platform with a settlement wallet, credit limit, and advance fee. The platform deposits a USDC reserve. The platform is marked active.

### 6.2 Claim creation

The platform creates a claim for a specific worker address, face value, due date, task hash, and evidence hash. The claim starts in `Pending` status.

### 6.3 Claim certification

The platform certifies the claim, attesting that the worker has completed the work and is owed the face value. Certification is irreversible — the claim cannot be cancelled or edited afterward. Only an authorized, active platform may certify.

### 6.4 Claim cancellation (pre-certification only)

The platform may cancel a `Pending` claim. Once certified, cancellation is forbidden.

### 6.5 Instant advance

The worker (and only the worker) sells their certified claim to the vault. The vault verifies the claim is certified, the worker address matches, the claim hasn't been purchased before, and the platform has sufficient credit headroom. The worker receives `faceValue - fee` in USDC. The platform's outstanding exposure increases by the face value.

### 6.6 Platform settlement

The platform settles a purchased claim by transferring the full face value to the vault. This reduces the platform's outstanding exposure.

### 6.7 Default and reserve draw

If a claim passes its due date without settlement, anyone may trigger a default. The vault draws from the platform's reserve to cover the face value. If the reserve is insufficient for full coverage, whatever is available is drawn. A default automatically pauses the platform, preventing new certifications and advances.

## 7. Invariants

1. **No advance before certification.** A claim must be `Certified` before the vault will purchase it.
2. **Certified claims are immutable.** No actor can revoke, cancel, or edit a certified claim.
3. **Workers never owe the vault.** The advance is a sale, not a loan. The platform is the obligor.
4. **Platform exposure cannot exceed credit limit.** Each advance increases exposure; the vault rejects purchases that would breach the limit.
5. **No double purchase.** A claim can be advanced exactly once.
6. **No double settlement.** A claim can be settled exactly once.
7. **Default cannot reduce a worker's completed payout.** Once a worker receives an advance, that USDC is theirs regardless of platform default.
8. **Vault solvency.** `availableLiquidity + totalOutstanding >= 0` at every transaction boundary. The vault's USDC balance must always cover its `availableLiquidity` accounting.

## 8. Access control summary

| Action | Authorized caller |
|---|---|
| Register/update/pause platform | Owner (governance) |
| Deposit/withdraw platform reserve | Owner (governance) |
| Create claim | Registered active platform |
| Certify claim | The same platform that created it |
| Cancel claim | The same platform that created it (pre-certification only) |
| Purchase advance | The worker named in the certified claim |
| Settle claim | Anyone (but requires platform's USDC transfer) |
| Trigger default | Anyone (permissionless after due date) |
| Deposit/withdraw vault liquidity | Owner (vault operator) |

## 9. Batch support

The initial implementation supports single-claim creation and certification. The API is designed so batch variants (`createClaimBatch`, `certifyClaimBatch`) can be added without changing the underlying claim structure or state machine.

## 10. Excluded from this milestone

- Frontend or UI
- Circle User-Controlled Wallet integration
- Gateway, CCTP, Paymaster, USYC
- Dynamic underwriting or risk-based pricing
- LP shares, yield distribution, or withdrawal queues
- Cross-chain settlement
