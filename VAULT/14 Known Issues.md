# Known Issues & Solutions

## Safari / iOS

### Native select chrome
**Problem**: Safari renders its own blue-tinted select dropdown UI, ignoring Tailwind styles.  
**Fix**: Wrap all `<select>` in the `Select` component:
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

### Number input spinners
**Problem**: iOS/Safari shows native spin buttons on `<input type="number">`.  
**Fix**: Add to `inputCls`:
```
[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]
```

### Backdrop blur on fixed header
**Problem**: `backdrop-filter` may flicker on older iOS Safari.  
**Status**: Acceptable, no fix needed currently.

## Firebase / Cloud Functions

### `firebase: command not found`
**Fix**: Use `npx -y firebase-tools` instead of bare `firebase`.

### Functions deploy timeout
**Problem**: Large function deploys can time out.  
**Fix**: Deploy functions separately from hosting: `npx -y firebase-tools deploy --only functions`

### `createdByStaff` not appearing on old posts
**Problem**: Posts created before the `createdByStaff` field was added don't have the flag.  
**Fix**: These show the Verified badge (not Staff) — expected behavior for legacy posts.

## UI / Styling

### Credit pills appearing as dark box in header
**Problem**: `bg-[#0e0e0e]` on the pills wrapper makes it visible against the transparent header.  
**Fix**: Use `bg-transparent` — the individual chip backgrounds provide color, no outer box needed.

### Tags input showing white outline
**Problem**: Default border color was too bright (`border-white` or similar).  
**Fix**: Use `border-[#262626]` on the container.

### Sticky submit bar too high on mobile
**Problem**: Bar overlaps tab navigation on iOS.  
**Fix**: `bottom-16` on mobile (clears the tab bar), `lg:bottom-0` on desktop.

## Capacitor / iOS

### Blank white screen after build
**Cause**: `dist/` not synced to iOS project.  
**Fix**: Always run `npx cap sync ios` after `npm run build`.

### MCP server tools not showing in session
**Fix**: Add `mcp-tools-istefox` to `~/.claude.json` `mcpServers` and restart Claude Code.

## Git / Deploy

### Push blocked by auto-mode classifier
**Status**: Can happen with `git push` to `main`. Push usually succeeds before the block.  
**Fix**: Verify with `git log --oneline origin/main` — if latest commit is there, push succeeded.
