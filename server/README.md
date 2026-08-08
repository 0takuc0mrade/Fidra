# Fidra Circle worker server

This service is the server-side boundary for Circle User-Controlled Wallet authentication and V1.1 worker-approved instant payouts. Circle API credentials remain server-side. Circle's browser SDK necessarily receives device-scoped challenge material in `sessionStorage`; Fidra never receives or stores a worker private key and never signs `purchaseAdvance` for a worker.

The service is disabled and fail-closed by default. With credentials absent, `GET /api/circle/status` reports `not_configured`, worker mutation endpoints return `circle_not_configured`, and no mock wallet, transaction hash, or receipt is substituted.

## V1.1 targets

- PlatformRegistry: `0x20EcB05d90D4F24F8Fcf2785BdE240796B8b1af3`
- EarningsManager: `0xdC1C359fC174Fb8C7cDcbE0e09447d123dD9cD57`
- AdvanceVaultV2: `0x12604e5acD074D3499C9ac4D2cbb4Bd39ECE49c5`
- Arc Testnet: chain ID `5042002`
- USDC: `0x3600000000000000000000000000000000000000`, 6 decimals

The V0 vendor endpoints remain available only to preserve historical evidence. V1 worker modules use separate ABIs and addresses and do not import MandateManager or Legacy AdvanceVault.

## Run locally

```bash
cp .env.example .env
npm install
npm run dev
```

The Vite development server proxies `/api` to `http://127.0.0.1:8787`. Do not expose this service publicly without TLS, a durable encrypted session store, rate limiting, CSRF review, monitoring, and an external secrets manager.

## Worker API

- `GET /api/circle/status`
- `POST /api/circle/worker/session/start`
- `POST /api/circle/worker/session/complete`
- `GET /api/circle/worker/session/callback`
- `POST /api/circle/worker/session/logout`
- `GET /api/circle/worker/wallet`
- `POST /api/circle/worker/wallet`
- `POST /api/circle/worker/seed-gas`
- `POST /api/circle/worker/transactions/purchase-advance`
- `POST /api/circle/worker/transactions/:operationId` to bind the Circle transaction ID returned after SDK approval
- `GET /api/circle/worker/transactions/:operationId` for Circle plus independently verified Arc status

`purchase-advance` requires an authenticated `ARC-TESTNET` `EOA`. At one explicit Arc block and timestamp it checks:

- exact wallet-to-claim worker ownership;
- existing, Certified, unexpired claim;
- no prior purchase;
- existing and active platform;
- nonzero reserve;
- sufficient unused face-value credit;
- sufficient accounted vault cash;
- sufficient actual USDC custody; and
- a valid user minimum against the exact per-platform fee quote.

It then asks Circle to prepare `purchaseAdvance(uint256)` against the deployed AdvanceVaultV2. The minimum is an API quote guard and is not inserted into calldata because the immutable V1 function accepts only the claim ID.

Each prepared challenge is correlated in memory with the session, wallet, claim, platform, face value, fee, advance, and quote block. After Circle supplies a transaction hash, Fidra independently verifies:

1. a successful Arc receipt;
2. exact worker sender;
3. exact AdvanceVaultV2 recipient;
4. `purchaseAdvance` calldata for the expected claim;
5. `Advanced` claim state;
6. `Outstanding` purchase state; and
7. exact worker, platform, face, fee, and advance values.

Only then does the API return `transaction_confirmed`, the real hash, and an ArcScan URL. Rejection, failure, timeout, a reverted receipt, or a hash without the expected state returns no receipt hash.

## Circle configuration status

Treat these as distinct:

- **Implemented:** code and deterministic mocked-boundary tests exist.
- **Configured:** valid Circle sandbox environment values and console settings are present.
- **Live-confirmed:** one worker-controlled transaction has been independently confirmed on Arc.

This repository never infers live confirmation from implementation or configuration. See [the Circle checklist](../docs/V1_2_CIRCLE_SETUP.md).

## Legacy V0 API

The `/api/circle/vendor/*` routes remain unchanged for historical V0 evidence, including Legacy `buyClaim`. They are not the current Fidra product path. `submit-proof` and `request-spend` remain honest `501 not_implemented` stubs.

The optional gas seeder transfers Arc native testnet USDC only for transaction fees. It grants no protocol role and is disabled by default. Principal payouts continue to use the 6-decimal ERC-20 USDC contract.

## V1.4 self-service demo

`/try` uses durable, ignored `0600` workflow records and four bounded endpoints:

- `GET|POST /api/demo/workflow`
- `POST /api/demo/workflow/gas`
- `POST /api/demo/workflow/task`
- `POST /api/demo/workflow/settle`

The public API accepts no wallet destination, platform ID, amount, target,
calldata or transfer value. The exact Circle session wallet is the gas recipient
and claim worker. The configured sandbox platform signer is limited in code to a
fixed platform ID, fixed 0.10-USDC claim, certification of its own new claim,
exact USDC approval and settlement. Claim IDs 1–6 and platform IDs 1–2 are
rejected by the sandbox service.

Before enabling writes, register a fresh Arc Testnet platform to a dedicated
settlement key, fund its reserve through the one-time owner path, fund that
settlement wallet for one exact settlement, and configure a separate gas-funder
key. Review `docs/V1_4_ARCHITECTURE.md`; never use the protocol-owner key for
either runtime signer.

## Public hosting

The server accepts the host-provided `PORT` and binds to `HOST` (`0.0.0.0` by
default). `GET /api/health` is the minimal non-secret health-check endpoint.

For Render, use one paid instance with a persistent disk mounted at
`/var/data/fidra` and set `FIDRA_RUNTIME_DATA_DIR=/var/data/fidra`. This places
both `worker-wallets.json` and `demo-workflows.json` on the mounted disk. Do not
scale the JSON-backed service beyond one instance.

Set `SERVER_ALLOWED_ORIGINS` to the exact HTTPS frontend origin. If the frontend
and API are cross-site provider domains, set both `SESSION_COOKIE_SECURE=true`
and `SESSION_COOKIE_SAME_SITE=None`. A shared custom parent domain can retain
`SameSite=Lax`. Wildcard origins and insecure `SameSite=None` configurations
fail closed. See [`PUBLIC_DEPLOYMENT.md`](../docs/PUBLIC_DEPLOYMENT.md).
