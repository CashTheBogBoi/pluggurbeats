# Firebase Architecture

## Firestore Collections — Full Schema

### `users/{uid}`
The central user record. Created on signup, extended by Cloud Functions only for sensitive fields.

```
displayName               string
email                     string
photoURL                  string

subscription.tier         string    "free" | "plugg" | "pro"
subscription.stripeSubId  string    active Stripe subscription ID

pitchCredits.balance      number    beat submission credits remaining
pitchCredits.monthlyGrant number    credits granted this billing period (for rollover cap)

loopCredits.balance       number    loop submission credits remaining
loopCredits.monthlyGrant  number    credits granted this billing period

verifiedPuller            boolean   can access Loop Pool tab on /verified
verifiedListener          boolean   can access /verified at all (A&R / artist gate)
verifiedRole              string    one of 9 verified identity roles (see [[06 User Roles]])
labelName                 string    A&R-only public label name (never email/contact)
verifiedRoleUpdatedAt     timestamp
verifiedRoleUpdatedBy     string    staff email who set the role

staff                     boolean   platform admin flag
notificationPrefs         map       per-event boolean prefs (see [[19 Push Notifications]])
```

**Protected fields** — Firestore rules block client writes on these:
`subscription`, `pitchCredits`, `loopCredits`, `verifiedPuller`, `verifiedListener`, `verifiedRole`, `labelName`

---

### `users/{uid}/campaigns/{campaignId}`
Beat campaigns created by producers via `submitCampaign`.

```
producer              object    { name, instagram }
beats                 array     [{ title, bpm, key, genre, tags, storagePath }]
targets               array     selected desk strings for Pro email targeting
tier                  string    submitter's subscription tier at time of submit
status                string    "pending_review" → "approved" → "pitched" | "no_contacts" | "send_failed"

targetRequestId       string    ID of the campaignRequest this targets (if direct submission)
targetRequesterUid    string    UID of the request owner
targetRequesterRole   string    their verifiedRole value
targetRequestType     string    "beats" | "loops" | "both"
targetRequestTitle    string    denormalized title

listInLibrary         boolean   true if producer paid +5 credits to also index publicly
pitchedAt             timestamp set when pitchCampaign Firestore trigger fires
pitchedTo             array     list of contact emails that were emailed
opens                 number    attributed via Resend webhook
downloads             number
```

**Lifecycle**: `submitCampaign` → `pending_review` → staff `moderateCampaign` approves → `approved` → `pitchCampaign` Firestore trigger fires automatically.

---

### `users/{uid}/inboundSubmissions/{subId}`
Beats received by A&Rs/Artists when producers submit directly to their requests. Written by `deliverInboundSubmission` (internal helper). Client reads own; Functions write only.

```
campaignId            string
producerUid           string
producerName          string
producerInstagram     string
beats                 array     includes signed playUrl
requestId             string
requestTitle          string
pitchedAt             timestamp
```

---

### `users/{uid}/creditLedger/{entryId}`
Full audit trail of every credit movement. Client reads own; Functions write only.

```
kind         string    "pitch" | "loop"
delta        number    positive = grant, negative = debit
reason       string    e.g. "monthly_grant", "submitCampaign", "buyCreditPack"
refId        string    campaignId or loopId that triggered the debit
balanceAfter number
at           timestamp
```

---

### `users/{uid}/devices/{token}`
FCM/APNs tokens for push notifications. Token IS the document ID (natural dedup). Multiple devices per user supported. Written by client via `saveDeviceToken` on push registration.

---

### `users/{uid}/splitSheets/{sheetId}`
DocuSign envelopes for beat split agreements. Owner reads; Functions write.

---

### `users/{uid}/libraryActivity/{actId}`
Tracks plays and downloads of this user's beats/loops. Owner reads; Functions write.

---

### `verifiedBeats/{beatId}`
Indexed approved beats shown in the Verified library on `/verified`. Created by `indexVerifiedBeats` when a campaign is approved and pitched to the general pool, or when a targeted campaign has `listInLibrary: true`.

