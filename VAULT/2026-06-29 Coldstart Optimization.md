# Session — 2026-06-29: Cold-Start Optimization (first-action latency)

## Symptom
First action on each page (play beat, load users) was slow; instant afterward. Classic
Cloud Functions (Gen 2) cold-start signature — functions scale to zero, first call spins up a container.

## Two root causes found
1. **40MB of heavy deps loaded on EVERY cold start.** `functions/index.js` top-level-required
   pdf-lib (23M), docusign-esign (7.3M), stripe (6.2M), svix (4.7M), jszip (1.1M). The hot
   functions (getVerifiedPreviewUrl, listApprovedBeats, listUsers, recordLibraryView) use NONE
   of these — but Gen2 loads the whole module on cold start, so they paid to parse 40MB.
2. **No minInstances** anywhere — every function cold-starts on first call after idle.

## Fix 1 — lazy-load heavy deps (FREE, done)
Moved each heavy require OUT of the top level INTO the cold-path function that uses it:
- `jszip` -> inside `pitchCampaign`
- `svix` Webhook -> inside `resendWebhook`
- `docusign-esign` -> inside `dsApiClient`, `generateSplitSheet`, `refreshSplitSheetStatus`
- `pdf-lib` -> inside `buildSplitSheetPdf`
- `stripe` -> top-level replaced with lazy wrapper `const Stripe = (...a) => require("stripe")(...a)`
  (Stripe SDK is callable without `new`, so all 5 call sites stay unchanged). require() is Node-cached.
- `resend` (~80K) left eager — negligible.
Result: hot functions no longer parse ~40MB on cold start → much faster cold starts. `node --check` passes.

## Fix 2 — minInstances on the 2 hottest (user chose "top 2", costs ~idle billing)
- `getVerifiedPreviewUrl` (play beat) → `{ region, minInstances: 1 }`
- `listApprovedBeats` (browse library) → `{ region, minInstances: 1 }`
Keeps one instance warm so the first play / first browse never cold-starts. Default 256MiB tier
(cheap). Billing for idle instances starts ONLY after deploy.

## DEPLOY REQUIRED
These are server-side. Nothing changes until:
```
firebase deploy --only functions
```
(Use Node 22 + `export LANG=en_US.UTF-8` in the shell — same env fixes as the iOS sync session.)

## Not done / future levers
- minInstances on listUsers / listReviewCampaigns / listCampaignRequests (Staff/Verified first loads
  still cold-start — user opted to revisit after seeing usage).
- Firestore `experimentalAutoDetectLongPolling: true` adds a transport-detection probe on the first
  Firestore op. If the Capacitor/web environment is known, `experimentalForceLongPolling` skips it.
  Minor, environment-sensitive — left alone.
- Client prewarm (fire hot callables right after login) — free alternative if minInstances cost grows.


---

## UPDATE — priority changed to "seamless for Verified + paying users"
User clarified the goal: seamlessness for **verified users and paying users** specifically (NOT free
users / staff). Re-scoped minInstances to cover both journeys' critical paths instead of just top 2.
Note: `listUsers` (Staff) dropped in priority — staff-only, not a paying/verified customer screen.

### minInstances: 1 now on 4 functions (the verified + paying spine)
| Function | Journey | Why |
|---|---|---|
| `listApprovedBeats` | Verified | browse library |
| `getVerifiedPreviewUrl` | Verified | play a beat |
| `listCampaignRequests` | Verified | request board + inbound submissions (main screen load) |
| `submitCampaign` | Paying | the core paid action — submit a campaign |

Rough cost: ~4 × 256MiB idle instances ≈ $12–30/mo (revisit against real usage).

### Next tier if they want even more coverage (not done)
`downloadLibraryBeat` / `downloadVerifiedBeatFile` (verified downloads), `pullLoop` / `submitLoop` /
`listLiveLoops` (loop economy), `reconcileCredits` (dashboard credit recovery on load).

### Deploy (unchanged)
`export LANG=en_US.UTF-8 && firebase deploy --only functions` (Node 22). Billing for warm
instances starts at deploy.
