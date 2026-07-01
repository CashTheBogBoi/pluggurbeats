/* ============================================================================
   notifications.js — Capacitor push-notification client (iOS + Android)

   Design rules baked in:
   - NATIVE ONLY. Every call is guarded by Capacitor.isNativePlatform() so the
     web build / Vite preview never touches the plugin (web push is a separate
     path we are not using). The plugin is loaded via a guarded dynamic import,
     so it is only pulled in on a real device.
   - PERMISSION IS USER-GESTURE-DRIVEN. Apple rejects apps that prompt for push
     on launch. registerPush() must be called from a tap (e.g. an "Enable
     notifications" toggle), never on mount.
   - TOKEN PERSISTENCE. The FCM/APNs token is written to
     users/{uid}/devices/{token} so Cloud Functions can fan out via firebase-admin.
   - PREFERENCES. Per-event opt-in/out lives at users/{uid}.notificationPrefs.
     The chat/announcements stream defaults OFF (opt-in); transactional events
     (your beat was viewed/downloaded, a direct submission arrived) default ON.

   SETUP STILL REQUIRED ON YOUR SIDE (cannot be done from JS):
     npm i @capacitor/push-notifications
     npx cap sync ios
     - Add APNs Auth Key (.p8) in Firebase console → Cloud Messaging
     - Add Push Notifications + Background Modes(remote) capabilities in Xcode
     - Drop GoogleService-Info.plist into ios/App/App/
   ============================================================================ */

import { Capacitor } from "@capacitor/core";
import { doc, setDoc, serverTimestamp, deleteDoc } from "firebase/firestore";
import { db } from "../firebase/db.js";

/* The canonical event taxonomy. Keep client + Cloud Functions in sync on these
   keys. `optInRequired` events default OFF until the user explicitly enables. */
export const NOTIFICATION_EVENTS = {
  beatViewed:        { label: "Beat viewed",                 default: true,  optInRequired: false },
  beatDownloadedLib: { label: "Beat downloaded (library)",   default: true,  optInRequired: false },
  beatDownloadedEml: { label: "Beat downloaded (email)",     default: true,  optInRequired: false },
  directSubmission:  { label: "Direct submission to you",    default: true,  optInRequired: false }, // A&R / artist
  openRequests:      { label: "Open requests chat",          default: false, optInRequired: true  },
  announcements:     { label: "Staff announcements",         default: false, optInRequired: true  }
};

export function defaultNotificationPrefs() {
  const prefs = {};
  for (const [key, cfg] of Object.entries(NOTIFICATION_EVENTS)) prefs[key] = cfg.default;
  return prefs;
}

export const pushSupported = () => Capacitor.isNativePlatform();

/* Lazily load the native plugin only on device. Guarded by isNativePlatform()
   so the web preview never executes this import path. */
async function loadPlugin() {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const mod = await import("@capacitor/push-notifications");
    return mod.PushNotifications;
  } catch {
    return null; // plugin not installed yet
  }
}

/**
 * Request permission + register for push. CALL FROM A USER GESTURE ONLY.
 * Returns { granted, token } — token is null until APNs/FCM round-trips.
 */
export async function registerPush(uid) {
  const PushNotifications = await loadPlugin();
  if (!PushNotifications || !uid) return { granted: false, token: null };

  // iOS guideline: check current state, only prompt if not yet decided.
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
    perm = await PushNotifications.requestPermissions();
  }
  if (perm.receive !== "granted") return { granted: false, token: null };

  return new Promise((resolve) => {
    let settled = false;

    PushNotifications.addListener("registration", async (token) => {
      if (settled) return;
      settled = true;
      await saveDeviceToken(uid, token.value);
      resolve({ granted: true, token: token.value });
    });

    PushNotifications.addListener("registrationError", () => {
      if (settled) return;
      settled = true;
      resolve({ granted: true, token: null });
    });

    PushNotifications.register();
    // Safety timeout so a stuck APNs handshake doesn't hang the UI.
    setTimeout(() => { if (!settled) { settled = true; resolve({ granted: true, token: null }); } }, 8000);
  });
}

/* Persist token so backend can target this device. Keyed by token => natural
   dedupe; multiple devices per user supported. */
async function saveDeviceToken(uid, token) {
  if (!uid || !token) return;
  await setDoc(
    doc(db, "users", uid, "devices", token),
    { token, platform: Capacitor.getPlatform(), updatedAt: serverTimestamp() },
    { merge: true }
  );
}

/* Call on sign-out so a shared/borrowed device stops receiving this user's pushes. */
export async function unregisterPush(uid, token) {
  const PushNotifications = await loadPlugin();
  if (PushNotifications) {
    try { await PushNotifications.removeAllListeners(); } catch {}
  }
  if (uid && token) {
    try { await deleteDoc(doc(db, "users", uid, "devices", token)); } catch {}
  }
}

/* Persist the user's per-event preferences (merged onto the user doc). */
export async function saveNotificationPrefs(uid, prefs) {
  if (!uid) return;
  await setDoc(doc(db, "users", uid), { notificationPrefs: prefs }, { merge: true });
}

/* Wire foreground/tap handlers once, after a successful register. `onTap`
   receives the data payload so you can route (e.g. open the request thread). */
export async function attachPushHandlers({ onForeground, onTap } = {}) {
  const PushNotifications = await loadPlugin();
  if (!PushNotifications) return;
  PushNotifications.addListener("pushNotificationReceived", (n) => onForeground?.(n));
  PushNotifications.addListener("pushNotificationActionPerformed", (a) => onTap?.(a.notification?.data || {}));
}