```
uid           string    producer's UID
campaignId    string
title         string
genre         string
bpm           string | number
key           string
tags          array
storagePath   string    used to generate signed play URLs
status        string    "active" | "removed"
pitchedAt     timestamp
```

---

### `loops/{loopId}`
Submitted loops (separate economy from beat campaigns). Created by `submitLoop`.

```
makerUid              string
makerName             string
title, bpm, key, genre, tags
storagePath           string
exclusivity           string    "exclusive" (one puller claims it, gone) | "shared" (stays in pool)
status                string    "pending_review" → "live" | "claimed"

targetRequestId       string    optional — if submitted to a campaignRequest
targetRequesterUid    string
targetRequesterRole   string
targetRequestType     string
targetRequestTitle    string

plays, downloads, pullCount   number
createdAt             timestamp
```

---

### `loopClaims/{claimId}`
Created when a `verifiedPuller` pulls an exclusive loop. Functions only.

```
loopId       string
pullerUid    string
pullerName   string
claimedAt    timestamp
```

---

### `campaignRequests/{requestId}`
Requests posted by verified users. Producers submit beats/loops to these.

```
title, brief                  string
requestType                   string    "beats" | "loops" | "both"
genres, tags, references      array
deadline                      string

status                        string    "open" | "closed"
createdByUid, createdByName   string
createdByRole                 string    verifiedRole value (e.g. "ar_plus")
createdByRoleLabel            string    display label (e.g. "A&R+")
labelName                     string    A&R's label — public label name only, never contact info

viewCount                     number    unique viewers (deduped via viewers subcollection)
submissionCount               number    incremented by submitCampaign / submitLoop
approvedCount                 number

createdAt, updatedAt          timestamp
```

### `campaignRequests/{requestId}/viewers/{uid}`
Empty docs keyed by viewer UID used to deduplicate `viewCount` increments. Functions only.

---

### `emailIndex/{token}`
Maps unique per-recipient download tokens to campaign + contact metadata. Used by `pitchCampaign` to generate tracked links and by `resendWebhook` to attribute opens. Functions only.

---

### `verifiedEmailList/{uid}`
Server-side email addresses for verified users. Written by `setVerifiedRole`, read by `submitCampaign`/`submitLoop` when sending Pro submission emails. **Never exposed to client** — `allow read, write: if false` in rules.

```
email         string    sourced from Firebase Auth, never client-supplied
displayName   string
verifiedRole  string
updatedAt     timestamp
```

---

### `stripeCustomers/{customerId}`
Maps Stripe customer ID → Firebase UID. Functions only.

### `dsEnvelopes/{envelopeId}`
Maps DocuSign envelope ID → `{uid, sheetId}`. Functions only.

---

## Routing Logic (`src/lib/userRouting.js`)

After sign-in, `getSignedInHome(user)` determines the landing page:
1. Email not verified → `/` (marketing)
2. Has `verifiedListener` or `verifiedPuller` AND no paid subscription → `/verified`
3. Everyone else (including paid subscribers who are also verified) → `/dashboard`

Native iOS app (`Capacitor.isNativePlatform()`) always launches to `/login`, skipping the marketing page entirely.

## Firebase Storage Paths

```
beats/{uid}/{filename}                Producer beat uploads
loops/{uid}/{filename}                Loop uploads
profiles/{uid}/avatar.jpg             User profile pictures
pitches/{uid}/{campaignId}/beats.zip  Server-assembled pitch zip packages
```

## Key Firestore Rule Patterns

- **Protected user fields**: `!request.resource.data.diff(resource.data).affectedKeys().hasAny(protectedKeys())`
- **Staff check**: done via `auth.token.email` allowlist + `auth.token.staff === true` custom claim
- **Loop access**: makers read own; `verifiedPuller == true` users read all live loops
- **campaignRequests**: authenticated users can read; all writes are Functions-only
