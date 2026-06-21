const { onDocumentUpdated }    = require("firebase-functions/v2/firestore");
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret }         = require("firebase-functions/params");
const admin                    = require("firebase-admin");
const JSZip                    = require("jszip");
const { Resend }               = require("resend");
const { Webhook }              = require("svix");
const Stripe                   = require("stripe");
const contacts                 = require("./contacts.json");
const staffConfig              = require("./staff.json");
const stripePrices             = require("./stripe-prices.json");

admin.initializeApp();

// Staff allowlist — emails permitted to access the moderation dashboard
const STAFF_EMAILS = (staffConfig.emails || []).map(e => e.toLowerCase());
function assertStaff(auth) {
  const email = auth?.token?.email?.toLowerCase();
  const verified = auth?.token?.email_verified;
  if (!email || !verified || !STAFF_EMAILS.includes(email)) {
    throw new HttpsError("permission-denied", "Not authorized for staff access.");
  }
  return email;
}

const RESEND_API_KEY          = defineSecret("RESEND_API_KEY");
const RESEND_WEBHOOK_SECRET   = defineSecret("RESEND_WEBHOOK_SECRET");
const STRIPE_SECRET           = defineSecret("STRIPE_SECRET");
const STRIPE_WEBHOOK_SECRET   = defineSecret("STRIPE_WEBHOOK_SECRET");

// Monthly credit grants by tier. Roll over = ADD on each paid invoice,
// capped at ROLLOVER_CAP_MULT × the monthly grant so balances don't grow forever.
const TIER_GRANTS = {
  free:  { pitch: 0,  loop: 5  },
  plugg: { pitch: 15, loop: 20 },
  pro:   { pitch: 50, loop: 60 }
};
// à-la-carte credit packs: which credit kind and how many each grants.
const PACK_CREDITS = {
  pack10: { kind: "pitch", amount: 10 },
  pack25: { kind: "pitch", amount: 25 },
  loop20: { kind: "loop",  amount: 20 },
  loop50: { kind: "loop",  amount: 50 }
};
const ROLLOVER_CAP_MULT = 3;

// Reverse lookup: Stripe price id -> our plan key
function tierForPriceId(priceId) {
  if (priceId && priceId === stripePrices.plugg) return "plugg";
  if (priceId && priceId === stripePrices.pro)   return "pro";
  return null;
}

// ====================================================================
// Credit plumbing — the ONLY way credit balances change. Both helpers
// run in a transaction and append an immutable creditLedger entry so
// every balance change is auditable. kind is "pitch" or "loop".
// ====================================================================
function creditField(kind) {
  if (kind !== "pitch" && kind !== "loop") throw new Error(`Unknown credit kind: ${kind}`);
  return kind === "pitch" ? "pitchCredits" : "loopCredits";
}

async function grantCredits(uid, kind, amount, reason, refId = null) {
  const db    = admin.firestore();
  const field = creditField(kind);
  const userRef   = db.doc(`users/${uid}`);
  const ledgerRef = userRef.collection("creditLedger").doc();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new Error(`User ${uid} not found`);
    const current = snap.get(`${field}.balance`) || 0;
    const balanceAfter = current + amount;
    tx.update(userRef, { [`${field}.balance`]: balanceAfter });
    tx.set(ledgerRef, {
      kind, delta: amount, reason, refId, balanceAfter,
      at: admin.firestore.FieldValue.serverTimestamp()
    });
    return balanceAfter;
  });
}

async function debitCredits(uid, kind, amount, reason, refId = null) {
  const db    = admin.firestore();
  const field = creditField(kind);
  const userRef   = db.doc(`users/${uid}`);
  const ledgerRef = userRef.collection("creditLedger").doc();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new Error(`User ${uid} not found`);
    const current = snap.get(`${field}.balance`) || 0;
    if (current < amount) {
      throw new HttpsError("failed-precondition",
        `Insufficient ${kind} credits: have ${current}, need ${amount}.`);
    }
    const balanceAfter = current - amount;
    tx.update(userRef, { [`${field}.balance`]: balanceAfter });
    tx.set(ledgerRef, {
      kind, delta: -amount, reason, refId, balanceAfter,
      at: admin.firestore.FieldValue.serverTimestamp()
    });
    return balanceAfter;
  });
}

// Region kept explicit so the email links below are deterministic
const REGION  = "us-central1";
const PROJECT = "pluggurbeats";
const FN_BASE = `https://${REGION}-${PROJECT}.cloudfunctions.net`;
// Public site origin — custom domain serving the React SPA. Used for
// Stripe Checkout return URLs (routes are SPA paths, not .html files).
const SITE_URL = "https://pluggurbeat.com";

// Maps target IDs from the dashboard to genre lane names in contacts.json
const TARGET_LANE_MAP = {
  "trap-a":          "Trap",
  "trap-r":          "Trap",
  "rb-a":            "R&B",
  "rb-r":            "R&B",
  "pop-a":           "Pop",
  "afro-r":          "Afrobeats",
  "drill-r":         "Drill",
  "reg-r":           "Reggaeton",
  "anr-major-trap":  "Trap",
  "anr-major-pop":   "Pop",
  "anr-indie":       "All",
  "anr-sync":        "All",
  "anr-mgmt":        "All"
};

