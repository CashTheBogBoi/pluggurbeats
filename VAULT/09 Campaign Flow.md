# Campaign Flow — End to End

There are two types of campaigns: **open pool** (beat goes to Verified library + optional email blast) and **direct targeted** (beat goes exclusively to one A&R/Artist's InboundInbox).

---

## Open Pool Campaign

### 1. Producer Submits
- Dashboard → Submit tab → Campaign Builder
- Selects beats, fills metadata, optionally picks "desks" (Pro only)
- Calls `submitCampaign` — debits pitch credits atomically
- Campaign created as `pending_review`

### 2. Staff Approves
- Staff page → Campaigns tab → pending list
- Staff reviews beats via signed preview URLs
- Calls `moderateCampaign` with `action: "approve"`
- Campaign status flips to `"approved"`

### 3. `pitchCampaign` Trigger Fires
Firestore trigger on `users/{uid}/campaigns/{campaignId}` when `status` becomes `"approved"`.

**If Plugg tier OR no desks selected:**
- Calls `indexVerifiedBeats` → writes to `verifiedBeats/{id}`
- Campaign status → `"pitched"`, no email sent
- Beat appears in Verified library immediately

**If Pro tier AND desks selected:**
- Resolves contacts from `contacts.json` (organized by lane/desk)
- Downloads beats from Storage, zips server-side via JSZip
- Saves zip to `pitches/{uid}/{campaignId}/beats.zip`
- Sends one personalized Resend email per contact with unique tracked download link
- Indexes each send in `emailIndex/{token}` and `emailIndex/{resendId}`
- Campaign status → `"pitched"`, `pitchedTo: [emails]`
- Beat also appears in Verified library

---

## Direct Targeted Campaign

Producer clicks "Submit to request" from a campaign request card → Dashboard pre-fills the request target.

### 1. Producer Submits (targeted)
- Same `submitCampaign` call but includes `targetRequestId`
- Server validates: request is open, producer's plan can submit to requester's role
- Increments `campaignRequests/{id}.submissionCount`
- Fires `sendPush` to requester: "New submission to your request"
- If Pro tier: fires `sendSubmissionEmail` (looks up `verifiedEmailList/{uid}`, sends Resend email)

### 2. Staff Approves (same as open pool)
- Staff approves via `moderateCampaign`

### 3. `pitchCampaign` Trigger — Targeted Branch
- **Does NOT email any contacts**
- Calls `deliverInboundSubmission` → writes to `users/{requesterUid}/inboundSubmissions/{id}`
- Includes signed play URLs for each beat
- If `listInLibrary: true` (producer paid +5 credits): ALSO calls `indexVerifiedBeats`
- Campaign status → `"pitched"`

### 4. A&R / Artist Reviews in InboundInbox
- `/verified` → My Requests tab → InboundInbox section
- Sees grouped submissions by producer
- Plays beats inline via the bottom player (Verified.jsx `NowPlaying` component)
- Downloads via `downloadLibraryBeat` callable

---

## Credit Cost Model

| Tier | Cost per beat campaign |
|------|----------------------|
| Free | Must target a request. 1 pitch credit per beat. |
| Plugg | 1 pitch credit per beat. Goes to library only. |
| Pro | 1 pitch credit per beat. Can select desks for email blast. |

Additional addon: `listInLibrary` for targeted campaigns costs +5 credits total.

Monthly pitch credit grants:
- Free: 0
- Plugg: 15/month
- Pro: 50/month

Rollover cap: 3× monthly grant (e.g. Pro caps at 150).

---

## Email Attribution Flow

1. `pitchCampaign` generates a unique `token` per contact → saves to `emailIndex/{token}`
2. Resend email embed: `https://us-central1-pluggurbeats.cloudfunctions.net/downloadBeats?e={token}`
3. When contact clicks link → `downloadBeats` HTTP function validates token, serves zip, increments `downloads`
4. Resend fires webhook → `resendWebhook` function → looks up `emailIndex/{resendId}` → increments `opens` on campaign

---

## Error States

| Condition | Error |
|-----------|-------|
| Insufficient credits | `failed-precondition`: "Insufficient pitch credits: have N, need M" |
| Request closed | `failed-precondition`: "This request is no longer open" |
| Plan can't submit to role | `permission-denied`: "Your plugg plan cannot submit to A&R++ requests" |
| Request type mismatch | `invalid-argument`: "This request does not accept beats" |
| Free user, no target | `permission-denied`: "Free users must target a specific request" |
