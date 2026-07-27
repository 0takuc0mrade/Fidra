# Circle and Arc Integration

## 1. Integration thesis

Fidra's core is a receivable state machine settled in USDC. Arc supplies the stablecoin-native execution environment. Circle products can improve account control, liquidity mobility, and capital efficiency around that core, but they must not blur the solvency boundary: a claim locks only against ERC-20 USDC already escrowed on Arc.

This document records the intended integration surface as of July 12, 2026. Product support changes; verify official documentation before implementation.

## 2. Arc Testnet constants

```text
Network:                 Arc Testnet
EVM chain ID:            5042002
RPC:                     https://rpc.testnet.arc.network
Arc USDC ERC-20:         0x3600000000000000000000000000000000000000
CCTP/Gateway domain ID:  26
Protocol USDC decimals:  6
```

The EVM chain ID and Circle domain ID are different namespaces and must never be interchanged.

Official sources:

- [Arc connection parameters](https://docs.arc.io/arc/references/connect-to-arc)
- [Arc infrastructure integration](https://docs.arc.io/integrate/infrastructure)
- [Circle USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)
- [CCTP supported domains](https://developers.circle.com/cctp/concepts/supported-chains-and-domains)

## 3. Dual USDC surfaces and decimals

Arc uses USDC as its native gas token and exposes USDC through an ERC-20 interface for contract interaction. Current Arc documentation describes native gas USDC with 18-decimal behavior, while Circle's USDC workflows and the ERC-20 interface use 6-decimal units.

Fidra therefore adopts a hard boundary:

- contract principal is only the ERC-20 balance at `0x3600...0000`;
- all mandate limits, face amounts, reserves, advances, spreads, transfers, events, and API values are 6-decimal integers;
- contract logic never uses `address.balance` to measure solvency;
- native-value transaction fields are never used to fund or release a claim; and
- UI/RPC code uses separate types and formatters for native gas values and protocol USDC.

Example:

```text
1,000.00 Fidra USDC = 1_000_000_000 protocol units
```

Tests must include conversions around 1 unit, 1 USDC, maximum configured values, and accidental 18-decimal inputs. Configuration should assert token address, chain ID, and `decimals() == 6` before deployment/operation.

## 4. Circle User-Controlled Wallets

[Circle User-Controlled Wallets](https://developers.circle.com/wallets/user-controlled) is Fidra's first implemented Circle product boundary. The code is real but fail-closed: it is disabled by default and is not called live until a real sandbox API key and App ID are supplied to `server/.env`. There is no mock success mode.

The vendor flow deliberately separates two choices:

1. **Authentication:** Google social login or email OTP identifies the vendor through Circle's Web SDK. Email OTP also requires SMTP configuration in the Circle Console. Circle supports PIN as a wallet security/authentication method, but Fidra does not implement PIN-only onboarding because a PIN alone does not establish the vendor identity required by this flow.
2. **Account type:** after authentication, the backend initializes or creates a wallet with `accountType: "EOA"` and `blockchains: ["ARC-TESTNET"]`. Circle returns a challenge; the vendor approves that challenge in the browser SDK. The backend never invents a wallet address.

EOA is a protocol requirement for this MVP, not a side effect of the login method. `MandateManager.requestSpend` and the claim assignment path ultimately authorize `msg.sender`. A Circle-managed vendor can sell a claim only when the exact EOA returned by Circle is registered as both the immutable vendor and initial payee. An SCA would be a different caller address and must not be substituted unless that SCA itself is registered and the full contract path is retested.

The implementation is split across trust boundaries:

- `server/` holds `CIRCLE_API_KEY`, optional operator seed signer, Circle user tokens, and an opaque `HttpOnly; SameSite=Lax` session cookie;
- the browser receives the public Circle App ID, device challenge material, and the SDK's short-lived user token/encryption key; Fidra keeps those challenge credentials in `sessionStorage` only until wallet creation/retrieval completes, then clears them;
- the validated user/refresh token copy held by Fidra lives only in the server's in-memory hackathon session store;
- `server/data/vendor-wallets.json` stores only wallet ID, address, network, account type, Circle user ID, and optional seed receipt metadata; and
- MetaMask remains the direct-wallet fallback if Circle is not configured or unavailable.

The current in-memory session store is suitable only for a single-process testnet demo. Production requires TLS, durable encrypted sessions, rotation/revocation, rate limiting, CSRF review, an external secret manager, and operational monitoring.

### Testnet gas seed

An optional `POST /api/circle/vendor/seed-gas` service can transfer a tiny amount of **Arc native USDC** from an operator wallet to the vendor EOA. It is off by default, capped by `MAX_VENDOR_GAS_SEED_USDC`, and can be restricted to one recorded seed per wallet. The signer is runtime-only. A missing signer, disabled service, failed transaction, or insufficient operator balance returns an honest error/not-configured result.

This seed pays EVM transaction fees. It is not ERC-20 protocol principal and never credits a mandate, vault deposit, advance, or repayment. Automatic seeding defaults to `0.10` native USDC with a `0.20` native USDC hard configuration ceiling; manual Arc testnet funding is the fallback.

Automatic seeding defaults to `0.10` native USDC with a `0.20` native USDC hard configuration ceiling; manual Arc testnet funding is the fallback.

### Real user-approved `buyClaim`

Vendor `buyClaim` is now a genuine user-controlled contract action. The primary tested authentication path is **email OTP**; Google social login is implemented but only claimed live when `CIRCLE_GOOGLE_CLIENT_ID` is configured and exercised.

The server first reads Arc directly (`MandateManager.getSpendRequest`, `AdvanceVault.getClaimPurchase`) and only then, if every check passes, creates a Circle contract-execution challenge:

- authenticated Circle user with an `ARC-TESTNET` `EOA` wallet;
- `request.status == Locked`;
- `request.payee` equals the wallet address — the exact address-binding invariant, never a silent fallback;
- the claim is not already purchased;
- a future quote `deadline`; and
- `minAdvanceAmount <= face * (10000 - discountBps) / 10000` for the deployed 1% discount.

The challenge targets `AdvanceVault.buyClaim(uint256,uint256,uint256)`. Fidra never signs a user-controlled transaction from the server: the browser SDK requires the vendor's explicit approval. Fidra then polls `GET /api/circle/vendor/transactions/:id` and shows a confirmed receipt (real `txHash` + ArcScan link) only on terminal Circle success. Failures never carry a fabricated hash.

Vendor `submitProof` and agent `requestSpend` remain `501 not_implemented`.

## 5. Gateway

[Circle Gateway](https://developers.circle.com/gateway) lets users deposit USDC into a unified balance and spend across supported chains while Circle handles the underlying settlement. Arc Testnet is currently listed with Circle domain `26` and nanopayment support.

Possible Fidra use:

- a business maintains a unified USDC treasury and brings funds to Arc before funding a mandate;
- the vault sources Arc liquidity from balances originating on other supported chains; or
- a vendor later moves released USDC out of Arc.

Boundary: Gateway balance is not an Arc mandate reserve. A claim may lock only after the destination ERC-20 USDC is confirmed on Arc and deposited into Fidra. Gateway-specific deposits must use Gateway's prescribed method, not a plain ERC-20 transfer to its wallet contract.

Reference: [Gateway supported blockchains](https://developers.circle.com/gateway/references/supported-blockchains).

## 6. CCTP

[CCTP](https://developers.circle.com/cctp) moves native USDC across supported networks using burn-and-mint rather than wrapped liquidity. Arc Testnet is currently supported for standard transfers and uses domain `26`.

Possible Fidra use:

- direct business funding from a supported source chain into an Arc wallet;
- vault treasury rebalancing; and
- vendor withdrawal to a preferred chain after settlement.

CCTP is a transport layer, not claim assignment or settlement. Crosschain transfers should be completed before mandate funding, or initiated after a recipient has been paid. Do not make the locked claim's solvency depend on a future attestation or mint.

## 7. Paymaster and gas UX

[Circle Paymaster](https://developers.circle.com/paymaster) is a permissionless ERC-4337 mechanism that lets supported smart accounts pay gas fees in USDC. Arc already denominates native gas in USDC, but users still need the native gas representation and compatible account infrastructure.

Potential value:

- reduce onboarding friction for ERC-4337 business/vendor accounts;
- keep fee UX denominated in the same familiar currency; and
- avoid manual native-gas acquisition where Arc support and the account stack allow it.

Current Circle Paymaster documentation lists a specific set of supported chains and does not list Arc. Treat Arc Paymaster integration as planned/support-dependent, not an MVP fact. Circle Wallets Gas Station is a separate developer-sponsored-fee product and should not be conflated with Paymaster.

Gas fees are operating expense, never mandate principal. The system must not pay gas by dipping into a locked reserve.

## 8. USYC

[USYC](https://www.circle.com/usyc) represents shares in an institutional tokenized money market fund and is subject to eligibility and network constraints. Circle's current CCTP documentation lists USYC crosschain support only on Ethereum and BNB Smart Chain, not Arc.

USYC is excluded from Fidra's first live MVP. A production upgrade could allow a qualified vault operator to allocate part of **aggregated idle pool capital** to USYC, subject to:

- investor and jurisdiction eligibility;
- supported-chain and custody design;
- liquidity and redemption capacity;
- price/oracle and valuation behavior;
- minimum liquid-USDC buffer;
- maturity matching against expected advances and releases;
- pause/depeg/redemption-failure handling; and
- clear allocation of yield, fees, and losses.

Individual locked-claim reserves should remain ERC-20 USDC and must not be transformed into USYC. The business's reserved face value is a settlement obligation, not vault investment capital.

## 9. MVP integration matrix

| Layer | Required for core demo | Acceptance evidence |
| --- | --- | --- |
| Arc Testnet | Yes | Chain ID, deployed addresses, explorer transactions |
| Arc ERC-20 USDC | Yes | `balanceOf`, approvals, deposits, advances, releases |
| Circle User-Controlled Wallets | Onboarding path implemented; not required for existing smoke | Real Google/email session, Circle challenge, and returned Arc Testnet EOA once sandbox credentials are configured |
| Vendor gas seed | Optional | Real Arc native-USDC receipt from the capped operator seed service, or explicit manual-funding state |
| Gateway | No | Deposit/transfer and resulting Arc balance if added |
| CCTP | No | Burn, attestation/message, and mint/receipt if added |
| Paymaster | No | ERC-4337 operation and USDC-denominated fee if supported/added |
| USYC | No; explicitly excluded | No simulated yield presented as live |

## 10. Integration failure rules

- Wrong chain ID: block writes and show a configuration error.
- Wrong token address or decimals: fail deployment/startup validation.
- Crosschain transfer pending: do not credit a Fidra mandate.
- Wallet/API unavailable: preserve onchain state; allow direct wallet fallback for the demo.
- Wallet credentials absent: report `not_configured`; never return a synthetic user, wallet, or transaction.
- Wallet account type/network mismatch: reject it; only the exact `EOA` on `ARC-TESTNET` can enter Circle Vendor Wallet mode.
- Gas seed unavailable: require manual Arc native-USDC funding; never use ERC-20 mandate/vault balances for gas.
- Paymaster unavailable: use ordinary Arc native gas USDC, never claim sponsorship.
- USYC unavailable/ineligible: keep vault capital in ERC-20 USDC.
