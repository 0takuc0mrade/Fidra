# Fidra v1 Architecture — Embedded Instant Payouts

## 1. Design goal

A worker with a platform-certified earnings claim can sell it to the Fidra vault for immediate USDC. The platform — never the worker — is responsible for settlement. Default draws from the platform's reserve and pauses the platform. All accounting is transparent, internally consistent, and enforced on-chain.

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

Only the authorized vault may call exposure/reserve/pause mutators.

### 3.2 EarningsManager

Standalone contract. Maintains the claim lifecycle.

**Claim state machine:**
```text
Pending ──certify──▶ Certified ──advance──▶ Advanced ──settle──▶ Settled
   │                                            │
   └──cancel──▶ Cancelled            default──▶ Settled (via reserve)
```

**State per claim:**
- `platformId`, `worker`, `faceValue`, `dueDate`, `taskHash`, `evidenceHash`
- `status` — enum: Pending, Certified, Cancelled, Advanced, Settled

**Key operations:**
- `createClaim(platformId, worker, faceValue, dueDate, taskHash, evidenceHash)` — platform creates
- `certifyClaim(claimId)` — platform attests earnings are final
- `cancelClaim(claimId)` — platform cancels (only if Pending)
- `markAdvanced(claimId)` — called by vault after purchasing
- `markSettled(claimId)` — called by vault after settlement

**Access control:**
- Create/certify/cancel: the platform's settlement wallet
- markAdvanced/markSettled: only the authorized vault
- Platform must be active for create and certify
- taskHash is unique per platform (deduplication)

### 3.3 AdvanceVaultV2

The liquidity and settlement engine. Owns the advance, settlement, and default flows.

**Accounting:**
- `availableLiquidity` — accounted liquid USDC for new advances
- `totalAdvanced` — cumulative USDC paid to workers
- `totalOutstanding` — sum of unsettled purchased claim face values
- `totalSettled` — cumulative face value received
- `totalRealizedSpread` — cumulative fee income
- Per-purchase record: claimId, worker, faceValue, advanceAmount, fee, timestamp, settled flag

**Key operations:**
- `depositLiquidity(amount)` — owner adds USDC
- `withdrawLiquidity(amount)` — owner removes excess USDC
- `purchaseAdvance(claimId)` — worker sells certified claim for USDC
- `settleClaim(claimId)` — platform (or anyone) pays face value to vault
- `triggerDefault(claimId)` — anyone calls after due date; draws reserve, pauses platform

**Purchase flow:**
1. Verify claim is `Certified` in EarningsManager
2. Verify caller is the claim's worker
3. Verify no prior purchase for this claim
4. Look up platform in PlatformRegistry
5. Verify platform is active
6. Verify `outstandingExposure + faceValue <= creditLimit`
7. Compute advance = `faceValue - (faceValue * advanceFeeBps / 10000)`
8. Verify sufficient `availableLiquidity`
9. Record purchase, update accounting
10. Call `registry.increaseExposure(platformId, faceValue)`
11. Call `earnings.markAdvanced(claimId)`
12. Transfer advance USDC to worker

**Settlement flow:**
1. Verify claim is `Advanced`
2. Transfer face value from caller to vault
3. Update accounting (reduce outstanding, increase settled/spread)
4. Call `registry.decreaseExposure(platformId, faceValue)`
5. Call `earnings.markSettled(claimId)`

**Default flow:**
1. Verify claim is `Advanced` and `block.timestamp > dueDate`
2. Draw from platform reserve (capped at reserve balance)
3. Update accounting
4. Call `registry.autoPause(platformId)`
5. Call `earnings.markSettled(claimId)`

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

### Vault global:
```text
USDC balance of vault >= availableLiquidity
totalAdvanced = sum(all advance amounts ever paid)
totalOutstanding = sum(faceValue of unsettled purchased claims)
totalSettled = sum(faceValue of settled claims)
totalRealizedSpread = sum(faceValue - advanceAmount) for settled claims
```

### Cross-contract:
```text
sum(registry.outstandingExposure for all platforms) = vault.totalOutstanding
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

### AdvanceVaultV2
- `LiquidityDeposited(depositor, amount)`
- `LiquidityWithdrawn(withdrawer, amount)`
- `AdvancePurchased(claimId, platformId, worker, faceValue, advanceAmount, fee)`
- `ClaimSettled(claimId, platformId, faceValue, spread)`
- `DefaultTriggered(claimId, platformId, reserveDrawn, shortfall)`

## 7. Upgrade and migration

v1 contracts are independent of v0. Both can coexist on the same chain. No migration or data porting is needed. v0 contracts (`MandateManager`, `AdvanceVault`) remain deployed and functional for any existing obligations.

## 8. Non-functional requirements

- Solidity 0.8.24, OpenZeppelin contracts
- SafeERC20 for all token transfers
- ReentrancyGuard on all external USDC-moving functions
- Checks-effects-interactions pattern throughout
- Balance-delta validation on deposits
- All amounts in 6-decimal USDC units
