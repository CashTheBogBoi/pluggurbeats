# Session — 2026-06-29: Loops work like beat campaigns

## Decisions (from user)
- **Staff review for loops: YES** — loops now go through moderation like beats.
- **Exclusivity model: MAKER CHOOSES** (option 2) — at submit, maker picks `exclusive` or `shared`.
  - `exclusive` (default): one puller claims it -> loop `used`, gone from pool (current behavior).
  - `shared`: stays `live`, many pullers can pull/build on it; each puller claims once.

## Loop lifecycle (new) — mirrors beat campaigns
`pending_review` -> (staff) `live` | `rejected`. Exclusive + pulled -> `used`. Shared stays `live`.

## Loop doc model (new fields)
`exclusivity: "exclusive"|"shared"`, `pullCount`, `status` lifecycle above, moderation fields
(`moderatedBy`, `moderatedAt`, `rejectionReason`, `rejectionNote`, `creditRefunded`).

## Backend — DONE (functions/index.js, parses clean)
- `submitLoop`: takes `exclusivity` (default exclusive); status now `pending_review` (was instant `live`); stores `exclusivity` + `pullCount:0`.
- `listReviewLoops` (NEW): staff-only pending-loop queue w/ signed preview URLs (mirror listReviewCampaigns).
- `moderateLoop` (NEW): staff approve(->live)/reject(->rejected); refunds 1 loop credit on reject of a still-pending loop (once, guarded); emails maker. Mirror of moderateCampaign.
- `pullLoop`: branches on `exclusivity`. Exclusive = mark `used` (single-use). Shared = stays `live`, `pullCount++`, dedupes per puller (re-pull just re-downloads, no new claim/email/count). loopClaim now stores `exclusivity`.
- No composite index needed (two `==` filters, no range/orderBy -> auto single-field indexes).

## ⚠️ CRITICAL SEQUENCING — do NOT deploy functions alone
submitLoop now creates loops as `pending_review`. Until the **Staff loop-approval UI** ships (calls
`moderateLoop` to flip them `live`), every new loop is stuck pending and NEVER enters the pool. So:
deploy functions + the Staff UI TOGETHER, or loops break.

## Frontend — TODO (next)
1. **Staff.jsx** — add a "Loop Review" tab (pending loops, approve/reject) mirroring the campaign
   moderation UI. (Currently Staff only has passive "Loop Claims" tracking.) REQUIRED — unblocks pending loops.
2. **Dashboard.jsx** (~loop submit form, call at submitLoop ~1835) — add exclusive/shared toggle, pass `exclusivity`.
3. **Verified.jsx** — show exclusivity badge on loop rows; shared loops show pull count / allow re-pull;
   pull button copy ("Claim exclusively" vs "Pull").

## minInstances also added this session (cold-start work)
9 funcs warm: submitCampaign, listApprovedBeats, listCampaignRequests, getVerifiedPreviewUrl,
submitLoop, pullLoop, listLiveLoops, downloadLibraryBeat, downloadVerifiedBeatFile.


---

## UPDATE — Frontend DONE (all 3 pages), build green

### Staff.jsx — "Loop Review" tab added
- New `reviewLoopsQ` query (`listReviewLoops`), `reviewLoops` data, `refreshReviewLoops`.
- `decideLoop(loopId)` approve handler; `confirmReject` extended to branch on `reject.kind === "loop"` (calls moderateLoop) vs campaign (moderateCampaign).
- NAV item "Loop Review" (ShieldCheck icon, pending count) inserted before "Loop Claims".
- META.loopReview header entry.
- `view === "loopReview"` section + new `LoopReviewCard` component (expandable row: audio preview, Exclusive/Shared pill, spec, tags, Approve & go live / Reject buttons). Mirrors CampaignCard.

### Dashboard.jsx — exclusivity toggle on loop submit
- `exclusivity` state (default "exclusive").
- "Availability" radio cards (Exclusive / Shared) with descriptions, inserted after BPM/Key/Tags row.
- Passed `exclusivity` to submitLoop; success msg now "pending review".
- "My submitted loops" status badge upgraded for all 4 statuses (pending_review=gold, live=green,
  rejected=red, used=gray) + shows model (Exclusive/Shared) + pullCount for shared + rejection reason.

### Verified.jsx — loop exclusivity surfaced
- Exclusivity badge on loop rows (Shared=blue +pullCount / Exclusive=gold).
- Dot-menu label: "Pull loop" for loops vs "Export" for beats.

### Verified
- `npm run build` passes (Staff 55.9k, Verified 63.5k, Dashboard 104.7k). No console errors.
- Dashboard toggle confirmed via preview: Exclusive<->Shared selection works.
- Staff loop-review tab + Verified badges compile (build green); not visually exercised (needs a staff
  account + live pending loops), but mirror proven campaign patterns.

## STATUS: feature complete end-to-end. Deploy functions + web together (see critical sequencing note above).
