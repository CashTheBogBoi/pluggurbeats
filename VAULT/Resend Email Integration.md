# Resend Email Integration

## Sending Domains

Two domains are configured (or need to be) in Resend:

| Domain | Purpose | Status |
|--------|---------|--------|
| `pluggurbeat.com` | Submission notifications to verified requesters | Active (used by `sendSubmissionEmail`) |
| `pluggurbeats.com` | Account verification emails, transactional auth | **Must be verified in Resend** (see setup below) |

> **Note:** `pluggurbeat.com` (single g) and `pluggurbeats.com` (double g) are two separate domains and require separate Resend domain verifications.

## DNS Setup for pluggurbeats.com (Required)

To send from `noreply@pluggurbeats.com`, add these records to your DNS (Google Workspace Admin → Domains, or wherever `pluggurbeats.com` DNS is managed):

1. Log in to [resend.com/domains](https://resend.com/domains)
2. Click **Add Domain** → enter `pluggurbeats.com`
3. Resend generates 3–4 DNS records (SPF TXT, DKIM CNAME x2, optional DMARC)
4. Add those records in Google Workspace Admin → Domains → DNS
5. Back in Resend, click **Verify** — propagation takes 5–30 minutes

The records coexist with Google Workspace MX records — they use different subdomains/types.

## Email Paths

### Account Verification (`sendVerificationEmail`)
- **From:** `PluggurBeats <noreply@pluggurbeats.com>`
- **Triggered:** On signup, via callable Cloud Function
- **Contains:** Firebase `generateEmailVerificationLink` link (24h expiry)
- **Continue URL:** `https://pluggurbeats.com/` (after verification, user lands on home)
- **Secret required:** `RESEND_API_KEY`

### Submission Notifications (`sendSubmissionEmail`)
- **From:** `PluggurBeats <submissions@pluggurbeat.com>`
- **Triggered:** Pro-tier user submits to a verified request (beat campaign or loop)
- **Recipient:** Pulled from `verifiedEmailList/{uid}` — never client-supplied
- **Secret required:** `RESEND_API_KEY`

## Verification Email UX Flow (as of June 2026)

1. User fills signup form, checks TOS, clicks **Create Account**
2. `createUserWithEmailAndPassword` — account created, user signed in
3. `sendVerificationEmail` Cloud Function called — generates Firebase link, sends branded HTML email via Resend
4. AuthModal switches to **"Check your email"** state (pulsing envelope, animated dots)
5. Browser polls `auth.currentUser.reload()` every 3 seconds
6. User clicks the link in their email → Firebase verifies the email
7. Next poll detects `emailVerified = true` → `getSignedInHome` → auto-redirect (no manual sign-in step)
8. If user closes the modal mid-flow → `signOut` is called, account remains unverified
9. If they try to sign in unverified → error + **Resend verification email** link

## Why Firebase's Default Sender Goes to Spam

Firebase Auth sends from `noreply@[project].firebaseapp.com` — a shared domain used by thousands of projects. Two failure modes:
- **Shared reputation:** Any Firebase project that sends spam damages the entire `firebaseapp.com` domain reputation
- **DMARC alignment failure:** `pluggurbeats.com` has a DMARC policy (Google Workspace sets this). Emails from `*.firebaseapp.com` fail DMARC alignment against `pluggurbeats.com`, which is a strong spam signal

Sending from `noreply@pluggurbeats.com` via Resend fixes both: DKIM and SPF are aligned to `pluggurbeats.com`, and reputation is entirely our own.

## Remember Me (Sign In)

- Checked (default): Firebase uses `browserLocalStorage` — session persists across browser closes
- Unchecked: Firebase uses `browserSessionStorage` — cleared when browser tab closes
- Native iOS: always uses `indexedDBLocalPersistence` (set in `src/firebase/auth.js`), Remember Me has no effect

## Gotchas

- `sendVerificationEmail` CF is non-fatal on signup — if Resend rejects (e.g. domain not verified yet), the account is still created and the "Check your email" screen shows. User can hit **Resend** once DNS propagates.
- Resend returns `{ data, error }` not throws — always check `sent?.error` before logging success
- `pluggurbeats.com` domain must be verified in Resend **before deploying** `sendVerificationEmail` in production, otherwise all new signups land on the resend screen with no email in their inbox
- Firebase verification links expire in 24 hours
- The 60-second resend cooldown is client-side only — a page refresh resets it
