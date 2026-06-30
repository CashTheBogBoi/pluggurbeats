# User Roles & Permissions

## Two Separate Role Systems

There are two independent role systems that often get confused:

1. **Subscription tier** — `subscription.tier`: `"free"` | `"plugg"` | `"pro"`. Controls what the user can *submit* and how many credits they get. Set by Stripe payments.

2. **Verified identity role** — `verifiedRole`: one of 9 values below. Controls *who the user is* publicly and what types of requests they can *post*. Set manually by staff.

These are orthogonal. A Pro subscriber may have no verified role. A verified A&R+ may be on the free tier.

---

## Verified Identity Roles

Defined in `src/lib/roles.js`:

| Value | Label | Family | Rank |
|-------|-------|--------|------|
| `""` | No verified role | — | — |
| `producer` | Producer | producer | 0 |
| `producer_plus` | Producer+ | producer | 1 |
| `producer_plusplus` | Producer++ | producer | 2 |
| `artist` | Artist | artist | 0 |
| `artist_plus` | Artist+ | artist | 1 |
| `artist_plusplus` | Artist++ | artist | 2 |
| `ar` | A&R | ar | 0 |
| `ar_plus` | A&R+ | ar | 1 |
| `ar_plusplus` | A&R++ | ar | 2 |

**Rank** controls which tiers can target them. Higher ranks are reserved for Pro users to submit to.

**Family** controls what request types they can post:
- `producer` family: can only post `"loops"` requests
- `artist` and `ar` families: can post `"beats"`, `"loops"`, or `"both"`

**A&R roles only**: can attach a public `labelName` (e.g. "Atlantic Records"). Contact info never stored on requests.

---

## What Each Role System Controls

### Access flags on `users/{uid}`
```
verifiedListener  boolean  → can access /verified page
verifiedPuller    boolean  → can see Loop Pool tab on /verified
staff             boolean  → can access /staff page, moderate, post announcements
```

These are set separately by staff and are independent of `verifiedRole`.

### Post-login routing (`src/lib/userRouting.js`)
```js
// Has verified access + no paid sub → /verified
const isVerified = profile.verifiedListener || profile.verifiedPuller;
return isVerified && !isClient ? "/verified" : "/dashboard";
```

Paid subscribers (Plugg/Pro) always land on `/dashboard` even if they're also verified.

---

## Plan → Verified Role Submission Matrix

Which subscription tier can submit to which verified role's requests:

```js
// From src/lib/roles.js canPlanSubmitToRole()
free:  can submit to → producer
plugg: can submit to → producer, producer_plus, artist, artist_plus, ar
pro:   can submit to → all 9 roles
```

This is enforced server-side in `submitCampaign` and `submitLoop` via `canTierSubmitToRole()`.

---

## Staff System

Staff is separate from all of the above. Staff flag is controlled two ways:
1. Hardcoded allowlist in `functions/staff.json` — owner accounts, cannot be revoked via UI
2. `setStaffRole` callable — grants/revokes `staff: true` on the user doc + sets `staff: true` custom claim on Firebase Auth token

Staff can:
- Access `/staff` page
- Approve/reject campaigns and loops
- Post announcements (cap-exempt)
- Pin/unpin/close/delete requests
- Assign verified roles and access flags to any user
- Adjust credits
- View platform overview stats

---

## Displaying Roles in the UI

**Staff badge** (gold):
```jsx
<span className="bg-[#f2ca50]/15 font-mono text-[9px] uppercase tracking-wider text-[#f2ca50]">Staff</span>
```

**Verified role badge** (purple):
```jsx
<span className="bg-[#7C5CFF]/20 font-mono text-[9px] uppercase tracking-wider text-[#b9a8ff]">{roleLabel}</span>
```

`verifiedRoleLabel(value)` from `src/lib/roles.js` returns the display label for any role value.
