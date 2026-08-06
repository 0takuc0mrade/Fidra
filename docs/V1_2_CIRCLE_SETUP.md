# Fidra V1.2 Circle setup

Circle configuration, V1.2 implementation, and a live-confirmed worker payout are separate statuses. Missing credentials must produce `not_configured`; do not enable a mock runtime success path.

## Required Circle sandbox configuration

1. Create or select a Circle Developer Console sandbox application for User-Controlled Wallets.
2. Obtain the server-only API key and public app ID.
3. Enable email OTP and configure the required email/SMTP settings in Circle's console.
4. Optional: configure Google authentication and its client ID.
5. Add the local or deployed frontend origin to `SERVER_ALLOWED_ORIGINS`.
6. Use TLS and secure cookies outside local development.

`server/.env`:

```dotenv
CIRCLE_WALLETS_ENABLED=true
CIRCLE_MOCK_MODE=false
CIRCLE_ENV=sandbox
CIRCLE_API_KEY=<server-only Circle sandbox key>
CIRCLE_APP_ID=<Circle app ID>
CIRCLE_GOOGLE_CLIENT_ID=<optional Google client ID>
```

Never put the API key, entity secret, operator seed key, OTP, user token, refresh token, or device encryption key in `web/.env*`, logs, Git, screenshots, deployment artifacts, or support messages.

## Arc configuration

Use the public V1.1 values already present in `.env.example`. The Circle wallet must be an `ARC-TESTNET` `EOA`. Its address must exactly equal the worker address of any claim it purchases. It receives no owner, platform, reserve, liquidity, vault, or settlement role.

The optional worker gas seeder is testnet-only and disabled by default. If used, configure a dedicated runtime signer and keep both the amount and maximum small. Manual Arc Testnet native USDC funding is acceptable.

## Readiness checks

```bash
cd server
npm run check
npm test

cd ../web
npm test
npm run build
```

Then start both services and verify:

- `/api/circle/status` reports wallets `configured`;
- email OTP works in Circle's own window;
- optional Google login works only when configured;
- Circle retrieves or creates an Arc Testnet EOA;
- browser and server logs contain no tokens or credentials; and
- no transaction is shown confirmed without an independently verified Arc receipt.

Do not create or certify a live test claim until all repository validation passes and a separate controlled-live-run authorization is given.
