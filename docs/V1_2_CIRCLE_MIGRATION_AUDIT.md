# Fidra V1.2 Circle Migration Audit

Status: implementation prerequisite complete
Scope: migrate the existing Legacy V0 Circle User-Controlled Wallet flow to Fidra V1.1 certified worker earnings without modifying either protocol version's contracts.

## Protocol boundary

Fidra V1.1 is embedded instant-payout infrastructure for irregular-work platforms. A platform certifies final worker earnings, the worker may take an immediate USDC advance, and the platform—not the worker—settles with Fidra later. The deployed V1.1 contracts remain immutable for this milestone:

- PlatformRegistry: `0x20EcB05d90D4F24F8Fcf2785BdE240796B8b1af3`
- EarningsManager: `0xdC1C359fC174Fb8C7cDcbE0e09447d123dD9cD57`
- AdvanceVaultV2: `0x12604e5acD074D3499C9ac4D2cbb4Bd39ECE49c5`
- Arc Testnet chain ID: `5042002`
- USDC: `0x3600000000000000000000000000000000000000` (6 decimals)

Legacy MandateManager and AdvanceVault contracts and their UI remain historical V0 evidence. V1 code must not import, call, or silently fall back to them.

## Existing Circle V0 flow

### Authentication and email OTP

The browser asks the server to start either a Google or email-OTP Circle flow. For email OTP, the server validates the email, requests Circle's device token, and returns only the browser-required flow material. The Circle browser SDK presents the OTP verification interface; Fidra does not collect or verify the OTP itself. The browser completes the flow with Circle-provided credentials, and the server stores the Circle user and refresh tokens in its in-memory session store.

The flow is fail-closed. When the Circle API key, app ID, entity secret ciphertext, or required authentication configuration is absent, wallet operations report `not_configured`; no local wallet or transaction is substituted.

### Google authentication

Google authentication is enabled only when its Circle configuration is present. The browser launches Circle's own Google login window and receives the device-scoped result. Fidra's server never receives a Google password. Missing Google configuration is reported explicitly instead of falling back to another method.

### Wallet creation and retrieval

After authentication, the server queries Circle wallets and selects only an exact `ARC-TESTNET` `EOA`. If none exists, it asks Circle to create one. Circle error `155106` is handled as an existing-user condition by retrying the appropriate user-wallet creation path. The browser approves wallet creation through Circle's SDK challenge window. The resulting public wallet metadata may be persisted in browser storage; tokens, entity secrets, and private keys may not.

The optional gas seeder is Arc-Testnet-only, checks a configured minimum first, and never supplies a protocol role. It is a testnet convenience, not part of claim ownership or authorization.

### V0 payee binding and quote validation

The current `buy-claim` route reads a Legacy V0 MandateManager spend request and AdvanceVault purchase. It requires the spend to be `Locked`, compares the V0 `payee` with the Circle EOA, rejects an existing purchase, checks a client deadline, and calculates an advance from the V0 vault-wide fixed discount.

These assumptions are V0-only and invalid for V1:

- a V0 spend request and its `Locked` status;
- `payee` as the ownership field;
- `getClaimPurchase` from Legacy AdvanceVault;
- a vault-wide `discountBps`;
- a client transaction deadline;
- `buyClaim(uint256,uint256,uint256)` calldata;
- vendor/seller terminology;
- MandateManager authorization and frozen-vault checks.

### Contract-execution challenge and approval

The server calls Circle's user-controlled-wallet contract-execution endpoint and supplies the target contract, function signature, arguments, and Arc Testnet blockchain. The browser receives the challenge ID, restores the device authentication material, and invokes Circle's SDK approval window. Fidra never signs the transaction and does not hold the worker's private key. This boundary is correct and will be preserved.

### Polling, receipts, errors, and timeouts

The browser polls the Fidra server, which polls Circle's transaction endpoint. Pending Circle states remain pending, Circle failures are returned without a transaction hash, and the browser stops polling after a bounded interval. The current flow constructs an ArcScan URL only from Circle's returned transaction hash.

The current terminal-success mapping is insufficient for V1.2: a Circle `COMPLETE` result and hash are treated as confirmed without independently checking the Arc chain. This can report success before indexing, after a reverted receipt, for calldata sent from the wrong address, or without the expected claim state transition. V1.2 must correlate each challenge to its intended wallet and claim, then require all of the following before returning `confirmed`:

1. Circle reports a real transaction hash.
2. Arc returns a successful receipt on chain `5042002`.
3. Receipt `from` exactly equals the authenticated worker EOA.
4. Receipt `to` exactly equals the deployed AdvanceVaultV2.
5. EarningsManager reports the claim as `Advanced`.
6. AdvanceVaultV2 reports an `Outstanding` purchase for that claim.
7. Purchase worker, platform, face value, advance, and fee equal the prevalidated snapshot.