// ====================================================================
// pitchCampaign — fires when a campaign is APPROVED by staff:
// zips beats, emails each contact a tracked link
// ====================================================================
exports.pitchCampaign = onDocumentUpdated(
  { document: "users/{uid}/campaigns/{campaignId}", region: REGION, secrets: [RESEND_API_KEY] },
  async (event) => {
    const before = event.data.before.data();
    const after  = event.data.after.data();

    // Only pitch on the transition INTO "approved" (ignore all other updates,
    // including the webhook's opens/downloads counter writes)
    if (before.status === "approved" || after.status !== "approved") return;

    const snap     = event.data.after;
    const { uid, campaignId } = event.params;
    const campaign = after;
    const db       = admin.firestore();
    const storage  = admin.storage().bucket();
    const resend   = new Resend(RESEND_API_KEY.value());

    const producer = campaign.producer || {};
    const beats    = (campaign.beats || []).filter(b => b.storagePath);
    const targets  = campaign.targets || [];

    if (beats.length === 0) {
      console.log("No uploaded beats on campaign", campaignId);
      return;
    }

    // Plugg-tier campaigns go straight to the Verified library — no email blast.
    const producerTier = campaign.tier ||
      (await db.doc(`users/${uid}`).get()).get("subscription.tier") || "free";
    if (producerTier !== "pro") {
      await snap.ref.update({
        status:    "pitched",
        pitchedAt: admin.firestore.FieldValue.serverTimestamp(),
        pitchedTo: [],
        opens:     0,
        downloads: 0
      });
      console.log(`Campaign ${campaignId}: Plugg tier — added to Verified library (no email)`);
      return;
    }

    // Resolve unique lanes from selected targets, then collect emails
    const lanes = [...new Set(targets.map(t => TARGET_LANE_MAP[t]).filter(Boolean))];
    const emailSet = new Set();
    lanes.forEach(lane => (contacts[lane] || []).forEach(e => emailSet.add(e)));
    (contacts["All"] || []).forEach(e => emailSet.add(e));
    const emails = [...emailSet];
    console.log("Pitching campaign", campaignId, "to", emails.length, "contacts");

    if (emails.length === 0) {
      await snap.ref.update({ status: "no_contacts" });
      return;
    }

    // Download individual beat files and zip server-side
    const zip = new JSZip();
    await Promise.all(beats.map(async beat => {
      const [buffer] = await storage.file(beat.storagePath).download();
      zip.file(beat.storagePath.split("/").pop(), buffer);
    }));
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const zipPath   = `pitches/${uid}/${campaignId}/beats.zip`;
    await storage.file(zipPath).save(zipBuffer, { contentType: "application/zip" });

    const beatListHtml = beats
      .map(b => `<li><strong>${b.title}</strong> — ${b.genre || ""}${b.bpm ? `, ${b.bpm} BPM` : ""}${b.key ? `, ${b.key}` : ""}</li>`)
      .join("");
    const packageLabel = { starter: "Starter", pro: "Pro", label: "Label" }[campaign.package] || campaign.package;

    // Send one personalized email per contact. A token is generated up front so
    // the download link is unique per recipient ("by who"); after send we also
    // index the Resend email id so the webhook can attribute opens.
    const results = await Promise.allSettled(emails.map(async (to) => {
      const token   = db.collection("emailIndex").doc().id;   // unique per recipient
      const recipient = { uid, campaignId, contact: to, sentAt: admin.firestore.FieldValue.serverTimestamp() };
      await db.collection("emailIndex").doc(token).set(recipient);

      const downloadUrl = `${FN_BASE}/downloadBeats?e=${token}`;
      const sent = await resend.emails.send({
        from:    "PluggurBeats Pitching <pitching@pluggurbeat.com>",
        to,
        subject: `New beats from ${producer.name || "a producer"} — PluggurBeats`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
            <h2 style="color:#C9A24B">New beats for your consideration</h2>
            <p>
              <strong>${producer.name || "A producer"}</strong>
              ${producer.instagram ? `(${producer.instagram})` : ""}
              has submitted <strong>${beats.length} beat${beats.length !== 1 ? "s" : ""}</strong>
              via PluggurBeats (${packageLabel} package — ${campaign.pitches} guaranteed pitches).
            </p>
            <p><strong>Beats included:</strong></p>
            <ul>${beatListHtml}</ul>
            <a href="${downloadUrl}"
               style="display:inline-block;margin:20px 0;padding:14px 28px;background:#E4C16B;
                      color:#1a1405;border-radius:999px;text-decoration:none;font-weight:bold;font-size:16px">
              Download Beats (ZIP)
            </a>
            <p style="color:#888;font-size:12px">
              To opt out of future pitches reply with "unsubscribe".<br>
              Powered by <a href="https://pluggurbeat.com" style="color:#C9A24B">PluggurBeats</a>
            </p>
          </div>`
      });

      // Resend returns { data, error } — it does NOT throw on API errors
      // (e.g. unverified domain), so surface those explicitly.
      if (sent?.error) {
        console.error(`Resend rejected email to ${to}:`, JSON.stringify(sent.error));
        return { to, error: sent.error };
      }
      // Index the Resend email id -> same recipient so webhook opens resolve
      const emailId = sent?.data?.id;
      if (emailId) await db.collection("emailIndex").doc(emailId).set(recipient);
      console.log(`Email sent to ${to} (id ${emailId})`);
      return { to, emailId };
    }));

    results.forEach(r => {
      if (r.status === "rejected") console.error("Email send threw:", r.reason);
    });

    const sentCount = results.filter(r => r.status === "fulfilled" && r.value.emailId).length;
    if (sentCount === 0) {
      console.error(`Campaign ${campaignId}: NO emails sent — check Resend domain verification`);
      await snap.ref.update({ status: "send_failed" });
      return;
    }

    await snap.ref.update({
      status:    "pitched",
      pitchedAt: admin.firestore.FieldValue.serverTimestamp(),
      pitchedTo: emails,
      opens:     0,
      downloads: 0
    });

    console.log(`Campaign ${campaignId}: pitched ${beats.length} beats to ${emails.length} contacts`);
  }
);

// ====================================================================
// mirrorLibraryBeats — fires when a campaign transitions INTO "pitched".
// Denormalizes each uploaded beat into a top-level /libraryBeats doc so
// verified listeners (who can't read other users' campaigns) get a live
// onSnapshot signal for the Verified library. Audio stays private — the
// client fetches signed URLs through listApprovedBeats. Idempotent: one
// deterministic doc id per beat (campaignId_index).
// ====================================================================
exports.mirrorLibraryBeats = onDocumentUpdated(
  { document: "users/{uid}/campaigns/{campaignId}", region: REGION },
  async (event) => {
    const before = event.data.before.data();
    const after  = event.data.after.data();
    if (before.status === "pitched" || after.status !== "pitched") return;

    const { uid, campaignId } = event.params;
    const db       = admin.firestore();
    const producer = after.producer || {};
    const beats    = (after.beats || []).filter(b => b.storagePath);
    if (beats.length === 0) return;

    const batch = db.batch();
    beats.forEach((b, i) => {
      const ref = db.doc(`libraryBeats/${campaignId}_${i}`);
      batch.set(ref, {
        ownerUid:   uid,
        campaignId,
        beatIndex:  i,
        title:      b.title || "Untitled",
        genre:      b.genre || "",
        key:        b.key   || "",
        bpm:        b.bpm   || "",
        producer:   { name: producer.name || "", instagram: producer.instagram || "" },
        storagePath: b.storagePath,
        pitchedAt:  admin.firestore.FieldValue.serverTimestamp()
      });
    });
    await batch.commit();
    console.log(`libraryBeats: mirrored ${beats.length} beats for campaign ${campaignId}`);
  }
);

// ====================================================================
// downloadBeats — logs who downloaded, then redirects to the ZIP
//   email link: /downloadBeats?e={emailId}
// ====================================================================
exports.downloadBeats = onRequest({ region: REGION }, async (req, res) => {
  const emailId = req.query.e;
  if (!emailId) { res.status(400).send("Missing token"); return; }

  const db  = admin.firestore();
  const idx = await db.collection("emailIndex").doc(String(emailId)).get();
  if (!idx.exists) { res.status(404).send("Invalid or expired link"); return; }

  const { uid, campaignId, contact } = idx.data();
  const zipPath = `pitches/${uid}/${campaignId}/beats.zip`;
  const file    = admin.storage().bucket().file(zipPath);

  // Log the download event (attributed to the recipient this link was sent to)
  const campaignRef = db.doc(`users/${uid}/campaigns/${campaignId}`);
  await campaignRef.collection("events").add({
    type:      "downloaded",
    contact,
    emailId:   String(emailId),
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });
  await campaignRef.update({ downloads: admin.firestore.FieldValue.increment(1) });
  console.log(`Recorded download for campaign ${campaignId} (contact ${contact})`);

  // Fresh 1-hour signed URL each click
  const [url] = await file.getSignedUrl({ action: "read", expires: Date.now() + 60 * 60 * 1000 });
  res.redirect(302, url);
});

// ====================================================================
// resendWebhook — receives Resend (Svix) events, stores opens/clicks
// ====================================================================
exports.resendWebhook = onRequest(
  { region: REGION, secrets: [RESEND_WEBHOOK_SECRET] },
  async (req, res) => {
    const db = admin.firestore();

    // Verify the Svix signature against the raw body
    let evt;
    try {
      const wh = new Webhook(RESEND_WEBHOOK_SECRET.value());
      evt = wh.verify(req.rawBody, {
        "svix-id":        req.header("svix-id"),
        "svix-timestamp": req.header("svix-timestamp"),
        "svix-signature": req.header("svix-signature")
      });
    } catch (e) {
      console.error("Webhook signature verification failed:", e.message);
      res.status(401).send("Invalid signature");
      return;
    }

    const type    = evt.type;                 // e.g. "email.opened"
    const emailId = evt.data?.email_id;
    console.log("Webhook event:", type, "email_id:", emailId);
    if (!emailId) { res.status(200).send("ok"); return; }

    const idx = await db.collection("emailIndex").doc(emailId).get();
    if (!idx.exists) {
      console.warn("No emailIndex entry for", emailId, "— event ignored:", type);
      res.status(200).send("ok");
      return;
    }

    const { uid, campaignId, contact } = idx.data();
    const campaignRef = db.doc(`users/${uid}/campaigns/${campaignId}`);

    const shortType = type.replace("email.", ""); // opened, clicked, delivered, bounced…
    await campaignRef.collection("events").add({
      type:      shortType,
      contact,
      emailId,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    // Bump the open counter on the campaign for quick stats
    if (shortType === "opened") {
      await campaignRef.update({ opens: admin.firestore.FieldValue.increment(1) });
    }

    console.log(`Recorded ${shortType} for campaign ${campaignId} (contact ${contact})`);
    res.status(200).send("ok");
  }
);

// ====================================================================
// listReviewCampaigns — staff-only: returns every campaign across all
// users with signed playback URLs for each beat, grouped client-side.
// ====================================================================
exports.listReviewCampaigns = onCall({ region: REGION }, async (request) => {
  assertStaff(request.auth);
  const db      = admin.firestore();
  const storage = admin.storage().bucket();

  const snap = await db.collectionGroup("campaigns").get();
  const campaigns = await Promise.all(snap.docs.map(async (doc) => {
    const c    = doc.data();
    const path = doc.ref.path;
    const uid  = path.split("/")[1];

    const beats = await Promise.all((c.beats || []).map(async (b) => {
      let playUrl = null;
      if (b.storagePath) {
        try {
          const [url] = await storage.file(b.storagePath)
            .getSignedUrl({ action: "read", expires: Date.now() + 2 * 60 * 60 * 1000 });
          playUrl = url;
        } catch (e) { console.warn("Signed URL failed for", b.storagePath, e.message); }
      }
      return { title:b.title||"Untitled", genre:b.genre||"", key:b.key||"", bpm:b.bpm||"",
               collabs:b.collabs||[], playUrl };
    }));

    // Fetch engagement events for pitched/failed campaigns so staff can see per-contact activity
    let events = [];
    if (["pitched", "send_failed", "approved"].includes(c.status)) {
      try {
        const evSnap = await db.collection(path + "/events").get();
        events = evSnap.docs.map(e => {
          const d = e.data();
          return {
            type:      d.type,
            contact:   d.contact,
            timestamp: d.timestamp?.toMillis ? d.timestamp.toMillis() : null
          };
        });
      } catch (e) { console.warn("Could not fetch events for", path, e.message); }
    }

    return {
      path,
      uid,
      id:          doc.id,
      status:      c.status || "pending_review",
      package:     c.package || "",
      pitches:     c.pitches || 0,
      producer:    c.producer || {},
      targets:     c.targets || [],
      beats,
      pitchedTo:   c.pitchedTo || [],
      opens:       c.opens || 0,
      downloads:   c.downloads || 0,
      events,
      createdAt:   c.createdAt?.toMillis   ? c.createdAt.toMillis()   : null,
      moderatedAt: c.moderatedAt?.toMillis ? c.moderatedAt.toMillis() : null
    };
  }));

  campaigns.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { campaigns };
});

// ====================================================================
// moderateCampaign — staff-only: approve (→ triggers pitch) or reject.
// On rejection, emails the producer with the reason if their email is set.
// ====================================================================
exports.moderateCampaign = onCall(
  { region: REGION, secrets: [RESEND_API_KEY] },
  async (request) => {
    const staffEmail = assertStaff(request.auth);
    const { path, decision, reason, note } = request.data || {};
    if (!path || !["approved", "rejected"].includes(decision)) {
      throw new HttpsError("invalid-argument", "path and a valid decision are required.");
    }
    if (!/^users\/[^/]+\/campaigns\/[^/]+$/.test(path)) {
      throw new HttpsError("invalid-argument", "Invalid campaign path.");
    }

    const ref  = admin.firestore().doc(path);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Campaign not found.");

    const campaign = snap.data();
    const update   = {
      status:      decision,
      moderatedBy: staffEmail,
      moderatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (reason) update.rejectionReason = reason;
    if (note)   update.rejectionNote   = note;
    await ref.update(update);

    // Refund pitch credits when rejecting a campaign that hasn't been pitched
    // yet. Guard on the PRE-update status (campaign was read before the write)
    // so an already-rejected/approved campaign can't be refunded twice.
    let refunded = 0;
    if (decision === "rejected" && campaign.status === "pending_review"
        && !campaign.creditRefunded && (campaign.creditCost || 0) > 0) {
      const uid        = path.split("/")[1];
      const campaignId = path.split("/")[3];
      await grantCredits(uid, "pitch", campaign.creditCost, "campaign_rejected_refund", campaignId);
      await ref.update({ creditRefunded: true });
      refunded = campaign.creditCost;
      console.log(`Refunded ${refunded} pitch credits to ${uid} for rejected campaign ${campaignId}`);
    }

    // Email the producer their rejection reason
    if (decision === "rejected" && campaign.producer?.email) {
      try {
        const resend = new Resend(RESEND_API_KEY.value());
        await resend.emails.send({
          from:    "PluggurBeats Team <team@pluggurbeat.com>",
          to:      campaign.producer.email,
          subject: "Update on your PluggurBeats campaign",
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
              <h2 style="color:#C9A24B">Campaign update</h2>
              <p>Hi ${campaign.producer.name || "there"},</p>
              <p>Our team has reviewed your campaign and unfortunately we're unable to pitch it at this time.</p>
              ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
              ${note   ? `<p>${note}</p>` : ""}
              ${refunded ? `<p><strong>${refunded} pitch credit${refunded !== 1 ? "s" : ""}</strong> ${refunded !== 1 ? "have" : "has"} been refunded to your account.</p>` : ""}
              <p>You're welcome to make revisions and submit a new campaign. If you have questions, reply to this email.</p>
              <p>— The PluggurBeats Team</p>
              <p style="color:#888;font-size:12px">
                Powered by <a href="https://pluggurbeat.com" style="color:#C9A24B">PluggurBeats</a>
              </p>
            </div>`
        });
        console.log(`Rejection email sent to ${campaign.producer.email}`);
      } catch (e) {
        console.error("Failed to send rejection email:", e.message);
        // Don't throw — the rejection was still recorded
      }
    }

    console.log(`Campaign ${path} ${decision} by ${staffEmail}`);
    return { ok: true, status: decision, refunded };
  }
);

// ====================================================================
// listUsers — staff-only: all user profiles with signed avatar URLs
// ====================================================================
exports.listUsers = onCall({ region: REGION }, async (request) => {
  assertStaff(request.auth);
  const db      = admin.firestore();
  const storage = admin.storage().bucket();

  const snap = await db.collection("users").get();
  const users = await Promise.all(snap.docs.map(async (doc) => {
    const u = doc.data();
    let avatarUrl = null;
    if (u.avatarPath) {
      try {
        const [url] = await storage.file(u.avatarPath)
          .getSignedUrl({ action: "read", expires: Date.now() + 2 * 60 * 60 * 1000 });
        avatarUrl = url;
      } catch (e) { /* avatar missing — ignore */ }
    }
    return {
      uid:             doc.id,
      displayName:     u.displayName || "",
      email:           u.email || "",
      phone:           u.phone || "",
      location:        u.location || "",
      bio:             u.bio || "",
      avatarUrl,
      verifiedPuller:   u.verifiedPuller   === true,
      verifiedListener: u.verifiedListener === true,
      pitchBalance:    u.pitchCredits?.balance || 0,
      loopBalance:     u.loopCredits?.balance  || 0,
      tier:            u.subscription?.tier    || "free",
      createdAt:       u.createdAt?.toMillis ? u.createdAt.toMillis() : null
    };
  }));

  users.sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
  return { users };
});

// ====================================================================
// setVerifiedPuller — staff-only: toggle a user's loop-pull verification
// ====================================================================
exports.setVerifiedPuller = onCall({ region: REGION }, async (request) => {
  const staffEmail = assertStaff(request.auth);
  const { uid, value } = request.data || {};
  if (!uid || typeof value !== "boolean") {
    throw new HttpsError("invalid-argument", "uid and a boolean value are required.");
  }
  const ref = admin.firestore().doc(`users/${uid}`);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "User not found.");
  await ref.update({ verifiedPuller: value });
  console.log(`verifiedPuller=${value} for ${uid} by ${staffEmail}`);
  return { ok: true, uid, verifiedPuller: value };
});

