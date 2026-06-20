# PluggurBeats — Pricing & Loops Redesign

Spec + phased Claude Code prompts to move from one-time packages to a **subscription + credit** model, and to add the new **Loop Drops** marketplace. Built against the live Firebase app (Auth, Firestore, Storage, Cloud Functions, Resend pitching, staff moderation).

---

## 1. The model at a glance

Two value lanes, two separate credit balances:

- **Loop Drops (new)** — producers submit loops to a pool; verified "bigger" producers pull them for their beats. Metered by **loop credits**.
- **Beat Campaigns (exists)** — producers pitch finished beats to artist/A&R lanes. Metered by **pitch credits**.

Keeping the two balances separate means the free loop economy never drains paid pitch capacity.

### Tiers

| | Free — $0/mo | Plugg — $29/mo | Plugg Pro — $99/mo |
|---|---|---|---|
| Loop credits / mo | 5 | 20 | 60 |
| Pitch credits / mo | 0 (buy à la carte) | 15 (roll over) | 50 (roll over) |
| Lanes per campaign | 1 | 3 | Unlimited |
| Beats per campaign | 5 | 15 | 25 |
| A&R / management lanes | — | — | ✓ |
| Queue | Standard | Standard | Priority (<48h) |
| Feedback + dedicated manager | — | — | ✓ |
| Pull from loop pool | Only if verified | Only if verified | Eligible to apply (still verified-gated) |
| Dashboard, analytics, split-sheet tools | ✓ | ✓ | ✓ |

Credits **roll over while the subscription is active** (Splice-style); they expire on cancellation.

### Pitch-credit menu (what each "Start a campaign" option costs)

| Campaign option | Cost |
|---|---|
| Artist lane — rising / indie desks | 1 credit |
| Artist lane — A-list / major tier | 2 credits |
| A&R / management lane (Pro only) | 3 credits |
| Rush — priority review, first pitch <48h | +2 credits |
| Written feedback summary | +1 credit |
| Beats (up to tier cap) | included, no cost |

Campaign cost = sum of selected lanes + add-ons. Example: 2 rising lanes + 1 A&R lane + rush = 1 + 1 + 3 + 2 = **7 pitch credits**.

### À la carte (hybrid — anyone, including Free)

- Pitch-credit packs: **10 for $25**, **25 for $50**
- Optional one-time single push at a fixed price (e.g. $49) if you want a no-account entry — flagged as optional below.

---

## 2. Loop Drops feature

- **Submit (any tier):** upload a loop (audio + name, BPM, key, genre, tags). Costs **1 loop credit**. Monthly grants: Free 5, Plugg 20, Pro 60.
- **Pull (verified / invite-only):** only producers a staff member has marked `verifiedPuller: true` can browse and download the pool. Pro subscribers are *eligible to apply*; verification stays manual.
- **Loop-maker payoff (attribution + split claim):**
  1. **Attribution / exposure** — every loop carries the maker's handle; on pull, the maker is credited and notified.
  2. **Split claim** — pulling a loop creates a pending claim linking maker ↔ puller ↔ loop. If the resulting beat gets placed, it flows into the existing split-sheet/paperwork so the maker gets a tracked cut.
- **Loop lifecycle:** `submitted` → (optional staff screen) `live` → `used` (on first pull; stays pullable unless you make loops single-use).

---

## 3. Firestore data model

```
users/{uid}
  …existing profile (displayName, email, avatarPath, …)
  subscription:  { tier: "free"|"plugg"|"pro", status, stripeCustomerId, stripeSubId, renewsAt }
  pitchCredits:  { balance, monthlyGrant, lastGrantAt }
  loopCredits:   { balance, monthlyGrant, lastGrantAt }
  verifiedPuller: boolean            // staff-set; gates loop pulling

users/{uid}/creditLedger/{entryId}
  { kind:"pitch"|"loop", delta, reason, refId, balanceAfter, at }   // audit trail

users/{uid}/campaigns/{campaignId}
  …existing (status, beats[], targets[], producer{}, opens, downloads, …)
  creditCost: number                 // pitch credits spent

loops/{loopId}                        // new top-level collection
  { makerUid, makerName, title, bpm, key, genre, tags[], storagePath,
    status:"live"|"used", plays, downloads, createdAt }

loopClaims/{claimId}                   // new — the split-claim link
  { loopId, makerUid, pullerUid, status:"pending"|"placed", beatRef, createdAt }
```

**Protected fields:** `subscription`, `pitchCredits`, `loopCredits`, `verifiedPuller` must be writable only by Cloud Functions, never the client.

---

## 4. Security-rules changes (firestore.rules)

- On `users/{userId}` updates, block the client from touching the protected fields:

