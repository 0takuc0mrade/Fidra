# Fidra V1.1 controlled Arc Testnet deployment

Status: **prepared, not deployed**.

This runbook deploys the embedded instant-payout V1.1 contracts. It does not
modify, migrate, or replace the Legacy V0 deployment recorded in
`deployments/arc-testnet/latest.json`.

## Immutable source gate

The protocol-correctness milestone is commit:

```text
b2477d047f95f60288ec12e099f7b857492fd410
```

Deployment tooling must also be committed before any broadcast. The working
tree and upstream branch must be clean and point to the exact commit recorded
as `V1_GIT_COMMIT`.

## Network boundary

| Field | Required value |
| --- | --- |
| Network | Arc Testnet |
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| ERC-20 USDC | `0x3600000000000000000000000000000000000000` |
| USDC decimals | `6` |

Never use a production RPC, production token, native-token amount, or
production funds. Arc native USDC is used for gas; protocol balances use the
six-decimal ERC-20 interface.

## Required roles and amounts

The current contracts make reserve and vault deposits owner-only. Therefore:

- `V1_OWNER_ADDRESS`, `LIQUIDITY_PROVIDER_WALLET`, and
  `RESERVE_PROVIDER_WALLET` must be the same deployment signer;
- `PLATFORM_SETTLEMENT_WALLET` may be that signer for this controlled smoke;
- `WORKER_WALLET` must be a different address so unauthorized worker
  settlement can be tested honestly.

Suggested small test values:

| Parameter | Units | Amount |
| --- | ---: | ---: |
| Credit limit | `3000000` | 3 USDC |
| Advance fee | `100` bps | 1% |
| Platform reserve | `400000` | 0.4 USDC |
| Vault liquidity | `3000000` | 3 USDC |
| Success claim | `1000000` | 1 USDC |
| Default claim | `1000000` | 1 USDC |

The 0.4 USDC reserve deliberately demonstrates partial recovery on a 1 USDC
claim advanced for 0.99 USDC: 0.59 USDC realized loss and 0.6 USDC contractual
shortfall.

Populate `contracts/.env` from `.env.example`. Never store private keys there.
Use encrypted Foundry keystores and the CLI `--account` option.

## Fail-closed preflight

Before any broadcast:

1. Confirm `git status --short` is empty.
2. Confirm local HEAD equals the pushed upstream commit.
3. Confirm every required V1 environment key is nonempty.
4. Read chain ID, USDC bytecode, decimals, role balances, and allowances from
   Arc Testnet.
5. Confirm every V1 address differs from the V0 addresses.
6. Confirm the signer address equals `V1_OWNER_ADDRESS`.
7. Confirm the platform and worker each have native gas.
8. Confirm the owner has enough ERC-20 USDC for reserve plus vault liquidity.
9. Confirm the platform wallet has enough ERC-20 USDC to settle the success
   claim.
10. Run formatting, all Foundry tests/invariants, server tests and syntax
    checks, web tests, and the V0-import audit.

Stop on any missing value or inconsistency.

## Deployment dry run

Keep the explicit broadcast guard disabled:

```dotenv
V1_BROADCAST_CONFIRMED=false
```

Run:

```bash
cd contracts
set -a
source .env
set +a

forge script script/DeployFidraV11.s.sol:DeployFidraV11 \
  --rpc-url arc_testnet \
  --account fidra-arc-deployer \
  -vvvv
```

The summary must show `DRY RUN`, chain `5042002`, canonical USDC, the intended
role addresses, 3 USDC credit, and 100 bps fee.

## Deployment broadcast

Only after the dry run and all preflight gates succeed:

```dotenv
V1_BROADCAST_CONFIRMED=true
```

```bash
forge script script/DeployFidraV11.s.sol:DeployFidraV11 \
  --rpc-url arc_testnet \
  --account fidra-arc-deployer \
  --broadcast \
  --slow \
  -vvvv
```

Wait for all receipts. Record the three new addresses in `contracts/.env`:

```dotenv
V1_PLATFORM_REGISTRY_ADDRESS=<REAL_ADDRESS>
V1_EARNINGS_MANAGER_ADDRESS=<REAL_ADDRESS>
V1_ADVANCE_VAULT_ADDRESS=<REAL_ADDRESS>
```