A Circle terminal failure, user rejection, expired challenge, validation failure, or polling timeout stays visibly failed or timed out. A hash without verified Arc state remains pending while indexing is plausible and then fails after the verification deadline. It is never displayed as a receipt.

## Migration map

| Area | Preserve | Replace or add |
| --- | --- | --- |
| Circle credentials | Server-only API key and entity secret; fail-closed configuration | Rename status and errors around worker flow; never log credentials |
| Authentication | Circle Google/email-OTP device flow and SDK approval | Worker-scoped routes, session cookie, storage labels, and UI language |
| Wallet lifecycle | Exact Arc Testnet EOA selection and Circle challenge creation | Worker wallet model and explicit `worker_wallet_mismatch` response |
| Gas seeding | Testnet-only optional seeder and minimum-balance checks | Worker naming; retain no-role guarantee |
| Chain reads | Viem public client and exact-address comparisons | V1.1 Registry, EarningsManager, VaultV2 reads at one block and its timestamp |
| Eligibility | Server-side authoritative validation | Certified claim, future due date, unpurchased state, active platform, reserve, credit, accounted cash, actual USDC |
| Quote | Integer USDC-unit arithmetic | Per-platform `advanceFeeBps`; quote exactly as VaultV2 computes it |
| Minimum | Server validation | API-only slippage guard; do not add it to V1 calldata |
| Transaction | Circle contract-execution challenge | `purchaseAdvance(uint256)` against deployed AdvanceVaultV2 |
| Correlation | Circle transaction polling | Pending-operation record binding session, wallet, claim, quote, challenge, and transaction |
| Confirmation | No fabricated hashes on failure | Independent Arc receipt and post-state verification before success |
| Worker UI | Circle SDK setup and challenge approval mechanics | `/worker`, `/worker/claims`, `/worker/claims/:claimId`; `Get paid now` language and explicit states |
| Platform UI | Existing injected-wallet client patterns where safe | V1 signer/chain checks, simulations, receipts, claim/batch/settlement actions |
| Evidence UI | Live-by-default/demo-opt-in policy | V1.1 deployment evidence page sourced from the confirmed artifact |
| Legacy UI | Historical V0 pages and data | Isolate under an explicit Legacy V0 label; no imports from V1 modules |

## V1 preflight snapshot

The server must perform all eligibility reads at an explicit block number and use that block's timestamp. It must reject a wrong RPC chain before any Circle request. The snapshot includes:

- EarningsManager claim and status;
- AdvanceVaultV2 purchase and purchase status;
- PlatformRegistry platform configuration, state, credit limit, exposure, reserve, and fee;
- AdvanceVaultV2 accounted cash;
- actual USDC `balanceOf(AdvanceVaultV2)`;
- computed fee and advance.

Validation is intentionally repeated by the contracts when the user eventually submits. A successful preflight is a quote, not a promise that stale state will remain eligible.

The minimum advance is an API guard only. It must be a non-negative six-decimal integer not greater than the computed advance. Because `purchaseAdvance` accepts only a claim ID, the worker sees the authoritative quote before approval and the post-state verifier requires the purchased amount to match that snapshot. A changed onchain quote causes verification failure rather than fabricated success.

## Explicit V1 error model

V1 server errors use stable machine-readable codes with safe public context:

- `claim_not_found`
- `claim_not_certified`
- `claim_expired`
- `claim_already_purchased`
- `worker_wallet_mismatch` with connected and expected public addresses
- `platform_inactive`
- `platform_paused`
- `credit_limit_exceeded`
- `reserve_requirement_not_met`
- `insufficient_accounted_liquidity`
- `insufficient_actual_liquidity`
- `invalid_minimum_advance`
- `wrong_chain`
- `circle_not_configured`

Errors must not contain Circle tokens, OTPs, device encryption keys, entity secrets, private keys, raw authorization headers, or environment values.

## Implementation order

1. Export curated V1 ABIs from the existing Foundry artifacts and define shared V1 schemas/constants.
2. Add V1 chain snapshot, validation, quote, correlation, and post-state verification services with deterministic tests.
3. Add worker Circle APIs while keeping the V0 routes isolated and operational until V1 is working.
4. Add the worker UI and its complete transaction-state model.
5. Add the trusted-platform read/write interface with signer, chain, simulation, and receipt checks.
6. Add the V1.1 live evidence page, documentation, and environment examples.
7. Run the full Foundry, invariant, server, web, build, isolation, and secret-validation suite.

No live claim will be created or certified until every local check passes. No V1.2 code or documentation will be committed or pushed without separate authorization.
