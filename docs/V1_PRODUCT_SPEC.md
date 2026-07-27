# Fidra V1.1 Product Specification — Embedded Instant Payouts

## 1. Product statement

Fidra V1.1 enables irregular-work platforms to offer instant USDC payouts to their workers. A platform certifies what a worker has earned; the worker sells that certified claim to a Fidra vault for immediate liquidity at a small fee; the platform settles the full face value on its normal payout schedule.

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

The v0 contracts (`MandateManager` and `AdvanceVault`) remain deployed and unmodified as legacy testnet evidence. They represent the original vendor purchase-receivable financing model. V1.1 is a clean protocol pivot; it does not upgrade, inherit from, or reference v0 contracts.

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
| `status` | `Pending`, `Certified`, `Cancelled`, `Advanced`, `Settled`, `Defaulted` |

### Vault accounting (in AdvanceVaultV2)

| Metric | Meaning |
|---|---|
| `accountedCash` | Internal liquid USDC balance available for advances or withdrawal |
| `actualCash` | `USDC.balanceOf(vault)`; may differ from accounted cash after an external transfer or token-balance impairment |
| `totalAdvancePrincipal` | Cumulative USDC principal paid to workers |
| `outstandingPrincipal` | Book cost of purchased unresolved claims: the advance principal actually paid |
| `outstandingFaceValue` | Contractual face value owed by platforms for purchased unresolved claims |
| `totalSettledFaceValue` | Cumulative face value actually paid by authorized platform payers |
| `totalDefaultRecoveries` | Cumulative USDC recovered from platform reserves |
| `totalRealizedProfit` | Cumulative positive P&L measured against advance principal |
| `totalRealizedLoss` | Cumulative advance principal not recovered on default |
| `totalContractualShortfall` | Cumulative face value not recovered on default |
| `totalLiquidityDeposited` | Cumulative owner liquidity deposits |
| `totalLiquidityWithdrawn` | Cumulative owner liquidity withdrawals |
| `netLiquidityContributed` | Signed deposits minus withdrawals; may be negative when realized earnings are withdrawn |
| `accountedAssets` | `accountedCash + outstandingPrincipal` |

The conservation relationship is:

```text
accountedAssets
=
netLiquidityContributed
+ totalRealizedProfit
- totalRealizedLoss
```

Outstanding claims are booked at the advance principal Fidra paid, never at face value. These values establish accounting conservation and cash reconciliation. V1.1 does not model LP shares or withdrawal liabilities and therefore does not claim to calculate complete economic solvency.

`netLiquidityContributed` is signed because withdrawals may legitimately exceed
cumulative deposits after the vault realizes profit. The other accounting totals
are non-negative cumulative or point-in-time USDC amounts.

Cash reconciliation is explicit:

```text
cashSurplus = max(actualCash - accountedCash, 0)
cashDeficit = max(accountedCash - actualCash, 0)
isCashReconciled = actualCash == accountedCash
```

External transfers may create a visible surplus but never increase `accountedCash`. A cash deficit remains visible. A new advance requires both `accountedCash` and `actualCash` to cover its advance amount.

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

The worker (and only the worker) sells their certified, unexpired claim to the vault. The vault verifies the worker address, single-purchase rule, platform active state, reserve-presence requirement, credit headroom, and both accounted and actual cash. The worker receives `faceValue - fee` in USDC. At this purchase—and not at certification—the platform's exposure and the vault's outstanding face value increase by face value, while outstanding principal increases by the advance paid.

### 6.6 Platform settlement

Only the registered platform settlement wallet or an explicitly authorized settlement operator may settle a purchased claim. The worker cannot settle the platform's obligation. A paused platform remains allowed to settle existing claims.

Successful settlement transfers the full face value, clears face-value exposure and advance principal, increases accounted cash and `totalSettledFaceValue`, and realizes `faceValue - advanceAmount` as profit. Principal repayment is not profit.

### 6.7 Default and reserve draw

If an advanced claim passes its due date without settlement, anyone may trigger a one-time default resolution. The vault draws up to the claim face value from the platform reserve and records the amount actually received.

Default clears the full contractual face exposure and full outstanding advance principal, pauses the platform, and marks the claim `Defaulted` even when reserve recovery equals face value. It never marks the claim `Settled`.

For reserve recovery `R`, face value `F`, and advance principal `A`:

```text
contractualShortfall = F - R

if R >= A:
    realizedProfit = R - A
    realizedLoss = 0
else:
    realizedProfit = 0
    realizedLoss = A - R
```

The worker's completed payout is never reduced, reversed, or clawed back.

## 7. Invariants

1. **No advance before certification.** A claim must be `Certified` before the vault will purchase it.
2. **Certified claims are immutable.** No actor can revoke, cancel, or edit a certified claim.
3. **Workers never owe the vault.** The advance is a sale, not a loan. The platform is the obligor.
4. **Platform exposure cannot exceed credit limit.** Each advance increases exposure; the vault rejects purchases that would breach the limit.
5. **No expired purchase.** A claim with `dueDate <= block.timestamp` cannot be purchased.
6. **No double purchase.** A claim can be advanced exactly once.
7. **Single terminal resolution.** A purchased claim can be settled or default-resolved exactly once and cannot leave its terminal state.
8. **Platform-only repayment.** Only the settlement wallet or an authorized operator may settle; paused platforms may repay.
9. **Exposure is purchase-time risk.** Certification consumes no credit. Purchase increases registry exposure and vault outstanding face value exactly once; settlement/default decreases each exactly once.
10. **Principal-book accounting.** `accountedAssets = accountedCash + outstandingPrincipal`.
11. **Conservation.** `accountedAssets = netLiquidityContributed + totalRealizedProfit - totalRealizedLoss`.
12. **Cash reconciliation.** Actual cash surplus or deficit is exposed and never masked.
13. **Reserve reconciliation.** Accounted platform reserves match reserve-token custody absent visible external-token surplus/deficit.
14. **Default cannot reduce a worker's completed payout.** Once a worker receives an advance, that USDC is theirs regardless of platform default.
15. **No profit without principal recovery.** Default profit is recorded only after recovered reserve cash covers advance principal.

## 8. Access control summary

| Action | Authorized caller |
|---|---|
| Register/update/pause platform | Owner (governance) |
| Deposit/withdraw platform reserve | Owner (governance) |
| Create claim | Registered active platform |
| Certify claim | The same platform that created it |
| Cancel claim | The same platform that created it (pre-certification only) |
| Purchase advance | The worker named in the certified claim |
| Authorize settlement operator | Platform settlement wallet |
| Settle claim | Platform settlement wallet or its explicitly authorized operator |
| Trigger default | Anyone (permissionless after due date) |
| Deposit/withdraw vault liquidity | Owner (vault operator) |

## 9. Batch support

Single-claim creation and certification remain supported. `createAndCertifyClaimsBatch` atomically creates and certifies up to 50 claims for one active platform. Empty, oversized, mismatched, duplicate-task, or otherwise invalid batches revert completely. Each successful item emits its own creation and certification events. Batch advance purchases remain out of scope.

## 10. Excluded from this milestone

- Frontend or UI
- Circle User-Controlled Wallet integration
- Gateway, CCTP, Paymaster, USYC
- Dynamic underwriting or risk-based pricing
- LP shares, yield distribution, or withdrawal queues
- Cross-chain settlement