// ====================================================================
// STRIPE — subscriptions ($29 Plugg / $99 Pro) + à-la-carte credit packs
// ====================================================================

// Get or create a Stripe customer for this uid, caching the id on the user doc
async function getOrCreateCustomer(stripe, uid) {
  const db   = admin.firestore();
  const ref  = db.doc(`users/${uid}`);
  const snap = await ref.get();
  const existing = snap.get("subscription.stripeCustomerId");
  if (existing) return existing;

  const email = snap.get("email") || undefined;
  const customer = await stripe.customers.create({ email, metadata: { uid } });
  await ref.update({ "subscription.stripeCustomerId": customer.id });
  await db.doc(`stripeCustomers/${customer.id}`).set({ uid });   // fast reverse lookup
  return customer.id;
}

// createSubscriptionCheckout({ plan }) -> { url } or { upgraded: true }
exports.createSubscriptionCheckout = onCall(
  { region: REGION, secrets: [STRIPE_SECRET] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    const uid  = request.auth.uid;
    const plan = request.data?.plan;
    if (!["plugg", "pro"].includes(plan)) throw new HttpsError("invalid-argument", "Unknown plan.");
    const priceId = stripePrices[plan];
    if (!priceId) throw new HttpsError("failed-precondition", "Plan price not configured.");

    const db      = admin.firestore();
    const snap    = await db.doc(`users/${uid}`).get();
    const curTier = snap.get("subscription.tier") || "free";
    const subId   = snap.get("subscription.stripeSubId");

    const stripe = Stripe(STRIPE_SECRET.value());

    // Already on this plan — block re-subscribe
    if (curTier === plan && subId) {
      throw new HttpsError("already-exists", `You already have the ${plan} plan.`);
    }

    // Plugg → Pro upgrade: swap price on existing subscription (no new checkout)
    if (curTier === "plugg" && plan === "pro" && subId) {
      const sub    = await stripe.subscriptions.retrieve(subId);
      const itemId = sub.items.data[0]?.id;
      if (!itemId) throw new HttpsError("failed-precondition", "Could not find subscription item.");
      await stripe.subscriptions.update(subId, {
        items: [{ id: itemId, price: priceId }],
        proration_behavior: "create_prorations"
      });
      await db.doc(`users/${uid}`).update({
        "subscription.tier":   "pro",
        "subscription.status": "active"
      });
      await applyMonthlyGrants(uid, "pro", null);
      console.log(`Subscription upgraded plugg -> pro for ${uid}`);
      return { upgraded: true };
    }

    // Pro trying to downgrade to Plugg — not allowed self-serve
    if (curTier === "pro" && plan === "plugg") {
      throw new HttpsError("failed-precondition",
        "To downgrade from Pro, please contact support.");
    }

    // New subscription (free → plugg or free → pro)
    const customer = await getOrCreateCustomer(stripe, uid);
    const session  = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { uid, kind: "subscription", tier: plan },
      success_url: `${SITE_URL}/dashboard?sub=success`,
      cancel_url:  `${SITE_URL}/dashboard?sub=cancel`
    });
    return { url: session.url };
  }
);

