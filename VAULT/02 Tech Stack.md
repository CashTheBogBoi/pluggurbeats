# Tech Stack

## Frontend

| Layer | Technology |
|-------|-----------|
| Framework | React 18 (Vite, JSX only — no TypeScript) |
| Styling | Tailwind CSS v3 with arbitrary values |
| Routing | React Router v6 |
| State | React Query (server state) + useState/useContext (local) |
| Icons | lucide-react |
| Build | `npm run build` → `dist/` |

## Backend / Cloud

| Layer | Technology |
|-------|-----------|
| Auth | Firebase Authentication (email/password + Google) |
| Database | Firestore (NoSQL, realtime via `onSnapshot`) |
| Storage | Firebase Storage (beat files, avatars) |
| Functions | Firebase Cloud Functions Gen 2, Node 22, `us-central1` |
| Hosting | Firebase Hosting (`dist/` directory) |

## Mobile

| Layer | Technology |
|-------|-----------|
| Shell | Capacitor 5 (`com.plugurbeat.app`) |
| Platform | iOS (Xcode) |
| Web dir | `dist/` (same build as web) |
| Sync | `npx cap sync ios` after every web build |

## Key Files

```
src/
  pages/
    Dashboard.jsx       # Main producer dashboard (~2100 lines)
    Staff.jsx           # Staff admin page (~1200 lines)
    Verified.jsx        # Verified artist page
    Marketing.jsx       # Landing page
    Login.jsx           # Auth page
  components/           # Shared UI (Nav, AuthModal, etc.)
  firebase/
    app.js              # Firebase init
    auth.js             # Auth helpers
    db.js               # Firestore helpers
    functions.js        # Cloud Function callers
    storage.js          # Storage helpers
  lib/
    roles.js            # Role constants
    userRouting.js      # Post-login redirect logic
    live.js             # useLiveCollection hook
functions/
  index.js              # All Cloud Functions
```

## Dev Workflow

```bash
npm run dev          # Vite dev server → http://localhost:5173
npm run build        # Production build → dist/
npm run preview      # Preview prod build → http://localhost:4173
```

## Environment
- No `.env` file in use — Firebase config is in `src/firebase/app.js`
- Firebase project: check `firebase.json` for project alias
