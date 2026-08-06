# Fidra V1.2 embedded platform interface

The platform console is a direct Arc Testnet wallet integration over the deployed V1.1 contracts. It does not use Circle worker authentication for administration.

## Routes and actions

| Route | Capability |
|---|---|
| `/platform` | status, credit, exposure, reserve, fee, operating state |
| `/platform/claims` | claim and purchase status |
| `/platform/claims/new` | create Pending claim; certify a Pending claim separately |
| `/platform/batches` | atomically create and certify 1–50 claims |
| `/platform/settlements` | approve exact USDC and settle an Outstanding claim |

Single claim fields map to `createClaim(platformId, worker, faceValue, dueDate, taskHash, evidenceHash)`. Plain task/evidence references are hashed client-side with Keccak-256 unless the platform supplies a full bytes32 hash. Certification calls `certifyClaim(claimId)` and is presented as irreversible.

Batch input is a JSON array with `worker`, decimal `faceValue`, future `dueDate`, `taskReference`, and `evidenceReference`. It maps to `createAndCertifyClaimsBatch` and remains bounded by the contract maximum of 50.

Settlement first approves the exact claim face value in USDC, then calls `settleClaim(claimId)`. The signer must be the platform settlement wallet or an authorized settlement operator. Paused status blocks new claims and certification but deliberately does not block repayment.

## Write guarantees

Every write:

1. requires an injected wallet;
2. requires Arc Testnet chain ID `5042002`;
3. reads the current platform and checks signer authority;
4. enforces paused restrictions in the interface;
5. simulates the exact contract request;
6. submits through the user's wallet;
7. waits for a successful receipt; and
8. shows the real ArcScan link.

Contract reverts remain the final authority if state changes between simulation and mining. No UI error path generates a placeholder hash or success state.
