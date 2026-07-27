# Arc Testnet deployment

Fidra's `MandateManager` and `AdvanceVault` are live on Arc Testnet. The canonical local record is [`deployments/arc-testnet/latest.json`](../deployments/arc-testnet/latest.json), and the read-only checker has passed against both contracts.

> **Do not redeploy. Do not freeze the authorized vault yet.** The 5 USDC liquidity deposit, first end-to-end smoke claim, and frontend read confirmation against mandate `1` / spend `1` are complete. The remaining gates are source publication/verification if possible, independent permanent-vault confirmation, and an explicit owner decision.

The scripts are Fidra-specific. Do not reuse old FAsset deployment scripts or addresses.

## Network and accounting boundary

| Parameter | Value |
| --- | --- |
| Network | Arc Testnet |
| Chain ID | `5042002` |
| RPC environment key | `ARC_RPC_URL` |
| Default RPC | `https://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| ERC-20 USDC interface | `0x3600000000000000000000000000000000000000` |
| Fidra token decimals | `6` |

## Live deployment

| Field | Value |
| --- | --- |
| MandateManager | [`0xEfA2b3e70138810eA51552177c3f1AE5ab249EF2`](https://testnet.arcscan.app/address/0xEfA2b3e70138810eA51552177c3f1AE5ab249EF2) |
| AdvanceVault | [`0x5F7Bec9eC341F816182a56D8E033cac63DBd8C8B`](https://testnet.arcscan.app/address/0x5F7Bec9eC341F816182a56D8E033cac63DBd8C8B) |
| Owner | `0xeC68c705001a158d0f810182Ca205887679E33f5` |
| Discount | `100 bps` / `1%` |
| Authorized vault frozen | `false` |
| Last verified vault liquidity | `5.010000 USDC` |
| First live mandate / spend | `1` / `1` — settled |

Deployment and funding evidence:

- [MandateManager deployment transaction](https://testnet.arcscan.app/tx/0xfd80556d75852b719a4c30566bfb32c2e66d4de20a4b31f608ebbfd185bc5400), block `51683343`;
- [AdvanceVault deployment transaction](https://testnet.arcscan.app/tx/0xec03528e9f33277e09f89198f2b56623e1b36b9cf0fe25301c01c76e6e614cb2), block `51683350`;
- [vault authorization transaction](https://testnet.arcscan.app/tx/0xe4fe5a23327703d29980f6caa1f38df1cb88091fc0412ee2f2c37cef0be7ace0), block `51683353`;
- [5 USDC allowance transaction](https://testnet.arcscan.app/tx/0xa3a95c09283ef11c752a31df59836f2f07fa5b5a287c7cb64ac21613582a4dba), block `51688809`; and
- [5 USDC accounted liquidity deposit](https://testnet.arcscan.app/tx/0x5ee8ef7c8f60414055a2694111b708381257cb9286cdc5278a643ebffc9a833d), block `51689037`.

The complete first-smoke transaction ledger, including mandate creation, lock, purchase, post-revocation release, and settlement, is recorded in [`deployments/arc-testnet/latest.json`](../deployments/arc-testnet/latest.json). Final verification at block `51691257` confirmed `0.99 USDC` advanced, `1 USDC` repaid, `0.01 USDC` realized spread, and `5.01 USDC` available liquidity.

Arc uses native USDC for gas and exposes a separate ERC-20 interface for contract interaction. Wallets and RPC tools may display native gas USDC with 18-decimal behavior. Fidra principal, budgets, reserves, advances, discounts, and settlement use only the ERC-20 interface above and 6-decimal integer units. Never use a native balance or `msg.value` as protocol funding.

`DeployFidra.s.sol` refuses to run outside chain `5042002`, refuses a noncanonical USDC address, and checks that the configured token contract reports six decimals before broadcasting.

## Add Arc Testnet to MetaMask

In MetaMask, open **Settings → Networks → Add network → Add a network manually**, then enter:

| Field | Value |
| --- | --- |
| Network name | Arc Testnet |
| RPC URL | `https://rpc.testnet.arc.network` |
| Chain ID | `5042002` |
| Currency symbol | `USDC` |
| Block explorer | `https://testnet.arcscan.app` |