All three addresses must contain bytecode and must differ from both V0
contracts.

## Record and check deployment

Record confirmed receipts without broadcasting:

```bash
forge script script/RecordFidraV11Deployment.s.sol:RecordFidraV11Deployment \
  --rpc-url arc_testnet \
  -vvvv

forge script script/CheckFidraV11Deployment.s.sol:CheckFidraV11Deployment \
  --rpc-url arc_testnet \
  -vvvv
```

The recorder writes only to `V1_DEPLOYMENT_ARTIFACT`; it never overwrites the
V0 ledger.

## Fund reserve and vault

Dry run first:

```bash
V1_BROADCAST_CONFIRMED=false forge script \
  script/FundFidraV11.s.sol:FundFidraV11 \
  --rpc-url arc_testnet \
  --account fidra-arc-deployer \
  -vvvv
```

If Forge's local simulation cannot model Arc USDC system calls, stop rather
than using `--skip-simulation`. Submit the exact approvals and owner-only
deposit calls individually with `cast send`, confirming each receipt before
the next call. Never replace `depositReserve` or `depositLiquidity` with a
direct token transfer.

After funding, the expected initial state is:

```text
platform reserve          = 400000
platform exposure         = 0
accountedCash             = 3000000
actualCash                = 3000000
accountedAssets           = 3000000
outstandingPrincipal      = 0
outstandingFaceValue      = 0
netLiquidityContributed   = 3000000
cashSurplus               = 0
cashDeficit               = 0
isCashReconciled          = true
```

## Successful claim smoke

Use real unique task and evidence hashes and a due date in the near future:

1. Platform calls `createClaim`.
2. Platform calls `certifyClaim`.
3. Read and record the immutable certified claim.
4. Worker calls `purchaseAdvance` and receives `990000`.
5. Worker attempts `settleClaim`; the transaction must fail.
6. Platform approves `1000000` USDC to the vault.
7. Platform calls `settleClaim`.

Expected successful-claim totals:

```text
platformSettlementAmount = 1000000
realizedProfit            = 10000
realizedLoss              = 0
terminal status           = Settled
```

Confirm exposure and both outstanding totals increase once at purchase and
decrease once at settlement.

## Partial-default smoke

Create and certify a second 1 USDC claim, then purchase it as the exact worker.
Use a short future due date and wait until the live Arc timestamp is strictly
greater than it. Call `triggerDefault`.

With the 0.4 USDC reserve:

```text
reserveRecoveryAmount = 400000
realizedLoss           = 590000
realizedProfit         = 0
contractualShortfall   = 600000
terminal status        = Defaulted
platform active        = false
```

Confirm the worker retains the completed `990000` payout, exposure is removed
once, new purchases fail while paused, and an existing outstanding claim can
still be repaid by the paused platform.

## Batch certification smoke

While the platform is active, submit
`createAndCertifyClaimsBatch` with at least two claims, equal-length arrays,
unique task hashes, and at most 50 entries. Confirm one created and one
certified event per item, certified status for every claim, and no exposure
change from certification alone.

This batch should occur before the default smoke pauses the platform.

## Source publication

Use Solidity `0.8.24`, optimizer enabled, 200 runs, and Blockscout:

```bash
forge verify-contract "$V1_PLATFORM_REGISTRY_ADDRESS" \
  src/PlatformRegistry.sol:PlatformRegistry \
  --chain-id 5042002 --verifier blockscout \
  --verifier-url https://testnet.arcscan.app/api/ \
  --constructor-args $(cast abi-encode "constructor(address)" "$USDC_ADDRESS")
```

Encode the exact live constructor arguments for `EarningsManager` and
`AdvanceVaultV2` in the same way. Source publication and deployed-bytecode
confirmation must be reported separately; publication is not an audit.

## Final evidence

Read final platform, claim, purchase, reserve, and vault totals directly from
Arc RPC. Add only real addresses, transaction hashes, blocks, statuses, and
ArcScan links to `deployments/arc-testnet/v1.1-latest.json`.

Do not commit or push deployment-generated evidence without a separate explicit
instruction.
