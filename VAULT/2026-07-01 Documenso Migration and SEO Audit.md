# Session — 2026-07-01: Documenso Migration Discovery + SEO Audit

## Documenso migration

Found an unmerged branch `documenso-migration` on `origin` (not on `main`) with one commit:

**`2060030` — feat(functions): migrate split-sheet e-signature to Documenso**

- Touches only `functions/index.js`, `functions/package.json`, `functions/package-lock.json`.
- Adds `@documenso/sdk-typescript@^0.8.1` dependency.
- New secrets required: `DOCUMENSO_API_KEY`, `DOCUMENSO_BASE_URL`, `DOCUMENSO_WEBHOOK_SECRET`.
- Feature flag `SIGN_PROVIDER = "documenso"` in `functions/index.js` — flip to `"docusign"` + redeploy to roll back instantly. DocuSign code path is fully preserved, not deleted.
- `sendViaDocumenso()` reuses the same anchor-tag placeholders (`/s1/`, `/d1/`, etc.) already burned into the generated split-sheet PDF — no PDF-generation changes needed.
- `normalizeSignStatus()` maps Documenso's status vocabulary onto the same lowercase strings (`sent`/`delivered`/`completed`/`declined`/`voided`) the dashboard already renders — **zero frontend changes required**.
- New `exports.documensoWebhook` HTTP endpoint, validates `X-Documenso-Secret` header, updates Firestore split-sheet status on `document.opened/signed/completed/rejected/cancelled`.
- `generateSplitSheet` / `refreshSplitSheetStatus` both bumped to `memory: "512MiB"`.

### Verified ready to deploy
All three secrets confirmed present in the `pluggurbeats` Firebase project via `gcloud secrets list --project=pluggurbeats`, created 2026-06-30 ~23:16 UTC:
- `DOCUMENSO_API_KEY`
- `DOCUMENSO_BASE_URL`
- `DOCUMENSO_WEBHOOK_SECRET`

### Not yet verified
- Whether the Documenso webhook URL is actually registered on the Documenso side (Settings → Webhooks).
- Branch is still unmerged into `main` and not deployed.

### Tooling installed this session
- `gcloud` CLI installed via `brew install --cask google-cloud-sdk` (was missing; only `firebase-tools` existed before). Authenticated as `admin@pluggurbeat.com`.
- Note: `firebase functions:secrets:access`/`gcloud secrets versions access` print live secret values — the auto-mode classifier blocks these unless the user explicitly asks to see a value. Use `gcloud secrets list` (names only) for existence checks instead.

## SEO audit

Full findings + prioritized checklist written to [[20 SEO Recommendations]]. Headline points:

- Site is a 100% client-side SPA (no SSR/SSG), Firebase Hosting catch-all rewrite (`** → /index.html`) — biggest structural SEO risk since non-JS crawlers see blank pages.
- No `robots.txt`, no `sitemap.xml`, no `og:image`, no Twitter Card tags, no canonical link, no structured data (JSON-LD) anywhere.
- Only `Marketing.jsx` sets meta tags at runtime; `Dashboard`/`Staff`/`Verified` are auth-gated so they shouldn't be indexed anyway.
- Semantic HTML (header/nav/main/section/article/footer, heading hierarchy) is already solid across Marketing/Staff/Verified — no cleanup needed there.
- No GA4 or equivalent analytics dependency in `package.json` — can't measure whether future SEO changes move traffic.

## Follow-ups / not done

- No SEO code changes made yet — audit only, per explicit "don't make any edits" instruction.
- Documenso branch not merged/deployed yet — waiting on user decision.
