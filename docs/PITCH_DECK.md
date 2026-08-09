# Fidra — Hackathon Pitch Deck

Nine slides for a 2–3 minute product pitch. Keep the slides visual and use the notes as the spoken narrative rather than placing every sentence on screen.

---

## Slide 1 — Fidra

### Get paid when the work is done, not when payday arrives.

**On screen**

- Fidra
- Embedded instant USDC payouts for completed work
- [fidra-arc.vercel.app/try](https://fidra-arc.vercel.app/try)

**Visual**

Use one clean product screenshot of the hosted **Payout complete** state. Highlight `0.099 USDC received` and the verified timeline.

**Speaker note — 12 seconds**

> Imagine I completed work today, but this platform normally pays me Friday. Fidra lets the platform confirm my earnings and lets me receive USDC now—without turning that payout into a loan I must repay.

---

## Slide 2 — The problem

### Work finishes now. Payout arrives later.

**On screen**

```text
Task completed          Platform payout day
      ●────────────────────────●
      Today                  Days later
```

- Irregular workers absorb the waiting period.
- Platforms still need time for their normal settlement cycle.
- Building wallets, liquidity, risk controls, and reconciliation is expensive.

**Visual**

A restrained horizontal timeline. Put the worker at the beginning and the platform payout at the end; avoid stock photography and invented statistics.

**Speaker note — 16 seconds**

> The worker has already earned the money, but the platform's payout operations still run on a later schedule. Large platforms can build custom instant payout systems. Smaller and global work platforms usually cannot justify all the wallet, liquidity, risk, and accounting infrastructure.

---

## Slide 3 — The gap

### Instant payout is not just a payment button.

**On screen**

Four required pieces:

1. Certified earnings
2. Embedded worker wallet
3. Upfront liquidity
4. Platform settlement and default controls

**Visual**

Four aligned blocks feeding one **Get paid now** action. Keep the visual structural, not decorative.

**Speaker note — 15 seconds**

> A payment button is the easy part. The hard part is proving the earnings are final, paying the exact worker, controlling platform exposure, surviving retries and restarts, and settling the platform obligation without ever making the worker responsible.

---

## Slide 4 — The solution

### Certified earnings become immediately liquid.

**On screen**

```text
Platform certifies earnings
            ↓
Worker chooses Get paid now
            ↓
Fidra sends USDC immediately
            ↓
Platform settles later
```

**Callout**

> The worker sells a claim. The worker does not take a loan.

**Visual**

Use the four-step flow above. Emphasize the worker payout before the later platform settlement.

**Speaker note — 18 seconds**

> The platform certifies a final earnings claim. The worker can sell that claim to Fidra for immediate USDC. Fidra takes the platform settlement risk. The platform repays Fidra on its normal schedule, and the completed worker payout is final.

---

## Slide 5 — Worker experience

### No MetaMask. No manual wallet. No crypto setup.

**On screen**

```text
Circle email login
      ↓
Complete task
      ↓
0.10 USDC certified
      ↓
Get paid now
      ↓
0.099 USDC received
```

**Visual**

Use three narrow screenshots:

1. Circle wallet ready
2. Earnings certified with **Get paid now**
3. Payout complete with Arc receipts

**Speaker note — 18 seconds**

> The worker signs in by email through Circle. Fidra creates or restores a user-controlled Arc wallet, prepares bounded transaction gas, and creates certified earnings after the task. The worker approves the payout in Circle. Fidra never receives or uses the worker's private key.

---

## Slide 6 — How the money moves

### A simple, visible financial loop

**On screen**

| | Demo | At a $100 scale |
|---|---:|---:|
| Certified earnings | `$0.100` | `$100` |
| Worker receives now | `$0.099` | `$99` |
| Fidra spread | `$0.001` | `$1` |
| Platform settles later | `$0.100` | `$100` |

```text
Platform exposure: 0 → 0.10 → 0 USDC
```

**Visual**

Use one large `$0.099 now` figure and a smaller settlement arrow returning `$0.100` to Fidra.

**Speaker note — 18 seconds**

> In the live test, a ten-cent certified claim produced a 9.9-cent worker payout and a one-tenth-cent fee. The platform then settled ten cents. The same one-percent example scales conceptually to a worker receiving ninety-nine dollars now against one hundred dollars of certified earnings.

---

## Slide 7 — Why Arc + Circle

### Programmable USDC with an embedded user experience

**On screen**

**Arc**

- USDC-oriented EVM execution
- Verifiable payout and settlement receipts
- Onchain credit, reserve, exposure, and accounting state

**Circle**

- Email authentication
- User-controlled Arc EOA
- Embedded contract approval
- Fidra never controls the worker key

**Speaker note — 18 seconds**

> Arc gives us programmable USDC settlement and one source of truth for claims, exposure, reserves, and vault accounting. Circle removes the normal crypto onboarding burden while preserving worker control. Circle submits the worker transaction; Fidra still verifies the Arc receipt and exact contract state independently.

---

## Slide 8 — Live proof

### Not a simulation: one complete hosted payout

**On screen**

- Public `/try` journey
- Circle-controlled worker
- Claim `#8`
- `0.099 USDC` worker payout
- Automatic `0.100 USDC` platform settlement
- Exposure returned to zero
- Refresh and Render restart recovery passed

**Receipt links**

- [Worker advance](https://testnet.arcscan.app/tx/0x7d166316f50f08429d991481b00ca8b907234d42ae5d8092515931d3898ef9c5)
- [Platform settlement](https://testnet.arcscan.app/tx/0xf7afa70a0da1e0f1e68c0313310b394dd9f1e530d4cd224fdaf4c10c83f450c6)
- [Complete evidence](../deployments/arc-testnet/v1.5.3-hosted-end-to-end.json)

**Protection proof**

Historical V1.1 testing also exercised a reserve-backed default: the worker payout remained complete, the platform was paused, new advances stopped, and existing obligations could still be repaid.

**Visual**

Show the completed timeline beside two ArcScan receipt cards. Use a small secondary callout for the default path; keep the successful worker payout as the hero.

**Speaker note — 24 seconds**

> This is live on Arc Testnet. A fresh hosted browser session automatically funded gas, created and certified claim eight, paid a Circle-controlled worker, verified the Arc receipt, and settled the platform. Refreshes and a Render restart restored the same workflow without repeating a financial action. We also proved the failure path: a platform default cannot reduce a completed worker payout.

---

## Slide 9 — Vision and business model

### The instant-payout layer for global work platforms

**On screen**

**Platform integration**

```text
certify earnings → offer payout → settle later
```

**Revenue**

- Configurable fee on advanced earnings
- Platform-specific credit and reserve terms

**Next market steps**

- Pilot with one irregular-work platform
- Production compliance and risk operations
- External security review and production deployment
- Broader liquidity participation after the core loop is proven

**Final line**

> A worker finishes a task. The platform confirms the earnings. Fidra pays now.

**Speaker note — 20 seconds**

> Fidra can sit behind work marketplaces, creator platforms, contractor systems, and other irregular-work products. Platforms get an embedded payout option without rebuilding wallet and settlement infrastructure. Fidra earns the configured spread while managing each platform through explicit credit, reserve, and exposure controls.

---

## Timing

| Section | Target |
|---|---:|
| Slides 1–3: problem and gap | 43 seconds |
| Slides 4–6: solution, experience, economics | 54 seconds |
| Slides 7–8: technology and proof | 42 seconds |
| Slide 9: vision and close | 20 seconds |
| **Total** | **about 2 minutes 40 seconds** |

## Submission framing

### Programmable Money Hackathon

Lead with:

> Fidra turns immutable, platform-certified earnings into programmable claims that workers can sell for immediate USDC, with automatic platform settlement and explicit credit, reserve, default, and accounting controls.

Prioritize slides 4, 6, 7, and 8.

### Ignyte Stablecoins Commerce Stack

Lead with:

> Fidra is embedded stablecoin payout infrastructure for work platforms: workers authenticate by email, receive a user-controlled wallet, and get paid early without understanding wallets, gas, or crypto.

Prioritize slides 3, 5, 7, and 9.

## Asset checklist

- Hosted landing-page screenshot
- Circle wallet-ready screenshot
- Earnings-certified screenshot
- Circle `purchaseAdvance(8)` confirmation screenshot
- Payout-complete screenshot
- Verified-timeline screenshot with all receipts
- ArcScan worker-advance screenshot
- ArcScan platform-settlement screenshot
- Optional historical default/paused-platform screenshot

Do not show emails, OTPs, Circle identifiers, API keys, database configuration, session data, or private keys in any slide or recording.
