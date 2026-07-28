# Fidra contracts

Foundry project for Fidra's current embedded instant-payout protocol.

## Current V1.1 contracts

- `PlatformRegistry`: platform settlement wallets, status, credit limits,
  purchased-claim exposure, reserves, settlement delegates, and advance fees.
- `EarningsManager`: immutable certified worker earnings claims and bounded
  atomic batch certification.
- `AdvanceVaultV2`: principal-booked worker advances, authorized platform
  settlement, reserve-backed default resolution, and explicit cash
  reconciliation.

V1.1 has not yet been deployed. The controlled Arc Testnet scripts are:

- `script/DeployFidraV11.s.sol`: deploys and links fresh V1.1 contracts and
  registers one small test platform;
- `script/FundFidraV11.s.sol`: funds its small reserve and vault liquidity;
- `script/CheckFidraV11Deployment.s.sol`: verifies live linkage, roles,
  platform state, and accounting;
- `script/RecordFidraV11Deployment.s.sol`: records confirmed Foundry receipts
  in a V1.1-specific JSON artifact.

Each mutating V1.1 script distinguishes dry-run from broadcast context and
requires `V1_BROADCAST_CONFIRMED=true` in broadcast mode. No script reads a raw
private key.

See
[`docs/V1_1_ARC_TESTNET_DEPLOYMENT.md`](../docs/V1_1_ARC_TESTNET_DEPLOYMENT.md)
for the fail-closed runbook.

## Commands

```bash
forge fmt --check
forge build
forge test -vv
```

All protocol amounts use the six-decimal Arc ERC-20 USDC interface. V1.1 tests
use a local six-decimal `MockUSDC`.

## Legacy V0

`MandateManager` and `AdvanceVault` remain unchanged as historical Arc Testnet
evidence. Their deployment scripts, smoke scripts, addresses, and live ledger
must not be reused or overwritten by V1.1. The canonical V0 artifact remains
[`deployments/arc-testnet/latest.json`](../deployments/arc-testnet/latest.json).
