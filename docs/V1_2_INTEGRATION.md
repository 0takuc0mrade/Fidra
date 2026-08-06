# Fidra V1.2 integration architecture

Fidra V1.2 connects Circle User-Controlled Wallets and an embedded platform console to the immutable V1.1 contracts already deployed on Arc Testnet. It does not modify protocol semantics, deploy new contracts, or introduce Gateway, CCTP, Paymaster, or USYC.

## System boundary

```text
Irregular-work platform                     Worker browser
  │ trusted Arc wallet                        │ Circle SDK approval
  │ create/certify/batch/settle               │
  ▼                                            ▼
EarningsManager / PlatformRegistry      Fidra Circle server
                 │                      │ preflight + challenge
                 └──── AdvanceVaultV2 ◀─┤ purchaseAdvance(claimId)
                                        │ Circle status
                                        └ Arc receipt + state verification
```

V1 contract addresses and ABIs live in separate shared modules. V1 server and web files do not import Legacy MandateManager or AdvanceVault. Legacy routes remain isolated as historical evidence.

## Worker preflight

`V1ChainReads.getWorkerAdvanceSnapshot` fixes a block number, reads that block's timestamp, and uses the same block for the claim, purchase, platform, accounted cash, and actual USDC custody. `validateWorkerAdvance` then enforces exact ownership, Certified and unexpired status, one purchase, active platform, nonzero reserve, credit headroom, and both forms of cash liquidity.

The quote matches VaultV2 integer arithmetic:

```text
fee = floor(faceValue × advanceFeeBps / 10,000)
advance = faceValue - fee
```

All values remain six-decimal USDC integers until presentation.

## Challenge correlation and confirmation

The server stores a short-lived in-memory operation containing the session ID, worker, claim, platform, quote, challenge, and eventual Circle transaction ID. A different session cannot inspect or bind it, and an operation cannot be rebound to another transaction.

Circle `COMPLETE` is treated as submission evidence, not protocol success. `verifyWorkerAdvance` requires a successful receipt from the worker to AdvanceVaultV2, decodes exact `purchaseAdvance(claimId)` calldata, and checks the claim and purchase at the receipt block. Only exact matches return a receipt.

## Platform writes

The web platform console uses an injected wallet. New-claim actions require the registered settlement wallet and an active platform. Settlement accepts a registered wallet or authorized operator even while paused. Every action validates chain `5042002`, checks authorization, simulates, sends through the wallet, waits for a successful receipt, and exposes only the resulting real ArcScan link.

## Operational limitations

- Sessions and challenge correlation are in memory; production requires a durable encrypted store.
- Claim discovery is currently limited to known deployment evidence or an explicit claim ID; production requires an event indexer/platform database.
- Platform name and task plaintext are offchain product metadata; V1 stores platform ID and task/evidence hashes.
- The current live platform is intentionally paused and has zero reserve after the controlled default test. New live exposure is therefore correctly unavailable until separately authorized platform remediation.
- No live Circle V1 transaction is claimed unless the sandbox is configured and an operation passes independent Arc verification.
