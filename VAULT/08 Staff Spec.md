# Staff Page Spec (`/staff`)

Main file: `src/pages/Staff.jsx` (~1200 lines)
Route guard: redirects to `/dashboard` if `!user?.staff`

## Layout Sections

```
Staff
├── Header — "Studio Admin" title + user info
├── RequestComposer — post to board
└── RequestFeed — moderation feed
```

## RequestComposer

### Form Fields
1. **Type** — dropdown: `placement | feature | sync | announcement`
2. **Title** — text input (min 4 chars)
3. **Brief** — textarea (min 20 chars; hidden/optional for announcements)
4. **Genre tags** — tag chip input
5. **Budget** — number input (hidden for announcements)

### Announcement Mode
```jsx
const isAnnouncement = type === "announcement";
const canPost = title.trim().length >= 4 && (isAnnouncement || brief.trim().length >= 20);
```
- Wrapper gets `border-[#f2ca50]/50` highlight when announcement selected
- Body/budget fields hidden
- Calls `createCampaignRequest` with `requestType: "announcement"`
- No daily cap (exempt server-side)

### Post Button
- `GoldBtn` — disabled until `canPost`
- Shows spinner during submission

## RequestFeed

### Data Flow
```js
// Fetched via listCampaignRequests or onSnapshot
// Sorted: pinned first, then by createdAt desc
const sorted = [...requests].sort((a, b) => {
  if (a.pinned && !b.pinned) return -1;
  if (!a.pinned && b.pinned) return 1;
  return b.createdAt - a.createdAt;
});
```

### FeedBubble
Each bubble shows:
- Avatar + name + role/staff badge
- Request type chip + title
- Brief text
- Pinned label (if `r.pinned === true`)
- Moderation buttons: **Pin/Unpin** · **Close** · **Delete**

### Pinned Bubble Styling
```jsx
<div className={`flex gap-3 p-4 ${r.pinned ? "bg-[#f2ca50]/[0.04] border-l-2 border-l-[#f2ca50]" : ""}`}>
  {r.pinned && (
    <span className="... bg-[#f2ca50]/15 text-[#f2ca50]">
      <Pin size={9} /> Pinned
    </span>
  )}
```

### Announcement Bubble Styling
```jsx
<div className="rounded-none border border-[#f2ca50]/40 bg-[#f2ca50]/[0.06] p-4">
```

### Moderation Actions
Calls `moderateCampaignRequest` Cloud Function:

```jsx
const onModerate = async (id, action) => {
  await moderateCampaignRequest({ id, action });
  // Optimistic update or refetch
};

// Pin/Unpin button
<button onClick={() => onModerate(r.id, r.pinned ? "unpin" : "pin")}>
  {r.pinned ? <><PinOff size={11} /> Unpin</> : <><Pin size={11} /> Pin</>}
</button>
```

## Required Imports (Staff.jsx)
```js
import { Pin, PinOff, Megaphone, /* ... */ } from "lucide-react";
```

## Identity Badge Logic
```jsx
{r.staff
  ? <span className="...bg-[#f2ca50]/15 text-[#f2ca50]">Staff</span>
  : <span className="...bg-[#7C5CFF]/20 text-[#b9a8ff]">{r.roleLabel || "Verified"}</span>
}
```
`r.staff` maps to `r.createdByStaff` from the `publicCampaignRequest` helper.
