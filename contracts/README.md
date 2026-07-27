# Contracts

Foundry project for Fidra's Arc smart contracts. The current milestone implements:

- `MandateManager`: funded mandates, allowlisted vendor requests, proof and approval, irrevocable lock, controlled payee assignment, one-way authorized-vault freeze, deadline-backed permissionless release, revocation, and reserve-safe reclaim.
- `AdvanceVault`: owner-funded USDC liquidity, fixed-discount purchases with seller minimum/deadline protection, atomic single-use vault assignment, and repayment/spread accounting.

The contracts are live on Arc Testnet at the addresses recorded in [`deployments/arc-testnet/latest.json`](../deployments/arc-testnet/latest.json). The first 1 USDC smoke claim settled successfully after being advanced at a fixed 100 bps discount and released after parent-mandate revocation. The authorized, deliberately unfrozen `AdvanceVault` now has 5.01 USDC of accounted and available liquidity, including 0.01 USDC realized spread. Do not redeploy or freeze yet. Freezing permanently disables vault rotation but does not disable purchases by that vault. Live Circle integrations, LP shares, and vault withdrawals remain out of scope.

## Commands

```bash
forge build
forge test
```

Arc Testnet support lives in:

- `script/DeployFidra.s.sol`: validates Arc and ERC-20 USDC, deploys both contracts, authorizes the vault, and freezes only when explicitly requested;
- `script/CheckFidraDeployment.s.sol`: read-only live configuration and vault-accounting assertions;
- `script/PrepareVaultLiquidity.s.sol`: capped, read-only demo-liquidity readiness checks;
- `script/SmokeFidra.s.sol`: capped, read-only single-wallet smoke readiness and exact quote/hash generation; and
- `.env.example`: non-secret Arc configuration and post-deploy address fields.

Follow [`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) for verification, direct Arc RPC liquidity/smoke transactions, freeze, and frontend handoff commands. Arc USDC invokes protocol system contracts that Forge's local EVM may not model, so the liquidity and smoke scripts intentionally never broadcast. Do not commit private keys or a populated `.env`.

All contract amounts use the 6-decimal units of Arc's ERC-20 USDC interface. Tests use a local 6-decimal `MockUSDC` plus one fee-on-transfer rejection mock. Run the suite for the current passing test count.

See [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) and [`docs/SECURITY_INVARIANTS.md`](../docs/SECURITY_INVARIANTS.md) for the broader design and invariants.
