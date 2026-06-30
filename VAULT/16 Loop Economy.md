# Loop Economy

Loops are a parallel economy to beat campaigns — separate credits, separate review queue, separate page section. They are not beats.

---

## What a Loop Is

Producers upload a short audio loop (stem, sample, drum pattern, etc.) to the Loop Pool on `/verified`. Verified pullers (`verifiedPuller: true`) discover loops and can "pull" them — claim the right to build on them.

---

## Exclusivity Model

When submitting, producers choose one of two models:

**Exclusive** (`exclusivity: "exclusive"`)
- Only one puller can claim it
- Once claimed, the loop `status` flips to `"claimed"` — removed from the pool
- Creates a `loopClaims/{id}` doc with the puller's info
- The exclusivity is the value prop — "no one else will build off this"

**Shared** (`exclusivity: "shared"`)
- Stays in the pool indefinitely
- Multiple pullers can pull it — each pull increments `pullCount`
- Status stays `"live"` after pulls
- Lower barrier but less differentiated

Producers choose based on what they value: exclusivity premium vs. broader exposure.

---

## Submission Flow

1. Producer: Dashboard → Loop Drops tab → uploads MP3 to `loops/{uid}/{filename}`
2. Calls `submitLoop` with `{ title, bpm, key, genre, tags, storagePath, exclusivity, targetRequestId? }`
3. `submitLoop` validates: auth, 1 loop credit available, path is under their own folder, file is MP3
4. Debits 1 loop credit atomically, creates `loops/{id}` as `pending_review`
5. **Staff reviews** via `listReviewLoops` → approves via `moderateLoop` → status flips to `"live"`
6. Loop appears in Loop Pool on `/verified` for all `verifiedPuller` users

---

## Targeted Loop Submissions

Loops can be submitted directly to a `campaignRequest` if the request type is `"loops"` or `"both"`.

- Producer visits `/verified` → sees a loop request → clicks "Submit a Loop" → routed to Dashboard with `?loopRequest={requestId}` in the URL
- Dashboard Loop Drops tab picks up the query param and pre-fills the request target
- `submitLoop` validates: request is open, producer's plan can submit to requester's role
- On success: increments `submissionCount` on the request, fires push (and Pro email) to requester

Targeted loops go through the same staff review queue. They don't automatically skip to the requester — staff still approves first.

---

## Pull Flow

`verifiedPuller: true` users see the Loop Pool tab on `/verified`.

Calling `pullLoop`:
- **Exclusive**: sets `loops/{id}.status = "claimed"`, creates `loopClaims/{id}`, increments `pullCount`
- **Shared**: increments `pullCount` only, status stays `"live"`

`listLoopClaims` (staff-only) returns the full claim history.

---

## Monthly Loop Credits

| Tier | Loop Credits / month |
|------|---------------------|
| Free | 5 |
| Plugg | 20 |
| Pro | 60 |

Free users get 5 loop credits — they can participate without a paid plan. See [[15 Credit Economy]] for rollover cap and grant mechanics.

---

## Loop vs Beat Campaign Key Differences

| | Loop | Beat Campaign |
|--|------|--------------|
| Credit cost | 1 per submission | 1 per beat |
| Review queue | Same staff queue | Same staff queue |
| Email blast | Never | Pro + desks only |
| Exclusivity choice | Yes (exclusive / shared) | N/A |
| Claiming mechanic | `pullLoop` callable | N/A |
| Library location | Loop Pool tab on /verified | Verified Beats tab on /verified |
| Targeted flow | `/dashboard?loopRequest=id` | `/dashboard?request=id` |