// buyCreditPack({ pack }) -> { url }
exports.buyCreditPack = onCall(
  { region: REGION, secrets: [STRIPE_SECRET] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    const uid  = request.auth.uid;
    const pack = request.data?.pack;
    if (!PACK_CREDITS[pack]) throw new HttpsError("invalid-argument", "Unknown pack.");
    const priceId = stripePrices[pack];
    if (!priceId) throw new HttpsError("failed-precondition", "Pack price not configured.");

    const stripe   = Stripe(STRIPE_SECRET.value());
    const customer = await getOrCreateCustomer(stripe, uid);
    const session  = await stripe.checkout.sessions.create({
      mode: "payment",
      customer,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { uid, kind: "pack", pack },
      success_url: `${SITE_URL}/dashboard?pack=success`,
      cancel_url:  `${SITE_URL}/dashboard?pack=cancel`
    });
    return { url: session.url };
  }
);

// Resolve a Stripe customer id -> our uid (mapping doc, fallback to metadata)
async function uidForCustomer(stripe, customerId) {
  const map = await admin.firestore().doc(`stripeCustomers/${customerId}`).get();
  if (map.exists) return map.get("uid");
  const cust = await stripe.customers.retrieve(customerId);
  return cust?.metadata?.uid || null;
}

// Apply a tier's monthly grants (ADD, capped at ROLLOVER_CAP_MULT × grant).
// Idempotent per billing period: if periodEnd is supplied and we've already
// granted for that period, this is a no-op. This lets both the Stripe webhook
// and the client-side reconcile path call it safely without double-granting.
// Returns true if grants were applied, false if skipped.
async function applyMonthlyGrants(uid, tier, periodEnd = null) {
  const db      = admin.firestore();
  const userRef = db.doc(`users/${uid}`);

  if (periodEnd != null) {
    const cur = (await userRef.get()).get("subscription.lastGrantPeriodEnd");
    if (cur === periodEnd) {
      console.log(`Grants already applied for period ${periodEnd} (uid ${uid}); skipping`);
      return false;
    }
  }

  const grants = TIER_GRANTS[tier] || TIER_GRANTS.free;
  for (const kind of ["pitch", "loop"]) {
    const field   = kind === "pitch" ? "pitchCredits" : "loopCredits";
    const grant   = grants[kind];
    const snap    = await userRef.get();
    const balance = snap.get(`${field}.balance`) || 0;
    const cap     = grant * ROLLOVER_CAP_MULT;
    const target  = Math.min(balance + grant, Math.max(cap, balance)); // never reduce below current
    const delta   = target - balance;
    if (delta > 0) await grantCredits(uid, kind, delta, `monthly_${tier}`);
    await userRef.update({
      [`${field}.monthlyGrant`]: grant,
      [`${field}.lastGrantAt`]:  admin.firestore.FieldValue.serverTimestamp()
    });
  }

  if (periodEnd != null) {
    await userRef.update({ "subscription.lastGrantPeriodEnd": periodEnd });
  }
  return true;
}

