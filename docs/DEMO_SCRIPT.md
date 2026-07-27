# Fidra Demo Script

## Demo objective

In under five minutes, prove one idea: a controlled AI-agent purchase becomes a locked, assignable USDC receivable; the vendor gets cash now; and the vault receives face value later.

Do not frame the demo as an agent wallet or invoice flow. The moment that matters is the transition to `Locked`.

## Setup

The core contracts are live on Arc Testnet: `MandateManager` at `0xEfA2b3e70138810eA51552177c3f1AE5ab249EF2` and `AdvanceVault` at `0x5F7Bec9eC341F816182a56D8E033cac63DBd8C8B`. The first 1 USDC smoke claim is settled: the vendor received 0.99 USDC, the vault received 1 USDC after parent-mandate revocation, and 0.01 USDC spread was realized. The vault remains deliberately unfrozen with 5.01 USDC accounted and available. The React/Vite frontend defaults to read-only Live Mode at `/mandates/1`; the former sample dataset is available through the visible Demo Mode switch.

`/vendor-onboarding` contains the real Circle integration boundary: email/Google User-Controlled Wallet authentication, explicit `EOA` creation on `ARC-TESTNET`, optional capped native-USDC gas seeding, and a real user-approved `AdvanceVault.buyClaim` contract-execution path. It is disabled and honestly shows `not_configured` until real Circle sandbox credentials are supplied. Vendor `submitProof`, agent `requestSpend`, general claim indexing, Gateway, CCTP, and Paymaster are not live.

Keep the mode badge visible during a demo. Live Mode must show configured addresses, a connected Arc RPC, and mandate `1` / spend `1`; if a read is unavailable, show the error state and do not substitute sample records. The landing/sidebar switch can move to the opt-in Demo Mode without editing an environment file; Demo Mode uses local records and an explicitly simulated lock action only when intentionally enabled.

