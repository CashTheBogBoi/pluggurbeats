# Cloud Functions Reference

All functions: Gen 2, Node 22, `us-central1`. Callable unless noted otherwise.

## Deploy

```bash
firebase deploy --only functions
# or with rules and indexes:
firebase deploy --only functions,firestore:rules,firestore:indexes
```

Heavy SDKs (pdf-lib, docusign-esign, stripe, svix, jszip) are **lazy-required** inside their handlers to avoid cold start penalties on hot functions like `getVerifiedPreviewUrl` and `listApprovedBeats`.

---

## Rate Limits (per-IP, enforced by `assertCallableRateLimit`)

| Function | Limit | Window |
|----------|-------|--------|
| submitCampaign | 10 | 1 hour |
| submitLoop | 30 | 1 hour |
| pullLoop | 60 | 1 hour |
| downloadLibraryBeat | 60 | 1 hour |
| generateSplitSheet | 10 | 1 hour |
| createCampaignRequest | 20 | 1 hour |
| getVerifiedPreviewUrl | 180 | 1 min |
| listLiveLoops | 120 | 1 min |
| listApprovedBeats | 120 | 1 min |
| listCampaignRequests | 120 | 1 min |
| recordLibraryView | 120 | 1 min |
| recordCampaignRequestView | 200 | 1 min |
| moderateCampaign | 60 | 1 min |
| removeFromLibrary | 30 | 1 min |

---

## Beat Campaign Functions

### `submitCampaign` — `minInstances: 1`, `secrets: [RESEND_API_KEY]`
Producer submits a beat campaign. Debits pitch credits atomically in a transaction.

**Guards**: Auth required. `pitchCredits.balance >= cost`. Free users must target a request. Targeted requests must be open and match the user's plan tier.

**Input**: `{ producer, beats[], targets[], addons, targetRequestId }`

**Side effects**:
- Debits `pitchCredits` + writes ledger entry
- Creates `users/{uid}/campaigns/{id}` as `pending_review`
- If targeted: increments `campaignRequests/{id}.submissionCount`
- If targeted + Pro: fires `sendSubmissionEmail` (fire-and-forget)
- If targeted: fires `sendPush` to requester

---

### `pitchCampaign` — Firestore trigger on `users/{uid}/campaigns/{campaignId}`
Fires automatically when `status` transitions to `"approved"`. This is where email sending happens.

**Logic branches**:
1. **Targeted campaign** (`targetRequesterUid` set): calls `deliverInboundSubmission` → writes to `users/{requesterUid}/inboundSubmissions`. If `listInLibrary: true`, also calls `indexVerifiedBeats`. No email blast.
2. **Non-Pro OR no desks selected**: calls `indexVerifiedBeats` only. Library listing, no email.
3. **Pro + desks selected**: resolves contacts from `contacts.json`, zips beats server-side, emails each contact via Resend with a unique tracked download token.

---

### `moderateCampaign` — staff-only
Approve or reject pending campaigns.

**Actions**: `"approve"` | `"reject"`

---

### `listReviewCampaigns` — staff-only
Returns pending campaigns with signed preview URLs for staff review.

---

### `listCampaignEmailEvents` — staff-only
Returns Resend open/click events for a campaign's emails.

---

## Loop Functions

### `submitLoop` — `minInstances: 1`, `secrets: [RESEND_API_KEY]`
Submits a loop. Debits 1 loop credit.

**Guards**: Auth required. `loopCredits.balance >= 1`. Storage path must be under `loops/{uid}/`. File must be valid MP3.

**Input**: `{ title, bpm, key, genre, tags, storagePath, targetRequestId, exclusivity }`

**Side effects**:
- Debits `loopCredits` + writes ledger
- Creates `loops/{id}` as `pending_review`
- If targeted: increments `campaignRequests/{id}.submissionCount`, fires push + Pro email

---

### `moderateLoop` — staff-only
Approve (`"live"`) or reject loops. Approval makes them visible in the Loop Pool.

---

### `listReviewLoops` — staff-only
Returns pending loops with signed preview URLs.

---

### `pullLoop` — verifiedPuller only
A verified puller claims a loop. For exclusive loops: sets status to `"claimed"`, creates `loopClaims/{id}`. For shared loops: increments `pullCount`.

---

### `listLiveLoops` — `minInstances: 1`
Returns approved live loops for the Loop Pool tab. Returns signed play URLs.

---

## Verified Library Functions

### `listApprovedBeats` — `minInstances: 1`
Returns `verifiedBeats` collection for the Verified library. Supports genre/key/BPM filtering and pagination.

---