// ====================================================================
// submitCampaign — credit-based campaign submission (Phase 3).
// Server recomputes cost, enforces tier caps + A&R gating,
// then atomically debits pitchCredits and creates the campaign doc.
// ====================================================================
const PITCH_TARGET_COSTS = {
  "trap-a":2,"trap-r":1,"rb-a":2,"rb-r":1,"pop-a":2,
  "afro-r":1,"drill-r":1,"reg-r":1,
  "anr-major-trap":3,"anr-major-pop":3,"anr-indie":3,"anr-sync":3,"anr-mgmt":3
};
const ANR_TARGET_IDS = new Set(["anr-major-trap","anr-major-pop","anr-indie","anr-sync","anr-mgmt"]);
const TIER_CAPS_FN = {
  free:  { beats:5,  lanes:1,        anr:false },
  plugg: { beats:15, lanes:3,        anr:false },
  pro:   { beats:25, lanes:Infinity, anr:true  }
};

exports.submitCampaign = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const uid = request.auth.uid;
  const { producer, beats, targets, addons } = request.data || {};

  if (!Array.isArray(targets) || targets.length === 0)
    throw new HttpsError("invalid-argument", "Select at least one target.");
  if (!Array.isArray(beats) || beats.length === 0)
    throw new HttpsError("invalid-argument", "Include at least one beat.");

  const db       = admin.firestore();
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) throw new HttpsError("not-found", "User not found.");

  const tier = userSnap.get("subscription.tier") || "free";

  if (tier === "free")
    throw new HttpsError("permission-denied",
      "Campaigns require a Plugg or Pro subscription.");

  const caps = TIER_CAPS_FN[tier] || TIER_CAPS_FN.free;

  if (beats.length > caps.beats)
    throw new HttpsError("invalid-argument",
      `Your ${tier} plan allows up to ${caps.beats} beats per campaign.`);

  if (caps.lanes !== Infinity && targets.length > caps.lanes)
    throw new HttpsError("invalid-argument",
      `Your ${tier} plan allows up to ${caps.lanes} lane${caps.lanes !== 1 ? "s" : ""} per campaign.`);

  const hasAnr = targets.some(t => ANR_TARGET_IDS.has(t));
  if (hasAnr && !caps.anr)
    throw new HttpsError("permission-denied",
      "A&R / management lanes require a Pro subscription.");

  // Recompute cost server-side — never trust client total
  let cost = 0;
  for (const t of targets) {
    const c = PITCH_TARGET_COSTS[t];
    if (c === undefined) throw new HttpsError("invalid-argument", `Unknown target: ${t}`);
    cost += c;
  }
  const addonsArr = Array.isArray(addons) ? addons : [];
  if (addonsArr.includes("rush"))     cost += 2;
  if (addonsArr.includes("feedback")) cost += 1;

  // Atomic: debit pitchCredits + create campaign
  const userRef     = db.doc(`users/${uid}`);
  const campaignRef = userRef.collection("campaigns").doc();
  const ledgerRef   = userRef.collection("creditLedger").doc();

  await db.runTransaction(async (tx) => {
    const snap    = await tx.get(userRef);
    const balance = snap.get("pitchCredits.balance") || 0;
    if (balance < cost) {
      throw new HttpsError("failed-precondition",
        `Not enough pitch credits — have ${balance}, need ${cost}. Buy a pack to continue.`);
    }
    const balanceAfter = balance - cost;
    tx.update(userRef, { "pitchCredits.balance": balanceAfter });
    tx.set(ledgerRef, {
      kind: "pitch", delta: -cost, reason: "campaign", refId: campaignRef.id,
      balanceAfter, at: admin.firestore.FieldValue.serverTimestamp()
    });
    tx.set(campaignRef, {
      producer:   producer || {},
      beats:      beats,
      targets:    targets,
      addons:     addonsArr,
      creditCost: cost,
      tier,
      status:     "pending_review",
      createdAt:  admin.firestore.FieldValue.serverTimestamp()
    });
  });

  console.log(`Campaign ${campaignRef.id} submitted by ${uid} (${tier}) — cost ${cost} credits`);
  return { ok: true, campaignId: campaignRef.id, creditCost: cost };
});

