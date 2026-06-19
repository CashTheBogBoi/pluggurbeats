const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret }      = require("firebase-functions/params");
const admin                 = require("firebase-admin");
const { Resend }            = require("resend");
const contacts              = require("./contacts.json");

admin.initializeApp();

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");

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

exports.pitchCampaign = onDocumentCreated(
  { document: "users/{uid}/campaigns/{campaignId}", secrets: [RESEND_API_KEY] },
  async (event) => {
    const snap     = event.data;
    const { uid, campaignId } = event.params;
    const campaign = snap.data();
    const storage  = admin.storage().bucket();
    const resend   = new Resend(RESEND_API_KEY.value());

    const producer = campaign.producer || {};
    const beats    = campaign.beats    || [];
    const targets  = campaign.targets  || [];
    const zipPath  = campaign.zipPath;

    if (!zipPath) {
      console.log("No zip on campaign", campaignId);
      return;
    }

    // Resolve unique lanes from selected targets, then collect emails
    const lanes = [...new Set(targets.map(t => TARGET_LANE_MAP[t]).filter(Boolean))];
    const emailSet = new Set();
    lanes.forEach(lane => (contacts[lane] || []).forEach(e => emailSet.add(e)));
    (contacts["All"] || []).forEach(e => emailSet.add(e));
    const emails = [...emailSet];

    if (emails.length === 0) {
      console.log("No contacts mapped for lanes:", lanes);
      await snap.ref.update({ status: "no_contacts" });
      return;
    }

    // Generate a 30-day signed download link for the already-uploaded zip
    const [downloadUrl] = await storage.file(zipPath).getSignedUrl({
      action:  "read",
      expires: Date.now() + 30 * 24 * 60 * 60 * 1000
    });

    const beatListHtml  = beats
      .map(b => `<li><strong>${b.title}</strong> — ${b.genre || ""}${b.bpm ? `, ${b.bpm} BPM` : ""}${b.key ? `, ${b.key}` : ""}</li>`)
      .join("");
    const packageLabel  = { starter: "Starter", pro: "Pro", label: "Label" }[campaign.package] || campaign.package;

    await Promise.all(emails.map(to =>
      resend.emails.send({
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
              Link expires in 30 days. To opt out of future pitches reply with "unsubscribe".<br>
              Powered by <a href="https://pluggurbeat.com" style="color:#C9A24B">PluggurBeats</a>
            </p>
          </div>`
      })
    ));

    await snap.ref.update({
      status:    "pitched",
      pitchedAt: admin.firestore.FieldValue.serverTimestamp(),
      pitchedTo: emails
    });

    console.log(`Campaign ${campaignId}: pitched ${beats.length} beats to ${emails.length} contacts`);
  }
);
