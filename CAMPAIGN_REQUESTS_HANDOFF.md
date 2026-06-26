# Campaign Requests Handoff

## Original Prompt

> Okay perfect, this is my next idea and should be my last feature I want to add. I want A&R's and artists to be able to make campaign requests. These should pop up to Pro users on their Overview. I want it to be almost forum like where it shows the A&R's profile picture (which profile pictures don't work btw), their name, and a briefing of what/who type beats they're looking for. Customers shouldn't be able to post but submit campaigns that target the A&R directly. We also need to add Producer, Producer +, Producer ++, A&R, A&R+, A&R++, Artist, Artist+, Artist++. These will be displayed as roles on verified users profiles. THEIR CONTACT INFO SHOULD NOT BE VISIBLE. A&R role needs to be able to add what label they work for. Think through this really quick. Ask any questions you need to. And lets plan out this implementation

Follow-up requirements clarified:

- Producer is a verified role, not a paid role.
- Free, Pro, and Plugg are paid roles.
- All verified roles can create requests.
- Producers can only create loop requests.
- A&Rs and Artists can request loops and beats.
- Free can submit only to Producer requests.
- Plugg can submit to Producer, Producer+, Artist, Artist+, and A&R requests.
- Pro can submit to all verified roles.
- "Desks" can become submitting to the respective role.
- A&R roles can add the label they work for.
- Contact info should never be visible.
- Requests should be shown at the front of the Verified dashboard.
- Requests should include analytics.
- If a Pro user submits a request, it should also be emailed to the A&R.
- Some role tiers, like the highest levels, are reserved for Pro targeting.

## Completed

### Authentication and Profile Cleanup

- Removed Google sign-in from the auth flow.
- Kept email/password auth as the primary path.
- Fixed the profile picture upload button.
- Added reusable avatar helpers for validating, uploading, and resolving profile images.
- Updated Dashboard, Verified, and Staff surfaces to use the improved avatar/profile handling.
- Updated storage rules so user profile image uploads are allowed in the intended profile paths.

### Verified Role System

- Added the verified role model:
  - Producer
  - Producer+
  - Producer++
  - Artist
  - Artist+
  - Artist++
  - A&R
  - A&R+
  - A&R++
- Added shared client helpers for verified role labels, families, and plan-to-role submission rules.
- Added matching backend helpers so role checks are enforced server-side.
- Added `verifiedRole` and `labelName` to user records.
- Protected role fields in Firestore rules so normal users cannot edit them directly.
- Updated staff user listing to include verified role and label fields.
- Added staff controls to assign/remove verified roles and A&R label names.

### Campaign Request Backend

- Added `createCampaignRequest` callable.
- Added `listCampaignRequests` callable.
- Added rate limits for campaign request creation and listing.
- Added server-side request validation:
  - Only verified users can create requests.
  - User must have a verified role.
  - Producers can only create loop requests.
  - Artists and A&Rs can create beat, loop, or both request types.
  - A&R label names are public only as label names, not contact details.
- Added request public serialization that intentionally excludes emails, phone numbers, and private contact info.
- Added request analytics fields:
  - view count
  - submission count
  - approved submission count
  - email sent count
- Added Firestore rules that block direct client reads/writes to `campaignRequests`; access goes through callables.
- Added the Firestore composite index for open campaign requests ordered by newest first.

### Verified Page Request Hub

- Added a request hub to the front of the Verified page.
- Added a request composer for verified users.
- Added role-aware request type options.
- Added request cards with:
  - profile/avatar
  - public display name
  - verified role label
  - A&R label name when available
  - request type
  - title
  - brief
  - genres/tags/references/deadline
  - submission CTA
- Added request analytics for the current user's own requests.
- Added responsive styling for desktop and mobile.
- Kept the UI in the same visual language as the redesigned Verified page.

### Beat Campaign Submissions to Requests

- Added request targeting from Verified request cards into the Dashboard campaign builder.
- Added `targetRequest` state in Dashboard.
- Added `/dashboard?request=<requestId>` handoff.
- Added a request target banner in the campaign builder.
- Added a clear-target action.
- Included `targetRequestId` in `submitCampaign`.
- Updated the confirmation modal to show request-target delivery.
- Server-side validation now checks:
  - target request exists
  - target request is open
  - user's paid plan can submit to the requester role
  - request accepts beats or both
- Targeted campaigns store request metadata:
  - target request ID
  - requester UID
  - requester role
  - request type
  - request title
- Targeted campaign submissions increment the request submission count.

### Loop Request Submissions

- Added `/dashboard?loopRequest=<requestId>` handoff.
- Loop-only request cards now route to Loop Drops instead of the beat campaign builder.
- Added a request target banner in Loop Drops.
- Added clear-target action in Loop Drops.
- Included `targetRequestId` in `submitLoop`.
- Server-side validation now checks:
  - target request exists
  - target request is open
  - user's paid plan can submit to the requester role
  - request accepts loops or both
- Targeted loop submissions store request metadata:
  - target request ID
  - requester UID
  - requester role
  - request type
  - request title
- Targeted loop submissions increment the request submission count.

### Firebase Deploy and iOS Sync

- Rebuilt the production web app with `npm run build`.
- Verified Cloud Functions syntax with `node --check functions/index.js`.
- Deployed to Firebase project `pluggurbeats`:
  - Hosting
  - Cloud Functions
  - Firestore rules
  - Storage rules
- Firestore index deploy initially returned `409 index already exists`; the index is already present, so the release continued without redeploying indexes.
- Confirmed these key callables are live:
  - `createCampaignRequest`
  - `listCampaignRequests`
  - `submitLoop`
- Synced iOS with Capacitor:
  - copied latest `dist` assets into `ios/App/App/public`
  - updated iOS plugins
  - ran `pod install`

## What Is Left

### Request Placement on Pro Overview — ✅ DONE

- Added a forum-style "Open requests" box to the Dashboard Overview, shown only to Pro users.
- Thread rows show requester avatar, name, role badge, A&R label, title, type chip, brief snippet, and submission count; expanding a row reveals the full brief, genres/tags, references, deadline, and view/submission counts.
- Submit CTA hands off to the campaign builder (beats) or Loop Drops (loops) via the existing `targetRequest` flow; `both` requests show separate "Submit a campaign" and "Submit a loop" actions.
- Backend: `listCampaignRequests` now also accepts paid (Plugg/Pro) subscribers, not just verified users, so Pro producers can load the feed.
- Backend: added `recordCampaignRequestView` callable — increments `viewCount` once per unique viewer (deduped via a `viewers/{uid}` marker; requester's own views and closed requests never count). This fixes the previously-inert `viewCount` field.
- Files: `functions/index.js` (gate + new callable + rate limit), `src/pages/Dashboard.jsx` (`RequestForum`/`RequestThread`, `pickRequest` handler).
- Not yet deployed — needs `firebase deploy` (functions + hosting) before it works against live data.

### Direct Role Targeting UI

- The backend rules for Free, Plugg, and Pro role submission access are in place.
- The UI can be improved so users understand which roles their plan can submit to before they click.
- Next step: add locked/available role filters and upgrade messaging.

### Pro Email to A&R

- The prompt asked: if a Pro user submits to an A&R request, it should email the A&R.
- Submission targeting is implemented, but the email notification path should still be added.
- Next step: trigger an email when a Pro campaign or loop targets an A&R request.
- Important: this must use server-side contact lookup only; never expose the A&R email to the client.

### Request Management

- Requests can be created and listed.
- There is not yet a full owner management flow.
- Next step: let request creators close, edit, or archive their own requests.

### Staff Moderation for Requests

- Requests are not currently staff-moderated before appearing.
- If quality control matters, add staff review states:
  - pending
  - open
  - closed
  - rejected
- This would keep low-quality or spammy requests out of Verified.

### Analytics Depth

- Basic request analytics fields exist.
- Next step: show richer request analytics:
  - submissions by type
  - submissions by plan
  - approved submissions
  - email delivery/open data for Pro-to-A&R requests
  - conversion from request view to submission

### Profile Pages

- Verified roles are assigned and displayed in request cards.
- Full public verified profiles are not built yet.
- Next step: add role badges and public profile cards/pages for verified users while keeping contact info hidden.

### "Both" Request UX

- Requests with `both` currently route to beat campaign submission by default.
- Next step: show two actions on `both` requests:
  - Submit campaign
  - Submit loop

### Native iOS QA

- iOS assets were synced successfully.
- Next step: open the iOS project in Xcode and run on the iPad/simulator to confirm:
  - request hub renders correctly
  - profile pictures load
  - loop request handoff opens Loop Drops
  - beat request handoff opens campaign builder
  - export/share still works

