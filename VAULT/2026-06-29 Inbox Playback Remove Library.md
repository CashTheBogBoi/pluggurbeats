# Session — 2026-06-29: Staff remove-from-library + inbox playback

## #2 — Staff "Remove from library"
- Backend `removeFromLibrary` (NEW, staff-only callable, functions/index.js): takes a campaign `path`,
  deletes its `verifiedBeats` docs, sets `excludedFromLibrary: true` on the campaign.
- `indexVerifiedBeats` guarded so it NEVER re-indexes excluded/exclusive campaigns (see fix below).
- Staff.jsx: `removeFromLibrary(path)` handler + "Remove from library" button on `pitched` CampaignCards
  (shows the targeted-request title if it was a targeted submission). Passed via `onRemoveLibrary`.
- Use this to pull the already-pitched "over & over" beat out of the library.

## #3 — Inbox playback/download (InboundInbox)
- Threaded `player`, `onPlayBeat`, `onDownloadBeat` from main Verified component → RequestHub → InboundInbox.
- Handlers reuse existing `chooseTrack` / `doDownloadBeat`, building the item id as
  `beat:${ownerUid}:${campaignId}:${beatIndex}` (matches resolvePreviewUrl's cache key).
- Each inbox beat now has a Play/Pause button + Download (Share2) button; `canPlay` gated on
  ownerUid/campaignId/beatIndex present (handles beatIndex 0 via `!= null`).
- Works because exclusive targeted campaigns are status `pitched`, and getVerifiedPreviewUrl /
  downloadLibraryBeat resolve via the campaign doc (status pitched) without needing a verifiedBeats index.

## ⚠️ CRITICAL bug found + fixed during #3
`resolveVerifiedBeatFile` LAZILY calls `indexVerifiedBeats` when a pitched beat has no verifiedBeats
index doc (fires on preview/download). For an EXCLUSIVE inbox beat that means: requester hits play →
beat silently republished to the public library. Exclusivity broken on first play.
**Fix:** `indexVerifiedBeats` now early-returns when
`campaign.targetRequesterUid && campaign.listInLibrary !== true` (in addition to `excludedFromLibrary`).
This makes indexVerifiedBeats the single source of truth — covers lazy re-index, backfill, and the
pitchCampaign path.

## Verified
- `node --check functions/index.js` OK; `npm run build` OK (all 3 pages).
- Inbox buttons not visually exercised (account has 0 inbound submissions) — verify after deploy with a
  real targeted submission.

## Disk note
Hit ENOSPC mid-session (disk 100% full) — user cleared space (now ~1.2GB free, tight). Avoided repeated
heavy builds.

## DEPLOY (all together)
`firebase deploy --only functions,firestore:rules,firestore:indexes` (Node 22 + LANG=en_US.UTF-8),
then deploy the web build. Covers: targeted-exclusive routing, inbox rule, submittedCampaigns index,
loop moderation, minInstances, removeFromLibrary.
