# Resend Email Integration

## What We Use It For

Resend is the transactional email provider for PluggurBeats. All outbound email goes through it — beat pitches to industry contacts, submission notifications to verified users, and any future system emails.

Sending domain: `pluggurbeat.com` (not pluggurbeats.com — confirm this is verified in Resend dashboard before adding new send paths)
From address pattern: `[Purpose Label] <role@pluggurbeat.com>`

## Current Email Paths

| Trigger | Recipient | Condition |
|---------|-----------|-----------|
| Campaign approved + Pro tier + desks selected | Industry contacts (contacts.json) | Public blast |
| Campaign approved + targeted request | Requester A&R/Artist | NOT YET — push only, email pending |

## How Email Tracking Works

Each send generates a unique token stored in `emailIndex/{token}` in Firestore. The download link embeds the token (`/downloadBeats?e={token}`). When the recipient opens or downloads, the webhook fires and resolves the token back to the campaign + contact — that's how per-contact opens and downloads are attributed.

Resend sends delivery events via Svix webhooks → `resendWebhook` Cloud Function → Firestore.

## Verified User Email List

When staff assigns a verified role via `setVerifiedRole`, that user's email is written to `verifiedEmailList/{uid}` in Firestore. This is the authoritative list for verified-user email targeting.

- Email is fetched server-side from Firebase Auth — never from the client
- When a role is revoked (role set to ""), the doc is deleted
- This list is intentionally NOT exposed to the client at any point

## Submission Email Rule (Pro → A&R/Artist)

When a Pro user submits a campaign or loop to a verified request:
1. Server looks up the requester's email from `verifiedEmailList/{requesterUid}`
2. Email is sent via Resend with beat details + producer info
3. No download link in this email — A&R accesses beats through `/verified` InboundInbox
4. Push notification fires in parallel (separate from email)

Non-Pro submissions (Plugg, Free) only get a push notification, no email.

## Secrets

- `RESEND_API_KEY` — Firebase Secret, required on any function that calls `new Resend(...)`
- `RESEND_WEBHOOK_SECRET` — Firebase Secret, used by `resendWebhook` to verify Svix signatures

Any new function that sends email must add `secrets: [RESEND_API_KEY]` to its `onCall` config, otherwise the secret is undefined at runtime and the function throws silently.

## Gotchas

- Resend returns `{ data, error }` — it does NOT throw on API-level failures (e.g. unverified domain, bad address). Always check `sent?.error` explicitly after every send call.
- The Resend `from` domain must be verified in the Resend dashboard. If emails aren't delivering, check domain verification first — the function will appear to succeed (no throw) but `data` will be null and `error` will carry the reason.
- `RESEND_WEBHOOK_SECRET` is a Svix secret, not a Resend API key — they're different values, both stored as Firebase Secrets.
