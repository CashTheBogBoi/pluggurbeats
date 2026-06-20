/**
 * One-off: create the PluggurBeats Stripe products + prices, then write their
 * ids into stripe-prices.json. Run once (test mode), commit the resulting file.
 *
 *   STRIPE_SECRET=sk_test_xxx node setupStripe.js
 *
 * Safe to re-run: it looks up existing products by name before creating.
 */
const fs     = require("fs");
const path   = require("path");
const Stripe = require("stripe");

const key = process.env.STRIPE_SECRET;
if (!key) { console.error("Set STRIPE_SECRET env var (use a sk_test_ key)."); process.exit(1); }
const stripe = Stripe(key);

const PLAN = [
  { key: "plugg", name: "PluggurBeats — Plugg",     amount: 2900, recurring: true  },
  { key: "pro",   name: "PluggurBeats — Plugg Pro", amount: 9900, recurring: true  },
  { key: "pack10",name: "PluggurBeats — 10 Pitch Credits", amount: 2500, recurring: false },
  { key: "pack25",name: "PluggurBeats — 25 Pitch Credits", amount: 5000, recurring: false }
];

async function findProduct(name) {
  const list = await stripe.products.search({ query: `name:'${name}'` });
  return list.data[0] || null;
}

(async () => {
  const out = {};
  for (const p of PLAN) {
    let product = await findProduct(p.name);
    if (!product) product = await stripe.products.create({ name: p.name });

    // Reuse an existing matching price if present
    const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
    let price = prices.data.find(pr =>
      pr.unit_amount === p.amount &&
      pr.currency === "usd" &&
      (!!pr.recurring) === p.recurring);

    if (!price) {
      price = await stripe.prices.create({
        product: product.id,
        unit_amount: p.amount,
        currency: "usd",
        ...(p.recurring ? { recurring: { interval: "month" } } : {})
      });
    }
    out[p.key] = price.id;
    console.log(`${p.key.padEnd(7)} -> ${price.id}  (${p.name})`);
  }

  const file = path.join(__dirname, "stripe-prices.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log("\nWrote", file);
})().catch(e => { console.error(e); process.exit(1); });
