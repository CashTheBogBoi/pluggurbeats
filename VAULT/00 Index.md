# PluggurBeats — Vault Index

> Master reference for the PluggurBeats codebase. Start here.

## Core Docs

| File | What it covers |
|------|---------------|
| [[01 Project Overview]] | Goals, user types, product vision |
| [[02 Tech Stack]] | React, Firebase, Capacitor, Tailwind |
| [[03 Design System]] | Obsidian Studio Admin palette, components, tokens |
| [[04 Firebase Architecture]] | Real Firestore schema, all collections, rules |
| [[05 Cloud Functions]] | All ~30 Cloud Functions — inputs, guards, side effects |
| [[06 User Roles]] | Verified role values, plan submission matrix |
| [[07 Dashboard Spec]] | Producer dashboard — all tabs and sub-flows |
| [[08 Staff Spec]] | Staff admin page — moderation, composer, feed |
| [[09 Campaign Flow]] | End-to-end beat campaign submission, review, pitch |
| [[10 Deployment]] | Firebase Hosting + Capacitor iOS deploy steps |
| [[11 Subscription Tiers]] | Free / Plugg / Pro tier gates |
| [[12 AI Context]] | Paste this at the top of any new Claude session |
| [[13 Component Patterns]] | Shared UI patterns — confirm dialogs, tag inputs, etc. |
| [[14 Known Issues]] | Safari bugs, Firebase quirks, deploy gotchas |

## Product & Business

| File | What it covers |
|------|---------------|
| [[Business and Legal Rundown]] | Legal docs needed, LLC status, key risks |
| [[Campaign Requests Handoff]] | Request system implementation log |
| [[15 Credit Economy]] | Pitch vs loop credits, monthly grants, Stripe webhook |
| [[16 Loop Economy]] | Loop submissions, exclusivity model, pull flow |
| [[17 Verified Page Spec]] | RequestHub, InboundInbox, Library, bottom player |
| [[18 Stripe & Payments]] | Price IDs, subscription flow, credit packs, webhooks |
| [[19 Push Notifications]] | FCM/APNs setup, event taxonomy, opt-in rules |
| [[Resend Email Integration]] | Email provider setup, tracking, verified user emails |

## Project At a Glance

- **Stack**: React 18 + Vite, Tailwind CSS, Firebase (Auth/Firestore/Storage/Functions), Capacitor (iOS)
- **Firebase project**: `pluggurbeats` (us-central1)
- **Live URL**: pluggurbeats.com (Firebase Hosting, CNAME in `public/CNAME`)
- **App bundle**: `com.plugurbeat.app` (note: single 'g' in bundle ID)
- **Theme**: Obsidian Studio Admin — `#131313` bg, `#f2ca50` gold, `rounded-none` everywhere, `font-mono` labels

## Session Conventions

- Never use rounded corners — `rounded-none` everywhere in Dashboard/Staff/Verified
- Tailwind arbitrary values for all palette colors (`bg-[#131313]` not named classes)
- Cloud Functions are Gen 2, Node 22, `us-central1`
- Deploy command: `firebase deploy --only functions,firestore:rules,firestore:indexes`
- Build before hosting deploy: `npm run build` then `firebase deploy --only hosting`
- iOS sync after every build: `npx cap sync ios`
