# Session — 2026-06-29: Targeted submissions are exclusive (not in library)

## Decision
Beats submitted to a request (via the chat box) are EXCLUSIVE to the requester — they must NOT
enter the public Verified library. Optional **+5 pitch credits** to ALSO list in the library.

## Root cause of the original complaint
1. `inboundSubmissions` (the requester's inbox the frontend reads) was **never written by the backend**
   AND **had no Firestore read rule** (default-deny → permission-denied). So the requester only ever saw
   targeted beats *because* they entered the public library on approval — exactly the wrong behavior.
2. On approval, `pitchCampaign` always called `indexVerifiedBeats` → every approved campaign (incl. targeted)
   landed in the library.

## Implementation

### Backend (functions/index.js)
- `deliverInboundSubmission(db, campaign, producerUid, campaignId, pitchedAt)` (NEW helper): writes
  `users/{targetRequesterUid}/inboundSubmissions/{campaignId}` with the schema the InboundInbox reads
  (producerName, producerInstagram, beats[{title,genre,key,bpm,ownerUid,campaignId,beatIndex,storagePath}],
  beatCount, creditsSpent, targetRequestId/Title, kind:"beats", status:"pitched", submittedAt).
- `pitchCampaign`: added a **targeted short-circuit** right after the empty-beats check —
  if `campaign.targetRequesterUid`: set status "pitched", deliver to inbox, and index to library ONLY if
  `campaign.listInLibrary === true`. Skips the email blast entirely. Non-targeted path unchanged.
- `submitCampaign`: `wantsLibrary = !!targetRequest && request.data.listInLibrary === true`;
  cost = beats + (rush?2:0) + (wantsLibrary?5:0); stores `listInLibrary: wantsLibrary` on the campaign.

### Rules (firestore.rules)
- Added `match /users/{userId}/inboundSubmissions/{subId}`: owner reads own, write:false (Functions only).
  THIS is what fixes the permission-denied on the requester's inbox.

### Frontend (Dashboard.jsx CampaignBuilder)
- `listInLibrary` state; `libraryCost = (targetRequest && listInLibrary) ? 5 : 0` added to `cost`.
- Add-on toggle "Also list in Verified library — 5 credits" shown ONLY when `targetRequest` (conditional
  spread into the add-ons array). Passed through `pay.listInLibrary` → submitCampaign.

## Verified
- functions `node --check` OK; web `npm run build` OK; rules has the inboundSubmissions match.
- Add-on hidden correctly without a target request (confirmed in preview). Couldn't seed a fake
  targetRequest in preview (mount effect consumes sessionStorage once + auth re-mount race) — verify the
  +5 toggle in the real flow after deploy.

## ⚠️ Deploy together
`firebase deploy --only functions,firestore:rules,firestore:indexes` (the indexes deploy also covers the
earlier submittedCampaigns `targetRequestId` index fix). Use Node 22 + `export LANG=en_US.UTF-8`.

## Cleanup the user should do
The already-approved "over & over" beat is ALREADY in the library (verifiedBeats). New logic only affects
FUTURE approvals. To remove it: delete its `verifiedBeats` doc(s) (id = `{ownerUid}_{campaignId}_{beatIndex}`),
or add a small staff "remove from library" action later.

## Still a UX gap (flagged, not built)
InboundInbox currently shows beat METADATA only — the requester can't play/download the submitted beats
yet. The inbox doc now stores ownerUid/campaignId/beatIndex/storagePath so playback can be added later
(reuse getVerifiedPreviewUrl / downloadLibraryBeat).
