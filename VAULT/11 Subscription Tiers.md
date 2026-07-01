# Subscription Tiers & Feature Gates

## Tier Overview

| Tier | Who | Can Post Requests | Credit Allowance | Notes |
|------|-----|:-----------------:|:----------------:|-------|
| Free | All signed-up users | ✗ | Starter credits | Browse feed only |
| Producer | Verified producers | ✗ | Monthly top-up | Submit beats |
| Verified | Artists / A&R / Labels | ✓ | N/A | Post requests, view inbox |
| Staff | Platform admins | ✓ (incl. announcements) | Unlimited | Full moderation |

## Gate Checks in Code

### Posting a request (Dashboard + Staff)
```js
// Cloud Function: createCampaignRequest
const me = await db.collection("users").doc(uid).get();
const isVerified = me.data()?.verified === true;
const isStaff = await hasStaffAccess(request.auth);

if (!isVerified && !isStaff) {
  throw new HttpsError("permission-denied", "Verified account required");
}
```

### Submitting a beat
```js
// Requires pitchBalance >= creditsCost
const balance = me.data()?.pitchBalance ?? 0;
if (balance < creditsCost) {
  throw new HttpsError("failed-precondition", "Insufficient credits");
}
```

### Daily cap
```js
// Non-exempt, non-staff users
const today = new Date().toISOString().slice(0, 10);
const todayCount = /* query submissions for today */;
if (!dailyCapExempt && !isStaff && todayCount >= DAILY_CAP) {
  throw new HttpsError("resource-exhausted", "Daily limit reached");
}
```

## Credit System

- Credits are called **`pitchBalance`** in Firestore
- Deducted atomically in `submitCampaign` Cloud Function
- Producers can purchase more credits (payment flow TBD)
- Staff: no credit requirement

## Verified Role Flow

1. User signs up → `verified: false`, `role: "producer"` (default)
2. User contacts support or gets discovered
3. Staff manually sets `verified: true` + `role: "artist"|"ar"|"label"` in Firestore
4. User re-logs in → can now post requests
5. Badge updates to show role label (A&R, Label, etc.)

## Future Tier Ideas

- **Pro Producer**: higher daily submission limit, analytics, early access
- **Label Dashboard**: bulk request management, team seats
- **Premium Placement**: boosted visibility in feed