### `getVerifiedPreviewUrl` — `minInstances: 1`
Generates a signed Storage URL for a beat's audio file. Rate-limited aggressively (180/min) to prevent scraping.

---

### `recordLibraryView`
Increments `plays` on a `verifiedBeat` doc and writes a `libraryActivity` entry.

---

### `downloadLibraryBeat` — `minInstances: 1`
Generates a signed download URL for a verified beat. Increments `downloads`, writes `libraryActivity`.

---

### `removeFromLibrary` — staff-only
Sets `verifiedBeats/{id}.status` to `"removed"`. Soft delete — the campaign still exists.

---

### `backfillVerifiedBeats` — staff-only
Re-indexes approved campaigns into `verifiedBeats`. Used when the indexing schema changes.

---

## Campaign Request Functions

### `createCampaignRequest`
Verified users (or staff) post a request.

**Guards**: Must have `verifiedRole` set. Producers can only create `"loops"` requests. A&Rs and Artists can create `"beats"`, `"loops"`, or `"both"`.

**Input**: `{ title, brief, requestType, genres, tags, references, deadline }`

---

### `listCampaignRequests` — `minInstances: 1`
Returns open `campaignRequests`. Accessible to all authenticated users (producers, verified, paid subs).

---

### `recordCampaignRequestView`
Increments `viewCount` once per unique viewer. Deduped via `campaignRequests/{id}/viewers/{uid}` marker. Requester's own views don't count.

---

### `moderateCampaignRequest` — staff-only
**Actions**: `"close"` | `"pin"` | `"unpin"`

---

## Staff Functions

### `checkStaffAccess`
Client calls this to verify staff status. Returns `{ staff: true/false }`.

### `getStaffOverview` — `secrets: [STRIPE_SECRET]`
Returns platform stats for the staff dashboard: user counts, revenue data from Stripe, recent activity.

### `listUsers` — staff-only
Returns paginated user list with subscription, verified role, credit balances, and ban status.

### `setVerifiedPuller` — staff-only
Toggles `verifiedPuller` flag. Grants/revokes Loop Pool access.

### `setVerifiedListener` — staff-only
Toggles `verifiedListener` flag. Grants/revokes `/verified` page access.

### `setVerifiedRole` — staff-only
Assigns one of the 9 verified identity roles. Also writes to `verifiedEmailList/{uid}` (or deletes from it on revoke) for the Pro submission email path.

### `setStaffRole` — staff-only
Grants/revokes staff flag. Cannot revoke owner accounts (in `staff.json` allowlist).

### `adjustCredits` — staff-only
Manually add or subtract pitch or loop credits. Writes a ledger entry.

### `banUser` — staff-only
Sets a ban flag on the user doc.

### `listLoopClaims` — staff-only
Returns loop claim history.

---

## Payments & Subscriptions

### `createSubscriptionCheckout` — `secrets: [STRIPE_SECRET]`
Creates a Stripe Checkout session for Plugg or Pro subscription. Returns `{ url }` — client redirects to it.

### `buyCreditPack` — `secrets: [STRIPE_SECRET]`
Creates a Stripe Checkout session for a one-time credit pack purchase.

### `reconcileCredits` — `secrets: [STRIPE_SECRET]`
Self-service: if a user's monthly credit grant was missed (webhook failure), they call this on dashboard load. Verifies the subscription is genuinely active with Stripe before granting.

### `stripeWebhook` — HTTP, `secrets: [STRIPE_SECRET, STRIPE_WEBHOOK_SECRET]`
Handles Stripe events: `invoice.payment_succeeded` → applies monthly credit grants; `customer.subscription.deleted` → downgrades tier.

---

## DocuSign / Split Sheet Functions

### `generateSplitSheet` — `secrets: DS_SECRETS`
Creates a DocuSign envelope for a beat split agreement. Requires DocuSign JWT grant credentials.

### `refreshSplitSheetStatus` — `secrets: DS_SECRETS`
Polls DocuSign for envelope status updates.

### `docusignConnect` — HTTP, `secrets: [DOCUSIGN_CONNECT_SECRET]`
Webhook endpoint for DocuSign Connect events. Updates split sheet status in Firestore.

---

## Email Functions

### `resendWebhook` — HTTP, `secrets: [RESEND_WEBHOOK_SECRET]`
Receives Resend (Svix) delivery events. Looks up the `emailIndex` token and increments `opens`/`downloads` on the campaign. Verifies Svix signature.

### `downloadBeats` — HTTP (no auth, token-gated)
Public endpoint embedded in pitch emails. Validates the `e` token, serves the zip from Storage, increments `downloads`.

### `downloadVerifiedBeatFile` — HTTP, `minInstances: 1`
Streams individual verified beat files. Separate from the download token flow.
