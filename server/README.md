# Fidra Circle wallet server

This service is the server-side boundary for Circle User-Controlled Wallet onboarding. It keeps the Circle API key and optional testnet seed signer out of the browser, stores its authenticated session only in ephemeral server memory, and persists only non-secret hackathon wallet metadata under `data/`. Circle's browser SDK necessarily receives short-lived user challenge credentials; Fidra keeps them in `sessionStorage` only until wallet creation/retrieval completes, then clears them.

The service is disabled by default. Copy `.env.example` to `.env`, configure the Circle User-Controlled Wallet application, and set `CIRCLE_WALLETS_ENABLED=true` only when the credentials are present. Google social login additionally requires `CIRCLE_GOOGLE_CLIENT_ID`. Email OTP requires SMTP configuration in the Circle Developer Console, which this service cannot detect.

```bash
npm install
npm run dev
```

The Vite development server proxies `/api` to `http://127.0.0.1:8787`. Do not expose this service directly without TLS, durable session storage, rate limiting, CSRF review, and an external secrets manager.

The server requests `accountType: "EOA"` and `blockchains: ["ARC-TESTNET"]` on both user initialization and existing-user wallet creation. Authentication method does not select the account type. The exact returned EOA must be registered as Fidra's vendor and initial payee because the claim-sale path authorizes `msg.sender`.

## Implemented API

- `GET /api/circle/status`
- `POST /api/circle/vendor/session/start`
- `POST /api/circle/vendor/session/complete`
- `GET /api/circle/vendor/session/callback`
- `POST /api/circle/vendor/session/logout`
- `POST /api/circle/vendor/wallet`
- `GET /api/circle/vendor/wallet`
- `POST /api/circle/vendor/seed-gas`
- `POST /api/circle/vendor/transactions/buy-claim` (prepares a user-approved `AdvanceVault.buyClaim` challenge)
- `GET /api/circle/vendor/transactions/:id` (reads the real Circle transaction state; no fabricated receipts)

`submit-proof` and `request-spend` remain `501 not_implemented`. The gas seed is an Arc **native USDC** transfer for transaction fees; the seed defaults to `0.10` and is capped at `0.20` native USDC. Fidra contract principal continues to use only the 6-decimal ERC-20 USDC interface at `0x3600000000000000000000000000000000000000`.

## Real user-approved `buyClaim`

`POST /api/circle/vendor/transactions/buy-claim` is the one implemented contract action. Before it ever calls Circle, the server reads Arc directly (`MandateManager.getSpendRequest`, `AdvanceVault.getClaimPurchase`) and requires:

- an authenticated Circle user with an `ARC-TESTNET` `EOA` wallet;
- `request.status == Locked`;
- `request.payee` equals the wallet address (exact address binding, never a fallback);
- the claim has not already been purchased;
- a future `deadline`; and
- `minAdvanceAmount <= face * (10000 - discountBps) / 10000` for the deployed 1% discount.

It then creates a Circle contract-execution challenge (`buyClaim(uint256,uint256,uint256)`) that the browser SDK must have the user approve. The server signs nothing. `GET /api/circle/vendor/transactions/:id` maps Circle transaction state to `confirmed` (only with a real `txHash` and ArcScan link), `failed` (no hash), or `pending`.

## Next write milestone

Vendor `submitProof` and agent `requestSpend` remain stubbed. Implement them only after the live `buyClaim` path has produced a confirmed Arc receipt from a Circle-controlled EOA.
