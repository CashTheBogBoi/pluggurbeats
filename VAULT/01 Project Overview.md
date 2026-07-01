# Project Overview

## What is PluggurBeats?

PluggurBeats is a music industry marketplace connecting **producers** (beat makers) with **verified artists/A&Rs** who post campaign requests. Producers discover open requests, pay credits to submit beats, and get placed.

## User Types

| Type | Description |
|------|-------------|
| **Producer** | Uploads beats, buys credits, submits to campaigns |
| **Verified Artist** | Posts campaign requests (gated by subscription + verified role) |
| **A&R / Label** | Same as verified artist, higher tier |
| **Staff** | Platform admins — moderate feed, post announcements, pin messages |

## Core User Journeys

### Producer
1. Signs up → lands on `/dashboard`
2. Browses open campaign requests in the feed
3. Clicks a request → reads brief → starts campaign builder
4. Pays credits → submits beat file
5. Views submitted campaigns in "My Campaigns" tab

### Verified Artist / A&R
1. Signs up + gets verified role (manual staff action)
2. Posts a campaign request with brief, genre tags, budget
3. Views inbound beat submissions in InboundInbox tab
4. Messages producers

### Staff
1. Logs in → `/staff` page (gated by `staff: true` Firestore flag)
2. Moderates the public request feed (close/delete/pin/unpin)
3. Posts announcements visible on all user dashboards
4. Manages user roles

## Product Vision

- **Music-first**: No fluff UI, everything serves the beat submission workflow
- **Studio aesthetic**: Dark, professional, feels like a DAW or studio app
- **Mobile-first**: Capacitor iOS app is primary distribution for producers

## Key Metrics (tracked in Firestore)
- `pitchBalance` — credits available to producer
- `submissionCount` — total submissions per user
- `requestCount` — open requests on the platform
- Campaign open/close state, pinned posts
