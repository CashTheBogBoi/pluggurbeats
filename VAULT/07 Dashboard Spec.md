# Dashboard Spec (`/dashboard`)

Main file: `src/pages/Dashboard.jsx` (~2100 lines)

## Tab Structure

```
Dashboard
├── Feed          (default tab) — open campaign requests
├── Submit        — campaign builder form
├── Campaigns     — producer's submitted campaigns
├── Inbox         — inbound submissions (verified artists only)
└── Paperwork     — contracts / documents (placeholder CTA)
```

## Feed Tab

### Layout
- Sticky gold header bar with `CreditPills` + user avatar
- Pinned strip (gold tinted, `border-l-[#f2ca50]`) above main feed
- iMessage-style chat scroll — newest at bottom
- Each `RequestBubble` shows: avatar, name + role badge, type chip, title, brief snippet

### Pinned Strip
```jsx
{pinned.length > 0 && (
  <div className="flex flex-col gap-3 border-b border-[#262626] bg-[#f2ca50]/[0.03] px-4 py-4">
    <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-[#f2ca50]">
      <Pin size={10} /> Pinned
    </div>
    {pinned.map(req => <RequestBubble key={`pin-${req.id}`} req={req} />)}
  </div>
)}
```

### RequestBubble
- Staff posts: gold "Staff" badge
- Non-staff: purple role badge (`createdByRoleLabel || "Verified"`)
- Announcements: `bg-[#f2ca50]/[0.06]` bubble, no submit button
- Click → opens request detail popup

### CreditPills
- Shows `pitchBalance` (pitch credits) and any other credit types
- `bg-transparent` wrapper (matches header `bg-[#131313]/70 backdrop-blur-xl`)
- Tooltip on hover showing credit type explanation

## Submit Tab (Campaign Builder)

### Form Fields
1. **Request selector** — dropdown of open requests (Safari-safe `Select` component)
2. **Beat file** — file upload (Firebase Storage)
3. **Beat name** — text input
4. **Message** — textarea (pitch note to artist)
5. **Tags** — tag chip input with helper text
6. **Credit cost** — auto-calculated

### Inline Submit Blockers (`formIssue`)
```js
const formIssue = !selectedRequest
  ? "Select a request to continue"
  : !beatFile
  ? "Upload a beat file"
  : beatName.trim().length < 2
  ? "Add a beat name"
  : message.trim().length < 10
  ? "Write a short pitch (10+ chars)"
  : pitchBalance < cost
  ? `Not enough credits — need ${cost}, have ${pitchBalance}`
  : null;
```

### Sticky Submit Bar
- Stays visible at bottom of form
- Shows cost breakdown: `Costs N credits · X left after`
- Shows `formIssue` text in gold when blocked
- `GoldBtn` disabled when `!!formIssue || busy`

### Tags Input
- Container: `border-[#262626]` + `focus-within:border-[#f2ca50]/60`
- Chips: `rounded-none border-[#4d4635] bg-[#1c1b1b] text-[#f2ca50]`
- Helper text: "Press Enter or comma to add a tag"
- Confirm-before-remove dialog on chip × click

## Inbox Tab (Verified Artists)
- Shows beats submitted to the user's own requests
- Each item: producer name, beat name, pitch message, audio player
- Accept / Reject buttons

## Paperwork Tab
- Empty state: `FileText` icon + gold CTA button → navigates to `submit` tab
- Future: contract signing, licensing docs

## Header
```jsx
<header className="sticky top-0 z-30 border-b border-[#262626] bg-[#131313]/70 px-4 py-3 backdrop-blur-xl">
```
