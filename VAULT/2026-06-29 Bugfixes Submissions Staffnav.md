# Session — 2026-06-29: Two bug fixes

## Bug 1 — beat submitted to a request didn't show in "verified requests submissions"
**Cause:** `submittedCampaigns` live query in Verified.jsx (~line 321) is
`users/{uid}/campaigns where targetRequestId != "" orderBy(targetRequestId, createdAt desc)`.
The `!=` + second orderBy needs a composite index that DIDN'T EXIST → Firestore throws
`failed-precondition` → query returns nothing → the user's submission ("over & over") never appears.
(Matches the `submitted-campaigns failed-precondition` console errors seen earlier.)
**Fix:** added composite index to firestore.indexes.json:
`campaigns (COLLECTION): targetRequestId ASC, createdAt DESC`.
**MUST DEPLOY:** `firebase deploy --only firestore:indexes` — index build takes a few minutes;
submissions stay empty until it finishes. The submission data itself was always saved.

### OPEN QUESTION (flagged, not changed)
User also said request-targeted submissions "shouldn't show in the beat library." Currently a
request-targeted campaign, once staff-approved, becomes `pitched` and DOES enter the general library
(listApprovedBeats) like any campaign. If they want request submissions delivered ONLY to the requester
(excluded from the public library), that's a deliberate backend change to pitchCampaign/library indexing
— needs confirmation before doing it. Not changed this session.

## Bug 2 — Staff button missing on mobile (iOS)
**Cause:** Staff button in Verified header is `hidden ... sm:flex` (desktop-only), and the mobile bottom
nav had no Staff entry. So staff users on phones couldn't reach /staff.
**Fix:** added a `{isStaff && ...}` Staff button (ShieldCheck icon) to the mobile bottom nav in Verified.jsx,
before "Studio". Verified in preview at 375px: nav shows Overview/Requests/Beats/Loops/Filters/Staff/Studio,
not crowded. Build green.
