# Deployment

## Web — Firebase Hosting

### Full deploy (build + hosting + functions)

```bash
# 1. Build the web app
npm run build

# 2. Deploy hosting
npx -y firebase-tools deploy --only hosting

# 3. Deploy functions (separately to avoid timeout)
npx -y firebase-tools deploy --only functions
```

### Hosting only (no function changes)

```bash
npm run build && npx -y firebase-tools deploy --only hosting
```

### Functions only

```bash
npx -y firebase-tools deploy --only functions
```

> **Note**: Use `npx -y firebase-tools` not bare `firebase` — CLI may not be globally installed.

## iOS — Capacitor

### After any web change

```bash
npm run build          # Build web
npx cap sync ios       # Copy dist/ to iOS project + update plugins
npx cap open ios       # Open Xcode
```

### First-time setup

```bash
npm install @capacitor/core @capacitor/ios
npx cap init           # App: "PluggurBeats", ID: "com.plugurbeat.app"
npx cap add ios
npm run build
npx cap sync ios
npx cap open ios       # Archive + distribute from Xcode
```

### capacitor.config.json
```json
{
  "appId": "com.plugurbeat.app",
  "appName": "PluggurBeats",
  "webDir": "dist",
  "server": {
    "androidScheme": "https"
  }
}
```

## Firebase Project Config

- `firebase.json` — hosting `public: "dist"`, rewrites SPA to `index.html`
- `firestore.rules` — security rules
- `firestore.indexes.json` — composite indexes
- `storage.rules` — storage security rules

## Common Issues

| Problem | Fix |
|---------|-----|
| `firebase: command not found` | Use `npx -y firebase-tools` |
| Deploy blocked by auto-mode | May need manual confirmation in terminal |
| Blank screen on iOS | Run `npx cap sync ios` after build |
| Functions 403 | Check `assertStaff` — user may not have `staff: true` |
| Hosting shows old build | Clear browser cache or check `dist/` was rebuilt |

## GitHub

- Remote: `origin` → `cashmcdearis/PluggurBeats`
- Branch: `main`
- Push: `git push origin main`
- Note: large pushes may need confirmation (auto-mode classifier may flag `git push`)

## Environment

No `.env` needed — Firebase config lives in `src/firebase/app.js`.
Sensitive keys (API keys) are in that file, appropriate for client-side Firebase.
