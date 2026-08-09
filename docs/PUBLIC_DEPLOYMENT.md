# Fidra V1.5 public hackathon deployment

Status: deployment preparation only. No public service has been created and no
Arc transaction is authorized by this document.

## Scope

V1.5 publishes the existing V1.4.1 `/try` flow over HTTPS. It does not change,
upgrade, or redeploy the V1.1 contracts, and it does not modify Legacy V0 or the
protocol's financial semantics.

The initial hosting target is:

- Vercel for the Vite frontend;
- one free Render Node web service for the API; and
- Neon Free Postgres for durable workflow state.

The Render filesystem is treated as ephemeral. Hosted state, idempotency,
budgets, operation correlation and rate limits live in Postgres. A shared custom
parent domain is preferred; cross-site origins require `SameSite=None; Secure`.

## Build and runtime inventory

| Concern | Configuration |
| --- | --- |
| Backend root | `server` |
| Backend install/build | `npm ci` (no compile step) |
| Backend start | `npm start` |
| Backend bind | `HOST=0.0.0.0`, host-provided `PORT` |
| Health check | `GET /api/health` |
| Frontend root | `web` |
| Frontend build | `npm ci && npm run build` |
| Frontend output | `web/dist` |
| Frontend API | `VITE_API_BASE_URL=https://<backend-host>` |
| SPA fallback | `vercel.json` |
| Durable state | Neon Postgres through server-only `DATABASE_URL` |
| Database setup | `npm run db:migrate`; `npm run db:status` |

Postgres contains only hashed Circle user references, public wallet metadata,
gas-seed receipts, workflows, operation correlation, budgets and rate limits.
Circle user tokens, refresh tokens, OTPs, device encryption material, email
addresses, session cookies and private keys must never be written there. Circle
sessions intentionally remain in memory and therefore
require reauthentication after a backend restart; the durable workflow is then
re-associated through the hashed Circle user identifier and verified wallet.

Rate limits, once-per-wallet gas reservations and daily gas/claim budgets use
atomic Postgres operations. Contracts independently enforce claim ownership,
platform credit, reserve, exposure and one-purchase/one-settlement rules.

## Backend environment

Set secrets only in Render's environment manager. Never upload `server/.env`.

Required public/non-secret values:

```dotenv
NODE_ENV=production
NODE_OPTIONS=--dns-result-order=ipv4first --no-network-family-autoselection
HOST=0.0.0.0
ARC_CHAIN_ID=5042002
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_BLOCK_EXPLORER_URL=https://testnet.arcscan.app
USDC_ADDRESS=0x3600000000000000000000000000000000000000
V1_PLATFORM_REGISTRY_ADDRESS=0x20EcB05d90D4F24F8Fcf2785BdE240796B8b1af3
V1_EARNINGS_MANAGER_ADDRESS=0xdC1C359fC174Fb8C7cDcbE0e09447d123dD9cD57
V1_ADVANCE_VAULT_ADDRESS=0x12604e5acD074D3499C9ac4D2cbb4Bd39ECE49c5
V1_DEPLOYMENT_BLOCK=55168614
PROTOCOL_OWNER_ADDRESS=0xeC68c705001a158d0f810182Ca205887679E33f5
SERVER_ALLOWED_ORIGINS=https://<frontend-host>
SESSION_COOKIE_SECURE=true
SESSION_COOKIE_SAME_SITE=None
```

Use `SESSION_COOKIE_SAME_SITE=Lax` instead when the frontend and API use the
same registrable custom domain (for example, `app.example.com` and
`api.example.com`). Never configure `SERVER_ALLOWED_ORIGINS=*`.

Required server-only secrets and controlled-write settings:

```dotenv
CIRCLE_WALLETS_ENABLED=true
CIRCLE_MOCK_MODE=false
CIRCLE_ENV=sandbox
CIRCLE_API_KEY=<Render secret>
CIRCLE_APP_ID=<Circle application ID>
DATABASE_URL=<Neon pooled connection string>
DATABASE_POOL_MAX=5
WORKER_GAS_SEED_ENABLED=false
OPERATOR_SEED_PRIVATE_KEY=<Render secret>
SANDBOX_WRITES_ENABLED=false
SANDBOX_PLATFORM_ID=3
SANDBOX_PLATFORM_PRIVATE_KEY=<Render secret>
```

Copy the already validated caps, budgets, reserve floors, and timeouts from the
local configuration. Keep `SANDBOX_WRITES_ENABLED=false` through the first
read-only deployment and security preflight. The owner/deployer private key
must not exist in the hosted environment.

## Frontend environment

Only public values may use the `VITE_` prefix:

```dotenv
VITE_DEMO_MODE=false
VITE_API_BASE_URL=https://<backend-host>
VITE_ARC_RPC_URL=https://rpc.testnet.arc.network
VITE_CHAIN_ID=5042002
VITE_USDC_ADDRESS=0x3600000000000000000000000000000000000000
VITE_ARC_BLOCK_EXPLORER_URL=https://testnet.arcscan.app
VITE_V1_PLATFORM_REGISTRY_ADDRESS=0x20EcB05d90D4F24F8Fcf2785BdE240796B8b1af3
VITE_V1_EARNINGS_MANAGER_ADDRESS=0xdC1C359fC174Fb8C7cDcbE0e09447d123dD9cD57
VITE_V1_ADVANCE_VAULT_ADDRESS=0x12604e5acD074D3499C9ac4D2cbb4Bd39ECE49c5
VITE_V1_LIVE_PLATFORM_ID=3
```

Circle's API key, signer keys, SMTP values, tokens, and session material must
never be present in the Vercel environment or built JavaScript.

## Deployment order

1. Secret-scan the working tree and V1.4.1 evidence. Keep evidence publication
   separate unless explicitly authorized.
2. Configure Neon, run the versioned migrations, and confirm `db:status` without
   exposing the connection string.
3. Deploy the Render API from the approved branch with both write switches
   disabled and a health check at `/api/health`.
4. Confirm HTTPS, health, Circle configuration status, Arc reads, database
   reachability/schema readiness and restart persistence. Do not start a demo workflow.
5. Deploy the Vite app to Vercel with the API URL set to the exact
   Render HTTPS origin. Confirm direct-route refreshes and that the production
   bundle contains no localhost or secret values.
6. Add the exact Vercel origin to `SERVER_ALLOWED_ORIGINS`. Configure the Circle
   application for the hosted browser origin if Circle requires it.
7. Verify the sandbox signer and gas-funder addresses from the configured
   private keys without printing either key. Confirm they differ from the owner
   and from each other, then verify platform 3, reserve, vault liquidity, gas
   balance, caps, budgets, rate limiting, and both kill switches.
8. Enable `SANDBOX_WRITES_ENABLED=true` only after that review.
9. Run one fresh incognito `/try` journey with no terminal or MetaMask. Capture
   only public URLs, addresses, receipts, balances, and final state.
10. Restart the backend, reauthenticate, and confirm the completed workflow and
   receipts recover from Postgres. Confirm retrying does not create
   another seed, claim, advance, or settlement.

## Immediate stop conditions

Disable sandbox writes and stop the hosted test on any signer mismatch, wrong
chain or contract address, permissive CORS response, missing secure cookie,
unreachable/outdated database, budget divergence, unexpected
nonce/state, duplicate financial action, receipt mismatch, or secret exposure.

The public deployment remains an Arc Testnet hackathon demo. It must not be
described as a production deployment.
