# Credit Economy

There are two separate credit currencies that never mix.

## Pitch Credits (`pitchCredits`)
Used to submit beat campaigns. Each beat in a campaign costs 1 pitch credit. Targeted campaigns with the `listInLibrary` addon cost an additional 5 credits flat.

## Loop Credits (`loopCredits`)
Used to submit loops. Each loop submission costs exactly 1 loop credit, regardless of exclusivity or targeting.

---

## Monthly Grants by Tier

Defined in `functions/index.js` as `TIER_GRANTS`:

| Tier | Pitch Credits / month | Loop Credits / month |
|------|----------------------|---------------------|
| Free | 0 | 5 |
| Plugg | 15 | 20 |
| Pro | 50 | 60 |

Free users get 5 loop credits monthly so they can still participate in the loop economy without a paid plan.

## Rollover Cap

`ROLLOVER_CAP_MULT = 3`

Credits roll over month to month but cap at 3× the monthly grant. Example: a Pro user who never spends accumulates a max of 150 pitch credits and 180 loop credits before rollover stops adding more. This prevents infinite stockpiling.

The grant is additive (`balance += grant`), not reset. The cap is enforced at grant time.

---

## How Grants Are Applied

Monthly grants fire via the `stripeWebhook` function when Stripe sends `invoice.payment_succeeded`. The webhook calls `applyMonthlyGrants(uid, tier, periodEnd)`.

**Idempotency key**: The function stores `loopCredits.lastGrantPeriodEnd` and `pitchCredits.lastGrantPeriodEnd` on the user doc. If the current `periodEnd` matches the stored one, the grant is skipped — this prevents double-granting if a webhook replays.

**Self-healing**: If a webhook is missed, the user can call `reconcileCredits` from the dashboard. It verifies the Stripe subscription is genuinely active before granting — it never grants without a real active sub.

---

## Credit Transaction Pattern

All credit movements use Firestore transactions to prevent race conditions:

```js
// Debit (submitCampaign / submitLoop)
db.runTransaction(async (tx) => {
  const snap = await tx.get(userRef);
  const current = snap.get("pitchCredits.balance");
  if (current < cost) throw new HttpsError("failed-precondition", "Insufficient credits...");
  tx.update(userRef, { "pitchCredits.balance": current - cost });
  tx.set(ledgerRef, { kind: "pitch", delta: -cost, reason: "submitCampaign", ... });
});
```

Every debit and grant writes a `creditLedger` entry — full audit trail, client can read their own.

---

## Credit Packs (One-Time Purchase)

Defined in `functions/index.js` as `PACK_CREDITS`:

| Pack Key | Kind | Amount |
|----------|------|--------|
| `pack10` | pitch | 10 |
| `pack25` | pitch | 25 |
| `loop20` | loop | 20 |
| `loop50` | loop | 50 |

Purchased via `buyCreditPack` → Stripe Checkout session → `stripeWebhook` handles `checkout.session.completed` → grants credits immediately.

---

## Staff Adjustments

Staff can manually add or subtract credits via `adjustCredits` callable. Takes `{ uid, kind, delta, reason }`. Delta is signed — positive grants, negative debits. Always writes a ledger entry.

---

## UI: Credit Pills

Displayed in the Dashboard header as clickable pills. Each pill shows the current balance and opens a credit purchase flow. Uses `bg-transparent` so pills blend into the `backdrop-blur-xl` header without creating a visible box.
