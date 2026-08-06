# Fidra V1.4 self-service testnet architecture

## Product boundary

`/try` is a single successful-flow testnet experience. Circle controls the
worker wallet and worker approval. Fidra's server controls only two dedicated
Arc Testnet accounts: a small gas-funding account and the settlement account of
a dedicated sandbox platform. Neither account is the protocol owner or deployer.

The deployed V1.1 contracts are reused without modification. Platform 1,
claims 1–5 and V1.3 claim 6 remain read-only evidence.

## Trust and signing model

| Signer | May sign | Must never sign |
|---|---|---|
| Circle worker | `AdvanceVaultV2.purchaseAdvance(claimId)` after explicit approval | Platform, owner, reserve, liquidity or arbitrary calls |
| Sandbox platform | One bounded `createClaim`, its `certifyClaim`, exact USDC approval, and `settleClaim` for the same workflow | Owner calls, defaults, arbitrary targets/calldata/value, other platforms or historical claims |
| Gas funder | One bounded native Arc Testnet USDC transfer to the exact authenticated Circle wallet | Arbitrary recipients, contract calls, principal payouts or protocol roles |
| Protocol owner | One-time platform registration and reserve/bootstrap funding | Any public-session request |

Every server signer is chain-ID and address allowlisted. Configuration fails
closed when keys are absent, equal to each other, equal to the protocol owner,
or resolve to an unexpected registered platform wallet.

## Durable workflow

The durable record is keyed by a random demo session ID and correlated to a
one-way Circle user reference. It stores only public chain identifiers and
workflow state: worker address, external task ID/hash, platform ID, claim ID,
funding/creation/certification/advance/settlement operations and receipts,
timestamps and errors. Circle user tokens, device encryption keys, OTPs, PINs
and private keys are excluded.

Writes use an atomic temporary-file rename with mode `0600`. Mutations are
serialized per workflow. A retry first reconciles the saved transaction and
current Arc state, then either returns the existing result or advances exactly
one incomplete stage.

## Public endpoints

- `GET /api/demo/workflow` — recover the authenticated user's current workflow.
- `POST /api/demo/workflow` — create or return one active workflow.
- `POST /api/demo/workflow/gas` — seed only the session's exact Circle wallet.
- `POST /api/demo/workflow/task` — create and certify one fixed-size claim.
- `POST /api/demo/workflow/settle` — settle only the workflow's verified advanced claim.
- Existing Circle worker challenge endpoints remain the only purchase path.

There is no generic contract-execution, target-address, calldata, value-transfer
or claim-parameter endpoint.

## Limits and kill switches

- `SANDBOX_WRITES_ENABLED` globally disables claim and settlement writes.
- `WORKER_GAS_SEED_ENABLED` independently disables funding.
- Fixed `SANDBOX_PLATFORM_ID`, contract addresses and Arc chain ID.
- Fixed demo face value, maximum claim value and due-date offset.
- Per-wallet once-only gas seed, per-wallet cap, daily global budget and funding
  wallet reserve floor.
- Per-session/IP/user/email-hash request throttles at the HTTP boundary.
- Historical platform and claim IDs are rejected even if supplied indirectly.

## Verification standard

Circle status is correlation data, never final truth. Fidra independently reads
the Arc receipt, transaction sender, AdvanceVaultV2 target and calldata, worker
transfer, claim/purchase state, platform exposure and vault accounting. Automatic
settlement begins only after this verification. Completion requires a successful
settlement receipt, `Settled` claim/purchase state, zero workflow exposure delta
and reconciled vault cash.

## Bootstrap still requiring an operator

The protocol owner must register one fresh platform and fund its initial reserve;
the vault owner must ensure bounded demo liquidity. These are one-time testnet
bootstrap actions, not tester actions. V1.4 code must be reviewed and dedicated
keys funded before any broadcast. No live bootstrap is authorized by this
implementation milestone.
