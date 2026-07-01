# Session — 2026-06-29: Mobile Perf Layer + Push Notifications

## Engineering triage (what the brief got wrong)
Stack is **React 18 + Vite + Capacitor 8**, iOS platform only (`@capacitor/ios`; no `android/` dir). Not Ionic.
- ❌ "Rewrite to Ionic" — rejected; no `@ionic/*`, zero benefit, high risk.
- ⚠️ Android Doze/Battery Optimization — premature; no Android platform exists yet (`cap add android` first).
- ❌ Geofencing vs GPS — N/A; app has zero location features.
- ❌ "Capacitor LocalLLM plugin" — does not exist as a production plugin; app has no LLM feature. Not fabricated.
- ✅ Optimistic UI, transform/opacity 60fps, GPU hints, instant taps, webkit autofill — applied.
- ✅ Push notifications — built (real product goal).

## Known issues flagged
- **Version mismatch:** `@capacitor/cli@7.6.7` vs `@capacitor/core@8.4.1`. Installed `@capacitor/push-notifications@7.0.6` (matches CLI). Recommend aligning ALL `@capacitor/*` to one major.
- Pre-existing Firestore errors (unrelated): `inbound-submissions` permission-denied (dev account), `submitted-campaigns` failed-precondition (missing composite index).

## Files added
- `src/styles/mobile.css` — imported in `main.jsx`. Tap-highlight removal, `touch-action: manipulation`, momentum scroll + overscroll containment, **webkit autofill fix** (inset box-shadow + 9999s transition), 16px input min (no focus-zoom), safe-area vars, `.tap-press` / `.anim-fast` / `.anim-sheet` / `.gpu` helpers, `prefers-reduced-motion`.
- `src/lib/notifications.js` — `registerPush(uid)` (user-gesture only), token → `users/{uid}/devices/{token}`, `NOTIFICATION_EVENTS` taxonomy, `saveNotificationPrefs`, `attachPushHandlers`, `unregisterPush`. All guarded by `Capacitor.isNativePlatform()`.
- `src/lib/usePush.js` — `usePushAutoRegister(uid,{onTap})` (mount-safe, never prompts, refreshes token if already granted) + `useNotificationToggle(uid)` (tap-driven enable).
- `src/lib/useOptimisticAction.js` — apply→commit→rollback primitive for instant buttons.
- `functions/notify.js` — `sendPush(uid, eventKey, {title,body,data})`. Honors prefs, multicasts to all devices, prunes dead tokens. Event keys mirror the client.

## Pages wired (all 3)
`usePushAutoRegister(uid, { onTap })` added to Dashboard, Verified, Staff (Staff got a new `uid` state from `onAuthStateChanged`). mobile.css is global so the CSS layer covers all three automatically.

## ⚠️ GOTCHA learned: block comments cannot contain the literal `/* @vite-ignore */`
The embedded `*/` closes the doc-comment early → "invalid JS syntax" pre-transform error. Reworded the comments. Don't write comment-syntax sequences inside comments.

## Notification event → trigger hook map (server side, to wire in index.js)
| eventKey | Fire from (index.js) | Recipient | Default |
|---|---|---|---|
| `beatViewed` | `recordLibraryView` | beat owner (producer) | ON |
| `beatDownloadedLib` | `downloadLibraryBeat` | beat owner | ON |
| `beatDownloadedEml` | `downloadVerifiedBeatFile` / email webhook | beat owner | ON |
| `directSubmission` | `submitCampaign` (when sent to a specific A&R/artist) | that A&R/artist | ON |
| `openRequests` | new message in open-requests chat | subscribers | OPT-IN |
| `announcements` | staff announcement create (Staff.jsx composer) | all opted-in | OPT-IN |

Example wiring (inside `recordLibraryView` after the view is recorded):
```js
const { sendPush } = require("./notify");
await sendPush(beatOwnerUid, "beatViewed", {
  title: "Your beat was viewed",
  body: `${viewerName} viewed "${beatTitle}"`,
  data: { route: "/dashboard", beatId }
});
```

## REMAINING NATIVE SETUP (user must do — cannot be done from JS)
1. `npx cap sync ios`
2. Firebase Console → Cloud Messaging → upload **APNs Auth Key (.p8)**.
3. Xcode → Signing & Capabilities → add **Push Notifications** + **Background Modes → Remote notifications**.
4. Drop `GoogleService-Info.plist` into `ios/App/App/`.
5. (Later) `npx cap add android` before any Android battery/Doze work.
6. Wire the 6 `sendPush` calls per the table above.
7. Build a Notification Settings UI using `NOTIFICATION_EVENTS` + `saveNotificationPrefs` (toggles for the 2 opt-in events).


