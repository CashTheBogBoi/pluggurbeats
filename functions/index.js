const { onDocumentUpdated }    = require("firebase-functions/v2/firestore");
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret }         = require("firebase-functions/params");
const admin                    = require("firebase-admin");
const JSZip                    = require("jszip");
const { Resend }               = require("resend");
const { Webhook }              = require("svix");
const contacts                 = require("./contacts.json");
const staffConfig              = require("./staff.json");

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

const RESEND_API_KEY        = defineSecret("RESEND_API_KEY");
const RESEND_WEBHOOK_SECRET = defineSecret("RESEND_WEBHOOK_SECRET");

// Region kept explicit so the email links below are deterministic
const REGION  = "us-central1";
const PROJECT = "pluggurbeats";
const FN_BASE = `https://${REGION}-${PROJECT}.cloudfunctions.net`;

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
    return { ok: true, status: decision };
  }
);
