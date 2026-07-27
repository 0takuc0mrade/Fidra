# Fidra V1.1 Architecture — Protocol Correctness

## 1. Design goal

A worker with a platform-certified, unexpired earnings claim can sell it to the Fidra vault for immediate USDC. The platform—never the worker—is responsible for settlement. Default draws from the platform reserve, records profit or loss against advance principal, marks the claim `Defaulted`, and pauses the platform. Accounting conservation and cash reconciliation are explicit on-chain.

## 2. System context

```text
Platform ──registers──▶ PlatformRegistry ◀──governance── Owner
    │
    ├──creates/certifies──▶ EarningsManager (claim ledger)
    │                              │
    │                       certified claim
    │                              │
Worker ──sells claim──▶ AdvanceVaultV2 ──USDC advance──▶ Worker
                              │
Platform ──settles──────▶ AdvanceVaultV2
                              │
Anyone ──triggers default──▶ AdvanceVaultV2 ──draws reserve──▶ PlatformRegistry
```

## 3. Contract architecture

### 3.1 PlatformRegistry

Standalone contract owned by Fidra governance. Stores platform metadata and reserve balances.

**State per platform:**
- `settlementWallet` — address authorized for platform operations
- `active` — boolean, governance-controlled and auto-paused on default
- `creditLimit` — maximum outstanding exposure
- `outstandingExposure` — current purchased-but-unsettled face value total
- `reserveBalance` — USDC deposited as collateral
- `advanceFeeBps` — fee deducted from face value on advance
- authorized settlement operators — optional platform-managed payers permitted to settle existing obligations

**Key operations:**
- `registerPlatform(...)` — owner creates a new platform entry
- `updatePlatform(...)` — owner modifies settlement wallet, credit limit, fee
- `pausePlatform(id)` / `unpausePlatform(id)` — owner toggles active state
- `depositReserve(id, amount)` — owner deposits USDC reserve for a platform
- `withdrawReserve(id, amount)` — owner withdraws excess reserve

**Cross-contract interface:**
- `increaseExposure(id, amount)` — called by vault during advance; reverts if limit breached
- `decreaseExposure(id, amount)` — called by vault during settlement
- `drawReserve(id, amount)` — called by vault during default; caps at available reserve
- `autoPause(id)` — called by vault on default; sets active = false
- `setSettlementOperator(id, operator, authorized)` — platform wallet manages explicit settlement delegates
- `isAuthorizedSettlementPayer(id, payer)` — true for the registered wallet or an authorized delegate

Only the authorized vault may call exposure/reserve/pause mutators.

### 3.2 EarningsManager

Standalone contract. Maintains the claim lifecycle.

**Claim state machine:**
```text
Pending ──certify──▶ Certified ──advance──▶ Advanced ──settle──▶ Settled
   │                                            │
   └──cancel──▶ Cancelled           default──▶ Defaulted
```

**State per claim:**
- `platformId`, `worker`, `faceValue`, `dueDate`, `taskHash`, `evidenceHash`
- `status` — enum: Pending, Certified, Cancelled, Advanced, Settled, Defaulted

**Key operations:**
- `createClaim(platformId, worker, faceValue, dueDate, taskHash, evidenceHash)` — platform creates
- `certifyClaim(claimId)` — platform attests earnings are final
- `cancelClaim(claimId)` — platform cancels (only if Pending)
- `markAdvanced(claimId)` — called by vault after purchasing
- `markSettled(claimId)` — called by vault after settlement
- `markDefaulted(claimId)` — called by vault after reserve-backed default resolution
- `createAndCertifyClaimsBatch(...)` — atomically creates and certifies 1–50 claims

**Access control:**
- Create/certify/cancel: the platform's settlement wallet
- markAdvanced/markSettled: only the authorized vault
- Platform must be active for create and certify
- taskHash is unique per platform (deduplication)

### 3.3 AdvanceVaultV2

The liquidity and settlement engine. Owns the advance, settlement, and default flows.

**Accounting:**
- `accountedCash` and `actualCash`
- `outstandingPrincipal` — advance principal paid for unresolved purchases
- `outstandingFaceValue` — platform contractual face obligations for unresolved purchases
- cumulative advance principal, settled face value, default recoveries, realized profit, realized loss, and contractual shortfall
- cumulative deposits and withdrawals, with derived net liquidity contribution
- `accountedAssets = accountedCash + outstandingPrincipal`
- Per-purchase record: claim identity, face value, advance principal, fee, settlement/recovery amounts, realized P&L, shortfall, timestamps, and terminal resolution status

**Key operations:**
- `depositLiquidity(amount)` — owner adds USDC
- `withdrawLiquidity(amount)` — owner removes excess USDC
- `purchaseAdvance(claimId)` — worker sells certified claim for USDC
- `settleClaim(claimId)` — registered platform payer transfers face value to vault
- `triggerDefault(claimId)` — anyone calls after due date; draws reserve, pauses platform

