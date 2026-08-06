# Fidra V1.2 worker payout flow

The worker experience uses earnings language rather than receivable-sale language. The platform certifies completed earnings, the worker chooses `Get paid now`, and the platform remains responsible for settlement.

## UI flow

1. Open `/worker` and authenticate with Circle email OTP or configured Google login.
2. Retrieve or approve creation of an Arc Testnet EOA.
3. Open `/worker/claims/:claimId`.
4. Review earnings, normal payout date, available-now amount, fee, sponsorship status, platform status, and task hash.
5. Select `Get paid now`.
6. Approve Circle's contract-execution challenge.
7. Wait while Fidra checks Circle status and independently verifies Arc.
8. Open the real ArcScan receipt only after the claim is `Advanced` and its purchase is `Outstanding` with exact quote values.

## Worker-visible states

- loading;
- Circle not configured;
- no worker wallet;
- worker-wallet mismatch;
- claim not certified;
- claim expired;
- platform paused;
- insufficient liquidity returned by the server preflight;
- quote available;
- awaiting Circle approval;
- challenge rejected;
- transaction pending;
- transaction confirmed;
- transaction failed or timed out; and
- claim already paid.

Failure, rejection, and timeout show no receipt. Circle credentials absent means no live Circle claim. The demo mode may demonstrate presentation states but may not be represented as a live wallet or Arc transaction.

## Security meaning

- The worker approves with a user-controlled wallet; Fidra never signs for them.
- The wallet address must exactly equal `claim.worker`.
- The worker does not settle the claim and never repays Fidra.
- Certified claims cannot be edited or revoked.
- Platform default after payout does not reduce or claw back the completed worker payment.
