# Component Patterns

Reusable patterns used across Dashboard.jsx and Staff.jsx.

## Loading States

```jsx
// Inline spinner for buttons
{busy ? <Loader2 size={15} className="animate-spin" /> : "Submit"}

// Full-page skeleton
<div className="flex h-full items-center justify-center">
  <Loader2 size={24} className="animate-spin text-[#f2ca50]" />
</div>
```

## Empty States

```jsx
// Paperwork tab empty state pattern
<div className="flex flex-col items-center gap-4 py-16 text-center">
  <FileText size={32} className="text-[#4d4635]" />
  <p className="text-[13px] text-[#99907c]">No documents yet</p>
  <GoldBtn onClick={() => go("submit")}>
    Start a Campaign <ArrowRight size={16} />
  </GoldBtn>
</div>
```

## Section Headers

```jsx
<div className="mb-4 flex items-center gap-2">
  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#99907c]">
    Open Requests
  </span>
  <div className="flex-1 border-t border-[#262626]" />
</div>
```

## Confirm Dialog Pattern

```jsx
const [confirmRemove, setConfirmRemove] = useState(null);

// Trigger
<button onClick={() => setConfirmRemove(tag)}>×</button>

// Dialog
{confirmRemove && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
    <div className="rounded-none border border-[#262626] bg-[#0e0e0e] p-6 max-w-sm w-full mx-4">
      <p className="text-[13px] text-[#e8e0d0] mb-4">
        Remove "{confirmRemove}"?
      </p>
      <div className="flex gap-3 justify-end">
        <GhostBtn onClick={() => setConfirmRemove(null)}>Cancel</GhostBtn>
        <GoldBtn onClick={() => { removeTag(confirmRemove); setConfirmRemove(null); }}>
          Remove
        </GoldBtn>
      </div>
    </div>
  </div>
)}
```

## Tag Input

```jsx
const [tags, setTags] = useState([]);
const [tagInput, setTagInput] = useState("");

const addTag = (val) => {
  const t = val.trim().toLowerCase();
  if (t && !tags.includes(t)) setTags([...tags, t]);
  setTagInput("");
};

// JSX
<div className="min-h-[42px] w-full rounded-none border border-[#262626] bg-[#0e0e0e] p-2 focus-within:border-[#f2ca50]/60 transition flex flex-wrap gap-1.5">
  {tags.map(tag => (
    <span key={tag} className="flex items-center gap-1 rounded-none border border-[#4d4635] bg-[#1c1b1b] px-2 py-0.5 text-[11px] text-[#f2ca50]">
      {tag}
      <button onClick={() => setConfirmRemove(tag)} className="opacity-60 hover:opacity-100">×</button>
    </span>
  ))}
  <input
    value={tagInput}
    onChange={e => setTagInput(e.target.value)}
    onKeyDown={e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagInput); }}}
    placeholder={tags.length === 0 ? "e.g. trap, drill, r&b" : ""}
    className="flex-1 min-w-[120px] bg-transparent text-[13px] text-[#e8e0d0] placeholder-[#99907c] outline-none"
  />
</div>
<p className="mt-1 text-[11px] text-[#99907c]">Press Enter or comma to add a tag</p>
```

## Tooltip Pattern

```jsx
<div className="group relative">
  <button className="...">Hover me</button>
  <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-none border border-[#262626] bg-[#0e0e0e] px-2 py-1 text-[11px] text-[#99907c] opacity-0 transition group-hover:opacity-100 whitespace-nowrap">
    Tooltip text
  </div>
</div>
```

## Navigation (Tab Bar)

```jsx
const TABS = ["feed", "submit", "campaigns", "inbox", "paperwork"];

<nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-[#262626] bg-[#131313]">
  <div className="flex">
    {TABS.map(tab => (
      <button
        key={tab}
        onClick={() => go(tab)}
        className={`flex-1 py-3 text-center font-mono text-[9px] uppercase tracking-wider transition ${
          active === tab ? "text-[#f2ca50]" : "text-[#99907c] hover:text-[#e8e0d0]"
        }`}
      >
        {tab}
      </button>
    ))}
  </div>
</nav>
```

## Request Type Meta

```js
const REQUEST_TYPE_META = {
  placement:    { label: "Placement",    Icon: Music,     color: "text-[#f2ca50]",  bg: "bg-[#f2ca50]/10" },
  feature:      { label: "Feature",      Icon: Users,     color: "text-[#b9a8ff]",  bg: "bg-[#7C5CFF]/10" },
  sync:         { label: "Sync",         Icon: Film,      color: "text-[#7dd3fc]",  bg: "bg-sky-500/10"   },
  announcement: { label: "Announcement", Icon: Megaphone, color: "text-[#f2ca50]",  bg: "bg-[#f2ca50]/10" },
};
```
