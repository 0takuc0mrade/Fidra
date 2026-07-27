# Fidra Architecture

## 1. Design goal

The architecture must make a locked claim a simple, inspectable promise: its face value is already held in Arc ERC-20 USDC, that reserve cannot be reclaimed, ownership of payment can be reassigned, and exactly one current payee receives settlement.

The core contracts are implemented, locally tested, and deployed to Arc Testnet: `MandateManager` at `0xEfA2b3e70138810eA51552177c3f1AE5ab249EF2` and `AdvanceVault` at `0x5F7Bec9eC341F816182a56D8E033cac63DBd8C8B`. The vault is authorized with a fixed 100 bps discount, remains unfrozen, and has 5.01 USDC available after the first settled smoke. A responsive React/Vite application defaults to read-only Live Mode and displays the settled mandate `1` / spend `1` evidence through viem. A separate Node service now implements fail-closed Circle User-Controlled Wallet onboarding for a vendor EOA, plus a real user-approved `AdvanceVault.buyClaim` contract-execution path (server-validated against live Arc state, signed only by the vendor in Circle's SDK, with no fabricated receipts). Vendor `submitProof`, agent `requestSpend`, Gateway, CCTP, and Paymaster remain stubbed or planned.

## 2. System context

```text
Business ──funds/reviews──▶ Mandate + Claim ledger ◀──requests── AI agent
                                  │
                          locks ERC-20 USDC
                                  │
Vendor ◀──advance USDC── AdvanceVault
  │                           │
  └────assigns payee──────────┘
                              ▲
Mandate/Claim ledger ──release face value──┘

Offchain app/indexer reads events and stores evidence addressed by proofHash.

Vendor browser ──Circle Web SDK challenge──▶ Circle User-Controlled Wallets
       │                  ▲
       │ opaque cookie    │ device/login challenge data
       ▼                  │
Fidra server ──server API key──▶ Circle API
       │
       └──optional capped Arc native-USDC seed──▶ exact vendor EOA
```

The contracts should not call external delivery services, price arbitrary goods, or infer that a hash proves fulfillment.

## 3. Onchain components

### `MandateManager`

One contract can own the MVP's mandate escrow and claim state machine. Keeping reserve accounting and release in the same trust boundary makes solvency easier to reason about.

Responsibilities:

- create, fund, revoke, and reclaim mandates;
- accept agent purchase requests;
- lock approved requests and reserve face value;
- expose immutable vendor and mutable payee;
- let the current payee directly assign a locked claim;
- authorize one configured vault to perform an atomic expected-payee assignment during purchase;
- permanently freeze the configured MVP vault against later rotation;
- release to current payee; and
- expose state and emit canonical events.

The local implementation is non-upgradeable. Before freezing, its owner can replace the authorized advance vault through a one-step, nonzero setter. After the real `AdvanceVault` is configured, the owner can irreversibly set `authorizedVaultFrozen`; the configured vault remains operational, but no later rotation is possible. The vault may assign only to itself, and each claim can use that privileged advance path only once. The deployment must verify the Manager and vault addresses before freezing because an incorrect frozen address cannot be repaired.

### `AdvanceVault`

Holds advance liquidity and buys only locked claims.

The implemented local vault can:

- hold Arc ERC-20 USDC liquidity;
- accept operator-funded liquidity;
- apply one immutable fixed discount in basis points;
- buy only canonical `Locked` claims from their current payee;
- enforce the seller's minimum advance and transaction deadline;
- atomically transfer advance USDC and acquire payee rights through the Manager's authorized-vault path;
- track acquisition cost and face value for reporting; and
- recognize a repayment and realized spread after the Manager has released the claim.

The vault deliberately has no LP shares, withdrawals, dynamic pricing, signed/offchain quotes, or USYC allocation. The caller-supplied minimum advance and deadline protect the seller's transaction from worse-than-expected or stale execution under the immutable fixed discount.

### Offchain application

Responsibilities:

- role-oriented transaction preparation and signing;
- evidence upload/storage and local `proofHash` calculation;
- event indexing and readable histories;
- vault quote presentation; and
- explicit labeling of live transactions versus simulated integrations.

The current application is a responsive product demonstration with explicit live and mock modes. Live Mode is the default. Curated Foundry ABIs live under `shared/`; Vite configuration selects Arc RPC and deployment addresses; and a viem public client reads manager code/configuration, vault linkage/accounting, authorization/freeze state, discount, liquidity, mandate `1`, spend `1`, and its vault purchase. The deployment ledger supplies only transaction/block/explorer metadata and a cross-check for fields contracts do not expose. Live errors remain visible and never silently fall back to mock records. Non-indexed Overview, Claims, and Activity screens suppress sample records in Live Mode. Wallet connection, contract writes, and general event indexing remain unimplemented. The app is never a trusted source for contract state or authorization.

The vendor onboarding page adds a separate identity boundary. Google or email is the authentication method; `EOA` on `ARC-TESTNET` is the independently selected wallet account type. The official Circle browser SDK owns the vendor challenge interaction. The Fidra server owns API-key calls, opaque `HttpOnly` sessions, wallet lookup/initialization, non-secret metadata persistence, and optional capped native-gas seeding. Only the exact returned EOA may be selected as the Circle vendor and initial payee. MetaMask remains the fallback. The browser never receives a Circle API key or operator seed key.

### Frontend integration boundary

```text
Foundry artifacts ──export script──▶ shared curated ABIs/constants
                                         │
Vite env ──▶ Arc config/address checks ──▶ viem public client
                                         │
                    mock adapter ◀── normalized mandate view ──▶ live adapter
                                         │
                               existing Mandate Detail UI
```

Demo mode may run explicit simulated handlers but never produces a transaction hash. Live mode is read-only and fails closed when addresses, RPC, chain ID, or contract reads are unavailable. Claim enumeration needs an indexer or bounded deployment start block; until then, live mode shows that limitation rather than mixing hardcoded claims into onchain mandate data.

### Circle onboarding boundary

```text
Browser                                Fidra server                         Circle
   │  SDK device ID                         │                                 │
   ├──POST session/start───────────────────▶│──device/social or email token──▶│
   │◀──public challenge material────────────│◀────────────────────────────────│
   ├──Circle Web SDK login/OTP───────────────────────────────────────────────▶│
   │──user token over TLS──────────────────▶│──validate current user─────────▶│
   │◀──opaque HttpOnly session cookie───────│                                 │
   ├──POST vendor/wallet───────────────────▶│──initialize/create EOA─────────▶│
   │◀──challenge ID─────────────────────────│◀────────────────────────────────│
   ├──SDK executes user challenge───────────────────────────────────────────▶│
   └──GET vendor/wallet────────────────────▶│──list wallets──────────────────▶│
      ◀──id + exact ARC-TESTNET EOA─────────│◀────────────────────────────────│
```

The SDK's user token/encryption key live briefly in browser `sessionStorage` so the vendor can approve wallet creation, then Fidra clears them. The server keeps its validated user/refresh token copy in an in-memory, single-process session only; it persists wallet metadata but not API keys, user tokens, refresh tokens, device encryption keys, or signer keys. This is intentionally a hackathon boundary, not a production identity service. Production must add durable encrypted sessions, rate limits, CSRF hardening, secret management, observability, and recovery.

## 4. State machines

### Mandate

```text
Active ──revoke──▶ Revoked
   │
   └──time passes──▶ Expired
```

Revoked and Expired prevent new locks. Neither affects already locked claims. Funding policy after revocation/expiry should be rejected to keep behavior simple.

### Claim

```text
Requested ──approve──▶ Approved ──lock + reserve──▶ Locked ──release──▶ Released
     │                    │                              │
     └────reject──────────┴──▶ Rejected                 └──sell──▶ Locked (payee changes)
```

Sale is not a new claim state because the obligation remains locked; it is a change in chain of title. `Released` and `Rejected` are terminal.

## 5. Accounting model

All amounts are unsigned integers denominated in the smallest unit of the Arc ERC-20 USDC interface:

```text
1 USDC = 1_000_000 protocol units
```

Do not use `address.balance`, native transfer syntax, or 18-decimal parsing for protocol principal.

Per mandate:

```text
available = deposits - reclaimed - totalLocked
reserved  = totalLocked - totalReleased
escrow obligation = available + reserved
```

Operationally, lock moves `available -> reserved`; release moves `reserved -> external payee`; reclaim moves `available -> business`. No path moves `reserved -> business`.

Globally:

```text
USDC balance of MandateManager >= sum(all mandate available + all mandate reserved)
```

If a single contract holds multiple mandates, internal balances must never let one mandate spend another mandate's funds. Accidental direct token transfers may create surplus but must not create user credit without an explicit accounting path.

The vault uses a different ledger:

```text
liquid USDC + acquired-claim carrying values = vault assets (accounting view)
```

Claim face value is not liquid USDC. Reporting should show face value, acquisition cost, unrealized spread, and release status separately.

## 6. Critical transaction flows

### Lock

1. Load request and parent mandate.
2. Authenticate approver.
3. Require active, unexpired mandate and valid request.
4. Require sufficient `available` USDC.
5. Set immutable claim terms, `payee = vendor`, and `releaseDueAt = lockedAt + defaultReleaseDelaySeconds`.
6. Decrease `available`; increase `reserved`.
7. Mark `Locked` and emit the full commitment.

All checks and state changes are atomic. Lock should not depend on a later funding transaction.

### Vault purchase

1. The current payee calls `AdvanceVault.buyClaim(requestId, minAdvanceAmount, deadline)`.
2. The vault requires the quote deadline not to have passed, then reads canonical Manager state and requires the claim to be `Locked`, the caller to be its current payee, the claim not to have been purchased already, and sufficient accounted liquidity.
3. The vault computes the advance from its immutable fixed discount, requires it to meet the seller's minimum, and records the purchase.
4. The vault calls `MandateManager.assignClaimForAdvance(requestId, seller, vault)`.
5. The Manager requires the caller to be its configured `authorizedAdvanceVault`, rechecks `Locked`, verifies that `seller` is still the current payee, requires that the claim has not used the advance path before, and permits the vault to assign only to itself.
6. The vault transfers advance USDC to the seller. Any failure reverts the assignment and all accounting in the same transaction.

The separate authorized-vault path is necessary because a direct assignment call from the vault would make `msg.sender` the vault rather than the selling payee. The expected-current-payee argument closes the stale-owner mismatch between the vault's initial read and the Manager's authoritative write.

### Release

1. Before `releaseDueAt`, authenticate release by the business or approver. At or after the deadline, allow any caller.
2. Read the current payee once into memory.
3. Mark released and decrease reserve before external interaction.
4. Safely transfer exact face value to that payee.
5. Emit release with vendor, payee, and amount.

A failed transfer reverts the entire release. This path never checks whether the parent mandate remains active or unexpired: once locked, a claim stays releasable and becomes permissionless at its deadline.

### Reclaim

1. Require mandate revoked/expired according to policy.
2. Calculate reclaimable amount from `available` only.
3. Decrease `available` before transfer.
4. Transfer to the business.

The implementation must never infer reclaimable funds from raw contract token balance.

## 7. Trust boundaries

| Boundary | Trusted for | Not trusted for |
| --- | --- | --- |
| Business approver | Deciding that evidence/purchase is acceptable before lock | Cancelling or redirecting a locked claim |
| Agent | Submitting requests within policy | Locking, spending escrow directly, or assigning claims |
| `proofHash` | Binding the reviewed bytes/URI commitment | Proving delivery, authenticity, or commercial validity |
| AdvanceVault | Paying the quoted advance and becoming payee atomically | Mutating face value, vendor, proof, or deadline |
| Manager owner before freeze | Configuring and permanently freezing the intended vault | Recovering from an incorrect address after freeze or changing claim economics |
| Web/indexer | Convenience and display | Canonical state, balances, or authorization |
| Circle Web SDK | User-controlled login and wallet challenge interaction | Fidra mandate rules or inventing the registered vendor address |
| Fidra Circle server | API-key boundary, session association, exact EOA lookup, optional capped testnet gas seed | Fabricating Circle success or authorizing an address other than the returned EOA |
| Operator gas seed signer | A tiny Arc native-USDC gas transfer when enabled | Funding ERC-20 claim principal, unlimited faucet behavior, or becoming vendor/payee |
| Circle crosschain products | Bringing external USDC liquidity to Arc | Satisfying a claim reserve before funds arrive on Arc |

## 8. Arc and Circle boundaries

- Chain ID: `5042002`.
- RPC: `https://rpc.testnet.arc.network`.
- Contract token: ERC-20 USDC at `0x3600000000000000000000000000000000000000`.
- Protocol accounting: 6 decimals only.
- Native USDC: gas only from Fidra's accounting perspective, even if its economic denomination is also USDC.
- CCTP domain: `26`, distinct from the EVM chain ID.

Gateway or CCTP may fund a business/vault wallet, but Fidra recognizes liquidity only after ERC-20 USDC is present and deposited on Arc. Paymaster concerns transaction fee UX, not face-value settlement. USYC belongs behind a future vault liquidity allocator, never inside individual claim reserve accounting.

## 9. Events and observability

The local contracts emit indexed identifiers and enough detail for deterministic reconstruction. Current event concepts include:

- `MandateCreated`, `MandateRevoked`, `ExpiredFundsReclaimed`;
- `SpendRequested`, `ProofSubmitted`, `SpendApproved`, `SpendRejected`, `SpendLocked`, `ClaimAssigned`, `SpendReleased`;
- `AdvanceVaultUpdated`, `AuthorizedAdvanceVaultFrozen`; and
- `LiquidityDeposited`, `ClaimPurchased`, `ClaimSettled`.

Every claim view should show state, immutable vendor, current payee, face value, proof hash, release deadline, and parent mandate. Events are not a substitute for guarded state transitions.

## 10. Delivery sequence

1. **Complete locally:** implement and unit-test `MandateManager` with a mock 6-decimal ERC-20.
2. **Complete locally:** implement controlled payee assignment and the minimal operator-funded `AdvanceVault`.
3. **Complete as a simulation:** build the responsive, role-based product UI.
4. **Complete for this hardening pass:** add permissionless post-deadline release, quote protection, focused fuzz accounting cases, and fee-on-transfer rejection coverage.
5. **Complete for the MVP admin model:** configure a nonzero vault and support an irreversible authorization freeze, while keeping frozen-vault purchases live.
6. **Partially complete:** generate curated shared ABIs/types, add Arc read configuration, and connect Mandate Detail through a mock/live adapter. Live Mode now defaults to settled evidence while wallet-backed writes and indexed portfolio screens remain pending.
7. **Complete on Arc Testnet:** deploy and authorize the recorded manager/vault pair, then verify chain, token, decimals, ownership, linkage, 100 bps discount, and unfrozen state through read-only RPC calls.
8. **Complete on Arc Testnet:** deposit 5 USDC of accounted vault liquidity through explicit ERC-20 approval and `depositLiquidity`, then verify the complete vault accounting state through read-only RPC calls.
9. **Complete on Arc Testnet:** run the first live smoke through request, proof, approval, irrevocable lock, 0.99 USDC claim purchase, parent revocation, full-face release, and spread recognition; record every transaction and verify final accounting through RPC.
10. **Frontend evidence complete:** default Live Mode reads settled mandate `1`, spend `1`, the vault purchase/accounting, and recorded explorer evidence without fabricating missing data.
11. **Circle onboarding boundary complete, configuration pending:** add real User-Controlled Wallet server calls, Web SDK Google/email flows, explicit Arc Testnet EOA creation, exact vendor-address selection, an optional capped native-gas seed, and honest contract-call stubs. The integration remains `not_configured` until sandbox credentials are supplied and exercised.
12. Vendor `buyClaim` is now implemented as a user-controlled transaction challenge: the server verifies the caller is the exact current-payee EOA against live Arc state before creating the challenge, the vendor approves it in Circle's SDK, and the UI polls for and displays the real Arc receipt (no fabricated hash). Next, extend the same pattern to vendor `submitProof` and agent `requestSpend` only after this path produces a confirmed receipt from a Circle EOA end to end.
13. Publish and verify source on ArcScan if possible, independently confirm the permanent vault address, then have the owner explicitly decide whether to freeze. Add deeper handler-based invariants and callback/reentrancy adversarial tests. Add Gateway, CCTP, or Paymaster only as separately verified integrations; keep USYC outside the live MVP.
