# SEO Recommendations

> Audit performed 2026-07-01 against the live codebase (React 18 + Vite SPA, Firebase Hosting at pluggurbeat.com). No code changes made — this is a reference checklist to work through. See [[2026-07-01 Documenso Migration and SEO Audit]] for the session this came out of.

## Context that shapes priority

- Pure client-side SPA, no SSR/SSG. `firebase.json` has a catch-all rewrite (`** → /index.html`), so any non-JS-executing crawler (Bing, most social link-preview bots) sees a blank shell for every route.
- Only `Marketing.jsx` (the public landing page) is meant to be indexed. `/dashboard`, `/staff`, `/verified` are auth/invite-gated and should stay out of search results.
- Only `Marketing.jsx` dynamically sets `document.title`/meta description at runtime (via a hand-rolled `setMeta()` helper, lines ~69-77). Every other route inherits the static root `index.html` title.

## 🔴 Critical — do first

- [x] Add `robots.txt` (`public/robots.txt`) — allows `/` and `/login`; disallows `/dashboard`, `/staff`, `/verified`; references `sitemap.xml`.
- [x] Add `sitemap.xml` (`public/sitemap.xml`) — lists `/` and `/login`.
- [ ] Add `og:image` to `index.html` — currently missing entirely, so social shares (X/Discord/iMessage/Slack) show no preview image.
- [ ] Add Twitter Card tags (`twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`) — absent.
- [x] Add `<link rel="canonical">` (`index.html`) — points at `https://pluggurbeat.com/`. Static, so it's identical on every route (harmless for gated/non-indexed routes; per-route canonicals need `react-helmet-async`).
- [ ] Pick and enforce `www` vs apex (`pluggurbeat.com`) via redirect — currently no normalization.

## 🟠 High impact — SPA crawlability

- [x] Prerender the marketing/landing page at build time. `scripts/prerender.js` runs as an npm `postbuild` hook: boots a `vite preview` server over `dist/`, loads `/` in headless Puppeteer, waits for it to paint, then overwrites `dist/index.html` with the fully rendered markup (hero, workflow, pricing, footer — all real text, not a blank shell). Safe because `main.jsx` uses `createRoot().render()`, not `hydrateRoot()` — the client just re-renders from scratch on load, so there's no hydration-mismatch risk. Verified: prerendered HTML contains real content, and the live app (auth modal, buttons) still works identically post-build. Only `/` is prerendered since it's the only public, indexable route — costs one Puppeteer + Chromium devDependency at build time only, no runtime/hosting changes.
- [ ] Alternative (not needed now that prerendering is in place): dynamic rendering via a Firebase Function that detects bot user-agents.
- [ ] Add `react-helmet-async` so any future public route can set its own title/description/OG tags instead of sharing the static root ones.

## 🟡 Structured data & rich results

- [ ] Add JSON-LD `Organization` schema to the marketing page (name, logo, url, `sameAs` social links). Currently zero structured data anywhere.
- [ ] Consider `SoftwareApplication`/`Product` schema for pricing rich snippets.
- [ ] Add `apple-itunes-app` meta tag / App Link tags so Safari/iMessage can smart-banner to the iOS App Store listing.

## 🟢 On-page content

- [x] Semantic HTML is already solid — `Marketing.jsx`, `Staff.jsx`, `Verified.jsx` all use proper `header`/`nav`/`main`/`section`/`article`/`footer` and heading hierarchy. Keep this up on new pages.
- [ ] Keyword pass on marketing copy — current tagline ("Your Beat. Their Inbox.") is strong for conversion but may under-index for search intent ("beat pitching platform", "submit beats to A&R", "sell beats to labels").
- [ ] No blog/content section exists. Highest-leverage long-tail SEO play for this niche would be producer-facing guides ("how to pitch beats to A&R", "beat licensing platforms") — currently nothing to rank for those queries.
- [ ] Link the legal pages (Terms, Privacy, DMCA — drafts live in `VAULT/Legal/`) from the public footer/nav once published, so they're indexed via a real page instead of orphaned.

## ⚙️ Technical / performance (SEO-adjacent)

- [ ] Add cache-control headers for static assets in `firebase.json` — only HSTS is set today. Long `max-age` + immutable on hashed JS/CSS/fonts helps Core Web Vitals.
- [ ] Add image optimization (`vite-imagetools` + `srcset`) before adding beat-cover/product images — low risk today since avatars are CSS backgrounds, but will become debt once real images ship.
- [ ] Run Lighthouse/PageSpeed Insights for actual Core Web Vitals (LCP/CLS/INP) — not measured in this audit, direct ranking factor.
- [ ] Double check no `noindex` meta ever leaks from a staging build into production `index.html`.

## 📊 Off-page / non-code setup

- [ ] Verify domain + submit sitemap in Google Search Console and Bing Webmaster Tools once sitemap exists.
- [x] Add GA4 — `gtag.js` (measurement ID `G-DDRLV9D1DV`) added to `index.html:5-12`, loads high in `<head>` per Google's recommendation. `scripts/prerender.js` blocks requests to `googletagmanager.com`/`google-analytics.com` during its headless build-time capture so builds don't send fake pageview hits from `localhost`.
- [ ] Claim consistent social profiles / Google Business Profile so `sameAs` structured data has somewhere to point.
- [ ] Backlink strategy: outreach to music-production blogs, producer forums (r/WeAreTheMusicMakers), A&R/industry newsletters — likely higher ROI than on-page tweaks given the site is young and mostly gated.

## Suggested order of attack

1. ~~`robots.txt` + `sitemap.xml`~~ — done 2026-07-01
2. ~~Prerender the marketing page~~ — done 2026-07-01
3. `og:image` + Twitter cards + www/apex redirect (canonical already done)
4. JSON-LD structured data
5. Search Console / GA4 setup
6. Content/blog strategy
