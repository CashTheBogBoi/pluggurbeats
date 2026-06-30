# Verified Page Spec (`/verified`)

The Verified page is gated to users with `verifiedListener: true` or `verifiedPuller: true`. It has two top-level views toggled by a tab: **My Requests** and **Beats** (or **Loops** for pullers).

---

## Routing Guard

`src/lib/userRouting.js`: verified users without a paid subscription are sent directly to `/verified` on login. Paid subscribers land on `/dashboard` even if they're also verified — they access `/verified` manually.

---

## My Requests Tab

Three sub-sections stacked vertically:

### 1. Overview Stats Row
4-stat grid (2×2 on mobile, 1×4 on desktop): **Views · Submissions · Approved · Open requests**
Pulled from the user's own `campaignRequests` docs.

### 2. RequestHub (Request Composer)
Create a new campaign request. Role-aware:
- Producers (family: "producer") only see "Loops" as request type
- Artists and A&Rs see "Beats", "Loops", "Both"
- A&Rs see an additional "Label" input field
- Form includes: type selector, title, brief textarea, genre toggles, tags, references, deadline, daily cap indicator
- Submits via `createCampaignRequest`

### 3. InboundInbox
Submissions received from producers targeting your requests. Grouped by producer.

Each producer row:
- Initial avatar (first letter of name, colored background)
- Producer name + handle
- Submission date + status badge
- Expands to show individual beats

Each beat:
- Title, genre chip, BPM/key tags
- Play button → loads into bottom `NowPlaying` player
- Download button → calls `downloadLibraryBeat`

### 4. Submitted Campaigns List
The user's own outbound requests (what they've posted). Each row shows:
- Request title
- Beat titles submitted (as mono tag chips)
- Status + date

---

## Beats Tab (Verified Library)

All approved beats indexed in `verifiedBeats`. Accessible to all users with `verifiedListener: true`.

### Header
Gold kicker label → "Verified Beats" title → count of shown vs total items.

### Column Headers
`#` | `Title & Info` | `Actions` — **no art column** (album covers were removed by design decision; genre color tags are sufficient visual identity).

### LibraryRow
Each beat row:

- **Number column** (hidden on mobile): shows row index. On hover → becomes a Play button. If the row is currently playing → shows Play/Pause button (gold, always visible). This is the Spotify-style hover-play pattern.
- **Left accent**: full-height gold `w-0.5` bar appears when the row is active or selected
- **Title**: gold when active, bone-white otherwise
- **Inline playing indicator**: `▶ playing` or `⏸ paused` in mono text when active
- **Genre tag**: first chip in the tags row, colored
- **BPM / Key / tags**: subsequent chips in `font-mono text-[10px]` style
- **MoreHorizontal button**: `text-[#4d4635]` (nearly invisible) until the row is hovered

Clicking a row selects it and loads it into the bottom player. Clicking play/pause on an active row toggles playback without re-selecting.

### Loading State
Skeleton rows: `animate-pulse bg-[#262626]` blocks. No art skeleton (art was removed).

### Filtering
Genre, key, BPM range filters above the list. Filtered using client-side state against the loaded `verifiedBeats` set. "Load more" pagination via `listApprovedBeats` cursor.

---

## Loops Tab (Loop Pool)

Only visible to `verifiedPuller: true` users. Same list-row pattern as Beats but with exclusivity chips and a "Pull" action replacing "Download".

---

## Bottom Player (`NowPlaying`)

Fixed to the bottom of the screen (above mobile nav). CSS class `vf-now-playing` in `Verified.css`. Only appears when a beat is actively selected.

**Grid layout**:
- **Desktop**: `62px art | minmax(130px,210px) info | 52px play | minmax(0,1fr) scrub | 40px action | 32px close`
- **Mobile**: 2-row grid: `[art | info | play | close]` then `[scrub | export]`

**Art block**: 62px square with genre gradient background + first letter of beat title. `border-radius: 14px` (the ONE place in the app that uses rounded corners — it's inside the now-playing pill which itself has `border-radius: 28px`).

**Scrub zone**: fake waveform bars + scrub input overlaid at `opacity: 0`. Progress tracked via `--vf-progress` CSS variable for the clip-path reveal effect.

**Play button**: circular with genre gradient (`--genre-grad`). Pulsing ring animation while playing (`vf-play-pulse` keyframe).

**Entry/exit animation**: slides up from bottom (`translateY(130%)`) using `@starting-style` and `.is-closing` class. `transition: 260ms cubic-bezier(0.23, 1, 0.32, 1)`.

**Desktop with sidebar**: player shifts right: `left: calc(276px + ((100vw - 276px) / 2))`.

---

## Design Language

Matches the Obsidian Studio Admin system used in Dashboard and Staff:
- `#131313` page bg, `#0e0e0e` cards, `#262626` borders
- `#f2ca50` gold accents, `font-mono text-[10px] uppercase tracking-wider` labels
- `rounded-none` everywhere except the NowPlaying pill
- Gold kicker headers with inline rule: `inline-block h-px w-5 bg-[#f2ca50]/70 align-middle`
