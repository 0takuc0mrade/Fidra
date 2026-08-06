# Fidra V1.4 controlled live-browser runbook

V1.4 remains incomplete until this runbook is executed with fresh dedicated
testnet accounts and separately authorized broadcasts. Do not use the protocol
owner as either runtime signer.

## One-time bootstrap

1. Generate two fresh Arc Testnet EOAs offline:
   - sandbox platform settlement signer;
   - worker gas-funding signer.
2. Record only their public addresses for review. Confirm both differ from the
   protocol owner/deployer and from each other.
3. With separate owner authorization, register the next unused platform ID to
   the sandbox platform address with:
   - credit limit no greater than 1.00 USDC;
   - 100-bps fee;
   - active status.
4. With separate owner authorization, deposit 0.10–0.20 USDC reserve for that
   platform. This owner-only restriction comes from the deployed registry.
5. Fund the sandbox platform wallet with enough Arc Testnet USDC to settle the
   approved daily demo budget and gas.
6. Fund the gas wallet within the approved daily budget while preserving its
   configured reserve floor.
7. Confirm the existing vault has enough accounted and actual cash. Add
   liquidity only through the separately authorized vault-owner bootstrap path.

## Ignored server configuration

Set the real values only in ignored `server/.env`, then enforce mode `0600`.

```dotenv
SANDBOX_WRITES_ENABLED=true
SANDBOX_PLATFORM_ID=<fresh-id-greater-than-2>
SANDBOX_PLATFORM_PRIVATE_KEY=<dedicated-platform-key>

WORKER_GAS_SEED_ENABLED=true
OPERATOR_SEED_PRIVATE_KEY=<dedicated-gas-key>
WORKER_GAS_SEED_USDC=0.04
MAX_WORKER_GAS_SEED_USDC=0.05
WORKER_GAS_DAILY_BUDGET_USDC=2
WORKER_GAS_WALLET_RESERVE_USDC=0.2
```

Never paste the private values into chat, source, logs, screenshots or evidence.

## Final preflight

- Exact Git branch and reviewed commit.
- Arc chain ID `5042002` and the three existing V1.1 addresses.
- Runtime signer addresses differ from the owner and each other.
- Sandbox signer exactly matches the fresh registered platform wallet.
- Platform ID is greater than 2, active, 100 bps, within credit limit, and above
  the reserve floor.
- Claim IDs 1–6 and platforms 1–2 unchanged.
- Gas and demo kill switches, per-wallet cap, daily budgets and reserve floor.
- Foundry, invariants, server, web, production build, isolation and secret scan.

Stop on any mismatch.

## Fresh browser test

1. Start at `/try` with a new Circle sandbox email.
2. Complete OTP and retrieve/create its Arc EOA.
3. Confirm one gas check and, if needed, one real funding receipt.
4. Refresh; confirm the same workflow and receipt recover.
5. Complete the task twice; confirm one claim ID and one creation/certification
   pair.
6. Select `Get paid now` twice; confirm one Circle challenge/operation.
7. Approve once in Circle.
8. Refresh during Arc confirmation; confirm polling resumes.
9. Confirm the exact 0.099-USDC gross worker transfer independently on Arc.
10. Refresh before settlement; confirm automatic settlement resumes.
11. Confirm the platform settles exactly 0.10 USDC, claim becomes Settled,
    exposure returns to zero, reserve is unchanged and vault cash reconciles.
12. Retry settlement; confirm the original receipt is returned and no second
    transaction is sent.

Record only public addresses, operation correlations, hashes, receipts,
balances and accounting. Do not commit the evidence without separate approval.

## Reset/repeat

Completion never deletes chain history. A completed Circle user may start a new
workflow, producing a new task hash and claim, subject to all daily budgets. To
reset presentation state without new chain writes, sign in with a fresh Circle
sandbox user. Historical workflows remain durable audit records.