Save and switch to Arc Testnet. These values match the [official Arc wallet setup](https://docs.arc.io/arc/references/connect-to-arc).

## Get Arc Testnet USDC

Use the [Circle testnet faucet](https://faucet.circle.com), select Arc Testnet, and enter the deployer address. Testnet tokens have no financial value. Faucet limits and availability can change, so follow the current instructions on that page.

The deployer needs enough native USDC to pay deployment gas. The vault owner also needs ERC-20 USDC if it will fund `AdvanceVault`. Check the two views separately:

```bash
cast balance <DEPLOYER_ADDRESS> --rpc-url "$ARC_RPC_URL"
cast call "$USDC_ADDRESS" "balanceOf(address)(uint256)" <DEPLOYER_ADDRESS> --rpc-url "$ARC_RPC_URL"
cast call "$USDC_ADDRESS" "decimals()(uint8)" --rpc-url "$ARC_RPC_URL"
```

The second command returns ERC-20 units, where `1 USDC = 1_000_000`.

## Prepare configuration

From the repository root:

```bash
cd contracts
cp .env.example .env
```

Review `.env`. The live configuration is:

```dotenv
ARC_RPC_URL=https://rpc.testnet.arc.network
USDC_ADDRESS=0x3600000000000000000000000000000000000000
ADVANCE_DISCOUNT_BPS=100
FREEZE_AUTHORIZED_VAULT=false
MANDATE_MANAGER_ADDRESS=0xEfA2b3e70138810eA51552177c3f1AE5ab249EF2
ADVANCE_VAULT_ADDRESS=0x5F7Bec9eC341F816182a56D8E033cac63DBd8C8B
EXPECTED_OWNER=0xeC68c705001a158d0f810182Ca205887679E33f5
```

For the `cast` examples in the rest of this shell session, export the non-secret configuration:

```bash
set -a
source .env
set +a
```

`100` basis points means the vault advances 99% of face value and targets a 1% gross spread. The contract permits `1` through `3000` basis points. Pricing is fixed for this MVP.

The local `.env` is ignored. Do not put a real private key in `.env`, source control, shell history, documentation, screenshots, or support messages. `PRIVATE_KEY` exists in `.env.example` only to document the discouraged runtime fallback and must remain blank in saved files.

## Use an encrypted Foundry keystore

Import the deployer into Foundry's encrypted keystore using hidden interactive prompts:

```bash
cast wallet import fidra-arc-deployer --interactive
cast wallet address --account fidra-arc-deployer
```

The account is stored under `~/.foundry/keystores`, outside the repository, and Forge prompts for its password. A hardware wallet or production multisig/timelock is preferable for production administration; the hackathon deployer is still a privileged owner until ownership is transferred.

As an ephemeral alternative, Forge supports `--interactive` instead of `--account`; it prompts for a key at runtime without putting it in the command. If automation absolutely requires a raw key, inject it through the runtime secret manager and pass `--private-key "$PRIVATE_KEY"`, then unset it immediately. Never save that value in the project.

## Historical deployment tooling — do not rerun

`DeployFidra.s.sol` remains in the repository for reproducibility and disaster-recovery review. Running it again creates a different manager/vault pair and is outside this milestone. The commands below document how the live deployment was prepared; they are not a next step.

### Preflight and dry run

Compile and test first:

```bash
forge fmt --check
forge build
forge test -vv
```

Run the script without `--broadcast`. This simulates the complete deployment and configuration against Arc Testnet:

```bash
forge script script/DeployFidra.s.sol:DeployFidra \
  --rpc-url arc_testnet \
  --account fidra-arc-deployer \
  -vvvv
```

Check the output carefully. It must show chain ID `5042002`, the canonical USDC address, the intended discount, and `Freeze authorized vault: false`. A dry run does not deploy contracts.

### Broadcast the deployment

Only after the dry run succeeds:

```bash
forge script script/DeployFidra.s.sol:DeployFidra \
  --rpc-url arc_testnet \
  --account fidra-arc-deployer \
  --broadcast \
  --slow \
  -vvvv
```

The script performs, in order:

1. deploy `MandateManager` with Arc ERC-20 USDC;
2. deploy `AdvanceVault` with Arc ERC-20 USDC, the new manager, and `ADVANCE_DISCOUNT_BPS`;
3. authorize the new vault in the manager; and
4. freeze that authorization only if `FREEZE_AUTHORIZED_VAULT=true` was explicitly configured.

It prints both addresses, owner, configuration, freeze state, and ArcScan links. Foundry also writes local broadcast receipts under `contracts/broadcast/`; that directory is ignored and is not a substitute for checking ArcScan.

**Do not rerun this broadcast command for the current deployment:** every successful run creates a new pair of contracts.

## Record and verify the deployment

The local `contracts/.env` should contain the recorded addresses and owner:

```dotenv
MANDATE_MANAGER_ADDRESS=0xEfA2b3e70138810eA51552177c3f1AE5ab249EF2
ADVANCE_VAULT_ADDRESS=0x5F7Bec9eC341F816182a56D8E033cac63DBd8C8B
EXPECTED_OWNER=0xeC68c705001a158d0f810182Ca205887679E33f5
```

Keep `FREEZE_AUTHORIZED_VAULT=false` if the deployment was intentionally left rotatable. Run the read-only checker; it does not require a wallet and never broadcasts:

```bash
forge script script/CheckFidraDeployment.s.sol:CheckFidraDeployment \
  --rpc-url arc_testnet \
  -vvvv
```

The checker fails unless all of the following agree:

- chain ID is `5042002`;
- manager, vault, and USDC addresses contain code;
- both contract owners match, and match `EXPECTED_OWNER` when it is set;
- both contracts reference canonical Arc ERC-20 USDC;
- USDC reports six decimals;
- `AdvanceVault` references the deployed `MandateManager`;
- `MandateManager.authorizedAdvanceVault()` references the deployed vault;
- `discountBps` matches `ADVANCE_DISCOUNT_BPS`; and
- frozen state matches `FREEZE_AUTHORIZED_VAULT`;
- configured manager and vault strings are nonzero and correctly checksummed; and
- vault public totals, `poolStats`, available liquidity, expected spread, repayments, realized spread, and ERC-20 balance satisfy the implemented accounting identities.

Also complete this operator checklist:

- Open every deployment/configuration transaction on [ArcScan](https://testnet.arcscan.app) and confirm success.
- Record the deployment transaction hashes and starting block for frontend event indexing.
- Confirm no unexpected ownership transfer occurred.
- Confirm `authorizedVaultFrozen()` is still `false` before the final freeze decision.
- Run a small test mandate and vault purchase before using larger testnet balances.
- Publish both contracts' source using the same compiler and optimizer configuration. The read-only checker verifies configuration, not published source code and not an audit.

### Publish source on ArcScan

ArcScan uses Blockscout's verification API. After the configuration checker passes, publish the manager source and its constructor argument:

```bash
forge verify-contract "$MANDATE_MANAGER_ADDRESS" \
  src/MandateManager.sol:MandateManager \
  --chain-id 5042002 \
  --verifier blockscout \
  --verifier-url https://testnet.arcscan.app/api/ \
  --constructor-args $(cast abi-encode "constructor(address)" "$USDC_ADDRESS")
```

Then publish the vault source and its three constructor arguments:

```bash
forge verify-contract "$ADVANCE_VAULT_ADDRESS" \
  src/AdvanceVault.sol:AdvanceVault \
  --chain-id 5042002 \
  --verifier blockscout \
  --verifier-url https://testnet.arcscan.app/api/ \
  --constructor-args $(cast abi-encode \
    "constructor(address,address,uint256)" \
    "$USDC_ADDRESS" \
    "$MANDATE_MANAGER_ADDRESS" \
    "$ADVANCE_DISCOUNT_BPS")
```

Confirm each ArcScan address page shows the expected source, ABI, optimizer settings, and constructor values. Source publication improves transparency but is not an audit.

## Fund AdvanceVault liquidity

Only the vault owner can call `depositLiquidity`. The deposit uses ERC-20 `transferFrom`, so the owner must approve the deployed vault first. The required interface is always Arc ERC-20 USDC at `0x3600000000000000000000000000000000000000`; native gas formatting must never be used for this amount.

> **Completed on Arc Testnet:** 5 USDC was deposited in transaction [`0x5ee8…833d`](https://testnet.arcscan.app/tx/0x5ee8ef7c8f60414055a2694111b708381257cb9286cdc5278a643ebffc9a833d) and verified at block `51689118`. Do not repeat these commands unless the owner intentionally chooses to add more liquidity.

### Why liquidity writes use `cast send`

Arc's USDC implementation invokes Arc protocol system contracts for runtime controls such as [blocklist enforcement](https://docs.arc.io/integrate/on-off-ramps). Arc exposes its [USDC ERC-20 interface at the canonical precompile address](https://docs.arc.io/arc/references/contract-addresses). In the observed Forge dry run, Arc RPC state loaded correctly, the approval simulated successfully, and then Forge's local EVM failed with `StackUnderflow` at system address `0x1800000000000000000000000000000000000001` during `transferFrom`. This is a local simulation compatibility failure, not evidence that the Fidra deposit reverted on Arc. No transaction was broadcast and no funds moved.

For this deployment, use Forge scripts only for read-only preflight. Send USDC-dependent state changes directly to the Arc node with `cast send`. Do **not** add `--broadcast` to `PrepareVaultLiquidity.s.sol` or `SmokeFidra.s.sol`.

The guarded preparation script defaults to `5 USDC = 5_000_000` units, rejects values above 20 USDC, and checks contract configuration, ERC-20 principal, native gas balance, current allowance, and current vault accounting. It never signs or broadcasts:

```bash
forge script script/PrepareVaultLiquidity.s.sol:PrepareVaultLiquidity \
  --rpc-url arc_testnet \
  -vvvv
```

Review the owner, vault, amount, balances, and allowance. Then submit the two explicit transactions below. The first transaction is a real approval; record its real transaction hash and confirm success before proceeding.

```bash
cast send "$USDC_ADDRESS" \
  "approve(address,uint256)" "$ADVANCE_VAULT_ADDRESS" "$DEMO_LIQUIDITY_AMOUNT" \
  --rpc-url "$ARC_RPC_URL" \
  --account fidra-arc-deployer
```

Confirm the onchain allowance using the ERC-20 interface:

```bash
cast call "$USDC_ADDRESS" \
  "allowance(address,address)(uint256)" \
  "$EXPECTED_OWNER" "$ADVANCE_VAULT_ADDRESS" \
  --rpc-url "$ARC_RPC_URL"
```

The result must be at least `DEMO_LIQUIDITY_AMOUNT`. Next ask the Arc node to simulate the deposit with `eth_call`. This does not change state or spend funds, but it exercises Arc's own execution path against the now-live allowance:

```bash
cast call "$ADVANCE_VAULT_ADDRESS" \
  "depositLiquidity(uint256)" "$DEMO_LIQUIDITY_AMOUNT" \
  --from "$EXPECTED_OWNER" \
  --rpc-url "$ARC_RPC_URL"
```

Only if that call returns successfully, send the real deposit transaction:

```bash
cast send "$ADVANCE_VAULT_ADDRESS" \
  "depositLiquidity(uint256)" "$DEMO_LIQUIDITY_AMOUNT" \
  --rpc-url "$ARC_RPC_URL" \
  --account fidra-arc-deployer
```

Confirm accounted liquidity:

```bash
cast call "$ADVANCE_VAULT_ADDRESS" \
  "availableLiquidity()(uint256)" \
  --rpc-url "$ARC_RPC_URL"

cast call "$ADVANCE_VAULT_ADDRESS" \
  "totalLiquidityDeposited()(uint256)" \
  --rpc-url "$ARC_RPC_URL"
```

If ownership has moved to a multisig, submit the approval and deposit through that multisig instead. A direct token transfer to the vault is not an accounted liquidity deposit and must not replace `depositLiquidity`.

After the deposit, rerun `CheckFidraDeployment.s.sol`. Its liquidity deposited, ERC-20 balance, and available liquidity values should reflect the deposit while all acquired-claim/spread values remain zero.

## First tiny smoke flow — completed

The first smoke completed successfully on Arc Testnet using mandate `1` and spend `1`. It used one wallet as business, agent, approver, and vendor so it exercised contract state transitions without introducing multi-wallet coordination. This is a smoke test, not the final role model. The commands below remain as the controlled procedure for a later intentional run; do not repeat them accidentally.

Default values from `.env.example`:

```dotenv
SMOKE_ACTOR_ADDRESS=0xeC68c705001a158d0f810182Ca205887679E33f5
SMOKE_FACE_AMOUNT=1000000
SMOKE_RUN_ID=2
```

`SmokeFidra.s.sol` is read-only. It rejects face values above 10 USDC, checks live balances and liquidity, computes the exact 1% quote, and prints unique reference hashes. Run ID `1` is already consumed onchain; `.env.example` now defaults to `2` so a future external reference cannot collide with the completed smoke.

```bash
forge script script/SmokeFidra.s.sol:SmokeFidra \
  --rpc-url arc_testnet \
  -vvvv
```

Copy its exact external-reference, proof, and metadata hashes into shell variables. Do not invent transaction hashes or assume IDs:

```bash
export EXTERNAL_REF_HASH=<HASH_PRINTED_BY_PREFLIGHT>
export PROOF_HASH=<HASH_PRINTED_BY_PREFLIGHT>
export METADATA_HASH=<HASH_PRINTED_BY_PREFLIGHT>
export MANDATE_EXPIRY=$(($(date +%s) + 86400))
```

Approve the manager to pull exactly the tiny mandate budget, then create the mandate. These are real transactions sent directly to Arc RPC:

```bash
cast send "$USDC_ADDRESS" \
  "approve(address,uint256)" "$MANDATE_MANAGER_ADDRESS" "$SMOKE_FACE_AMOUNT" \
  --rpc-url "$ARC_RPC_URL" \
  --account fidra-arc-deployer

cast send "$MANDATE_MANAGER_ADDRESS" \
  "createMandate(address,address,uint256,uint64,uint64,uint256,bool,bytes32,address[])" \
  "$SMOKE_ACTOR_ADDRESS" "$SMOKE_ACTOR_ADDRESS" "$SMOKE_FACE_AMOUNT" \
  "$MANDATE_EXPIRY" 60 "$SMOKE_FACE_AMOUNT" true "$METADATA_HASH" \
  "[$SMOKE_ACTOR_ADDRESS]" \
  --rpc-url "$ARC_RPC_URL" \
  --account fidra-arc-deployer
```

Record both real transaction hashes. Read `mandateId` from the successful transaction's `MandateCreated` event on ArcScan, then set it explicitly:

```bash
export MANDATE_ID=<ACTUAL_MANDATE_ID_FROM_MandateCreated>

cast send "$MANDATE_MANAGER_ADDRESS" \
  "requestSpend(uint256,address,uint256,bytes32)" \
  "$MANDATE_ID" "$SMOKE_ACTOR_ADDRESS" "$SMOKE_FACE_AMOUNT" "$EXTERNAL_REF_HASH" \
  --rpc-url "$ARC_RPC_URL" \
  --account fidra-arc-deployer
```

Read `spendId` from that transaction's `SpendRequested` event, set it explicitly, and progress through proof, approval, and lock one confirmed transaction at a time:

```bash
export SPEND_ID=<ACTUAL_SPEND_ID_FROM_SpendRequested>

cast send "$MANDATE_MANAGER_ADDRESS" \
  "submitProof(uint256,bytes32)" "$SPEND_ID" "$PROOF_HASH" \
  --rpc-url "$ARC_RPC_URL" --account fidra-arc-deployer

cast send "$MANDATE_MANAGER_ADDRESS" \
  "approveSpend(uint256)" "$SPEND_ID" \
  --rpc-url "$ARC_RPC_URL" --account fidra-arc-deployer

cast send "$MANDATE_MANAGER_ADDRESS" \
  "lockSpend(uint256)" "$SPEND_ID" \
  --rpc-url "$ARC_RPC_URL" --account fidra-arc-deployer
```

Confirm on ArcScan that the spend is `Locked`. Immediately create a fresh 15-minute quote deadline, sell for a minimum `0.99 USDC`, revoke the parent, and release early as the business:

```bash
export QUOTE_DEADLINE=$(($(date +%s) + 900))
export MIN_ADVANCE_AMOUNT=990000

cast send "$ADVANCE_VAULT_ADDRESS" \
  "buyClaim(uint256,uint256,uint256)" \
  "$SPEND_ID" "$MIN_ADVANCE_AMOUNT" "$QUOTE_DEADLINE" \
  --rpc-url "$ARC_RPC_URL" --account fidra-arc-deployer

cast send "$MANDATE_MANAGER_ADDRESS" \
  "revokeMandate(uint256)" "$MANDATE_ID" \
  --rpc-url "$ARC_RPC_URL" --account fidra-arc-deployer

cast send "$MANDATE_MANAGER_ADDRESS" \
  "releaseSpend(uint256)" "$SPEND_ID" \
  --rpc-url "$ARC_RPC_URL" --account fidra-arc-deployer

cast send "$ADVANCE_VAULT_ADDRESS" \
  "markClaimSettled(uint256)" "$SPEND_ID" \
  --rpc-url "$ARC_RPC_URL" --account fidra-arc-deployer
```

Each command must succeed on ArcScan before the next command is sent. After settlement:

1. rerun `CheckFidraDeployment.s.sol`;
2. confirm the mandate is `Revoked` while the claim is `Released`;
3. confirm the fixed vendor remains the smoke actor and current payee is `AdvanceVault`;
4. confirm cumulative advanced and acquired face value increased by `0.99` and `1.00` USDC;
5. confirm repayments increased by `1.00` USDC and realized spread by `0.01` USDC; and
6. increment `SMOKE_RUN_ID` before any intentional later run so `externalRefHash` remains unique.

## Do not freeze yet

The freeze is one-way. Once frozen, `MandateManager` can never rotate the authorized vault. The current live state must remain `false` until all of these conditions pass:

1. both contract sources are published and verified on ArcScan if the explorer accepts verification;
2. `AdvanceVault` is funded through an accounted ERC-20 USDC deposit;
3. at least one full live claim purchase, release, and settlement succeeds;
4. frontend Live Mode shows the correct deployed addresses, authorized vault, `100 bps` discount, liquidity, and unfrozen state;
5. the owner independently confirms `0x5F7Bec9eC341F816182a56D8E033cac63DBd8C8B` is the intended permanent vault; and
6. the team accepts that an incorrect frozen address cannot be repaired.

For a post-deploy freeze by the current manager owner:

```bash
cast send "$MANDATE_MANAGER_ADDRESS" \
  "freezeAuthorizedAdvanceVault()" \
  --rpc-url "$ARC_RPC_URL" \
  --account fidra-arc-deployer
```

Then change `FREEZE_AUTHORIZED_VAULT=true` in `contracts/.env` and rerun `CheckFidraDeployment.s.sol`. The frozen vault remains able to buy locked claims; only rotation is disabled.

## Configure the frontend

Copy the deployed addresses into a local Vite environment file:

```dotenv
VITE_DEMO_MODE=false
VITE_ARC_RPC_URL=https://rpc.testnet.arc.network
VITE_CHAIN_ID=5042002
VITE_USDC_ADDRESS=0x3600000000000000000000000000000000000000
VITE_MANDATE_MANAGER_ADDRESS=0xEfA2b3e70138810eA51552177c3f1AE5ab249EF2
VITE_ADVANCE_VAULT_ADDRESS=0x5F7Bec9eC341F816182a56D8E033cac63DBd8C8B
VITE_LIVE_EVIDENCE_MANDATE_ID=1
VITE_LIVE_EVIDENCE_SPEND_ID=1
```

Restart Vite after changing environment values. Live Mode is the default and opens `/mandates/1`. It reads manager/vault runtime code, linkage, owner parity, canonical USDC, authorization, frozen state, fixed discount, pool accounting, mandate `1`, spend `1`, and the vault purchase record. It uses [`deployments/arc-testnet/latest.json`](../deployments/arc-testnet/latest.json) only for known transaction/block/explorer metadata and ledger cross-checks. The evidence panel links the manager, vault, and [settlement transaction](https://testnet.arcscan.app/tx/0xd80a21c1ae6e354bf64989c01a22487a3a62ebd3782026a9c2c0254a9d50dbe5). Live read failures remain visible; no demo record or fake hash replaces them.

Overview, Claims, and Activity require event indexing for honest portfolio-wide data, so default Live Mode shows an explicit indexing notice rather than sample values. The landing/sidebar mode switch can opt into the clearly labeled presentation dataset without rebuilding; `VITE_DEMO_MODE=true` changes only the first-run default. Wallet transactions, event indexing, and Circle APIs are still not implemented; do not present them as live.

## Recovery notes

- Wrong chain, token, decimals, or discount: the deployment script reverts before deployment.
- Transaction underpriced or pending: check Arc's current gas tracker and RPC fee suggestion; do not switch to legacy transactions unless current Arc guidance requires it.
- Broadcast interrupted: inspect ArcScan and `broadcast/` before using Forge's `--resume`; never assume all steps completed.
- Manager deployed but vault authorization missing: do not fund or freeze anything until the exact onchain state is understood.
- Wrong authorized vault before freeze: the manager owner can set the correct nonzero vault and rerun the checker.
- Wrong authorized vault after freeze: rotation is impossible by design; stop using that deployment and redeploy a reviewed pair.
- Lost owner key: there is no recovery mechanism. Use an encrypted keystore, backups, and preferably multisig/timelock administration.

This deployment process is not a smart-contract audit.
