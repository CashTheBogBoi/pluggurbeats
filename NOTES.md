# PluggurBeats — Project Notes

> This file is for you and Claude. Add ideas, todos, questions, or context here and Claude will read it automatically when you reference it.

---

## Active To-Dos
- [ ] 

## Feature Ideas
- 

## Bugs / Issues
- 

## Questions for Claude
- 

---

## Business Context
- Beat-pitching platform for producers
- Subscription tiers: Free / Plugg ($29/mo) / Pro ($99/mo)
- Credits used for pitch campaigns + loop drops
- A&Rs/artists browse the Verified library

## Tech Stack (quick ref)
- React + Vite + Tailwind + Firebase
- Stripe (subscriptions + credit packs)
- DocuSign (split sheets)
- Resend (transactional email)
- Capacitor (iOS app wrapper)

## Key Files
- `src/pages/Dashboard.jsx` — main producer workspace
- `src/pages/Verified.jsx` — A&R/artist beat library
- `functions/index.js` — all Cloud Functions
- `src/firebase.js` — Firebase init

## Decisions Made
- Subscriptions replaced one-time campaign fees
- Credits roll over, capped at 3x monthly grant
- Plugg tier: beats added to Verified library (no email blast)
- Pro tier: beats zipped + emailed to contacts

---

## Notes / Misc
- 
