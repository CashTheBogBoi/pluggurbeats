const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onRequest }         = require("firebase-functions/v2/https");
const { defineSecret }      = require("firebase-functions/params");
const admin                 = require("firebase-admin");
const JSZip                 = require("jszip");
const { Resend }            = require("resend");
const { Webhook }           = require("svix");
const contacts              = require("./contacts.json");

admin.initializeApp();

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
// pitchCampaign — zips beats, emails each contact a tracked link
// ====================================================================
exports.pitchCampaign = onDocumentCreated(
  { document: "users/{uid}/campaigns/{campaignId}", region: REGION, secrets: [RESEND_API_KEY] },
  async (event) => {
    const snap     = event.data;
    const { uid, campaignId } = event.params;
    const campaign = snap.data();
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

      // Index the Resend email id -> same recipient so webhook opens resolve
      const emailId = sent?.data?.id;
      if (emailId) await db.collection("emailIndex").doc(emailId).set(recipient);
      return { to, emailId };
    }));

    results.forEach(r => {
      if (r.status === "rejected") console.error("Email failed:", r.reason);
    });

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