// ====================================================================
// reconcileCredits — self-service entitlement recovery. If a user's
// monthly grant was missed (e.g. a webhook delivery failure), the
// dashboard calls this on load. It ONLY ever affects the caller's own
// account, verifies a real active Stripe subscription before granting,
// and is idempotent per billing period (can't double-grant).
// ====================================================================
exports.reconcileCredits = onCall(
  { region: REGION, secrets: [STRIPE_SECRET] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    const uid  = request.auth.uid;
    const db   = admin.firestore();
    const ref  = db.doc(`users/${uid}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "User not found.");

    const tier  = snap.get("subscription.tier") || "free";
    const subId = snap.get("subscription.stripeSubId");
    if (!["plugg", "pro"].includes(tier) || !subId) {
      return { granted: false, reason: "no_active_paid_subscription" };
    }

    // Confirm the subscription is genuinely active before granting anything
    const stripe = Stripe(STRIPE_SECRET.value());
    const sub    = await stripe.subscriptions.retrieve(subId);
    if (!["active", "trialing"].includes(sub.status)) {
      return { granted: false, reason: `subscription_${sub.status}` };
    }

    // current_period_end moved into items in newer Stripe API — support both
    const periodEnd = sub.current_period_end
                   || sub.items?.data?.[0]?.current_period_end
                   || null;

    const applied = await applyMonthlyGrants(uid, tier, periodEnd);
    if (applied) {
      await ref.update({
        "subscription.status":   "active",
        "subscription.renewsAt": periodEnd
          ? admin.firestore.Timestamp.fromMillis(periodEnd * 1000) : null
      });
    }

    const after = await ref.get();
    return {
      granted: applied,
      tier,
      pitch: after.get("pitchCredits.balance") || 0,
      loop:  after.get("loopCredits.balance")  || 0
    };
  }
);

// ====================================================================
// submitLoop — debit 1 loop credit, create the loop doc as "live".
// storagePath is the path the client already uploaded to Storage.
// ====================================================================
exports.submitLoop = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const uid = request.auth.uid;
  const { title, bpm, key, genre, tags, storagePath } = request.data || {};

  if (!title || typeof title !== "string" || !title.trim())
    throw new HttpsError("invalid-argument", "title is required.");
  if (!storagePath || typeof storagePath !== "string")
    throw new HttpsError("invalid-argument", "storagePath is required.");

  const db       = admin.firestore();
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) throw new HttpsError("not-found", "User not found.");
  const makerName = userSnap.get("displayName") || "Unknown";

  const loopRef = db.collection("loops").doc();

  // Debit 1 loop credit before creating the doc (throws if insufficient)
  await debitCredits(uid, "loop", 1, "loop_submit", loopRef.id);

  await loopRef.set({
    makerUid:  uid,
    makerName,
    title:     title.trim(),
    bpm:       bpm   || null,
    key:       key   || null,
    genre:     genre || null,
    tags:      Array.isArray(tags) ? tags.slice(0, 10) : [],
    storagePath,
    status:    "live",
    plays:     0,
    downloads: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  console.log(`Loop ${loopRef.id} submitted by ${uid}`);
  return { ok: true, loopId: loopRef.id };
});

// ====================================================================
// pullLoop — assert verifiedPuller, create a loopClaims record,
// mark the loop "used", email the maker, return a signed download URL.
// ====================================================================
exports.pullLoop = onCall(
  { region: REGION, secrets: [RESEND_API_KEY] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    const uid = request.auth.uid;
    const { loopId } = request.data || {};
    if (!loopId) throw new HttpsError("invalid-argument", "loopId is required.");

    const db      = admin.firestore();
    const storage = admin.storage().bucket();

    const pullerSnap = await db.doc(`users/${uid}`).get();
    if (!pullerSnap.get("verifiedPuller")) {
      throw new HttpsError("permission-denied", "Only verified pullers can pull loops.");
    }

    const loopRef  = db.doc(`loops/${loopId}`);
    const loopSnap = await loopRef.get();
    if (!loopSnap.exists) throw new HttpsError("not-found", "Loop not found.");
    const loop = loopSnap.data();
    if (loop.status !== "live") {
      throw new HttpsError("failed-precondition", "This loop has already been pulled.");
    }

    // Create claim and update loop atomically
    const claimRef = db.collection("loopClaims").doc();
    const batch    = db.batch();
    batch.set(claimRef, {
      loopId,
      makerUid:  loop.makerUid,
      pullerUid: uid,
      status:    "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    batch.update(loopRef, {
      status:    "used",
      downloads: admin.firestore.FieldValue.increment(1)
    });
    await batch.commit();

    // Notify the maker by email
    const makerSnap  = await db.doc(`users/${loop.makerUid}`).get();
    const makerEmail = makerSnap.get("email");
    const pullerName = pullerSnap.get("displayName") || "Someone";
    if (makerEmail) {
      try {
        const resend = new Resend(RESEND_API_KEY.value());
        await resend.emails.send({
          from:    "PluggurBeats <team@pluggurbeat.com>",
          to:      makerEmail,
          subject: "Your loop was pulled on PluggurBeats!",
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
              <h2 style="color:#C9A24B">Your loop got picked up</h2>
              <p>Hi ${loop.makerName || "there"},</p>
              <p>
                <strong>${pullerName}</strong> just pulled your loop
                "<strong>${loop.title}</strong>" from the PluggurBeats pool.
              </p>
              <p>
                A split-claim has been created — if the resulting beat gets placed
                your contribution will be tracked through the existing paperwork flow.
              </p>
              <p>Log in to your dashboard to see your loop activity.</p>
              <p>— The PluggurBeats Team</p>
              <p style="color:#888;font-size:12px">
                Powered by <a href="https://pluggurbeat.com" style="color:#C9A24B">PluggurBeats</a>
              </p>
            </div>`
        });
        console.log(`Loop-pull email sent to ${makerEmail}`);
      } catch (e) {
        console.error("Failed to send loop-pull email:", e.message);
      }
    }

    // 1-hour signed download URL
    const [url] = await storage.file(loop.storagePath)
      .getSignedUrl({ action: "read", expires: Date.now() + 60 * 60 * 1000 });

    console.log(`Loop ${loopId} pulled by ${uid} — claim ${claimRef.id}`);
    return { ok: true, url, claimId: claimRef.id };
  }
);

