# Fidra V1.4 terminal-action audit

This audit records every terminal-only action remaining after the V1.3 live
Circle payout. It is written before V1.4 implementation. V1.1 contracts and
Legacy V0 remain unchanged.

## Action classification

| Operation | V1.3 terminal path | V1.4 classification | Browser replacement | Authority boundary |
|---|---|---|---|---|
| Deploy V1 contracts | `forge script DeployFidraV11` | One-time deployment/bootstrap | None. Existing verified deployment is reused. | Protocol owner; never public. |
| Authorize vaults | owner `cast send` | One-time deployment/bootstrap | None. Already complete. | Protocol owner; never public. |
| Register a platform | owner `registerPlatform` | One-time deployment/bootstrap | Operator runbook records one fresh sandbox platform ID. | Protocol owner only; never reachable from the public API. |
| Configure platform credit/fee | owner `updatePlatform` | One-time deployment/bootstrap | Fixed sandbox configuration, displayed read-only. | Protocol owner only. |
| Fund platform reserve | owner USDC approval + `depositReserve` | One-time deployment/bootstrap | Operator runbook; reserve is monitored in `/try`. | Protocol owner only because the deployed registry restricts reserve deposits. |
| Fund vault liquidity | owner USDC approval + `depositLiquidity` | One-time deployment/bootstrap | Operator runbook; liquidity is displayed read-only. | Vault owner only; never public. |
| Create a claim | platform `createClaim` | Authenticated platform action; restricted sandbox-operator action in `/try` | `Complete demo task` creates one bounded claim for the authenticated Circle wallet. Platform Console retains authorized-wallet mode. | Exact registered platform settlement signer. |
| Certify one claim | platform `certifyClaim` | Authenticated platform action; restricted sandbox-operator action in `/try` | The demo service certifies only the claim it just created. Platform Console retains authorized-wallet mode. | Exact registered platform settlement signer. |
| Certify a batch | platform `createAndCertifyClaimsBatch` | Authenticated platform action | Platform Console through an authorized browser wallet. Not exposed to public `/try`. | Exact registered platform settlement signer. |
| Cancel a pending claim | platform `cancelClaim` | Authenticated platform action | Not part of the public demo. May be added to the authenticated Platform Console. | Exact registered platform settlement signer; pending claims only. |
| Fund worker gas | deployer native transfer | Restricted sandbox-operator action | Authenticated Circle wallet receives a bounded, idempotent seed when below the configured threshold. | Dedicated testnet funding signer; exact session wallet only. |
| Purchase an advance | worker `purchaseAdvance` | Public worker action | Existing Circle user-controlled challenge. | Exact claim worker approves in Circle; server never signs. |
| Settle a purchased claim | platform USDC approval + `settleClaim` | Authenticated platform action; restricted sandbox-operator action in `/try` | Automatic settlement after independent advance verification; Platform Console retains authorized-wallet mode. | Dedicated registered sandbox platform signer. |
| Trigger a default | `triggerDefault` | Historical evidence only | No mutation control. V1.1 default evidence is read-only. | Public `/try` and sandbox APIs explicitly forbid it. |
| Inspect platform, claims, purchases, receipts and accounting | `cast call`, `cast receipt` | Read-only frontend action | `/try`, Worker, Platform Console and Legacy Evidence read Arc directly or through bounded read endpoints. | No signing authority. |
| Reset the demo | manual creation of another claim/platform | Restricted sandbox-operator action | A completed authenticated user can start a new uniquely identified workflow, subject to budgets and limits. Reset never deletes or rewrites chain history. | Server workflow state only; no owner action. |

## Terminal-free public journey

After the one-time sandbox platform bootstrap, a tester needs only `/try` and
Circle email authentication. Gas funding, one task, one claim, certification,
worker approval, independent verification, automatic settlement and receipt
inspection are browser-driven. No public endpoint accepts a destination address,
contract address, calldata, transfer value, platform ID, claim face value or
settlement amount.

## Actions intentionally left outside the public journey

- Deployment and vault authorization.
- Platform registration, updates, pause/unpause and reserve funding.
- Vault liquidity deposits and withdrawals.
- Default triggering.
- Mutation of platform 1 or claims 1–6.
- Arbitrary platform batches from the sandbox signer.

These actions remain owner or authenticated-platform operations because making
them public would widen authority rather than improve the tester journey.
