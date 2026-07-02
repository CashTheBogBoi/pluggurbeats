# Session — 2026-07-01: Producer Dashboard redesign (Obsidian v2)

Modernized `src/pages/Dashboard.jsx` to match the newer Verified/Staff design language. All logic, data flow, callables, and TOS gates untouched — visual layer only.

## What changed

### Primitives (every view inherits these)
- `Card`: solid `border-[#262626] bg-[#0e0e0e]` — dropped the translucent `bg-[#0e0e0e]/70 backdrop-blur-sm` look.
- `Eyebrow`: now the Verified kicker — 10px mono, `tracking-[0.18em]`, inline `h-px w-5` gold rule.
- `SectionHead`: kicker always visible (was desktop-only) + `border-b border-[#262626] pb-5` under every page head.
- `GoldBtn`/`GhostBtn`: fixed the stray second gold (`#d4af37` hover → `bg-[#f2ca50]/90`), violet focus ring → gold, `active:scale-[0.97]`, `duration-140 ease-expo`.
- `inputCls`: `border-[#262626]`, removed focus ring (border-color change only, like Verified/Staff).
- NEW `StatGrid` + reworked `Stat`: hairline stat grid (`grid gap-px bg-[#262626] border`) with mono uppercase labels, `tabular-nums` values, optional dim `sub` line. Icons removed from stat cards.

### Shell
- Sidebar brand: gold EQ-bars mark (`.dash-eq`) + mono uppercase "PluggurBeats" (mirrors Verified sidebar / Staff header).
- Active nav item: gold left accent bar (`w-0.5`) + faint gold wash — replaced the rounded-full dot.
- Header: added current-view title + "Producer Studio · {tier}" mono sub (Verified header pattern). Tier hidden on xs (was truncating).
- All avatars square (`rounded-none border`) except chat-bubble avatars (iMessage pattern stays round on purpose).
- Mobile bottom nav: square active chips (was `rounded-full` — violated design rule), uppercase labels, `active:scale-[0.94]`.
- Account/profile menus: `.dash-pop` origin-aware scale-in (150ms expo, from scale(0.97), never scale(0)).

### Overview
- Head: kicker "Producer Studio" + "Welcome back, {name}" (dropped 👋).
- 4-stat hairline grid with sub lines.
- Free-tier upsell: gold `border-l-2` accent card (pinned-post pattern).
- Recent campaigns: header-row card (border-b + mono "View all") matching the Open requests card; fixed a misalignment where RequestForum's card had its own `mt-4/mt-6` inside the shared grid.
- Quick actions: hairline `gap-px` tile grid under a mono kicker (was a Card of bordered buttons).

### Detail sweep
- StepHead chips: square bordered mono `01/02/03` (was rounded-full).
- Progress bars, spinner, desk-target checkmarks, loop exclusivity radios: all `rounded-none` (radios became square check tiles).
- Target-request banners: gold left-accent style.
- Billing: section labels → mono kickers; pack icons → bordered tiles.
- Toast: matches Verified (`border-[#4d4635] bg-[#0e0e0e]`), transitions only opacity/transform.
- Empty states: bare dim icon (`text-[#4d4635]`) like Verified, not icon-in-a-box.

## FOLLOW-UP — typography unified to Inter (user feedback: "the font is different")
First pass kept Bricolage Grotesque (`font-display`) for titles/numbers. User flagged the font mismatch vs Verified — Verified uses **zero** display font (all Inter semibold + Space Mono kickers). Swept all ~35 `font-display` usages out of Dashboard.jsx:
- Page titles → `text-[22px] font-semibold tracking-tight lg:text-2xl`
- Card headers → `text-[15px] font-semibold tracking-tight`
- All numbers (stats, credit balances, costs, prices, %) → Inter semibold + `tabular-nums`
- Avatar initials → plain `font-semibold`/`font-bold`

**Convention going forward: the display font (Bricolage) is Marketing/Staff-only. Dashboard + Verified are Inter semibold + mono kickers.**

## FOLLOW-UP 2 — pinned messages moved into a dropdown
User feedback: the pinned strip in `RequestForum` (Overview → Open requests) was always visible above the chat feed, permanently eating vertical space. Converted to a collapsed-by-default toggle:
- Header now shows a `Pin · N pinned · chevron` chip (only when `pinned.length > 0`), next to the existing "N live" count.
- Clicking toggles `pinnedOpen`; panel is `position: absolute; inset-x-0; top-full` inside a `relative` wrapper around the header, `z-30`, solid `bg-[#0e0e0e]`, so it floats over the feed below rather than pushing it down.
- Outside-click closes it (`data-pinned` wrapper + document listener, same pattern as the account menu's `data-menu`/`data-me`).
- Reused `.dash-pop dash-pop-down` for the open/close animation (scale+opacity from 0.97, 150ms expo — consistent with every other dropdown in the file).
- Pinned bubbles now get a real per-item stagger (`index={i}` instead of the old hardcoded `index={0}`) since opening the dropdown is a deliberate user action — a cascading reveal fits here per the animation framework (occasional, purposeful).
- Verified in preview: closed by default, opens/closes correctly, outside-click dismiss works, feed underneath is undisturbed, full-width panel wraps correctly on mobile (375px).

## Bugs found & fixed along the way
1. **`Dashboard.css` was never imported** — the iMessage feed styles (`.msg-row` stagger, `.bubble-tail` radius, `.req-scroll`) silently never applied. Added `import "./Dashboard.css"` to Dashboard.jsx.
2. **~157 lines of dead CSS** — the entire `#dash-root` block in Dashboard.css was from the pre-redesign page; nothing references it. Deleted; file now only holds `dash-eq`, `dash-pop`, and the msg-feed styles.
3. Removed now-unused `TrendingUp` icon import.

## ⚠️ Related latent issue (not fixed, out of scope)
`Staff.css` (1271 lines) is also NOT imported by Staff.jsx — same class of bug. Verify whether Staff page needs it before deleting.

## Verified
- Preview MCP: desktop (Overview, Campaign builder, Billing, Loop Drops) + mobile 375px (Overview, builder w/ sticky submit bar) — all render clean, zero console errors.
- `npx vite build` passes (Dashboard chunk 106.5k + 1.1k css).

## Deploy reminder
`npm run build && npx -y firebase-tools deploy --only hosting`, then `npx cap sync ios`.
