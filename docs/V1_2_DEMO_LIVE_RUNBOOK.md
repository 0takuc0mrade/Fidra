# Fidra V1.2 demo and live-evidence runbook

## Safe hackathon demo

1. Start the server and web app.
2. Open `/platform` in default Live Mode to show the current platform state, exposure, reserve, and vault accounting.
3. Open `/platform/claims` to show claim 1 settled, claims 2–3 certified as the batch, claim 4 defaulted, and claim 5 settled while paused.
4. Open `/platform/claims/new` to show that new certification is disabled while paused.
5. Open `/platform/settlements` to show that repayment remains available to an authorized platform signer.
6. Open `/worker/claims/2` to show exact worker/Circle/platform eligibility states. Do not claim it is payable if it is expired or the platform remains paused.
7. For judge or auditor verification outside the product UI, open `deployments/arc-testnet/v1.1-latest.json` and its recorded ArcScan receipts. Do not present the deployment ledger as a customer feature.

## Circle configured demo

Only after credentials are present and a separately authorized fresh live claim exactly names the Circle EOA:

1. Authenticate in Circle's email OTP or Google window.
2. Retrieve the Arc Testnet EOA and verify the public address against the claim.
3. Review the six-decimal quote and fee.
4. Select `Get paid now` and approve Circle's challenge.
5. Show Circle pending while Arc verification is incomplete.
6. Show the ArcScan receipt only after the server returns `transaction_confirmed`.
7. Refresh and show claim `Advanced` and purchase `Outstanding`.

If Circle is absent, stop at the honest `Circle not configured` state. If any validation, approval, Circle status, Arc receipt, or post-state check fails, show the failure and no receipt.

## Explicit demo mode

Use the sidebar switch or `?mode=demo`. Demo Mode is for presentation data only. Never combine a demo claim, balance, status, or transaction with a Live Mode label or a real ArcScan link.

## Current limitation

No new live Circle V1 claim or transaction has been created in this milestone run. The V1.1 deployment receipts are real; Circle worker live confirmation remains a separate status until the controlled flow is performed and independently verified.