// ====================================================================
// listLiveLoops — verifiedPuller-only: returns all live loops with
// 2-hour signed playback URLs so the browser can preview before pulling.
// ====================================================================
exports.listLiveLoops = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const uid = request.auth.uid;
  const db      = admin.firestore();
  const storage = admin.storage().bucket();

  const pullerSnap = await db.doc(`users/${uid}`).get();
  if (!pullerSnap.get("verifiedPuller")) {
    throw new HttpsError("permission-denied", "Only verified pullers can browse the loop pool.");
  }

  const snap  = await db.collection("loops").where("status", "==", "live").get();
  const loops = await Promise.all(snap.docs.map(async (d) => {
    const l = d.data();
    let playUrl = null;
    try {
      [playUrl] = await storage.file(l.storagePath)
        .getSignedUrl({ action: "read", expires: Date.now() + 2 * 60 * 60 * 1000 });
    } catch (e) { console.warn("Signed URL failed for loop", d.id, e.message); }
    return {
      id:        d.id,
      makerUid:  l.makerUid,
      makerName: l.makerName || "Unknown",
      title:     l.title,
      bpm:       l.bpm   || null,
      key:       l.key   || null,
      genre:     l.genre || null,
      tags:      l.tags  || [],
      downloads: l.downloads || 0,
      createdAt: l.createdAt?.toMillis ? l.createdAt.toMillis() : null,
      playUrl
    };
  }));

  loops.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { loops };
});

// ====================================================================
// listApprovedBeats — verifiedListener or verifiedPuller callable.
// Returns a flat list of every beat from every pitched campaign,
// with 2-hour signed playback URLs, for the Verified library.
// ====================================================================
exports.listApprovedBeats = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const uid = request.auth.uid;
  const db      = admin.firestore();
  const storage = admin.storage().bucket();

  const userSnap = await db.doc(`users/${uid}`).get();
  const ok = userSnap.get("verifiedListener") === true
          || userSnap.get("verifiedPuller")   === true;
  if (!ok) throw new HttpsError("permission-denied", "Verified access required.");

  const snap  = await db.collectionGroup("campaigns").where("status", "==", "pitched").get();
  const beats = [];

  await Promise.all(snap.docs.map(async (d) => {
    const c        = d.data();
    const producer = c.producer || {};
    const pitchedAt = c.pitchedAt?.toMillis ? c.pitchedAt.toMillis() : null;

    await Promise.all((c.beats || []).map(async (b, i) => {
      if (!b.storagePath) return;
      let playUrl = null;
      try {
        [playUrl] = await storage.file(b.storagePath)
          .getSignedUrl({ action: "read", expires: Date.now() + 2 * 60 * 60 * 1000 });
      } catch (e) { console.warn("Signed URL failed for beat", b.storagePath, e.message); }
      beats.push({
        id:         `${d.id}_${i}`,
        campaignId: d.id,
        title:      b.title  || "Untitled",
        genre:      b.genre  || "",
        key:        b.key    || "",
        bpm:        b.bpm    || "",
        producer:   { name: producer.name || "", instagram: producer.instagram || "" },
        pitchedAt,
        playUrl
      });
    }));
  }));

  beats.sort((a, b) => (b.pitchedAt || 0) - (a.pitchedAt || 0));
  return { beats };
});

// ====================================================================
// setVerifiedListener — staff-only: grant/revoke A&R / artist access
// to the Verified beat library and Loop Pool.
// ====================================================================
exports.setVerifiedListener = onCall({ region: REGION }, async (request) => {
  const staffEmail = assertStaff(request.auth);
  const { uid, value } = request.data || {};
  if (!uid || typeof value !== "boolean") {
    throw new HttpsError("invalid-argument", "uid and a boolean value are required.");
  }
  const ref = admin.firestore().doc(`users/${uid}`);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "User not found.");
  await ref.update({ verifiedListener: value });
  console.log(`verifiedListener=${value} for ${uid} by ${staffEmail}`);
  return { ok: true, uid, verifiedListener: value };
});

// ====================================================================
// adjustCredits — staff-only: add or remove pitch/loop credits.
// delta is a signed integer (positive = grant, negative = debit).
// ====================================================================
exports.adjustCredits = onCall({ region: REGION }, async (request) => {
  const staffEmail = assertStaff(request.auth);
  const { uid, kind, delta } = request.data || {};
  if (!uid || !["pitch","loop"].includes(kind) || typeof delta !== "number" || delta === 0) {
    throw new HttpsError("invalid-argument", "uid, kind (pitch|loop), and a non-zero integer delta are required.");
  }
  const amount = Math.abs(Math.round(delta));
  const db = admin.firestore();
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) throw new HttpsError("not-found", "User not found.");
  let newBalance;
  if (delta > 0) {
    newBalance = await grantCredits(uid, kind, amount, `staff_adjustment:${staffEmail}`);
  } else {
    newBalance = await db.runTransaction(async (tx) => {
      const snap = await tx.get(db.doc(`users/${uid}`));
      const field = kind === "pitch" ? "pitchCredits" : "loopCredits";
      const current = snap.get(`${field}.balance`) || 0;
      const after = Math.max(0, current - amount);
      const ledgerRef = db.doc(`users/${uid}`).collection("creditLedger").doc();
      tx.update(db.doc(`users/${uid}`), { [`${field}.balance`]: after });
      tx.set(ledgerRef, {
        kind, delta: -(current - after), reason: `staff_adjustment:${staffEmail}`,
        refId: null, balanceAfter: after,
        at: admin.firestore.FieldValue.serverTimestamp()
      });
      return after;
    });
  }
  console.log(`adjustCredits: ${kind} delta=${delta} uid=${uid} by ${staffEmail}, newBalance=${newBalance}`);
  return { ok: true, newBalance };
});

// ====================================================================
// banUser — staff-only: disable or re-enable a user account.
// Sets banned:true on Firestore doc and disables Firebase Auth.
// ====================================================================
exports.banUser = onCall({ region: REGION }, async (request) => {
  const staffEmail = assertStaff(request.auth);
  const { uid, banned } = request.data || {};
  if (!uid || typeof banned !== "boolean") {
    throw new HttpsError("invalid-argument", "uid and banned (boolean) are required.");
  }
  await Promise.all([
    admin.auth().updateUser(uid, { disabled: banned }),
    admin.firestore().doc(`users/${uid}`).update({ banned })
  ]);
  console.log(`banUser: uid=${uid} banned=${banned} by ${staffEmail}`);
  return { ok: true, uid, banned };
});

// ====================================================================
// listLoopClaims — staff-only: all maker↔puller claim links
// ====================================================================
exports.listLoopClaims = onCall({ region: REGION }, async (request) => {
  assertStaff(request.auth);
  const db   = admin.firestore();
  const snap = await db.collection("loopClaims").get();
  const claims = snap.docs.map(d => {
    const c = d.data();
    return {
      id:        d.id,
      loopId:    c.loopId,
      makerUid:  c.makerUid,
      pullerUid: c.pullerUid,
      status:    c.status || "pending",
      createdAt: c.createdAt?.toMillis ? c.createdAt.toMillis() : null
    };
  });
  claims.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { claims };
});

// ====================================================================
// initStaffClaim — stamps isStaff:true on the caller's Auth token so
// Firestore rules can allow cross-user reads without exposing emails.
// assertStaff guards the gate — non-staff get permission-denied.
// ====================================================================
exports.initStaffClaim = onCall({ region: REGION }, async (request) => {
  assertStaff(request.auth);
  await admin.auth().setCustomUserClaims(request.auth.uid, { isStaff: true });
  console.log(`isStaff claim stamped for ${request.auth.uid}`);
  return { ok: true };
});

