# Push Notifications

Push is **native-only** (iOS/Android via Capacitor). The web build never touches push — every call is guarded by `Capacitor.isNativePlatform()`. Web push is not used.

---

## Event Taxonomy

Defined in both `src/lib/notifications.js` (client) and `functions/notify.js` (server). Keys must match exactly.

| Event Key | Label | Default | Opt-in Required |
|-----------|-------|---------|-----------------|
| `beatViewed` | Beat viewed | ON | No |
| `beatDownloadedLib` | Beat downloaded (library) | ON | No |
| `beatDownloadedEml` | Beat downloaded (email) | ON | No |
| `directSubmission` | Direct submission to you | ON | No |
| `openRequests` | Open requests chat | OFF | Yes |
| `announcements` | Staff announcements | OFF | Yes |

**Transactional events** (the first four) default ON — users must explicitly turn them off.
**Broadcast events** (`openRequests`, `announcements`) default OFF — users must explicitly opt in. Apple requires this for non-transactional push.

---

## Token Storage

FCM/APNs token stored at `users/{uid}/devices/{token}` (token IS the doc ID — natural dedup). Multiple devices per user are supported. Token is written by `saveDeviceToken` in `src/lib/notifications.js` after successful registration.

On sign-out: `unregisterPush(uid, token)` removes the listener AND deletes the Firestore token doc so the signed-out device stops receiving that user's pushes.

---

## Permission Flow (Apple guideline)

Apple rejects apps that prompt for push on launch. `registerPush(uid)` **must be called from a user gesture** (e.g. tapping an "Enable notifications" toggle), never on mount.

The function:
1. Calls `PushNotifications.checkPermissions()` first
2. If status is `"prompt"` or `"prompt-with-rationale"`: calls `requestPermissions()`
3. If denied: returns `{ granted: false, token: null }` — app continues normally
4. On grant: registers with APNs, listens for `"registration"` event to get the token
5. 8-second safety timeout so a stuck APNs handshake doesn't freeze the UI

---

## iOS Setup (must be done in Xcode/Firebase Console, not in JS)

1. Add Push Notifications capability in Xcode (`Signing & Capabilities`)
2. Add Background Modes capability → enable "Remote notifications"
3. Drop `GoogleService-Info.plist` into `ios/App/App/`
4. Generate APNs Auth Key (.p8) in Apple Developer portal
5. Upload the .p8 key to Firebase Console → Project Settings → Cloud Messaging

If any of these are missing, `PushNotifications.register()` silently fails — no error, just no token.

---

## Server-Side Fan-Out (`functions/notify.js`)

`sendPush(uid, eventKey, { title, body, data })`:
1. Reads user's `notificationPrefs` — skips if event is muted
2. Reads all docs from `users/{uid}/devices` — gets all FCM tokens
3. Calls `admin.messaging().sendEachForMulticast()` with all tokens
4. **Prunes dead tokens**: if FCM returns `registration-token-not-registered` or `invalid-registration-token`, the token doc is deleted automatically

`sendBroadcast(eventKey, { title, body, data, excludeUid })`:
- Queries `users` where `notificationPrefs.{eventKey} == true`
- Fans out to all opted-in users
- Used for staff announcements and open-requests notifications

---

## Notification Routing (tap handler)

When a user taps a notification, `attachPushHandlers({ onTap })` fires with the data payload. Routing data is embedded in the `data` field:

```js
{ route: "/verified", requestId: "abc123" }
```

The tap handler in Dashboard/Verified reads `data.route` and navigates accordingly.

---

## User Preference Storage

`saveNotificationPrefs(uid, prefs)` writes the full `notificationPrefs` map to `users/{uid}` via `setDoc` with `merge: true`. The UI shows a toggle per event key using `NOTIFICATION_EVENTS` from `src/lib/notifications.js` for labels and defaults.
