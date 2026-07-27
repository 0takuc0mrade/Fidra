# Fidra Web

Fidra's frontend is an existing React 19 + Vite 6 application styled with plain CSS. It is not Next.js and should not be re-scaffolded. Routes include:

- `/` — full-screen product landing page;
- `/overview` — portfolio accounting overview in opt-in Demo Mode; honest indexing notice in Live Mode;
- `/mandates/1` — default Live Mode evidence for settled mandate `1` and spend `1`;
- `/mandates/1042` — the opt-in Demo Mode mandate experience;
- `/claims` — searchable and filterable claim work queue; and
- `/activity` — canonical-state-style audit feed; and
- `/vendor-onboarding` — Circle User-Controlled EOA onboarding and vendor identity selection.

The default is **Live Mode**. Landing actions open `/mandates/1`, which reads the deployed Arc contracts and reconciles them with the recorded smoke ledger. Overview, Claims, and Activity do not show sample records in Live Mode because general event indexing is not implemented. **Demo Mode is opt-in** and preserves the clearly labeled presentation dataset and simulated lock interaction at `/mandates/1042`. Use the visible mode switch on the landing page or in the sidebar; the choice is stored locally and the mandate route changes to the matching evidence/demo record.

## Configuration

Copy `.env.example` to `.env.local` for the default read-only live flow:

```bash
cp .env.example .env.local
```

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

`VITE_DEMO_MODE` sets the first-run default. The visible Live/Demo switch overrides it for that browser using local storage; `?mode=live` or `?mode=demo` can also select a mode for the current load. Live Mode currently:

- validates configured addresses;
- probes the Arc RPC and chain ID;
- reads manager/vault runtime code, owner parity, USDC configuration, vault linkage, authorized-vault and frozen state, 1% discount, liquidity, and pool accounting;
- reads mandate `1`, spend `1`, and the vault's claim-purchase record directly from the deployed contracts;
- shows original vendor, final payee, face value, advance, spread, available liquidity, discount, authorization, and freeze state;
- links the deployed manager, vault, and recorded settlement transaction to ArcScan;
- uses `deployments/arc-testnet/latest.json` only for transaction/block/explorer metadata and ledger cross-checks that contracts do not expose;
- shows connection, configuration, wallet, read-only, and refresh status; and
- fails with a visible non-breaking panel instead of falling back to fabricated live data.

The evidence copy is deliberately narrow: “Fidra’s live smoke proves that a locked claim can be sold to AdvanceVault, the parent mandate can be revoked, and settlement still pays the vault because locked receivables are irrevocable.” Claim enumeration is not presented as live because the contract has no per-mandate request index and event scanning/indexing has not been implemented. Wallet connection and transaction submission are intentionally not implemented. Every transaction method remains an explicit stub that throws in Live Mode; no fake transaction hashes are generated.

The authorization remains unfrozen. The UI freeze gate stays blocked until source is published/verified on ArcScan if possible, `/mandates/1` confirms the contract and ledger state, the permanent vault address is independently confirmed, and the owner explicitly approves the irreversible freeze.

## Circle vendor onboarding

The frontend talks only to Fidra's local/server API; it never receives `CIRCLE_API_KEY` or an operator seed private key. The official Circle Web SDK is loaded lazily only when `GET /api/circle/status` reports a real configured Circle application. Google and email OTP are implemented authentication paths. Wallet creation is a separate client-approved Circle challenge that explicitly requests `accountType: EOA` and `blockchains: ["ARC-TESTNET"]`.

This separation matters: `AdvanceVault.buyClaim` ultimately depends on `msg.sender` being the claim's current payee. In Circle Vendor Wallet mode, the exact returned EOA must therefore be registered as both vendor and initial payee. The UI does not silently substitute a test address. MetaMask one-wallet mode remains the fallback.

Gas seeding is optional, testnet-only, capped server-side, and disabled by default. It transfers **Arc native USDC for gas**, not the 6-decimal ERC-20 USDC that Fidra uses for mandates and advances. A wallet is not labeled ready until an EOA exists and the seed is confirmed, not needed because the native balance is sufficient, or previously recorded. When automatic seeding is disabled, the page shows manual funding instructions instead of success.

Start both services for the onboarding route:

```bash
cd ../server
cp .env.example .env
npm install
npm run dev
```

```bash
cd ../web
npm install
npm run dev
```

Paymaster, Gateway, and CCTP cards are explicitly planned/status-only. Vendor `buyClaim` is a real user-approved Circle contract-execution challenge: Fidra prepares it server-side, the vendor approves it in Circle's window, and the UI shows a confirmed ArcScan receipt only after the real transaction confirms (payee mismatch disables the action and shows both addresses; failures never carry a fabricated hash). Vendor `submitProof` and agent `requestSpend` remain `501 not_implemented`.

## Contract modules

```text
src/lib/config.js                 Vite environment configuration
src/lib/contracts/addresses.js   Address validation and readiness
src/lib/contracts/abis.js        Curated shared ABI imports
src/lib/contracts/client.js      viem public client and wallet placeholder
src/lib/contracts/types.js       6-decimal USDC/status formatting
src/lib/data/fidraAdapter.js      Mock/live selection
src/lib/data/mockFidraData.js     Existing demo experience
src/lib/data/liveFidraData.js     Read-only mandate, spend, purchase, and vault reads
src/lib/data/fidraActions.js      Demo handlers and live transaction stubs
src/lib/circle/api.js             Same-origin Circle server client
src/lib/circle/sdk.js             Lazy Circle Web SDK login/challenge boundary
src/lib/circle/vendorIdentity.js  Local selection of MetaMask versus exact Circle EOA
src/pages/VendorOnboarding.jsx    Fail-closed vendor onboarding workflow
```

After a Solidity ABI change:

```bash
cd ../contracts
forge build
cd ../web
npm run sync:abis
```

## Run locally

```bash
npm install
npm run dev
```

```bash
npm run build
```

The interface distinguishes reversible approval from an irrevocable locked receivable and states clearly that a proof commitment is an audit reference—not independent delivery verification. The first smoke ledger is [`../deployments/arc-testnet/latest.json`](../deployments/arc-testnet/latest.json), and its settlement transaction is [visible on ArcScan](https://testnet.arcscan.app/tx/0xd80a21c1ae6e354bf64989c01a22487a3a62ebd3782026a9c2c0254a9d50dbe5).