**Purchase flow:**
1. Verify claim is `Certified` in EarningsManager
2. Verify caller is the claim's worker
3. Verify no prior purchase for this claim
4. Look up platform in PlatformRegistry
5. Verify platform is active
6. Verify the claim is not expired and the platform reserve-presence requirement is met
7. Verify `outstandingExposure + faceValue <= creditLimit`
8. Compute advance = `faceValue - (faceValue * advanceFeeBps / 10000)`
9. Verify both `accountedCash` and `actualCash` cover the advance
10. Decrease accounted cash; increase cumulative and outstanding advance principal; increase outstanding face value
11. Call `registry.increaseExposure(platformId, faceValue)`
12. Call `earnings.markAdvanced(claimId)`
13. Transfer advance USDC to the worker

**Settlement flow:**
1. Verify purchase is outstanding and claim is `Advanced`
2. Verify caller is the platform settlement wallet or its explicit settlement operator; platform active state is irrelevant
3. Transfer and balance-delta verify the full face value
4. Decrease outstanding face value and outstanding principal
5. Increase accounted cash and settled face value
6. Realize profit as `faceValue - advanceAmount`
7. Decrease registry exposure and mark the claim `Settled`

**Default flow:**
1. Verify purchase is outstanding, claim is `Advanced`, and `block.timestamp > dueDate`
2. Draw from platform reserve (capped at reserve balance) and verify actual cash received
3. Clear outstanding face value, outstanding principal, and registry exposure
4. Increase accounted cash and cumulative default recoveries by actual recovery
5. Record `faceValue - recovery` as contractual shortfall
6. Record profit only for recovery above advance principal; otherwise record unrecovered principal as realized loss
7. Pause the platform and mark the claim `Defaulted`

## 4. Trust boundaries

| Boundary | Trusted for | Not trusted for |
|---|---|---|
| Platform settlement wallet | Creating and certifying legitimate earnings claims | Settling on time (enforced by default mechanism) |
| Worker address | Selling only their own certified claims | Anything about claim validity |
| Governance (owner) | Platform registration, limits, reserves | Seizing worker advances or manipulating claim state |
| Vault | Advancing USDC and managing settlement/default | Editing claim content or platform identity |

## 5. Accounting identities

### Per platform:
```text
outstandingExposure = sum(faceValue of Advanced claims for this platform)
outstandingExposure <= creditLimit (enforced at purchase time)
```

### Vault conservation:
```text
accountedAssets = accountedCash + outstandingPrincipal
accountedAssets = netLiquidityContributed + totalRealizedProfit - totalRealizedLoss
```

Outstanding claims use advance principal—not face value—as book cost. This is accounting conservation, not complete economic-solvency accounting. `netLiquidityContributed` is signed so realized earnings can be withdrawn without an arithmetic underflow when cumulative withdrawals exceed deposits.

### Cash reconciliation:
```text
actualCash = USDC.balanceOf(vault)
cashSurplus = max(actualCash - accountedCash, 0)
cashDeficit = max(accountedCash - actualCash, 0)
isCashReconciled = actualCash == accountedCash
```

External token transfers do not alter accounted cash. A new advance requires both actual and accounted cash.

### Cross-contract exposure:
```text
sum(registry.outstandingExposure for all platforms) = vault.outstandingFaceValue
```

## 6. Events

### PlatformRegistry
- `PlatformRegistered(platformId, settlementWallet, creditLimit, advanceFeeBps)`
- `PlatformUpdated(platformId, ...)`
- `PlatformPaused(platformId)`
- `PlatformUnpaused(platformId)`
- `ReserveDeposited(platformId, amount)`
- `ReserveWithdrawn(platformId, amount)`

### EarningsManager
- `ClaimCreated(claimId, platformId, worker, faceValue, dueDate, taskHash)`
- `ClaimCertified(claimId, platformId)`
- `ClaimCancelled(claimId, platformId)`
- `ClaimAdvanced(claimId)`
- `ClaimSettled(claimId)`
- `ClaimDefaulted(claimId)`

### AdvanceVaultV2
- `LiquidityDeposited(depositor, amount)`
- `LiquidityWithdrawn(withdrawer, amount)`
- `AdvancePurchased(claimId, platformId, worker, faceValue, advanceAmount, fee)`
- `ClaimSettled(claimId, platformId, faceValue, realizedProfit)`
- `DefaultTriggered(claimId, platformId, reserveRecovery, realizedProfit, realizedLoss, contractualShortfall)`

## 7. Upgrade and migration

v1 contracts are independent of v0. Both can coexist on the same chain. No migration or data porting is needed. v0 contracts (`MandateManager`, `AdvanceVault`) remain deployed and functional for any existing obligations.

## 8. Non-functional requirements

- Solidity 0.8.24, OpenZeppelin contracts
- SafeERC20 for all token transfers
- ReentrancyGuard on all external USDC-moving functions
- Checks-effects-interactions pattern throughout
- Balance-delta validation on deposits
- All amounts in 6-decimal USDC units