Open `/mandates/1` and use the **Live Smoke Evidence** section first. Show the manager and vault address links, `Revoked` mandate, `Released` spend, original vendor, final `AdvanceVault` payee, 1.00 USDC face amount, 0.99 USDC advance, 0.01 USDC spread, 5.01 USDC available liquidity, unfrozen authorization, and the [settlement transaction](https://testnet.arcscan.app/tx/0xd80a21c1ae6e354bf64989c01a22487a3a62ebd3782026a9c2c0254a9d50dbe5). The complete transaction ledger lives in [`deployments/arc-testnet/latest.json`](../deployments/arc-testnet/latest.json).

Say:

> Fidra’s live smoke proves that a locked claim can be sold to AdvanceVault, the parent mandate can be revoked, and settlement still pays the vault because locked receivables are irrevocable.

Use four clearly labeled actors:

- **Northstar Labs** — business and mandate funder;
- **ProcureBot** — AI purchasing agent;
- **Atlas Supply** — vendor;
- **Fidra AdvanceVault** — liquidity buyer.

For explanatory product copy, keep the fixed 1% quote concrete:

> Get 99 USDC now instead of waiting for 100 USDC later.

The completed first Arc smoke used these tiny values:

- mandate funded: `1.00 USDC`;
- claim face value: `1.00 USDC`;
- vendor advance: `0.99 USDC`;
- vault gross spread at release: `0.01 USDC`.

After the smoke flow is confirmed, a presentation can use the larger equivalent example:

- mandate funded: `5,000.00 USDC`;
- claim face value: `1,000.00 USDC`;
- vendor advance: `990.00 USDC`;
- vault gross spread at release: `10.00 USDC`.

Before presenting, confirm the recorded smoke transactions and final live reads, confirm chain ID `5042002`, and record starting ERC-20 balances. Testnet USDC has no financial value. Do not freeze the authorized vault until source is published/verified if possible, the frontend evidence matches, the permanent vault is independently confirmed, and the owner explicitly authorizes the one-way action.

## Script

### 1. Open with the wedge (20 seconds)

> AI agents can already be given spending limits. That protects the buyer, but it does not help a vendor who must wait to be paid. Fidra turns an approved-but-unreleased agent purchase claim into instant USDC.

Show the four actors and the empty lifecycle. Avoid opening on wallet setup.

### 2. Business creates a controlled mandate (35 seconds)

Northstar authorizes ProcureBot, sets a 5,000 USDC budget and expiry, then deposits 5,000 Arc ERC-20 USDC.

Show:

- agent and business addresses;
- mandate status `Active`;
- `available = 5,000`, `reserved = 0`; and
- Arc transaction link.

Say:

> The agent has authority to request purchases, not custody of an unrestricted wallet balance.

### 3. Agent requests a purchase (35 seconds)

ProcureBot submits a 1,000 USDC request for Atlas Supply with a visible description and `proofHash`.

Show `Requested` and emphasize:

> This is not yet a receivable. No funds are reserved, and the business can reject it. The hash commits to the receipt or evidence the business reviews; it does not prove physical delivery.

### 4. Business locks the claim (50 seconds)

Northstar reviews and approves the request. Execute lock.

Show the state and balances change atomically:

```text
state:     Requested -> Locked
available: 5,000 -> 4,000 USDC
reserved:      0 -> 1,000 USDC
vendor:    Atlas Supply (fixed)
payee:     Atlas Supply (currently)
```

Say:

> This is Fidra's point of no return. The full amount is reserved. Revoking or expiring the mandate cannot cancel this claim or sweep its funds.

### 5. Prove the invariant, not just the happy path (35 seconds)

Revoke the mandate, or use a prepared test/read demonstrating the same rule. Show that:

- a new request cannot be locked;
- the existing claim remains `Locked`;
- its 1,000 USDC remains reserved; and
- reclaimable funds exclude that reserve.

Say:

> Spend control governs future commitments. It cannot rewrite an existing receivable.

If time is tight, show a passing invariant test and the corresponding contract read, not a simulated toast.

### 6. Vendor sells the locked claim (50 seconds)

Atlas accepts a 990 USDC quote from `AdvanceVault`. Execute the atomic purchase.

Show:

- Atlas ERC-20 balance increases by 990 USDC;
- claim `vendor` remains Atlas Supply;
- claim `payee` changes to `AdvanceVault`;
- face value remains 1,000 USDC; and
- claim state remains `Locked`.

Say:

> Atlas gets working capital now. We preserve who performed the work for audit, but assignment changes who owns the payment right.

### 7. Release and settle (45 seconds)

Use business early release for the fastest live flow, then show the tested fallback: at immutable `releaseDueAt`, any account can execute the same settlement path.

Show:

- claim becomes `Released`;
- mandate reserve falls by 1,000 USDC;
- `AdvanceVault`, not Atlas, receives 1,000 USDC; and
- vault gross spread is 10 USDC.

Say:

> Release pays the current payee. The vendor traded time for liquidity; the vault earned the spread on a fully reserved locked claim.

### 8. Close with the expansion path (30 seconds)

If Circle sandbox credentials have been configured and tested before recording, briefly open `/vendor-onboarding` after the receivable proof. Show the real configured status, authenticate a vendor with email OTP (the primary tested method), approve the Circle wallet challenge, and display the returned Arc Testnet EOA. Show that Circle Vendor Wallet mode binds both vendor and initial payee to that exact address. If a freshly locked claim whose payee is that EOA exists, enter its id, approve the `buyClaim` challenge in Circle's window, and show the confirmed ArcScan receipt. Show a real seed receipt only if the optional operator seed service produced it.

If Circle is not configured, show the honest `not_configured` status and MetaMask fallback; do not imply the wallet was created or that a claim was sold. Say:

> Authentication and account type are separate. Email or Google identifies the vendor, while Fidra explicitly requests an EOA because that exact address must be the `msg.sender` that sells the claim. Fidra never signs for the vendor: the vendor approves each `buyClaim` in Circle's own window.

Then close:

> The live core is intentionally narrow: Arc USDC mandates, locked receivables, advances, assignment, and settlement. The Circle Wallets onboarding boundary is implemented for a vendor EOA, including a real user-approved `buyClaim`; vendor `submitProof` and agent `requestSpend` are the next steps. Gateway and CCTP can bring unified crosschain USDC liquidity to Arc. Paymaster can simplify gas UX where supported. USYC is a later, qualified-capital upgrade for aggregated idle vault liquidity—not part of this MVP.

## What must be live versus labeled

The following should be real Arc Testnet transactions before they are called live:

- mandate funding;
- request and lock;
- vendor advance and payee assignment;
- release to the vault; and
- reserve/reclaim protection.

Use an explicit **mocked** or **planned** badge for:

- AI-generated procurement text if the request is manually submitted;
- evidence storage or ERP integration;
- delivery verification;
- Circle wallet creation, login, gas seed, or contract execution unless the specific action is configured and traceable;
- Gateway/CCTP crosschain funding if not transacted live;
- Paymaster/gas sponsorship; and
- USYC yield.

## Presenter guardrails

- Do not call a `Requested` claim approved, funded, or financeable.
- Do not say `proofHash` verifies delivery.
- Do not say the vendor identity transfers; the payee right transfers.
- Do not imply vault returns are risk-free or guaranteed.
- Do not count native gas USDC balances as contract principal.
- Do not describe a screenshot, prefilled number, or backend record as onchain proof.
- Do not claim Circle product integrations that cannot be traced in the demo.
- Do not call a wallet ready merely because an address exists; its Arc native gas status must be confirmed or manual funding must be stated.

## Recovery plan

Keep a known-good deployed contract, funded wallets, and transaction links available. If a live transaction fails, explain the failed step, show the last confirmed onchain state, and use previously confirmed transactions to finish the narrative. Never silently switch from live state to mocked state.
