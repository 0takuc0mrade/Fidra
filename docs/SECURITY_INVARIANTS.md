# Fidra Security Invariants

## 1. Security objective

Fidra is safe only if every `Locked` claim remains fully payable to exactly one current payee, regardless of what happens to its parent mandate afterward. Authorization controls before lock and solvency controls after lock are equally important.

This is a design specification, not an audit.

## 2. Product-critical invariants

### S1 — Lock eligibility

A request can transition to `Locked` only if its parent mandate is active, unrevoked, unexpired, policy-compliant, and sufficiently funded at the instant of lock.

### S2 — Full reservation

Lock atomically reserves exactly the claim's immutable face amount in Arc ERC-20 USDC. A partially reserved claim cannot exist.

### S3 — Post-lock irrevocability

No actor—including the business, agent, vault operator, or admin—can cancel, reduce, reopen, or invalidate a locked claim. Parent mandate revocation and expiry have no effect on assignment or release eligibility.

### S4 — Reserved funds cannot be reclaimed

Business reclaim is bounded by the mandate's `available` balance. It never transfers from `reserved`, and it never relies on the contract's raw token balance. For every mandate:

```text
reserved = sum(unreleased locked claim face amounts)
```

### S5 — Global solvency

At every successful transaction boundary:

```text
MandateManager ERC-20 USDC balance
  >= sum(all available balances) + sum(all reserved balances)
```

Unexpected token transfers may produce surplus but cannot authorize withdrawals or mask an internal deficit.

### S6 — Locked-only financing

`AdvanceVault` buys only a claim whose canonical contract state is `Locked` and unreleased. A request, rejected claim, released claim, offchain invoice, UI record, or signature without canonical state is ineligible.

### S7 — Atomic sale and assignment

A vault purchase either transfers an advance satisfying the seller's minimum to the current payee and makes the vault the new payee in one atomic transaction, or does neither. Execution after the seller's deadline reverts, and the privileged advance-assignment path can be used only once per claim.

The Manager exposes two intentionally different assignment paths:

- direct assignment is callable only by the claim's current payee; and
- advance assignment is callable only by the Manager's configured `authorizedAdvanceVault` and must name the exact current payee the vault expects to be selling.

Both paths require canonical state `Locked`, reject a zero new payee, change only `payee`, and immediately remove assignment authority from the former payee.

### S8 — Vendor identity is immutable

`vendor` records who supplied the purchase for audit and never changes after request/lock according to the final schema. Assignment must not rewrite history.

### S9 — Payee is the claim ownership field

`payee` records who currently owns settlement rights. It begins as the vendor and may change only through an authorized assignment path. UI and events must show both fields.

### S10 — Release pays current payee

Release resolves the payee from canonical claim state at execution time, transfers exact face amount to that address, reduces reserve exactly once, and marks the claim terminal. It must not use a cached original-vendor address.

### S11 — Settlement liveness

Each mandate fixes a bounded `defaultReleaseDelaySeconds`, and lock stamps immutable `releaseDueAt`. The business or approver may release early; any caller may execute the identical release path at or after the deadline. Revocation, expiry, assignment, UI/API failure, and business inactivity do not block settlement.

### S12 — Single settlement and chain of title

A claim cannot be purchased twice by replay, assigned by a former payee, or released twice. Every assignment event links the same claim ID, previous payee, new payee, and consideration context.

### S13 — ERC-20-only accounting

All principal is measured and transferred through `0x3600000000000000000000000000000000000000` using 6-decimal units. Native gas USDC and `msg.value` do not create mandate credit, satisfy reserves, or settle claims.

## 3. `proofHash` truth boundary

`proofHash` is an audit/receipt gate. It can establish that a specific byte sequence, document, URI commitment, or evidence bundle existed and was referenced when the request was reviewed. It can help detect later alteration.

It does not automatically establish:

- that goods were delivered;
- that a receipt or vendor is authentic;
- that quality or quantity is correct;
- that an agent's description is truthful;
- that the business legally owes the amount offchain; or
- that a court would enforce the assignment.

The business approval step owns this real-world judgment. The contract guarantees the onchain consequence of lock, not the truth of the underlying evidence. The UI must use language such as “evidence committed” or “receipt hash recorded,” never “delivery verified” unless an independently specified verifier exists.

## 4. Authorization invariants

- Only the mandate business (or a narrowly defined approval role) can lock, revoke, and reclaim.
- Only the named agent can submit a request for that mandate.
- Direct assignment may be initiated only by the current payee.
- Atomic vault assignment may be initiated only by the single owner-configured vault, must match the current payee supplied by that vault, may assign only to the calling vault, and may occur only once per claim.
- Before freeze, the authorized-vault setter is owner-only, one-step, rejects zero, and emits the old and new vault. The owner can freeze only a configured nonzero vault, only once. Freeze is irreversible, emits the frozen address, prevents every later setter call, and does not disable assignments by the frozen vault.
- Rotation cannot reacquire an already-financed claim or alter its current payee. A frozen but malicious vault could still redirect a not-yet-financed locked claim to itself without seller consent at the Manager boundary. Production should use seller-signed permits and should place pre-freeze configuration behind carefully verified deployment, preferably controlled by a multisig or timelock.
- The minimal local vault uses an immutable fixed discount and a direct current-payee transaction with caller-supplied minimum proceeds and deadline. Signature-based quotes and nonces remain out of scope.
- Administrative pause, if any, must be asymmetric: it may stop new requests/locks/purchases, but must not indefinitely block release of existing locked claims.
- Upgrade or rescue powers must not permit seizure of available or reserved user principal. Prefer non-upgradeable MVP contracts.

## 5. State-transition invariants