```
allow update: if request.auth.uid == userId
  && !request.resource.data.diff(resource.data).affectedKeys()
        .hasAny(['subscription','pitchCredits','loopCredits','verifiedPuller']);
```

- `creditLedger`: client read-only; writes only via Functions (admin SDK bypasses rules).
- `loops/{loopId}`: read if `verifiedPuller == true` OR `makerUid == auth.uid`; create if `makerUid == auth.uid` (cost enforced in the `submitLoop` Function); update/delete via Functions only.
- `loopClaims`: Functions only.

---

## 5. Cloud Functions (new / changed)

Billing (replaces the `createCheckout` stub):
- `createSubscriptionCheckout(plan)` — Stripe Checkout Session for $29/$99 → returns URL.
- `stripeWebhook` — on `invoice.paid`: set tier + **add** monthly pitch+loop grants (roll over = add, don't reset; optional cap) + write ledger. On `customer.subscription.deleted`: downgrade to free, zero out paid grants.
- `buyCreditPack(pack)` — one-time Stripe payment → grant pitch credits on success.

Credit enforcement (server-side — the client can't be trusted with balances):
- `submitCampaign(payload)` — compute pitch cost from lanes/add-ons, check tier caps + A&R gating, verify balance, **atomically debit in a transaction**, create the campaign as `pending_review`, write ledger. Replaces the client `pay()` stub.
- `submitLoop(payload)` — verify loop-credit balance, debit, create `loops/{id}`.
- `pullLoop(loopId)` — assert `verifiedPuller`; create `loopClaims` record; mark loop `used`; notify maker; return a signed download URL.

Staff:
- `setVerifiedPuller(uid, value)` — staff-only flag toggle.
- Existing `listReviewCampaigns` / `moderateCampaign` / `listUsers` unchanged.

---

## 6. Phased Claude Code prompts

Run these **in order**, deploying and testing between each. Each is self-contained.

### Phase 1 — Data model + rules + credit plumbing

```
In the pluggurbeats repo, set up the credit/subscription data model server-side. No pricing UI yet.

1) Add fields to the users/{uid} doc model (initialize on user creation, e.g. in the existing profile-creation path): subscription {tier:"free", status:"active", stripeCustomerId:null, stripeSubId:null, renewsAt:null}, pitchCredits {balance:0, monthlyGrant:0, lastGrantAt:null}, loopCredits {balance:5, monthlyGrant:5, lastGrantAt:<now>}, verifiedPuller:false.

2) In firestore.rules, on users/{userId} update, keep the existing auth check but add: the client may NOT modify subscription, pitchCredits, loopCredits, or verifiedPuller. Use request.resource.data.diff(resource.data).affectedKeys().hasAny([...]) to block those keys. Add a creditLedger subcollection (users/{uid}/creditLedger/{id}) that is client-readable but write:false. Keep all existing rules.

3) In functions/index.js add two internal helpers (not yet exported endpoints): grantCredits(uid, kind, amount, reason) and debitCredits(uid, kind, amount, reason, refId) — both run in a Firestore transaction, update the balance, and append a creditLedger entry {kind, delta, reason, refId, balanceAfter, at}. kind is "pitch" or "loop". debitCredits throws if balance < amount.

4) Add a staff-only callable setVerifiedPuller({uid, value}) using the existing assertStaff() guard.

Deploy rules + functions. Verify a normal user cannot write pitchCredits/loopCredits from the client console, and that grant/debit helpers update balance + ledger atomically.
```

### Phase 2 — Stripe subscriptions + à-la-carte packs

```
Add Stripe subscriptions to replace the createCheckout stub. Tiers: Free $0, Plugg $29/mo, Plugg Pro $99/mo. À-la-carte pitch-credit packs: 10/$25, 25/$50.

1) Add a STRIPE_SECRET secret (defineSecret) and create Stripe Products/Prices for the two plans and the two credit packs (document the price IDs in a PRICES constant).

2) functions/index.js:
   - createSubscriptionCheckout({plan}) callable → creates/reuses a Stripe Customer for the uid, returns a Checkout Session URL for the plan's recurring price.
   - buyCreditPack({pack}) callable → one-time Checkout Session for the pack's price.
   - stripeWebhook onRequest (verify Stripe signature against rawBody):
       • checkout.session.completed / invoice.paid for a subscription → set users/{uid}.subscription {tier,status:"active",stripeSubId,renewsAt}; grantCredits monthly amounts by tier (pitch: plugg 15 / pro 50; loop: free 5 / plugg 20 / pro 60). Roll over = ADD to balance (optionally cap at 3x monthlyGrant). Set monthlyGrant + lastGrantAt.
       • checkout.session.completed for a credit pack → grantCredits(uid,"pitch",packAmount,"pack_purchase").
       • customer.subscription.deleted → set tier "free", zero the paid monthlyGrant; loop grant returns to 5.
   Map Stripe customer→uid via metadata.

3) index.html: replace the one-time PACKAGES pricing section with three subscription cards (Free / Plugg $29 / Plugg Pro $99) using the tier table from PRICING_AND_LOOPS_REDESIGN.md §1, plus a small "Buy credits" area for the à-la-carte packs. Subscribe buttons call createSubscriptionCheckout and redirect to the returned URL; pack buttons call buyCreditPack. Keep the existing disclaimers/FAQ.

Deploy. Test with Stripe test mode: subscribing grants the right credits and rolls over on renewal; cancellation downgrades to free.
```

### Phase 3 — Credit-based campaign builder

```
Convert dashboard.html "Start a campaign" from package selection to a credit-priced builder enforced server-side.

1) Remove the PACKAGES paywall step. At the top of the builder show the user's pitchCredits.balance (read from their user doc) and their tier.

2) Define a PITCH_COSTS map: artist rising/indie lane = 1, artist A-list/major lane = 2, A&R/management lane = 3, rush add-on = 2, feedback add-on = 1. Tag each target in ARTIST_TARGETS / ANR_TARGETS with its credit cost and show it on the card. As the producer selects lanes/add-ons, show a running "Total: N credits" and disable submit if N > balance. Enforce tier caps client-side for UX (Free 1 lane/5 beats, Plugg 3 lanes/15 beats, Pro unlimited/25 beats) and gate A&R lanes to Pro.

3) Replace the client pay() stub with a submitCampaign callable in functions/index.js that: recomputes the credit cost from the submitted lanes/add-ons (do NOT trust a client-sent total), re-checks tier caps + A&R gating, calls debitCredits(uid,"pitch",cost,"campaign",campaignId) in the same transaction that creates the campaign doc (status "pending_review", creditCost set). Return the new campaignId. If balance is insufficient, throw and surface "Not enough credits — upgrade or buy a pack."

4) Keep the rest of the flow (beats upload, collaborators, staff moderation, pitchCampaign) exactly as-is. The campaign's pitch count for the email can be derived from creditCost or lanes.

Deploy. Verify the debit + campaign creation are atomic and that tampering with the client total can't underpay.
```

### Phase 4 — Loop Drops

```
Add the Loop Drops marketplace.

1) Storage + collection: loops/{loopId} docs as specified in PRICING_AND_LOOPS_REDESIGN.md §3; loop audio under loops/{uid}/{loopId}/... in Storage. Update storage.rules so a user can upload their own loop files; downloads happen only via signed URLs from the pullLoop function.

2) firestore.rules: loops readable if verifiedPuller==true OR makerUid==auth.uid; create if makerUid==auth.uid (the cost is enforced in submitLoop); updates/deletes via Functions. loopClaims: Functions only.

3) functions/index.js:
   - submitLoop({title,bpm,key,genre,tags,storagePath}) → debitCredits(uid,"loop",1,"loop_submit"), create loops/{id} with status "live".
   - pullLoop({loopId}) → assertVerified (the caller's user doc verifiedPuller==true, else permission-denied); create loopClaims {loopId, makerUid, pullerUid, status:"pending", createdAt}; increment loop.downloads; mark status "used"; email/notify the maker (Resend) that their loop was pulled; return a signed download URL.

4) dashboard.html — add a "Loop Drops" nav item with two panels:
   - Submit: shows loopCredits.balance; upload form (audio + metadata); costs 1 credit; lists the user's submitted loops with status and any claims.
   - Pull (only render if the user's verifiedPuller==true): a browsable grid of live loops with playback + a "Use this loop" button calling pullLoop, which kicks off the signed download.

5) staff.html — add a control on each user to toggle verifiedPuller via setVerifiedPuller, and a simple list of loopClaims so staff can see maker↔puller links. When a placement happens, surface the claim into the existing split-sheet/paperwork flow so the loop maker's cut is tracked.

Deploy. Verify: submitting a loop debits a loop credit + writes the doc; a non-verified user cannot pull (rules + function both block); pulling creates a claim, notifies the maker, and returns a working download link.
```

---

## 7. Decisions still open (safe to defer)

- Roll-over cap (suggested: 3× monthly grant) so balances don't accumulate forever.
- Whether loops are single-use (remove from pool after one pull) or reusable.
- Whether to monetize loop *pulls* later (puller spends credits that pay the maker) — start with attribution + split claim only.
- The optional no-account one-time push ($49) — include only if you want a non-subscriber entry beyond credit packs.
- Exact Resend templates for "your loop was pulled" and subscription receipts.
