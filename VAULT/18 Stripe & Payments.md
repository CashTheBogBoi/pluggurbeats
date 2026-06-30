# Stripe & Payments

## Price IDs

Stored in `functions/stripe-prices.json`. Two subscription prices + several one-time credit pack prices. The mapping is:

| Key | What it maps to |
|-----|----------------|
| `plugg` | Stripe price ID for Plugg monthly subscription |
| `pro` | Stripe price ID for Pro monthly subscription |

Credit pack price IDs are also in this file, keyed by the pack name (`pack10`, `pack25`, `loop20`, `loop50`).

The webhook uses `tierForPriceId(priceId)` to resolve `"plugg"` or `"pro"` from any incoming Stripe price ID. Credit packs are resolved via a separate mapping.

---

## Subscription Flow

1. User clicks "Upgrade" on Dashboard → calls `createSubscriptionCheckout`
2. Server creates a Stripe Checkout session (hosted page) with `mode: "subscription"` and the correct price ID
3. Returns `{ url }` — client does `window.location.href = url`
4. User completes payment on Stripe's hosted page
5. Stripe fires `checkout.session.completed` webhook → `stripeWebhook` function
6. Server looks up or creates `stripeCustomers/{customerId}` → resolves UID
7. Updates `users/{uid}.subscription.tier` and `subscription.stripeSubId`
8. Fires `applyMonthlyGrants` to give the user their first month's credits

---

## Credit Pack Flow

Same checkout flow but `mode: "payment"` (one-time). `checkout.session.completed` grants credits immediately via `grantCredits`. No subscription created.

---

## Stripe Webhook Events Handled

| Event | Handler |
|-------|---------|
| `checkout.session.completed` | Sets subscription tier OR grants credit pack |
| `invoice.payment_succeeded` | Applies monthly credit grants (recurring) |
| `customer.subscription.deleted` | Downgrades `subscription.tier` to `"free"` |

Webhook is verified via `STRIPE_WEBHOOK_SECRET` (Svix-style signature validation on the raw body).

---

## Customer Identity

`stripeCustomers/{stripeCustomerId}` maps Stripe customer IDs to Firebase UIDs. Created on first checkout. All subsequent checkouts reuse the same Stripe customer (idempotent lookup).

---

## Secrets

All Stripe calls require `secrets: [STRIPE_SECRET]` in the `onCall` options. Webhook requires both `STRIPE_SECRET` and `STRIPE_WEBHOOK_SECRET`. Both are Firebase Secrets set via `firebase functions:secrets:set`.

---

## Testing

To test locally, use `firebase emulators:start` + Stripe CLI:
```bash
stripe listen --forward-to localhost:5001/pluggurbeats/us-central1/stripeWebhook
stripe trigger invoice.payment_succeeded
```

Stripe test mode price IDs differ from production — `stripe-prices.json` should be swapped accordingly for local testing.

---

## Reconciliation

If `invoice.payment_succeeded` is missed (network blip, function cold start timeout), the client calls `reconcileCredits` on Dashboard load. The function:
1. Checks `subscription.tier` — must be `"plugg"` or `"pro"`
2. Fetches live subscription from Stripe API to confirm it's `"active"` or `"trialing"`
3. Checks `lastGrantPeriodEnd` on the user doc to see if this period was already granted
4. If not granted: applies the grant and updates `lastGrantPeriodEnd`

This is safe to call repeatedly — it's idempotent per billing period.