Allowed transitions:

```text
Requested -> Approved
Requested -> Rejected
Approved  -> Locked
Approved  -> Rejected
Locked    -> Locked (authorized payee assignment only)
Locked    -> Released
```

All other transitions revert. In particular:

- `Rejected -> Locked` is forbidden;
- `Released -> any` is forbidden;
- `Locked -> Rejected/Approved/Requested` is forbidden; and
- mandate `Revoked/Expired -> new Locked claim` is forbidden.

## 6. Accounting and token hazards

### Decimal confusion

Arc native gas USDC may be represented with 18-decimal behavior while ERC-20 USDC uses 6 decimals. Separate amount types/configuration and assert token decimals. A 12-order-of-magnitude mistake must fail validation rather than create a huge request.

### Transfer behavior

Use safe ERC-20 wrappers. Update state before external interaction while relying on transaction reversion for failed transfers. Mandate and vault deposits validate balance deltas so internal credit matches tokens actually received; the local suite confirms that fee-on-transfer underfunding is rejected.

### Reentrancy

Release, reclaim, funding, and atomic vault purchase cross token/contract boundaries. Apply checks-effects-interactions and targeted reentrancy guards. Test malicious recipients, callbacks, and a hostile token locally even though canonical USDC is the production target.

### Vault-to-Manager caller identity

When a seller calls `AdvanceVault.buyClaim`, the subsequent call into `MandateManager` has `msg.sender == AdvanceVault`, not the seller. Reusing the direct current-payee assignment function would therefore fail, or weakening it would let arbitrary callers steal claims. The separate `assignClaimForAdvance` path preserves atomicity while requiring both an authorized vault caller and an exact expected-current-payee match at the authoritative Manager write.

### One-way vault freeze

The hackathon MVP closes address-rotation risk by freezing the verified `AdvanceVault` after configuration. This prevents a compromised owner from replacing it later, but it cannot repair a wrong address and does not prove that the frozen vault code is safe. Deployment must verify the vault bytecode, constructor parameters, Manager address, token address, and ownership before freezing. This control is focused hardening, not a full audit or a substitute for seller authorization signatures.

### Rounding

Advance pricing must specify rounding direction. Round proceeds conservatively and require `advanceAmount < faceAmount` when a positive discount is intended. Never allow rounding to mint accounting value or under-reserve face amount.

### Donation/surplus

Direct ERC-20 transfers to a contract must not be credited to a mandate or LP automatically. Define a constrained surplus-recovery policy that proves withdrawals cannot touch accounted balances.

## 7. Vault-specific risks

Full claim reservation removes business credit risk inside the contract but does not eliminate:

- contract bugs or privileged-key compromise;
- stablecoin freeze, blacklist, or depeg risk;
- timing and liquidity mismatch;
- evidence fraud approved by the business;
- legal mismatch between onchain assignment and offchain rights;
- concentration in one business, agent, vendor, or maturity bucket;
- front-running or stale quote execution; and
- operational failure of keepers/indexers.

The local vault mitigates eligibility and replay through canonical locked-only checks, current-payee checks, claim-level single-use advance assignment, atomic assignment, minimum-proceeds and deadline protection, accounted-liquidity bounds, and objective post-release settlement recognition. Exposure caps, withdrawals, diversified maturities, signed quotes, and deeper callback-token testing remain production work. Marketing must not describe advances or returns as risk-free.

## 8. USYC boundary

USYC is a production upgrade for qualified, aggregated idle pool capital. It is not part of the first live MVP and is not a substitute for locked-claim reserves.

If introduced later:

- only capital legally and operationally eligible for USYC may be allocated;
- each locked mandate reserve remains ERC-20 USDC in the mandate contract;
- the vault maintains a risk-governed liquid USDC buffer;
- valuation, oracle, redemption, chain, and eligibility failures are modeled;
- users receive clear disclosures about yield and liquidity; and
- allocation cannot impair current advance or withdrawal obligations.

## 9. Required tests before Arc deployment

### Unit and negative tests

- every allowed and forbidden transition;
- authorization for every state-changing method;
- lock exactly before, at, and after expiry;
- revocation before request, after request, and after lock;
- zero address, zero amount, duplicate request, and reused nonce;
- assignment followed by release to new payee;
- stale/replayed sale authorization and insufficient vault liquidity;
- failed/reentrant token transfers and recipient callbacks; and
- 6-versus-18-decimal input mistakes.

### Stateful invariants/fuzzing

- global token solvency always holds;
- aggregate per-mandate reserve equals unreleased locked face value;
- reclaim never reduces a locked claim's coverage;
- vendor never changes;
- only authorized assignment changes payee;
- released count/value never decreases;
- each claim releases at most once; and
- revoked/expired mandates never produce a new locked claim.

### Integration tests

- canonical Arc Testnet token address and `decimals()` check;
- real approve/deposit/lock/purchase/release balance deltas;
- explorer-visible events reconstruct the claim chain of title; and
- business early release plus permissionless post-deadline release.

## 10. Security review checklist

- Does any admin, rescue, upgrade, pause, or migration path touch reserved funds?
- Can reclaim calculate from raw balance or another mandate's liquidity?
- Can a claim lock without all face-value USDC already present?
- Can a former payee sell after assignment?
- Can release use the original vendor instead of current payee?
- Can expiry/revocation accidentally gate release?
- Can a malicious token/recipient reenter before terminal state is written?
- Is every externally supplied amount unambiguously 6-decimal ERC-20 USDC?
- Does the UI overstate what `proofHash` proves?
- Are planned Circle/USYC features clearly separated from deployed behavior?
- Was the intended vault fully verified before the irreversible authorization freeze?