---

## UPDATE — sendPush wired + version mismatch fixed

### Version mismatch RESOLVED
Aligned all `@capacitor/*` to v8: cli 8.4.1, core 8.4.1, ios 8.4.1, push-notifications 8.1.1,
filesystem 8.1.2, share 8.0.1. (`file-transfer@2.0.4` uses its own independent version scheme — not a mismatch.)
Production `npm run build` passes; push plugin code-splits into its own `plugin-*.js` chunk (native-only).

### All 6 sendPush/sendBroadcast calls wired in functions/index.js
Added `const { sendPush, sendBroadcast } = require("./notify");` after `admin.initializeApp()`.
Added `sendBroadcast()` to notify.js (queries `users where notificationPrefs.{eventKey} == true`, skips author).
Every send is fire-and-forget (`.catch(() => {})`) so a push failure never breaks the underlying action.
Self-sends suppressed (`ownerUid !== uid`).

| Event | Function | Recipient |
|---|---|---|
| `beatViewed` | `recordLibraryView` (beat + loop branches) | beat/loop owner |
| `beatDownloadedLib` | `downloadLibraryBeat` | beat owner |
| `beatDownloadedEml` | `downloadVerifiedBeatFile` | beat owner |
| `directSubmission` | `submitCampaign` (when `targetRequest` set) | `targetRequest.createdByUid` |
| `announcements` | `createCampaignRequest` (isAnnouncement) | broadcast → opted-in |
| `openRequests` | `createCampaignRequest` (non-announcement) | broadcast → opted-in |

### Needs a Firestore index
`sendBroadcast` queries `users` collection on `notificationPrefs.{eventKey}`. Firestore single-field index
on `notificationPrefs.announcements` and `notificationPrefs.openRequests` (or rely on auto single-field
indexing — map fields are auto-indexed by default, so likely no action needed unless exemptions were set).

### STILL on the user (native — cannot be done from JS/here)
1. Drop `GoogleService-Info.plist` into `ios/App/App/` (from Firebase console).
2. `npx cap sync ios` (installs the push pod).
3. Upload APNs Auth Key (.p8) in Firebase → Cloud Messaging.
4. Xcode → add Push Notifications + Background Modes (Remote notifications) capabilities.
5. Build a notification-settings UI for the 2 opt-in toggles (`NOTIFICATION_EVENTS` + `saveNotificationPrefs`).


---

## UPDATE 2 — iOS push wiring (GoogleService-Info.plist + AppDelegate)

### Done
- `GoogleService-Info.plist` (BUNDLE_ID com.plugurbeat.app, IS_GCM_ENABLED true, GOOGLE_APP_ID 1:990734368924:ios:...) placed at `ios/App/App/GoogleService-Info.plist`.
- Wired into Xcode `App` target via the `xcodeproj` ruby gem (CocoaPods' vendored copy at `/opt/homebrew/Cellar/cocoapods/*/libexec/gems`, run with `GEM_PATH=$LIBEXEC:$(gem env gemdir)`). Added to both the App group AND Copy Bundle Resources. Project re-parses cleanly. Backup of project.pbxproj saved to scratchpad before editing.
- `AppDelegate.swift`: added `didRegisterForRemoteNotificationsWithDeviceToken` + `didFailToRegisterForRemoteNotificationsWithError` posting `.capacitorDidRegisterForRemoteNotifications` / `.capacitorDidFailToRegisterForRemoteNotifications`. Without these the JS `registration` event never fires.
- `Info.plist`: added `UIBackgroundModes = [remote-notification]` (Background Modes capability). Lints OK.

### STILL on the user (Apple portal / Xcode UI — cannot be automated safely)
1. **APNs Auth Key**: Apple Developer portal -> Keys -> create key with APNs enabled -> download .p8 -> upload in Firebase Console -> Cloud Messaging -> Apple app config. (Apple-side.)
2. **Push Notifications capability**: Xcode -> App target -> Signing & Capabilities -> + Capability -> Push Notifications. (Left to Xcode because it coordinates the aps-environment entitlement with the App ID + automatic signing; hand-adding the entitlement can break code-signing.)

### GEM_PATH recipe for future xcodeproj edits
```
LIBEXEC=/opt/homebrew/Cellar/cocoapods/1.16.2_2/libexec
GEM_PATH="$LIBEXEC:$(/opt/homebrew/bin/gem env gemdir)" /opt/homebrew/bin/ruby script.rb
```
NOTE: keep ruby heredocs ASCII-only (no ellipsis/em-dash) or you get "invalid multibyte character".
