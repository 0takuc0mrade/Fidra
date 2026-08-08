# Fidra Web

Fidra Web is a React 19 and Vite 6 product interface for live V1.1 worker payouts and trusted platform operations. Legacy V0 screens remain present and explicitly labelled as historical evidence.

## V1 routes

- `/worker` and `/worker/claims` — live V1.1 earnings claims and Circle worker wallet state;
- `/worker/claims/:claimId` — exact worker ownership, quote, fee, normal payout date, Circle approval, Arc verification, and receipt;
- `/platform` — platform status, credit, exposure, reserve, fee, and live claims;
- `/platform/claims` — live V1 claim and purchase status;
- `/platform/claims/new` — trusted settlement-wallet draft creation and irreversible certification;
- `/platform/batches` — bounded atomic create-and-certify transaction; and
- `/platform/settlements` — USDC approval and settlement, including repayment while paused.

Legacy routes remain `/overview`, `/mandates/*`, `/claims`, `/activity`, and `/vendor-onboarding`.

## Live and demo behavior

Live Mode is the default. It reads the configured Arc contracts and fails visibly when RPC or configuration is unavailable. It never falls back to sample data. Demo Mode requires an explicit sidebar selection, `?mode=demo`, local preference, or `VITE_DEMO_MODE=true`.

Confirmed deployment evidence remains in `deployments/arc-testnet/v1.1-latest.json`; it is not exposed as a customer-facing web route.

## Configuration

```bash
cp .env.example .env.local
npm install
npm run dev
```

The checked-in example contains only public Arc addresses and blank/non-secret client configuration. Circle secrets belong only in `server/.env` and never use a `VITE_` prefix.

For Cloudflare Pages, use `web` as the project root, `npm run build` as the
build command, and `dist` as the output directory. Set `VITE_API_BASE_URL` to
the exact public HTTPS API origin. The checked-in `_redirects` rule sends direct
SPA routes such as `/try` and `/worker/claims/:id` to `index.html`.

## Worker transaction boundary

The web app uses Circle's official SDK for email OTP or configured Google authentication, EOA creation, and worker approval. It sends the public claim ID and minimum quote to the Fidra server. The server creates the challenge and returns an operation ID; after SDK approval, the browser binds Circle's transaction ID and polls the operation.

The UI displays a confirmed payout only when the server has independently verified the Arc receipt and V1 claim/purchase state. Failure and timeout states never render a hash. A connected wallet mismatch shows the expected worker and connected public addresses without falling back to another wallet.

## Trusted platform writes

Platform writes use the injected Arc Testnet wallet. Each action validates chain ID and signer authorization, simulates the contract call, sends through the wallet, waits for a successful receipt, and displays the real ArcScan URL. New claims and certifications are disabled while the live platform is paused. Settlement remains available to an authorized payer while paused.

## Commands

```bash
npm run sync:abis
npm test
npm run build
```

`sync:abis` generates curated ABIs from the existing Foundry build artifacts. Do not hand-maintain V1 ABI fragments.
