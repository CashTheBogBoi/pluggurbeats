# Design System — Obsidian Studio Admin

Applied to `Dashboard.jsx` and `Staff.jsx`. Do NOT use on Marketing, Login, or other pages.

## Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `bg-primary` | `#131313` | Page background |
| `bg-card` | `#0e0e0e` | Card / panel backgrounds |
| `bg-input` | `#0e0e0e` | Form inputs |
| `border-default` | `#262626` | Most borders, dividers |
| `border-strong` | `#4d4635` | Hover borders, active states |
| `gold` | `#f2ca50` | Primary accent, CTAs, labels |
| `gold-dim` | `#f2ca50/15` | Gold badge backgrounds |
| `gold-glow` | `#f2ca50/60` | Focus ring on inputs |
| `text-muted` | `#99907c` | Secondary text, placeholders |
| `text-bone` | `#e8e0d0` | Primary body text |
| `purple-badge` | `#7C5CFF/20` bg + `#b9a8ff` text | Verified / role badges |

## Tailwind Usage Rules

- **Always use arbitrary values**: `bg-[#131313]` not a named class
- **Never use `rounded-*`** — everything is `rounded-none` (sharp corners)
- **Uppercase tracking-wider** for labels, buttons, badges
- **Monospace** (`font-mono`) for identity tags and status labels

## Core Components (defined in Dashboard.jsx)

### GoldBtn
```jsx
const GoldBtn = ({ className = "", ...p }) => (
  <button
    className={`inline-flex items-center gap-2 rounded-none border border-[#f2ca50] bg-[#f2ca50] px-4 py-2 text-[13px] font-semibold uppercase tracking-wider text-[#3c2f00] transition hover:bg-[#f2ca50]/90 disabled:opacity-40 ${className}`}
    {...p}
  />
);
```

### GhostBtn
```jsx
const GhostBtn = ({ className = "", ...p }) => (
  <button
    className={`inline-flex items-center gap-2 rounded-none border border-[#4d4635] px-4 py-2 text-[13px] uppercase tracking-wider text-[#99907c] transition hover:border-[#f2ca50]/60 hover:text-[#e8e0d0] disabled:opacity-40 ${className}`}
    {...p}
  />
);
```

### inputCls (shared class string)
```js
const inputCls = `w-full rounded-none border border-[#262626] bg-[#0e0e0e] px-3 py-2 text-[13px] text-[#e8e0d0] placeholder-[#99907c] outline-none transition focus:border-[#f2ca50]/60 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]`;
```

### Safari-safe Select
```jsx
const Select = ({ className = "", children, ...p }) => (
  <div className="relative">
    <select className={`${inputCls} appearance-none [-webkit-appearance:none] pr-9 ${className}`} {...p}>
      {children}
    </select>
    <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#99907c]" />
  </div>
);
```

## Identity Badges

### Staff badge
```jsx
<span className="rounded-none bg-[#f2ca50]/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[#f2ca50]">Staff</span>
```

### Verified / role badge
```jsx
<span className="rounded-none bg-[#7C5CFF]/20 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[#b9a8ff]">{roleLabel || "Verified"}</span>
```

## Request Type Colors

| Type | Icon | Color class |
|------|------|-------------|
| `placement` | Music | `text-[#f2ca50]` |
| `feature` | Users | `text-[#b9a8ff]` |
| `sync` | Film | `text-[#7dd3fc]` |
| `announcement` | Megaphone | `text-[#f2ca50]` |

## Pinned Post Styling
```jsx
// Left border accent + subtle gold tint
className={`flex gap-3 p-4 ${r.pinned ? "bg-[#f2ca50]/[0.04] border-l-2 border-l-[#f2ca50]" : ""}`}
```

## Sticky Submit Bar
```jsx
<div className="sticky bottom-16 z-20 -mx-4 mt-6 border-t border-[#262626] bg-[#0e0e0e]/95 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:bottom-0 lg:-mx-10 lg:px-10">
```
`bottom-16` on mobile (above nav), `lg:bottom-0` on desktop.

## Credit Pills
```jsx
<button className="group flex items-center gap-1.5 rounded-none border border-[#262626] bg-transparent p-1 pr-2 transition hover:border-[#4d4635]">
```
`bg-transparent` — blends with the `bg-[#131313]/70 backdrop-blur-xl` header.
