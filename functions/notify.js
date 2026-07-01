/* ============================================================================
   notify.js — server-side push fan-out via FCM (firebase-admin already init'd
   in index.js). Import and call sendPush() from any event hook point.

   Token storage:  users/{uid}/devices/{token}  (written by the client)
   Prefs:          users/{uid}.notificationPrefs.{eventKey}  (bool)

   sendPush() respects the user's per-event preference, skips opt-in events the
   user hasn't enabled, multicasts to all their devices, and prunes dead tokens.
   ============================================================================ */
const admin = require("firebase-admin");

const db = admin.firestore;

/* Event keys must match src/lib/notifications.js NOTIFICATION_EVENTS.
   optInRequired events are skipped unless the user explicitly set the pref true. */
const EVENTS = {
  beatViewed:        { optInRequired: false },
  beatDownloadedLib: { optInRequired: false },
  beatDownloadedEml: { optInRequired: false },
  directSubmission:  { optInRequired: false },
  openRequests:      { optInRequired: true  },
  announcements:     { optInRequired: true  }
};

/**
 * Send a push to one user for a given event, honoring their preferences.
 * @param {string} uid        recipient
 * @param {string} eventKey   one of EVENTS
 * @param {object} opts       { title, body, data } — data is string->string for routing
 */
async function sendPush(uid, eventKey, { title, body, data = {} }) {
  const cfg = EVENTS[eventKey];
  if (!uid || !cfg) return { sent: 0, reason: "bad-args" };

  const firestore = admin.firestore();
  const userSnap = await firestore.doc(`users/${uid}`).get();
  const prefs = userSnap.get("notificationPrefs") || {};

  // Transactional events default ON (undefined => send). Opt-in events default
  // OFF (must be explicitly true). Explicit false always wins.
  const pref = prefs[eventKey];
  const allowed = cfg.optInRequired ? pref === true : pref !== false;
  if (!allowed) return { sent: 0, reason: "muted" };

  const devSnap = await firestore.collection(`users/${uid}/devices`).get();
  const tokens = devSnap.docs.map((d) => d.id).filter(Boolean);
  if (!tokens.length) return { sent: 0, reason: "no-tokens" };

  // Stringify data values — FCM data payload must be string->string.
  const stringData = {};
  for (const [k, v] of Object.entries({ ...data, eventKey })) stringData[k] = String(v);

  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    data: stringData,
    apns: { payload: { aps: { sound: "default", badge: 1 } } },
    android: { priority: "high", notification: { sound: "default" } }
  });

  // Prune tokens FCM reports as permanently invalid.
  const dead = [];
  res.responses.forEach((r, i) => {
    const code = r.error?.code;
    if (code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token") dead.push(tokens[i]);
  });
  await Promise.all(dead.map((t) => firestore.doc(`users/${uid}/devices/${t}`).delete().catch(() => {})));

  return { sent: res.successCount, failed: res.failureCount, pruned: dead.length };
}

/**
 * Broadcast an opt-in event to every user who explicitly enabled it.
 * Used for announcements + open-requests chat. Skips the originator.
 * Queries users where notificationPrefs.{eventKey} == true (opt-in events
 * default OFF, so this query naturally returns only consenting users).
 */
async function sendBroadcast(eventKey, { title, body, data = {}, excludeUid } = {}) {
  if (!EVENTS[eventKey]) return { sent: 0, recipients: 0 };
  const firestore = admin.firestore();
  const snap = await firestore
    .collection("users")
    .where(`notificationPrefs.${eventKey}`, "==", true)
    .get();

  let sent = 0, recipients = 0;
  await Promise.all(snap.docs.map(async (d) => {
    if (d.id === excludeUid) return;
    recipients += 1;
    const r = await sendPush(d.id, eventKey, { title, body, data }).catch(() => ({ sent: 0 }));
    sent += r.sent || 0;
  }));
  return { sent, recipients };
}

module.exports = { sendPush, sendBroadcast, EVENTS };
