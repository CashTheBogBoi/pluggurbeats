# AI Context — Paste at Top of New Claude Sessions

> Copy everything below this line into a new Claude Code session to get full project context instantly.

---

## PluggurBeats — Session Bootstrap

**Project**: PluggurBeats — music marketplace (React/Firebase/Capacitor)  
**Working dir**: `/Users/cashmcdearis/Documents/Pluggurbeats`  
**Main branch**: `main`

### Key Files
- `src/pages/Dashboard.jsx` — main producer dashboard (~2100 lines)
- `src/pages/Staff.jsx` — staff admin page (~1200 lines)
- `functions/index.js` — all Cloud Functions

### Design Rules (NEVER break these)
- `rounded-none` everywhere in Dashboard/Staff — NO rounded corners
- All palette colors as Tailwind arbitrary values: `bg-[#131313]`, `text-[#f2ca50]`, etc.
- Palette: `#131313` bg · `#0e0e0e` cards · `#f2ca50` gold · `#262626` borders · `#99907c` muted text
- `GoldBtn`, `GhostBtn`, `Select`, `inputCls` are defined at top of Dashboard.jsx — reuse them
- Safari-safe selects: wrap in `Select` component with `appearance-none [-webkit-appearance:none]`
- Credit pills: `bg-transparent` (matches header backdrop)

### Architecture
- **Auth**: Firebase Auth
- **DB**: Firestore — `users`, `campaignRequests`, `campaignSubmissions`
- **Functions**: Gen 2, Node 22, us-central1, onCall
- **Hosting**: Firebase Hosting (`dist/` dir)
- **Mobile**: Capacitor iOS (`com.plugurbeat.app`)

### Staff vs Verified Badge
```jsx
// Staff posts → gold "Staff" badge
{req.createdByStaff
  ? <span className="...bg-[#f2ca50]/15 text-[#f2ca50]">Staff</span>
  : <span className="...bg-[#7C5CFF]/20 text-[#b9a8ff]">{req.createdByRoleLabel || "Verified"}</span>
}
```
`createdByStaff` is stamped **server-side** in `createCampaignRequest` — never set from client.

### Deploy Commands
```bash
npm run build && npx -y firebase-tools deploy --only hosting
npx -y firebase-tools deploy --only functions
npx cap sync ios && npx cap open ios   # after web build for iOS
git add -A && git commit -m "..." && git push origin main
```

### Vault
Full specs live in `VAULT/` folder (Obsidian):
- [[03 Design System]] — all colors, components, patterns
- [[04 Firebase Architecture]] — Firestore schema
- [[05 Cloud Functions]] — function inputs/outputs
- [[07 Dashboard Spec]] — dashboard tab specs
- [[08 Staff Spec]] — staff page spec
- [[09 Campaign Flow]] — end-to-end flow