// ====================================================================
// getPlayUrls — staff-only: generate 2-hour signed playback URLs for
// a single campaign's beats. Called lazily when a new campaign arrives
// via onSnapshot and isn't yet in the client's play-URL cache.
// ====================================================================
exports.getPlayUrls = onCall({ region: REGION }, async (request) => {
  assertStaff(request.auth);
  const { path } = request.data || {};
  if (!path || !/^users\/[^/]+\/campaigns\/[^/]+$/.test(path))
    throw new HttpsError("invalid-argument", "Invalid campaign path.");
  const snap = await admin.firestore().doc(path).get();
  if (!snap.exists) throw new HttpsError("not-found", "Campaign not found.");
  const storage = admin.storage().bucket();
  const beats = await Promise.all((snap.data().beats || []).map(async (b) => {
    let playUrl = null;
    if (b.storagePath) {
      try {
        const [url] = await storage.file(b.storagePath)
          .getSignedUrl({ action: "read", expires: Date.now() + 2 * 60 * 60 * 1000 });
        playUrl = url;
      } catch { /* file missing — ignore */ }
    }
    return { ...b, playUrl };
  }));
  return { beats };
});

// ====================================================================
// getLoopPlayUrls — verifiedPuller-only: 2-hour signed playback URLs for
// a batch of live loops. Called lazily by the Verified loop pool when
// loops arrive via onSnapshot and aren't yet in the client's URL cache.
// ====================================================================
exports.getLoopPlayUrls = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const uid = request.auth.uid;
  const db      = admin.firestore();
  const storage = admin.storage().bucket();

  const pullerSnap = await db.doc(`users/${uid}`).get();
  if (!pullerSnap.get("verifiedPuller"))
    throw new HttpsError("permission-denied", "Only verified pullers can preview loops.");

  const { loopIds } = request.data || {};
  if (!Array.isArray(loopIds) || loopIds.length === 0) return { urls: {} };

  const urls = {};
  await Promise.all(loopIds.slice(0, 100).map(async (id) => {
    if (typeof id !== "string") return;
    try {
      const snap = await db.doc(`loops/${id}`).get();
      const path = snap.exists ? snap.get("storagePath") : null;
      if (!path) return;
      const [url] = await storage.file(path)
        .getSignedUrl({ action: "read", expires: Date.now() + 2 * 60 * 60 * 1000 });
      urls[id] = url;
    } catch (e) { console.warn("Signed URL failed for loop", id, e.message); }
  }));
  return { urls };
});

// stripeWebhook — verifies signature, applies subscription/pack effects
exports.stripeWebhook = onRequest(
  { region: REGION, secrets: [STRIPE_SECRET, STRIPE_WEBHOOK_SECRET] },
  async (req, res) => {
    const stripe = Stripe(STRIPE_SECRET.value());
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody, req.header("stripe-signature"), STRIPE_WEBHOOK_SECRET.value());
    } catch (e) {
      console.error("Stripe signature verification failed:", e.message);
      res.status(400).send(`Webhook Error: ${e.message}`);
      return;
    }

    const db = admin.firestore();
    try {
      if (event.type === "checkout.session.completed") {
        const s = event.data.object;
        const uid = s.metadata?.uid;
        if (uid && s.metadata?.kind === "pack") {
          const def = PACK_CREDITS[s.metadata.pack];
          if (def?.amount) await grantCredits(uid, def.kind, def.amount, "pack_purchase", s.id);
          console.log(`Pack ${s.metadata.pack}: +${def?.amount || 0} ${def?.kind || "?"} credits to ${uid}`);
        } else if (uid && s.metadata?.kind === "subscription") {
          const tier = s.metadata.tier;
          await db.doc(`users/${uid}`).update({
            "subscription.tier":      tier,
            "subscription.status":    "active",
            "subscription.stripeSubId": s.subscription || null
          });
          console.log(`Subscription ${tier} activated for ${uid}`);
          // First-period credits are granted by the invoice.paid below.
        }
      }

      else if (event.type === "invoice.paid") {
        const inv = event.data.object;
        // Scan ALL line items — proration invoices put credits first,
        // so lines.data[0] may not be the actual subscription price line.
        // Stripe moved the price id from line.price.id (old) to
        // line.pricing.price_details.price (2025+ API). Support both.
        const allLines = inv.lines?.data || [];
        let tier = null, periodEnd = null;
        for (const line of allLines) {
          const pid = line?.pricing?.price_details?.price || line?.price?.id || null;
          const t   = tierForPriceId(pid);
          if (t) { tier = t; periodEnd = line?.period?.end || null; break; }
        }
        console.log(`invoice.paid: tier=${tier} periodEnd=${periodEnd}`);
        if (tier) {
          const uid = await uidForCustomer(stripe, inv.customer);
          if (uid) {
            await db.doc(`users/${uid}`).update({
              "subscription.tier":     tier,
              "subscription.status":   "active",
              "subscription.renewsAt": periodEnd
                ? admin.firestore.Timestamp.fromMillis(periodEnd * 1000) : null
            });
            await applyMonthlyGrants(uid, tier, periodEnd || null);
            console.log(`invoice.paid: granted ${tier} credits to ${uid}`);
          }
        }
      }

      else if (event.type === "customer.subscription.updated") {
        // Handles external changes (Stripe dashboard, billing portal, etc.)
        const sub = event.data.object;
        if (sub.status === "active" || sub.status === "trialing") {
          const uid = await uidForCustomer(stripe, sub.customer);
          if (uid) {
            const priceId = sub.items?.data?.[0]?.price?.id;
            const tier    = tierForPriceId(priceId);
            if (tier) {
              await db.doc(`users/${uid}`).update({
                "subscription.tier":      tier,
                "subscription.status":    "active",
                "subscription.stripeSubId": sub.id
              });
              console.log(`subscription.updated: ${uid} tier=${tier}`);
            }
          }
        }
      }

      else if (event.type === "customer.subscription.deleted") {
        const sub = event.data.object;
        const uid = await uidForCustomer(stripe, sub.customer);
        if (uid) {
          await db.doc(`users/${uid}`).update({
            "subscription.tier":            "free",
            "subscription.status":          "canceled",
            "subscription.stripeSubId":     null,
            "pitchCredits.monthlyGrant":    0,
            "loopCredits.monthlyGrant":     TIER_GRANTS.free.loop
          });
          console.log(`Subscription canceled — ${uid} downgraded to free`);
        }
      }
    } catch (e) {
      console.error("stripeWebhook handler error:", e.message);
      res.status(500).send("handler error");
      return;
    }

    res.status(200).send("ok");
  }
);
