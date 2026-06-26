# PluggurBeats — Planned Changes

## ~~1. Credit System — Flat 1 Credit Per Beat~~ ✅ DONE

**New model:** 1 credit = 1 beat submitted in a campaign.

| Tier | Credits/Month |
|------|--------------|
| Plugg | 15 |
| Pro | 50 |

Campaign cost = number of beats × 1 (no per-desk variable pricing).

**Files to change:**
- `src/pages/Dashboard.jsx` — remove `PITCH_COSTS` map, remove per-target cost display, change debit calc to `beats.length * 1`
- `functions/index.js` — `TIER_GRANTS` already has plugg=15, pro=50 (correct); change `debitCredits` call from `targets.length × cost` to `beats.length × 1`
- `src/components/Pricing.jsx` / `src/pages/Marketing.jsx` — update copy to reflect new model

---

## ~~2. Tags on Beats~~ ✅ DONE

Artists add their own custom tags to each beat when uploading (e.g. "dark trap", "melodic", "808 heavy"). Tags travel with the beat and display on the Verified library so curators can filter.

**Completed:**
- `src/pages/Dashboard.jsx` — beat upload form has pill-style tag add/remove. Tags save as `beat.tags: string[]`.
- Verified library — tags display as chips on beat cards; curators can filter and search by tag.
- `functions/index.js` — tags are normalized server-side, returned to Verified, and included in outgoing pitch email HTML.

---

## ~~3. Desks — Pro Only, 5 Lanes, No Credit Cost~~ ✅ DONE

Desks are an optional Pro-only add-on layer. Selecting desks costs 0 extra credits but is capped at 5 lanes per campaign. Free/Plugg get no desk targeting — their beats go into the Verified library only.

**Files to change:**
- `src/pages/Dashboard.jsx` — wrap desk/target picker in a Pro gate (`tier === "pro"`). Show locked upsell state for Plugg. Disable checkboxes once 5 lanes selected.
- Remove cost display from desk targets entirely (cost is always 0 now).
- Update `TIER_CAPS`: `plugg.lanes = 0`, `pro.lanes = 5`.
- `functions/index.js` — desk/lane logic stays for Pro campaigns; Plugg campaigns continue to skip email blast and go to Verified library.

---

## ~~4. Pro Email Destination Reveal + Viewer Identity~~ ✅ DONE

Pro users see who engaged with their campaign — without exposing raw emails.

- Pro sees desk names + contact count (e.g. "Trap desks · 32 contacts") but never raw emails.
- When a contact opens/clicks the tracked link:
  - If they have a PluggurBeats account → show their `@username`
  - If no account → show a `name` field added to `contacts.json`
- Viewer identity is Pro-gated. Plugg sees aggregate counts only.

**Files to change:**
- `contacts.json` — restructure entries from `"email@example.com"` strings to `{ "email": "...", "name": "..." }` objects. Update all references in `functions/index.js`.
- `functions/index.js` — when logging opens/downloads in the webhook handler, look up the contact name from `contacts.json`. Also check Firestore `users` collection for a doc where `email == contact.email` to get their `@username`. Write `{ name, username }` to the activity log instead of raw email.
- `src/pages/Dashboard.jsx` / `src/pages/Verified.jsx` — analytics viewer list shows `@username` if available, else contact `name`, never raw email. Pro-gate this section.

---

## ~~5. Campaign-First Analytics Tree~~ ✅ DONE

Replace the current flat beat list with a three-level collapsible hierarchy.

```
Campaign: "Summer 2025 Trap Pack"  [12 plays · 3 downloads · 28 views]
  └── Beat: "Midnight Rider"  ▶
        ├── Plays: 8
        ├── Downloads: 2
        ├── Views: 19
        └── Viewers: @yungwave, DJ Premier (no account), ...
  └── Beat: "808 Pressure"  ▶
        └── ...

Campaign: "R&B Wave March"  [...]
  └── ...
```

**Files to change:**
- `src/pages/Dashboard.jsx` — replace `ActivityList` / flat analytics with `CampaignTree` component:
  - Top level: list of campaigns (name, date, status badge, totals)
  - Expand → beats in that campaign
  - Expand beat → per-beat stats inline (plays, downloads, views, viewer list)
  - Viewer list is Pro-gated
- `functions/index.js` — add `beatId` field to activity log entries so plays/downloads can be attributed to a specific beat within a campaign (currently only campaign-level counters exist).

---

## Firestore / Data Model Changes

| Collection | Change |
|---|---|
| `users/{uid}/campaigns/{id}` | Add `beats[].tags: string[]` |
| `users/{uid}/campaigns/{id}/activity/{id}` | Add `beatId`, `viewerName`, `viewerUsername` |
| `contacts.json` | Restructure to `{ email, name }` per entry |

---

## Implementation Order

1. `contacts.json` restructure + function viewer identity logging (backend first, no visible UI change)
2. Flat credit model (simple, high-impact — credit debit in function + cost display in dashboard)
3. Tags on beats (upload form + Verified library display)
4. Desks → Pro only, 5 lanes, 0 cost (gate existing UI, simplify targeting)
5. Campaign analytics tree (biggest UI change — build last once data model from step 1 is solid)
