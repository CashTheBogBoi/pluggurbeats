const { onDocumentUpdated }    = require("firebase-functions/v2/firestore");
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret }         = require("firebase-functions/params");
const admin                    = require("firebase-admin");
const crypto                   = require("crypto");
const JSZip                    = require("jszip");
const { Resend }               = require("resend");
const { Webhook }              = require("svix");
const Stripe                   = require("stripe");
const docusign                 = require("docusign-esign");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const contacts                 = require("./contacts.json");
const staffConfig              = require("./staff.json");
const stripePrices             = require("./stripe-prices.json");

admin.initializeApp();

// Staff allowlist — emails permitted to access the moderation dashboard
const STAFF_EMAILS = (staffConfig.emails || []).map(e => e.toLowerCase());
function hasStaffAccess(auth) {
  const email = auth?.token?.email?.toLowerCase();
  const verified = auth?.token?.email_verified;
  return Boolean(email && verified && (STAFF_EMAILS.includes(email) || auth?.token?.staff === true));
}
function assertStaff(auth) {
  if (!hasStaffAccess(auth)) {
    throw new HttpsError("permission-denied", "Not authorized for staff access.");
  }
  return auth.token.email.toLowerCase();
}

const RESEND_API_KEY          = defineSecret("RESEND_API_KEY");
const RESEND_WEBHOOK_SECRET   = defineSecret("RESEND_WEBHOOK_SECRET");
const STRIPE_SECRET           = defineSecret("STRIPE_SECRET");
const STRIPE_WEBHOOK_SECRET   = defineSecret("STRIPE_WEBHOOK_SECRET");

// DocuSign (eSignature API, JWT grant). Set via `firebase functions:secrets:set`.
//   DOCUSIGN_INTEGRATION_KEY  integration (client) key / GUID
//   DOCUSIGN_USER_ID          API user GUID being impersonated
//   DOCUSIGN_ACCOUNT_ID       API account GUID
//   DOCUSIGN_PRIVATE_KEY      RSA private key (full PEM, including header/footer)
//   DOCUSIGN_OAUTH_HOST       account-d.docusign.com (demo) | account.docusign.com (prod)
//   DOCUSIGN_BASE_PATH        https://demo.docusign.net/restapi (demo) | https://NAx.docusign.net/restapi (prod)
//   DOCUSIGN_CONNECT_SECRET   shared token appended to the Connect webhook URL
const DOCUSIGN_INTEGRATION_KEY = defineSecret("DOCUSIGN_INTEGRATION_KEY");
const DOCUSIGN_USER_ID         = defineSecret("DOCUSIGN_USER_ID");
const DOCUSIGN_ACCOUNT_ID      = defineSecret("DOCUSIGN_ACCOUNT_ID");
const DOCUSIGN_PRIVATE_KEY     = defineSecret("DOCUSIGN_PRIVATE_KEY");
const DOCUSIGN_OAUTH_HOST      = defineSecret("DOCUSIGN_OAUTH_HOST");
const DOCUSIGN_BASE_PATH       = defineSecret("DOCUSIGN_BASE_PATH");
const DOCUSIGN_CONNECT_SECRET  = defineSecret("DOCUSIGN_CONNECT_SECRET");
const DS_SECRETS = [DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID, DOCUSIGN_ACCOUNT_ID, DOCUSIGN_PRIVATE_KEY, DOCUSIGN_OAUTH_HOST, DOCUSIGN_BASE_PATH];

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

function normalizeContact(entry) {
  if (typeof entry === "string") {
    return { email: entry, name: entry.split("@")[0] || "Verified contact" };
  }
  const email = String(entry?.email || "").trim().toLowerCase();
  if (!email) return null;
  return {
    email,
    name: String(entry?.name || email.split("@")[0] || "Verified contact").trim()
  };
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}

function normalizeBeatTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags
    .map((tag) => String(tag || "").trim().toLowerCase().replace(/^#/, ""))
    .filter(Boolean)
    .map((tag) => tag.slice(0, 40))
  )].slice(0, 8);
}

function contactIdForEmail(email) {
  return crypto.createHash("sha256").update(String(email).toLowerCase()).digest("hex").slice(0, 16);
}

function contactNameForEmail(email) {
  const target = String(email || "").trim().toLowerCase();
  if (!target) return "";
  for (const entries of Object.values(contacts)) {
    for (const entry of entries || []) {
      const contact = normalizeContact(entry);
      if (contact?.email === target) return contact.name || "";
    }
  }
  return "";
}

function publicContactIdentity(value) {
  if (!value) return null;
  if (typeof value === "string") {
    return {
      contactId: contactIdForEmail(value),
      viewerName: contactNameForEmail(value) || "Verified contact",
      viewerUsername: ""
    };
  }
  const fallbackEmail = value.contactEmail || value.contact || value.email || "";
  const contactId = value.contactId || (fallbackEmail ? contactIdForEmail(fallbackEmail) : "");
  if (!contactId && !value.viewerName && !value.viewerUsername) return null;
  return {
    contactId: contactId || "",
    viewerName: value.viewerName || value.contactName || contactNameForEmail(fallbackEmail) || "Verified contact",
    viewerUsername: value.viewerUsername || ""
  };
}

function publicEventIdentity(d) {
  const fallbackEmail = d.contactEmail || d.contact || "";
  return {
    type:           d.type,
    contactId:      d.contactId || (fallbackEmail ? contactIdForEmail(fallbackEmail) : ""),
    viewerName:     d.viewerName || d.contactName || contactNameForEmail(fallbackEmail) || "Verified contact",
    viewerUsername: d.viewerUsername || "",
    timestamp:      d.timestamp?.toMillis ? d.timestamp.toMillis() : null
  };
}

async function contactViewerIdentity(db, contact) {
  const email = contact.email.toLowerCase();
  let viewerName = contact.name || "Verified contact";
  let viewerUsername = "";
  try {
    const snap = await db.collection("users").where("email", "==", email).limit(1).get();
    if (!snap.empty) {
      const u = snap.docs[0].data();
      viewerName = u.displayName || contact.name || "Verified contact";
      viewerUsername = u.instagram || u.username || "";
      if (viewerUsername && !viewerUsername.startsWith("@")) viewerUsername = "@" + viewerUsername;
    }
  } catch (e) {
    console.warn("Contact user lookup failed:", email, e.message);
  }
  return {
    contactId: contactIdForEmail(email),
    viewerName,
    viewerUsername
  };
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

const RATE_LIMITS = {
  createSubscriptionCheckout: { limit: 10,  windowMs: 10 * 60 * 1000 },
  buyCreditPack:              { limit: 20,  windowMs: 10 * 60 * 1000 },
  submitCampaign:             { limit: 10,  windowMs: 60 * 60 * 1000 },
  submitLoop:                 { limit: 30,  windowMs: 60 * 60 * 1000 },
  pullLoop:                   { limit: 60,  windowMs: 60 * 60 * 1000 },
  downloadLibraryBeat:        { limit: 60,  windowMs: 60 * 60 * 1000 },
  getVerifiedPreviewUrl:      { limit: 180, windowMs: 60 * 1000 },
  generateSplitSheet:         { limit: 10,  windowMs: 60 * 60 * 1000 },
  refreshSplitSheetStatus:    { limit: 60,  windowMs: 10 * 60 * 1000 },
  recordLibraryView:          { limit: 120, windowMs: 60 * 1000 },
  listLiveLoops:              { limit: 120, windowMs: 60 * 1000 },
  listApprovedBeats:          { limit: 120, windowMs: 60 * 1000 },
  listCampaignRequests:       { limit: 120, windowMs: 60 * 1000 },
  recordCampaignRequestView:  { limit: 200, windowMs: 60 * 1000 },
  createCampaignRequest:      { limit: 20,  windowMs: 60 * 60 * 1000 },
  backfillVerifiedBeats:      { limit: 20,  windowMs: 60 * 1000 },
  listCampaignEmailEvents:    { limit: 120, windowMs: 60 * 1000 },
  checkStaffAccess:           { limit: 120, windowMs: 60 * 1000 },
  listReviewCampaigns:        { limit: 120, windowMs: 60 * 1000 },
  listUsers:                  { limit: 120, windowMs: 60 * 1000 },
  listLoopClaims:             { limit: 120, windowMs: 60 * 1000 },
  moderateCampaign:           { limit: 60,  windowMs: 60 * 1000 },
  setVerifiedPuller:          { limit: 60,  windowMs: 60 * 1000 },
  setVerifiedListener:        { limit: 60,  windowMs: 60 * 1000 },
  setVerifiedRole:            { limit: 60,  windowMs: 60 * 1000 },
  setStaffRole:               { limit: 30,  windowMs: 60 * 1000 },
  adjustCredits:              { limit: 60,  windowMs: 60 * 1000 },
  banUser:                    { limit: 30,  windowMs: 60 * 1000 },
  downloadBeats:              { limit: 120, windowMs: 60 * 60 * 1000 },
  default:                    { limit: 60,  windowMs: 60 * 1000 }
};

const VERIFIED_ROLES = new Set([
  "",
  "producer", "producer_plus", "producer_plusplus",
  "artist", "artist_plus", "artist_plusplus",
  "ar", "ar_plus", "ar_plusplus"
]);

function isArVerifiedRole(role) {
  return ["ar", "ar_plus", "ar_plusplus"].includes(role);
}

function verifiedRoleFamily(role) {
  if (["producer", "producer_plus", "producer_plusplus"].includes(role)) return "producer";
  if (["artist", "artist_plus", "artist_plusplus"].includes(role)) return "artist";
  if (isArVerifiedRole(role)) return "ar";
  return "";
}

function publicRoleLabel(role) {
  return ({
    producer: "Producer",
    producer_plus: "Producer+",
    producer_plusplus: "Producer++",
    artist: "Artist",
    artist_plus: "Artist+",
    artist_plusplus: "Artist++",
    ar: "A&R",
    ar_plus: "A&R+",
    ar_plusplus: "A&R++"
  })[role] || "";
}

function canTierSubmitToRole(tier, role) {
  const allowed = {
    free: new Set(["producer"]),
    plugg: new Set(["producer", "producer_plus", "artist", "artist_plus", "ar"]),
    pro: new Set(["producer", "producer_plus", "producer_plusplus", "artist", "artist_plus", "artist_plusplus", "ar", "ar_plus", "ar_plusplus"])
  };
  return (allowed[tier] || allowed.free).has(role);
}

function cleanShortString(value, max = 80) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanStringList(value, maxItems = 8, maxLen = 40) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => cleanShortString(item, maxLen))
    .filter(Boolean)
  )].slice(0, maxItems);
}

function publicCampaignRequest(docSnap, viewerUid = "") {
  const r = docSnap.data();
  return {
    id: docSnap.id,
    createdByUid: r.createdByUid || "",
    createdByName: r.createdByName || "Verified user",
    createdByPhotoURL: r.createdByPhotoURL || "",
    createdByRole: r.createdByRole || "",
    createdByRoleLabel: publicRoleLabel(r.createdByRole || ""),
    createdByLocation: r.createdByLocation || "",
    labelName: r.labelName || "",
    requestType: r.requestType || "loops",
    title: r.title || "",
    brief: r.brief || "",
    genres: Array.isArray(r.genres) ? r.genres : [],
    tags: Array.isArray(r.tags) ? r.tags : [],
    references: Array.isArray(r.references) ? r.references : [],
    deadline: r.deadline || "",
    status: r.status || "open",
    viewCount: r.viewCount || 0,
    submissionCount: r.submissionCount || 0,
    approvedSubmissionCount: r.approvedSubmissionCount || 0,
    emailSentCount: r.emailSentCount || 0,
    createdAt: r.createdAt?.toMillis ? r.createdAt.toMillis() : null,
    updatedAt: r.updatedAt?.toMillis ? r.updatedAt.toMillis() : null,
    isMine: viewerUid && r.createdByUid === viewerUid
  };
}

function rateLimitDocId(parts) {
  return crypto.createHash("sha256").update(parts.filter(Boolean).join(":")).digest("hex");
}

async function consumeRateLimit(name, identity, cfg = RATE_LIMITS[name] || RATE_LIMITS.default) {
  const now = Date.now();
  const windowStart = Math.floor(now / cfg.windowMs) * cfg.windowMs;
  const docId = rateLimitDocId([name, identity, String(windowStart)]);
  const ref = admin.firestore().doc(`rateLimits/${docId}`);

  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? (snap.get("count") || 0) : 0;
    if (count >= cfg.limit) {
      return {
        allowed: false,
        retryAfterMs: Math.max(1000, windowStart + cfg.windowMs - now)
      };
    }
    tx.set(ref, {
      name,
      count: count + 1,
      windowStart: admin.firestore.Timestamp.fromMillis(windowStart),
      expiresAt: admin.firestore.Timestamp.fromMillis(windowStart + cfg.windowMs + 24 * 60 * 60 * 1000),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return { allowed: true, retryAfterMs: 0 };
  });
}

async function assertCallableRateLimit(name, request, identity = null) {
  const key = identity || request.auth?.uid || request.auth?.token?.email || request.rawRequest?.ip || "anonymous";
  const result = await consumeRateLimit(name, key);
  if (!result.allowed) {
    throw new HttpsError(
      "resource-exhausted",
      "Too many requests. Please wait a bit and try again.",
      { retryAfterMs: result.retryAfterMs }
    );
  }
}

async function allowHttpRequest(name, req, identityParts = []) {
  const key = [...identityParts, req.ip || req.headers["x-forwarded-for"] || "unknown"].join(":");
  return consumeRateLimit(name, key);
}

function verifiedBeatDocId(ownerUid, campaignId, beatIndex) {
  return `${ownerUid}_${campaignId}_${beatIndex}`;
}

function publicBeatFromCampaignDoc(docSnap, campaign, beat, beatIndex, ownerUid = null) {
  const producer = campaign.producer || {};
  const resolvedOwnerUid = ownerUid || docSnap.ref.path.split("/")[1];
  const pitchedAt = campaign.pitchedAt?.toMillis ? campaign.pitchedAt.toMillis() : null;
  const addons = Array.isArray(campaign.addons) ? campaign.addons : [];
  const tier = campaign.tier || "free";
  return {
    id:         verifiedBeatDocId(resolvedOwnerUid, docSnap.id, beatIndex),
    campaignId: docSnap.id,
    ownerUid:   resolvedOwnerUid,
    beatIndex,
    title:      beat.title  || "Untitled",
    genre:      beat.genre  || "",
    key:        beat.key    || "",
    bpm:        beat.bpm    || "",
    tags:       normalizeBeatTags(beat.tags),
    producer:   { name: producer.name || "", instagram: producer.instagram || "" },
    tier,
    isPro:     tier === "pro",
    rush:      addons.includes("rush"),
    pitchedAt,
    storagePath: beat.storagePath || ""
  };
}

function campaignRush(addons = []) {
  return Array.isArray(addons) && addons.includes("rush");
}

function reviewAgeHours(createdAt) {
  if (!createdAt) return 0;
  return Math.max(0, (Date.now() - Number(createdAt)) / (60 * 60 * 1000));
}

function reviewPriorityMeta(campaign) {
  if (campaign.status !== "pending_review") {
    return { ageHours: reviewAgeHours(campaign.createdAt), thresholdHours: 0, timeSensitive: false, label: "" };
  }
  const ageHours = reviewAgeHours(campaign.createdAt);
  if (ageHours >= 48) {
    return { ageHours, thresholdHours: 48, timeSensitive: true, label: "48h priority" };
  }
  if (campaign.rush && ageHours >= 24) {
    return { ageHours, thresholdHours: 24, timeSensitive: true, label: "Rush 24h" };
  }
  return { ageHours, thresholdHours: 0, timeSensitive: false, label: "" };
}

function reviewPriority(campaign) {
  if (campaign.status !== "pending_review") return 0;
  const meta = reviewPriorityMeta(campaign);
  if (meta.timeSensitive) {
    return 10000 + Math.min(Math.max(0, meta.ageHours - meta.thresholdHours), 96);
  }
  let score = 1000;
  if (campaign.rush) score += 200;
  if (campaign.tier === "pro") score += 60;
  score += Math.min(meta.ageHours, 72);
  return score;
}

function beatSearchText(beat, producer = {}) {
  return [
    beat.title,
    beat.genre,
    beat.key,
    beat.bpm,
    ...(Array.isArray(beat.tags) ? beat.tags : []),
    producer.name,
    producer.instagram,
    ...(Array.isArray(beat.collabs) ? beat.collabs.flatMap((c) => [c.name, c.instagram, c.role]) : [])
  ].filter(Boolean).join(" ").toLowerCase().slice(0, 2000);
}

function stableScore(seed) {
  const hex = crypto.createHash("sha256").update(String(seed)).digest("hex").slice(0, 12);
  return parseInt(hex, 16) / 0xffffffffffff;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isOwnUuidBeatPath(uid, storagePath) {
  const uuid = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";
  return new RegExp(`^beats/${escapeRegExp(uid)}/${uuid}/beats/${uuid}/[^/]+\\.mp3$`, "i").test(String(storagePath || ""));
}

function isOwnLoopPath(uid, storagePath) {
  const value = String(storagePath || "");
  return value.startsWith(`loops/${uid}/`) && !value.includes("..") && /\.mp3$/i.test(value);
}

async function assertMp3StorageObject(storage, storagePath) {
  const file = storage.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError("not-found", "Uploaded audio file was not found.");
  const [meta] = await file.getMetadata();
  const contentType = String(meta.contentType || "").toLowerCase();
  if (contentType !== "audio/mpeg") {
    throw new HttpsError("invalid-argument", "Only .mp3 audio files can be uploaded.");
  }
  return meta;
}

function publicVerifiedBeat(docSnap) {
  const b = docSnap.data();
  return {
    id: docSnap.id,
    campaignId: b.campaignId,
    ownerUid: b.ownerUid,
    beatIndex: b.beatIndex,
    title: b.title || "Untitled",
    genre: b.genre || "",
    key: b.key || "",
    bpm: b.bpm || "",
    tags: normalizeBeatTags(b.tags),
    producer: {
      name: b.producer?.name || "",
      instagram: b.producer?.instagram || ""
    },
    tier: b.tier || "free",
    isPro: b.isPro === true,
    rush: b.rush === true,
    pitchedAt: b.pitchedAt?.toMillis ? b.pitchedAt.toMillis() : null,
    storagePath: b.storagePath || ""
  };
}

function weightedRecentBeats(pageDocs, limit) {
  const today = new Date().toISOString().slice(0, 10);
  const ranked = pageDocs
    .map((d) => ({ doc: d, data: d.data(), score: stableScore(`${today}:${d.id}`) }))
    .sort((a, b) => a.score - b.score);
  const pro = ranked.filter((x) => x.data.isPro === true);
  const other = ranked.filter((x) => x.data.isPro !== true);
  const out = [];
  let p = 0, o = 0;
  while (out.length < limit && (p < pro.length || o < other.length)) {
    const slot = out.length % 5;
    const preferPro = slot < 3; // 3 of every 5 = 60% when inventory exists.
    if (preferPro && p < pro.length) out.push(pro[p++].doc);
    else if (!preferPro && o < other.length) out.push(other[o++].doc);
    else if (p < pro.length) out.push(pro[p++].doc);
    else if (o < other.length) out.push(other[o++].doc);
  }
  return out;
}

async function recentWeightedVerifiedDocs(db, { genreFilter, tagFilter, limit }) {
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const poolLimit = Math.min(Math.max(limit * 8, 120), 300);
  let q = db.collection("verifiedBeats").where("pitchedAt", ">=", cutoff);
  if (genreFilter) q = q.where("genre", "==", genreFilter);
  if (tagFilter) q = q.where("tags", "array-contains", tagFilter);
  q = q.orderBy("pitchedAt", "desc").limit(poolLimit);
  const snap = await q.get();
  if (snap.empty) return null;
  const orderedPage = snap.docs.slice(0, limit);
  const weightedPage = weightedRecentBeats(orderedPage, limit);
  const last = orderedPage[orderedPage.length - 1]?.data();
  return {
    docs: weightedPage,
    hasMore: snap.docs.length > limit || Boolean(last),
    nextCursor: last?.pitchedAt?.toMillis ? { pitchedAt: last.pitchedAt.toMillis() } : null
  };
}

async function resolveVerifiedBeatFile(db, ownerUid, campaignId, beatIndex, requestedStoragePath = "") {
  let title = "Beat";
  let storagePath = "";
  const indexed = await db.collection("verifiedBeats").doc(verifiedBeatDocId(ownerUid, campaignId, beatIndex)).get();
  if (indexed.exists) {
    storagePath = indexed.get("storagePath") || "";
    title = indexed.get("title") || title;
  }
  if (!storagePath) {
    const camp = await db.doc(`users/${ownerUid}/campaigns/${campaignId}`).get();
    if (!camp.exists || camp.get("status") !== "pitched") throw new HttpsError("not-found", "Beat not in library.");
    const beat = (camp.get("beats") || [])[beatIndex];
    storagePath = beat?.storagePath || "";
    title = beat?.title || title;
    if (storagePath) indexVerifiedBeats(db, ownerUid, campaignId, camp.data(), camp.get("pitchedAt")).catch(() => {});
  }
  if (!storagePath) throw new HttpsError("not-found", "Beat file missing.");
  if (requestedStoragePath && requestedStoragePath !== storagePath) {
    throw new HttpsError("permission-denied", "Beat file mismatch.");
  }
  return { title, storagePath };
}

function setCors(req, res) {
  const origin = req.headers.origin || "";
  const allowed = new Set([
    "https://pluggurbeat.com",
    "https://www.pluggurbeat.com",
    "https://pluggurbeats.web.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173"
  ]);
  if (allowed.has(origin)) res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Expose-Headers", "Content-Disposition, Content-Length, Content-Type");
}

async function indexVerifiedBeats(db, ownerUid, campaignId, campaign, pitchedAtValue = null) {
  const producer = campaign.producer || {};
  const pitchedAt = pitchedAtValue || campaign.pitchedAt || admin.firestore.FieldValue.serverTimestamp();
  const tier = campaign.tier || "free";
  const rush = Array.isArray(campaign.addons) && campaign.addons.includes("rush");
  const batch = db.batch();
  (campaign.beats || []).forEach((beat, beatIndex) => {
    if (!beat?.storagePath) return;
    batch.set(db.collection("verifiedBeats").doc(verifiedBeatDocId(ownerUid, campaignId, beatIndex)), {
      ownerUid,
      campaignId,
      beatIndex,
      title: beat.title || "Untitled",
      genre: beat.genre || "",
      key: beat.key || "",
      bpm: beat.bpm || "",
      tags: normalizeBeatTags(beat.tags),
      producer: { name: producer.name || "", instagram: producer.instagram || "" },
      storagePath: beat.storagePath,
      searchText: beatSearchText(beat, producer),
      tier,
      isPro: tier === "pro",
      rush,
      pitchedAt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
  await batch.commit();
}

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

    // Plugg-tier campaigns, and Pro campaigns without selected desks, go
    // straight to the Verified library — no email blast.
    const producerTier = campaign.tier ||
      (await db.doc(`users/${uid}`).get()).get("subscription.tier") || "free";
    if (producerTier !== "pro" || targets.length === 0) {
      const pitchedAt = admin.firestore.Timestamp.now();
      await snap.ref.update({
        status:    "pitched",
        pitchedAt,
        pitchedTo: [],
        opens:     0,
        downloads: 0
      });
      await indexVerifiedBeats(db, uid, campaignId, campaign, pitchedAt);
      console.log(`Campaign ${campaignId}: added to Verified library (no email)`);
      return;
    }

    // Resolve unique lanes from selected targets, then collect contacts.
    const lanes = [...new Set(targets.map(t => TARGET_LANE_MAP[t]).filter(Boolean))];
    const byEmail = new Map();
    [...lanes, "All"].forEach(lane => (contacts[lane] || []).forEach(entry => {
      const contact = normalizeContact(entry);
      if (contact && !byEmail.has(contact.email)) byEmail.set(contact.email, contact);
    }));
    const recipients = [...byEmail.values()];
    console.log("Pitching campaign", campaignId, "to", recipients.length, "contacts");

    if (recipients.length === 0) {
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
      .map((b) => {
        const tags = normalizeBeatTags(b.tags);
        const meta = [b.genre, b.bpm ? `${b.bpm} BPM` : "", b.key].filter(Boolean).map(escapeHtml).join(", ");
        const tagHtml = tags.length
          ? `<div style="margin-top:4px;color:#555;font-size:13px">${tags.map((t) => `#${escapeHtml(t)}`).join(" ")}</div>`
          : "";
        return `<li><strong>${escapeHtml(b.title)}</strong>${meta ? ` — ${meta}` : ""}${tagHtml}</li>`;
      })
      .join("");
    const packageLabel = { starter: "Starter", pro: "Pro", label: "Label" }[campaign.package] || campaign.package;

    // Send one personalized email per contact. A token is generated up front so
    // the download link is unique per recipient ("by who"); after send we also
    // index the Resend email id so the webhook can attribute opens.
    const results = await Promise.allSettled(recipients.map(async (contact) => {
      const token   = db.collection("emailIndex").doc().id;   // unique per recipient
      const identity = await contactViewerIdentity(db, contact);
      const recipient = {
        uid,
        campaignId,
        contactEmail: contact.email,
        contactName: contact.name,
        ...identity,
        sentAt: admin.firestore.FieldValue.serverTimestamp()
      };
      await db.collection("emailIndex").doc(token).set(recipient);

      const downloadUrl = `${FN_BASE}/downloadBeats?e=${token}`;
      const sent = await resend.emails.send({
        from:    "PluggurBeats Pitching <pitching@pluggurbeat.com>",
        to:      contact.email,
        subject: `New beats from ${producer.name || "a producer"}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111;font-size:15px;line-height:1.6">
            <p>Hi,</p>
            <p>
              <strong>${producer.name || "A producer"}</strong>${producer.instagram ? ` (${producer.instagram})` : ""}
              submitted ${beats.length} beat${beats.length !== 1 ? "s" : ""} for your consideration.
            </p>
            <p><strong>Included:</strong></p>
            <ul>${beatListHtml}</ul>
            <p>Download: <a href="${downloadUrl}">${downloadUrl}</a></p>
            <p>Reply to pass or to opt out of future submissions.</p>
          </div>`
      });

      // Resend returns { data, error } — it does NOT throw on API errors
      // (e.g. unverified domain), so surface those explicitly.
      if (sent?.error) {
        console.error(`Resend rejected email to ${contact.email}:`, JSON.stringify(sent.error));
        return { to: contact.email, error: sent.error };
      }
      // Index the Resend email id -> same recipient so webhook opens resolve
      const emailId = sent?.data?.id;
      if (emailId) await db.collection("emailIndex").doc(emailId).set(recipient);
      console.log(`Email sent to ${contact.email} (id ${emailId})`);
      return { to: contact.email, emailId, publicContact: identity };
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

    const pitchedAt = admin.firestore.Timestamp.now();
    await snap.ref.update({
      status:    "pitched",
      pitchedAt,
      pitchedTo: results
        .filter(r => r.status === "fulfilled" && r.value.emailId)
        .map(r => r.value.publicContact),
      opens:     0,
      downloads: 0
    });
    await indexVerifiedBeats(db, uid, campaignId, campaign, pitchedAt);

    console.log(`Campaign ${campaignId}: pitched ${beats.length} beats to ${recipients.length} contacts`);
  }
);

// ====================================================================
// downloadBeats — logs who downloaded, then redirects to the ZIP
//   email link: /downloadBeats?e={emailId}
// ====================================================================
exports.downloadBeats = onRequest({ region: REGION }, async (req, res) => {
  const emailId = req.query.e;
  if (!emailId) { res.status(400).send("Missing token"); return; }
  const rate = await allowHttpRequest("downloadBeats", req, [String(emailId)]);
  if (!rate.allowed) {
    res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).send("Too many requests. Please wait a bit and try again.");
    return;
  }

  const db  = admin.firestore();
  const idx = await db.collection("emailIndex").doc(String(emailId)).get();
  if (!idx.exists) { res.status(404).send("Invalid or expired link"); return; }

  const { uid, campaignId, contactEmail, contact, contactId, viewerName, viewerUsername } = idx.data();
  const zipPath = `pitches/${uid}/${campaignId}/beats.zip`;
  const file    = admin.storage().bucket().file(zipPath);

  // Log the download event (attributed to the recipient this link was sent to)
  const campaignRef = db.doc(`users/${uid}/campaigns/${campaignId}`);
  await campaignRef.collection("events").add({
    type:           "downloaded",
    contactId:      contactId || contactIdForEmail(contactEmail || contact || String(emailId)),
    viewerName:     viewerName || "Verified contact",
    viewerUsername: viewerUsername || "",
    emailId:        String(emailId),
    timestamp:      admin.firestore.FieldValue.serverTimestamp()
  });
  await campaignRef.update({ downloads: admin.firestore.FieldValue.increment(1) });
  console.log(`Recorded download for campaign ${campaignId} (contact ${contactId || viewerName || "unknown"})`);

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

    const { uid, campaignId, contactEmail, contact, contactId, viewerName, viewerUsername } = idx.data();
    const campaignRef = db.doc(`users/${uid}/campaigns/${campaignId}`);

    const shortType = type.replace("email.", ""); // opened, clicked, delivered, bounced…
    await campaignRef.collection("events").add({
      type:           shortType,
      contactId:      contactId || contactIdForEmail(contactEmail || contact || emailId),
      viewerName:     viewerName || "Verified contact",
      viewerUsername: viewerUsername || "",
      emailId,
      timestamp:      admin.firestore.FieldValue.serverTimestamp()
    });

    // Bump the open counter on the campaign for quick stats
    if (shortType === "opened") {
      await campaignRef.update({ opens: admin.firestore.FieldValue.increment(1) });
    }

    console.log(`Recorded ${shortType} for campaign ${campaignId} (contact ${contactId || viewerName || "unknown"})`);
    res.status(200).send("ok");
  }
);

// ====================================================================
// listReviewCampaigns — staff-only: returns every campaign across all
// users with signed playback URLs for each beat, grouped client-side.
// ====================================================================
exports.listReviewCampaigns = onCall({ region: REGION }, async (request) => {
  assertStaff(request.auth);
  await assertCallableRateLimit("listReviewCampaigns", request);
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
          return publicEventIdentity(d);
        });
      } catch (e) { console.warn("Could not fetch events for", path, e.message); }
    }

    const status = c.status || "pending_review";
    const createdAt = c.createdAt?.toMillis ? c.createdAt.toMillis() : null;
    const rush = campaignRush(c.addons);
    const priorityMeta = reviewPriorityMeta({ status, createdAt, rush, tier: c.tier || "free" });

    return {
      path,
      uid,
      id:          doc.id,
      status,
      package:     c.package || "",
      tier:        c.tier || "free",
      addons:      Array.isArray(c.addons) ? c.addons : [],
      rush,
      reviewAgeHours: Math.round(priorityMeta.ageHours * 10) / 10,
      timeSensitive: priorityMeta.timeSensitive,
      priorityLabel: priorityMeta.label,
      pitches:     c.pitches || 0,
      producer:    c.producer || {},
      targets:     c.targets || [],
      beats,
      pitchedTo:   (c.pitchedTo || []).map(publicContactIdentity).filter(Boolean),
      opens:       c.opens || 0,
      downloads:   c.downloads || 0,
      events,
      createdAt,
      moderatedAt: c.moderatedAt?.toMillis ? c.moderatedAt.toMillis() : null
    };
  }));

  campaigns.sort((a, b) => {
    const priority = reviewPriority(b) - reviewPriority(a);
    if (priority) return priority;
    if (b.timeSensitive !== a.timeSensitive) return b.timeSensitive ? 1 : -1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
  return { campaigns };
});

exports.listCampaignEmailEvents = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  await assertCallableRateLimit("listCampaignEmailEvents", request);
  const uid = request.auth.uid;
  const { campaignId } = request.data || {};
  if (!campaignId || String(campaignId).includes("/")) {
    throw new HttpsError("invalid-argument", "campaignId is required.");
  }

  const db = admin.firestore();
  const campaignRef = db.doc(`users/${uid}/campaigns/${campaignId}`);
  const campaign = await campaignRef.get();
  if (!campaign.exists) throw new HttpsError("not-found", "Campaign not found.");

  const snap = await campaignRef.collection("events").get();
  const events = snap.docs.map((d) => publicEventIdentity(d.data()));
  return { events };
});

exports.checkStaffAccess = onCall({ region: REGION }, async (request) => {
  await assertCallableRateLimit("checkStaffAccess", request);
  return { staff: hasStaffAccess(request.auth) };
});

// ====================================================================
// moderateCampaign — staff-only: approve (→ triggers pitch) or reject.
// On rejection, emails the producer with the reason if their email is set.
// ====================================================================
exports.moderateCampaign = onCall(
  { region: REGION, secrets: [RESEND_API_KEY] },
  async (request) => {
    const staffEmail = assertStaff(request.auth);
    await assertCallableRateLimit("moderateCampaign", request);
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
          subject: "Your recent campaign submission",
          html: `
            <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111;font-size:15px;line-height:1.6">
              <p>Hi ${campaign.producer.name || "there"},</p>
              <p>Our team reviewed your campaign and we're unable to pitch it at this time.</p>
              ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
              ${note   ? `<p>${note}</p>` : ""}
              ${refunded ? `<p>${refunded} pitch credit${refunded !== 1 ? "s have" : " has"} been refunded to your account.</p>` : ""}
              <p>You're welcome to revise and resubmit. Reply to this email with any questions.</p>
              <p>— The PluggurBeats Team</p>
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
  await assertCallableRateLimit("listUsers", request);
  const db      = admin.firestore();
  const storage = admin.storage().bucket();

  const snap = await db.collection("users").get();
  const users = await Promise.all(snap.docs.map(async (doc) => {
    const u = doc.data();
    let avatarUrl = u.photoURL || null;
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
      verifiedRole:     u.verifiedRole || "",
      labelName:        u.labelName || "",
      staff:           u.staff === true || STAFF_EMAILS.includes(String(u.email || "").toLowerCase()),
      staffLocked:     STAFF_EMAILS.includes(String(u.email || "").toLowerCase()),
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
  await assertCallableRateLimit("setVerifiedPuller", request);
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

// createSubscriptionCheckout({ plan }) -> { url }
exports.createSubscriptionCheckout = onCall(
  { region: REGION, secrets: [STRIPE_SECRET] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    await assertCallableRateLimit("createSubscriptionCheckout", request);
    const uid  = request.auth.uid;
    const plan = request.data?.plan;
    if (!["plugg", "pro"].includes(plan)) throw new HttpsError("invalid-argument", "Unknown plan.");
    const priceId = stripePrices[plan];
    if (!priceId) throw new HttpsError("failed-precondition", "Plan price not configured.");

    const stripe   = Stripe(STRIPE_SECRET.value());
    const customer = await getOrCreateCustomer(stripe, uid);
    const session  = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { uid, kind: "subscription", tier: plan },
      success_url: "https://pluggurbeat.com/dashboard?sub=success",
      cancel_url:  "https://pluggurbeat.com/dashboard?sub=cancel"
    });
    return { url: session.url };
  }
);

// buyCreditPack({ pack }) -> { url }
exports.buyCreditPack = onCall(
  { region: REGION, secrets: [STRIPE_SECRET] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    await assertCallableRateLimit("buyCreditPack", request);
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
      success_url: "https://pluggurbeat.com/dashboard?pack=success",
      cancel_url:  "https://pluggurbeat.com/dashboard?pack=cancel"
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
const ANR_TARGET_IDS = new Set(["anr-major-trap","anr-major-pop","anr-indie","anr-sync","anr-mgmt"]);
const TIER_CAPS_FN = {
  free:  { beats:5,  lanes:0, anr:false },
  plugg: { beats:15, lanes:0, anr:false },
  pro:   { beats:25, lanes:5, anr:true  }
};

exports.submitCampaign = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  await assertCallableRateLimit("submitCampaign", request);
  const uid = request.auth.uid;
  const { producer, beats, targets, addons, targetRequestId } = request.data || {};

  if (!Array.isArray(targets))
    throw new HttpsError("invalid-argument", "Targets must be an array.");
  if (!Array.isArray(beats) || beats.length === 0)
    throw new HttpsError("invalid-argument", "Include at least one beat.");

  const db       = admin.firestore();
  const storage  = admin.storage().bucket();
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) throw new HttpsError("not-found", "User not found.");

  const tier = userSnap.get("subscription.tier") || "free";
  const cleanTargetRequestId = cleanShortString(targetRequestId, 80);
  let targetRequest = null;
  let targetRequestRef = null;
  if (cleanTargetRequestId) {
    targetRequestRef = db.collection("campaignRequests").doc(cleanTargetRequestId);
    const targetSnap = await targetRequestRef.get();
    if (!targetSnap.exists) throw new HttpsError("not-found", "Request not found.");
    targetRequest = targetSnap.data();
    if (targetRequest.status !== "open") throw new HttpsError("failed-precondition", "This request is no longer open.");
    if (!canTierSubmitToRole(tier, targetRequest.createdByRole || "")) {
      throw new HttpsError("permission-denied", `Your ${tier} plan cannot submit to ${publicRoleLabel(targetRequest.createdByRole)} requests.`);
    }
    if (!["beats", "both"].includes(targetRequest.requestType)) {
      throw new HttpsError("failed-precondition", "This request is for loops. Loop request submissions are coming next.");
    }
  }

  if (tier === "free" && !targetRequest)
    throw new HttpsError("permission-denied",
      "Campaigns require a Plugg or Pro subscription.");

  const caps = TIER_CAPS_FN[tier] || TIER_CAPS_FN.free;

  if (beats.length > caps.beats)
    throw new HttpsError("invalid-argument",
      `Your ${tier} plan allows up to ${caps.beats} beats per campaign.`);

  if (targets.length > caps.lanes)
    throw new HttpsError("invalid-argument",
      `Your ${tier} plan allows up to ${caps.lanes} lane${caps.lanes !== 1 ? "s" : ""} per campaign.`);

  const hasAnr = targets.some(t => ANR_TARGET_IDS.has(t));
  if (hasAnr && !caps.anr)
    throw new HttpsError("permission-denied",
      "A&R / management lanes require a Pro subscription.");

  for (const t of targets) {
    if (!TARGET_LANE_MAP[t]) throw new HttpsError("invalid-argument", `Unknown target: ${t}`);
  }
  const addonsArr = [...new Set(Array.isArray(addons) ? addons : [])]
    .filter((a) => ["rush", "feedback"].includes(a));
  // Recompute cost server-side — never trust client total.
  // 1 pitch credit per beat, plus 2 pitch credits for rush queue.
  const cost = beats.length + (addonsArr.includes("rush") ? 2 : 0);
  const cleanBeats = beats.map((b) => ({
    title: String(b?.title || "").trim().slice(0, 120),
    genre: String(b?.genre || "").trim().slice(0, 40),
    key: String(b?.key || "").trim().slice(0, 40),
    bpm: String(b?.bpm || "").trim().slice(0, 12),
    tags: normalizeBeatTags(b?.tags),
    storagePath: String(b?.storagePath || "").trim(),
    collabs: Array.isArray(b?.collabs) ? b.collabs.slice(0, 10).map((c) => ({
      name: String(c?.name || "").trim().slice(0, 120),
      role: String(c?.role || "").trim().slice(0, 60),
      instagram: String(c?.instagram || "").trim().slice(0, 80),
      phone: String(c?.phone || "").trim().slice(0, 40)
    })).filter((c) => c.name) : []
  })).filter((b) => b.title && b.storagePath);

  if (cleanBeats.length !== beats.length)
    throw new HttpsError("invalid-argument", "Every beat needs a title and uploaded file.");

  if (cleanBeats.some((b) => !isOwnUuidBeatPath(uid, b.storagePath))) {
    throw new HttpsError("permission-denied", "Beat files must be uploaded to your UUID campaign folder.");
  }

  await Promise.all(cleanBeats.map((b) => assertMp3StorageObject(storage, b.storagePath)));

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
      beats:      cleanBeats,
      targets:    targets,
      addons:     addonsArr,
      targetRequestId: targetRequestRef ? targetRequestRef.id : "",
      targetRequesterUid: targetRequest?.createdByUid || "",
      targetRequesterRole: targetRequest?.createdByRole || "",
      targetRequestType: targetRequest?.requestType || "",
      targetRequestTitle: targetRequest?.title || "",
      creditCost: cost,
      tier,
      status:     "pending_review",
      createdAt:  admin.firestore.FieldValue.serverTimestamp()
    });
    if (targetRequestRef) {
      tx.update(targetRequestRef, {
        submissionCount: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
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
    await assertCallableRateLimit("reconcileCredits", request);
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
  await assertCallableRateLimit("submitLoop", request);
  const uid = request.auth.uid;
  const { title, bpm, key, genre, tags, storagePath, targetRequestId } = request.data || {};

  if (!title || typeof title !== "string" || !title.trim())
    throw new HttpsError("invalid-argument", "title is required.");
  if (!storagePath || typeof storagePath !== "string")
    throw new HttpsError("invalid-argument", "storagePath is required.");
  if (!isOwnLoopPath(uid, storagePath))
    throw new HttpsError("permission-denied", "Loop files must be uploaded to your loop folder.");

  const db       = admin.firestore();
  const storage  = admin.storage().bucket();
  await assertMp3StorageObject(storage, storagePath);
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) throw new HttpsError("not-found", "User not found.");
  const makerName = userSnap.get("displayName") || "Unknown";
  const tier = userSnap.get("subscription.tier") || "free";
  const cleanTargetRequestId = cleanShortString(targetRequestId, 80);
  let targetRequest = null;
  let targetRequestRef = null;
  if (cleanTargetRequestId) {
    targetRequestRef = db.collection("campaignRequests").doc(cleanTargetRequestId);
    const targetSnap = await targetRequestRef.get();
    if (!targetSnap.exists) throw new HttpsError("not-found", "Request not found.");
    targetRequest = targetSnap.data();
    if (targetRequest.status !== "open") throw new HttpsError("failed-precondition", "This request is no longer open.");
    if (!canTierSubmitToRole(tier, targetRequest.createdByRole || "")) {
      throw new HttpsError("permission-denied", `Your ${tier} plan cannot submit to ${publicRoleLabel(targetRequest.createdByRole)} requests.`);
    }
    if (!["loops", "both"].includes(targetRequest.requestType)) {
      throw new HttpsError("failed-precondition", "This request is for beats. Start a beat campaign instead.");
    }
  }

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
    targetRequestId: targetRequestRef ? targetRequestRef.id : "",
    targetRequesterUid: targetRequest?.createdByUid || "",
    targetRequesterRole: targetRequest?.createdByRole || "",
    targetRequestType: targetRequest?.requestType || "",
    targetRequestTitle: targetRequest?.title || "",
    status:    "live",
    plays:     0,
    downloads: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  if (targetRequestRef) {
    await targetRequestRef.update({
      submissionCount: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

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
    await assertCallableRateLimit("pullLoop", request);
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
    // Log a download to the maker's verified-library activity feed
    batch.set(
      db.doc(`users/${loop.makerUid}/libraryActivity/download_loop_${loopId}_${uid}`),
      {
        kind: "loop", resourceId: `loop_${loopId}`, title: loop.title || "Loop",
        actorUid: uid, actorName: pullerSnap.get("displayName") || "A verified user",
        type: "download", count: admin.firestore.FieldValue.increment(1),
        lastAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
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
          subject: "Your loop was just pulled",
          html: `
            <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111;font-size:15px;line-height:1.6">
              <p>Hi ${loop.makerName || "there"},</p>
              <p><strong>${pullerName}</strong> just pulled your loop "<strong>${loop.title}</strong>" from the pool.</p>
              <p>A split-claim has been created. If the beat gets placed, your contribution is tracked through the paperwork flow.</p>
              <p>Log in to your dashboard to see your loop activity.</p>
              <p>— The PluggurBeats Team</p>
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
// listLiveLoops — verifiedPuller-only: returns a paginated live-loop metadata
// page. Preview URLs are intentionally lazy-loaded by getVerifiedPreviewUrl.
// ====================================================================
exports.listLiveLoops = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  await assertCallableRateLimit("listLiveLoops", request);
  const uid = request.auth.uid;
  const db = admin.firestore();
  const { pageSize = 50, cursor = null } = request.data || {};
  const limit = Math.min(Math.max(Number(pageSize) || 50, 1), 80);

  const pullerSnap = await db.doc(`users/${uid}`).get();
  if (!pullerSnap.get("verifiedPuller")) {
    throw new HttpsError("permission-denied", "Only verified pullers can browse the loop pool.");
  }

  let q = db.collection("loops")
    .where("status", "==", "live")
    .orderBy("createdAt", "desc")
    .limit(limit + 1);
  if (cursor?.createdAt) {
    q = q.startAfter(admin.firestore.Timestamp.fromMillis(Number(cursor.createdAt)));
  }

  const snap = await q.get();
  const pageDocs = snap.docs.slice(0, limit);
  const loops = pageDocs.map((d) => {
    const l = d.data();
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
      createdAt: l.createdAt?.toMillis ? l.createdAt.toMillis() : null
    };
  });

  const last = pageDocs[pageDocs.length - 1]?.data();
  return {
    loops,
    hasMore: snap.docs.length > limit,
    nextCursor: last?.createdAt?.toMillis ? { createdAt: last.createdAt.toMillis() } : null
  };
});

// ====================================================================
// listApprovedBeats — verifiedListener or verifiedPuller callable.
// Returns a paginated metadata page of individual verified beat docs. Preview
// URLs are lazy-loaded only when a verified user taps a beat.
// ====================================================================
exports.listApprovedBeats = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  await assertCallableRateLimit("listApprovedBeats", request);
  const uid = request.auth.uid;
  const db = admin.firestore();
  const { pageSize = 25, cursor = null, genre = "", tag = "" } = request.data || {};
  const limit = Math.min(Math.max(Number(pageSize) || 25, 1), 60);
  const genreFilter = String(genre || "").trim();
  const tagFilter = normalizeBeatTags([tag])[0] || "";

  const userSnap = await db.doc(`users/${uid}`).get();
  const ok = userSnap.get("verifiedListener") === true
          || userSnap.get("verifiedPuller")   === true;
  if (!ok) throw new HttpsError("permission-denied", "Verified access required.");

  if (!cursor?.pitchedAt) {
    const weighted = await recentWeightedVerifiedDocs(db, { genreFilter, tagFilter, limit });
    if (weighted) {
      return {
        beats: weighted.docs.map(publicVerifiedBeat),
        hasMore: weighted.hasMore,
        nextCursor: weighted.nextCursor
      };
    }
  }

  let indexedQ = db.collection("verifiedBeats");
  if (genreFilter) indexedQ = indexedQ.where("genre", "==", genreFilter);
  if (tagFilter) indexedQ = indexedQ.where("tags", "array-contains", tagFilter);
  indexedQ = indexedQ.orderBy("pitchedAt", "desc").limit(limit + 1);
  if (cursor?.pitchedAt) {
    indexedQ = indexedQ.startAfter(admin.firestore.Timestamp.fromMillis(Number(cursor.pitchedAt)));
  }

  const indexedSnap = await indexedQ.get();
  if (!indexedSnap.empty) {
    const pageDocs = indexedSnap.docs.slice(0, limit);
    const beats = pageDocs.map(publicVerifiedBeat);
    const last = pageDocs[pageDocs.length - 1]?.data();
    return {
      beats,
      hasMore: indexedSnap.docs.length > limit,
      nextCursor: last?.pitchedAt?.toMillis ? { pitchedAt: last.pitchedAt.toMillis() } : null
    };
  }

  const backfillState = await db.doc("system/verifiedBeatsBackfill").get();
  if (backfillState.get("completed") === true) {
    return { beats: [], hasMore: false, nextCursor: null };
  }

  // Migration fallback: old campaigns keep beat metadata embedded in the
  // campaign doc. Page campaigns, return that page, and opportunistically
  // backfill the individual verifiedBeats index for future requests.
  let q = db.collectionGroup("campaigns")
    .where("status", "==", "pitched")
    .orderBy("pitchedAt", "desc")
    .limit(limit + 1);
  if (cursor?.pitchedAt) {
    q = q.startAfter(admin.firestore.Timestamp.fromMillis(Number(cursor.pitchedAt)));
  }

  const snap = await q.get();
  const pageDocs = snap.docs.slice(0, limit);
  const beats = [];

  pageDocs.forEach((d) => {
    const c        = d.data();
    const ownerUid = d.ref.path.split("/")[1];
    indexVerifiedBeats(db, ownerUid, d.id, c, c.pitchedAt).catch((e) => {
      console.warn("Verified beat backfill failed", d.ref.path, e.message);
    });

    (c.beats || []).forEach((b, i) => {
      if (!b.storagePath) return;
      if (genreFilter && b.genre !== genreFilter) return;
      if (tagFilter && !normalizeBeatTags(b.tags).includes(tagFilter)) return;
      beats.push(publicBeatFromCampaignDoc(d, c, b, i, ownerUid));
    });
  });

  beats.sort((a, b) => (b.pitchedAt || 0) - (a.pitchedAt || 0));
  const last = pageDocs[pageDocs.length - 1]?.data();
  return {
    beats,
    hasMore: snap.docs.length > limit,
    nextCursor: last?.pitchedAt?.toMillis ? { pitchedAt: last.pitchedAt.toMillis() } : null
  };
});

// ====================================================================
// createCampaignRequest — verified public-role users can post opportunities.
// Producers can only request loops; Artists/A&Rs can request beats, loops, or both.
// Contact info is never stored on request docs.
// ====================================================================
exports.createCampaignRequest = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  await assertCallableRateLimit("createCampaignRequest", request);
  const uid = request.auth.uid;
  const db = admin.firestore();
  const me = await db.doc(`users/${uid}`).get();
  if (!me.exists) throw new HttpsError("not-found", "Profile not found.");
  const verifiedRole = String(me.get("verifiedRole") || "");
  const family = verifiedRoleFamily(verifiedRole);
  if (!family) throw new HttpsError("permission-denied", "A verified profile role is required to create requests.");
  if (!(me.get("verifiedListener") === true || me.get("verifiedPuller") === true)) {
    throw new HttpsError("permission-denied", "Verified access required.");
  }

  // Daily cap: 5 requests per user per UTC day, tracked in Firestore.
  const todayKey = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  const dailyRef = db.doc(`users/${uid}/requestDailyCounters/${todayKey}`);
  const dailySnap = await dailyRef.get();
  const dailyCount = dailySnap.exists ? (dailySnap.get("count") || 0) : 0;
  if (dailyCount >= 5) {
    throw new HttpsError("resource-exhausted", "You can post up to 5 requests per day. Try again tomorrow.");
  }

  const requestType = cleanShortString(request.data?.requestType, 12);
  const allowedTypes = family === "producer" ? ["loops"] : ["beats", "loops", "both"];
  if (!allowedTypes.includes(requestType)) {
    throw new HttpsError("invalid-argument", family === "producer"
      ? "Producer roles can only create loop requests."
      : "Request type must be beats, loops, or both.");
  }

  const title = cleanShortString(request.data?.title, 90);
  const brief = cleanShortString(request.data?.brief, 900);
  if (title.length < 4 || brief.length < 20) {
    throw new HttpsError("invalid-argument", "Add a clear title and briefing before posting.");
  }
  const deadline = cleanShortString(request.data?.deadline, 20);
  if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    throw new HttpsError("invalid-argument", "Deadline must use YYYY-MM-DD.");
  }

  const labelName = isArVerifiedRole(verifiedRole) ? cleanShortString(me.get("labelName"), 80) : "";
  const doc = {
    createdByUid: uid,
    createdByName: cleanShortString(me.get("displayName") || request.auth.token?.name || "Verified user", 80),
    createdByPhotoURL: cleanShortString(me.get("photoURL"), 500),
    createdByRole: verifiedRole,
    createdByLocation: cleanShortString(me.get("location"), 100),
    labelName,
    requestType,
    title,
    brief,
    genres: cleanStringList(request.data?.genres, 6, 32),
    tags: cleanStringList(request.data?.tags, 10, 32).map((t) => t.replace(/^#/, "").toLowerCase()),
    references: cleanStringList(request.data?.references, 8, 48),
    deadline,
    status: "open",
    visibility: "verified",
    viewCount: 0,
    submissionCount: 0,
    approvedSubmissionCount: 0,
    emailSentCount: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  const ref = await db.collection("campaignRequests").add(doc);

  // Increment daily counter (set with merge so first-of-day creates the doc).
  await dailyRef.set(
    { count: admin.firestore.FieldValue.increment(1), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  return {
    ok: true,
    request: {
      id: ref.id,
      createdByUid: uid,
      createdByName: doc.createdByName,
      createdByPhotoURL: doc.createdByPhotoURL,
      createdByRole: verifiedRole,
      createdByRoleLabel: publicRoleLabel(verifiedRole),
      labelName,
      requestType,
      title,
      brief,
      genres: doc.genres,
      tags: doc.tags,
      references: doc.references,
      deadline,
      status: "open",
      viewCount: 0,
      submissionCount: 0,
      approvedSubmissionCount: 0,
      emailSentCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isMine: true
    }
  };
});

// ====================================================================
// listCampaignRequests — verified users see public request feed + own analytics.
// Public identity is denormalized; requester contact info never leaves users docs.
// ====================================================================
exports.listCampaignRequests = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  await assertCallableRateLimit("listCampaignRequests", request);
  const uid = request.auth.uid;
  const db = admin.firestore();
  const me = await db.doc(`users/${uid}`).get();
  const isVerified = me.exists && (me.get("verifiedListener") === true || me.get("verifiedPuller") === true);
  const viewerTier = me.exists ? (me.data()?.subscription?.tier || "free") : "free";
  const isSubscriber = ["plugg", "pro"].includes(viewerTier);
  if (!me.exists || (!isVerified && !isSubscriber)) {
    throw new HttpsError("permission-denied", "Verified or subscriber access required.");
  }
  const limit = Math.min(Math.max(Number(request.data?.limit || 40), 1), 80);
  const snap = await db.collection("campaignRequests")
    .where("status", "==", "open")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  const requests = snap.docs.map((doc) => publicCampaignRequest(doc, uid));
  const mine = requests.filter((r) => r.isMine);
  return {
    requests,
    analytics: {
      mineOpen: mine.length,
      mineViews: mine.reduce((sum, r) => sum + (r.viewCount || 0), 0),
      mineSubmissions: mine.reduce((sum, r) => sum + (r.submissionCount || 0), 0),
      mineApproved: mine.reduce((sum, r) => sum + (r.approvedSubmissionCount || 0), 0),
      mineEmails: mine.reduce((sum, r) => sum + (r.emailSentCount || 0), 0)
    }
  };
});

// ====================================================================
// recordCampaignRequestView — counts one unique view per viewer on an open
// request. Deduped via a viewers/{uid} marker; the requester's own views and
// closed requests never increment the counter.
// ====================================================================
exports.recordCampaignRequestView = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  await assertCallableRateLimit("recordCampaignRequestView", request);
  const uid = request.auth.uid;
  const db = admin.firestore();
  const requestId = cleanShortString(request.data?.requestId, 80);
  if (!requestId) throw new HttpsError("invalid-argument", "Missing request id.");

  const reqRef = db.collection("campaignRequests").doc(requestId);
  const viewerRef = reqRef.collection("viewers").doc(uid);
  return db.runTransaction(async (tx) => {
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists || reqSnap.get("status") !== "open") return { ok: false };
    const current = reqSnap.get("viewCount") || 0;
    if (reqSnap.get("createdByUid") === uid) return { ok: true, viewCount: current, counted: false };
    const viewerSnap = await tx.get(viewerRef);
    if (viewerSnap.exists) return { ok: true, viewCount: current, counted: false };
    tx.set(viewerRef, { at: admin.firestore.FieldValue.serverTimestamp() });
    tx.update(reqRef, { viewCount: admin.firestore.FieldValue.increment(1) });
    return { ok: true, viewCount: current + 1, counted: true };
  });
});

// ====================================================================
// backfillVerifiedBeats — staff-only migration tool. Copies old pitched
// campaign beat metadata into verifiedBeats docs in small pages. This never
// renames or moves audio files; it preserves each beat.storagePath exactly.
// ====================================================================
exports.backfillVerifiedBeats = onCall({ region: REGION }, async (request) => {
  assertStaff(request.auth);
  await assertCallableRateLimit("backfillVerifiedBeats", request);
  const db = admin.firestore();
  const { pageSize = 25, cursor = null } = request.data || {};
  const limit = Math.min(Math.max(Number(pageSize) || 25, 1), 50);

  let q = db.collectionGroup("campaigns")
    .where("status", "==", "pitched")
    .orderBy("pitchedAt", "desc")
    .limit(limit + 1);
  if (cursor?.pitchedAt) {
    q = q.startAfter(admin.firestore.Timestamp.fromMillis(Number(cursor.pitchedAt)));
  }

  const snap = await q.get();
  const pageDocs = snap.docs.slice(0, limit);
  let beatCount = 0;
  for (const d of pageDocs) {
    const campaign = d.data();
    const ownerUid = d.ref.path.split("/")[1];
    beatCount += (campaign.beats || []).filter((b) => b?.storagePath).length;
    await indexVerifiedBeats(db, ownerUid, d.id, campaign, campaign.pitchedAt);
  }

  const last = pageDocs[pageDocs.length - 1]?.data();
  const hasMore = snap.docs.length > limit;
  if (!hasMore) {
    await db.doc("system/verifiedBeatsBackfill").set({
      completed: true,
      completedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }
  return {
    ok: true,
    campaignsProcessed: pageDocs.length,
    beatsIndexed: beatCount,
    hasMore,
    nextCursor: last?.pitchedAt?.toMillis ? { pitchedAt: last.pitchedAt.toMillis() } : null
  };
});

// ====================================================================
// getVerifiedPreviewUrl — returns a short-lived preview URL only after the
// listener chooses a specific beat/loop. Keeps list payloads tiny.
// ====================================================================
exports.getVerifiedPreviewUrl = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  await assertCallableRateLimit("getVerifiedPreviewUrl", request);
  const uid = request.auth.uid;
  const db = admin.firestore();
  const storage = admin.storage().bucket();
  const me = await db.doc(`users/${uid}`).get();
  const { kind } = request.data || {};

  if (kind === "beat") {
    if (!(me.get("verifiedListener") === true || me.get("verifiedPuller") === true)) {
      throw new HttpsError("permission-denied", "Verified access required.");
    }
    const { ownerUid, campaignId, beatIndex, storagePath } = request.data || {};
    if (!ownerUid || !campaignId || beatIndex == null) throw new HttpsError("invalid-argument", "Beat reference required.");
    const file = await resolveVerifiedBeatFile(db, ownerUid, campaignId, beatIndex, storagePath);
    const [url] = await storage.file(file.storagePath).getSignedUrl({ action: "read", expires: Date.now() + 2 * 60 * 60 * 1000 });
    return { ok: true, url };
  }

  if (kind === "loop") {
    if (me.get("verifiedPuller") !== true) {
      throw new HttpsError("permission-denied", "Only verified pullers can preview loops.");
    }
    const { loopId } = request.data || {};
    if (!loopId) throw new HttpsError("invalid-argument", "loopId required.");
    const loop = await db.doc(`loops/${loopId}`).get();
    if (!loop.exists || loop.get("status") !== "live") throw new HttpsError("not-found", "Loop not found.");
    const storagePath = loop.get("storagePath");
    if (!storagePath) throw new HttpsError("not-found", "Loop file missing.");
    const [url] = await storage.file(storagePath).getSignedUrl({ action: "read", expires: Date.now() + 2 * 60 * 60 * 1000 });
    return { ok: true, url };
  }

  throw new HttpsError("invalid-argument", "Unknown preview kind.");
});

// ====================================================================
// recordLibraryView — a verified user viewed (played) a beat or loop in the
// Verified library. Logs to the resource owner's libraryActivity feed so the
// producer can see who's checking out their work. One row per (actor,
// resource, type); repeated views bump count + lastAt.
// ====================================================================
exports.recordLibraryView = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  await assertCallableRateLimit("recordLibraryView", request);
  const uid = request.auth.uid;
  const db  = admin.firestore();
  const me  = await db.doc(`users/${uid}`).get();
  if (!(me.get("verifiedListener") === true || me.get("verifiedPuller") === true))
    throw new HttpsError("permission-denied", "Verified access required.");
  const actorName = me.get("displayName") || "A verified user";
  const { kind } = request.data || {};

  if (kind === "beat") {
    const { ownerUid, campaignId, beatIndex, title } = request.data || {};
    if (!ownerUid || !campaignId || beatIndex == null) throw new HttpsError("invalid-argument", "Beat reference required.");
    const camp = await db.doc(`users/${ownerUid}/campaigns/${campaignId}`).get();
    if (!camp.exists || camp.get("status") !== "pitched") throw new HttpsError("not-found", "Beat not in library.");
    const resourceId = `${campaignId}_${beatIndex}`;
    await db.doc(`users/${ownerUid}/libraryActivity/view_beat_${resourceId}_${uid}`).set({
      kind: "beat", resourceId, title: title || (camp.get("beats") || [])[beatIndex]?.title || "Beat",
      actorUid: uid, actorName, type: "view",
      count: admin.firestore.FieldValue.increment(1),
      lastAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return { ok: true };
  }

  if (kind === "loop") {
    const { loopId } = request.data || {};
    if (!loopId) throw new HttpsError("invalid-argument", "loopId required.");
    const loop = await db.doc(`loops/${loopId}`).get();
    if (!loop.exists) throw new HttpsError("not-found", "Loop not found.");
    const ownerUid = loop.get("makerUid");
    await db.doc(`users/${ownerUid}/libraryActivity/view_loop_${loopId}_${uid}`).set({
      kind: "loop", resourceId: `loop_${loopId}`, title: loop.get("title") || "Loop",
      actorUid: uid, actorName, type: "view",
      count: admin.firestore.FieldValue.increment(1),
      lastAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return { ok: true };
  }
  throw new HttpsError("invalid-argument", "Unknown kind.");
});

// ====================================================================
// downloadLibraryBeat — verified user downloads a library beat. Returns a
// short-lived signed URL and logs a download to the owner's activity feed.
// ====================================================================
exports.downloadLibraryBeat = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  await assertCallableRateLimit("downloadLibraryBeat", request);
  const uid = request.auth.uid;
  const db  = admin.firestore();
  const storage = admin.storage().bucket();
  const me  = await db.doc(`users/${uid}`).get();
  if (!(me.get("verifiedListener") === true || me.get("verifiedPuller") === true))
    throw new HttpsError("permission-denied", "Verified access required.");
  const { ownerUid, campaignId, beatIndex, storagePath } = request.data || {};
  if (!ownerUid || !campaignId || beatIndex == null) throw new HttpsError("invalid-argument", "Beat reference required.");
  const file = await resolveVerifiedBeatFile(db, ownerUid, campaignId, beatIndex, storagePath);
  const [url] = await storage.file(file.storagePath).getSignedUrl({ action: "read", expires: Date.now() + 60 * 60 * 1000 });
  const resourceId = `${campaignId}_${beatIndex}`;
  await db.doc(`users/${ownerUid}/libraryActivity/download_beat_${resourceId}_${uid}`).set({
    kind: "beat", resourceId, title: file.title,
    actorUid: uid, actorName: me.get("displayName") || "A verified user", type: "download",
    count: admin.firestore.FieldValue.increment(1),
    lastAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true, url };
});

exports.downloadVerifiedBeatFile = onRequest({ region: REGION }, async (req, res) => {
  setCors(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "GET") { res.status(405).send("Method not allowed"); return; }

  try {
    const rate = await allowHttpRequest("downloadLibraryBeat", req, [String(req.query.ownerUid || ""), String(req.query.campaignId || ""), String(req.query.beatIndex || "")]);
    if (!rate.allowed) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      res.status(429).send("Too many requests. Please wait a bit and try again.");
      return;
    }
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) { res.status(401).send("Missing auth token"); return; }
    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;
    const db = admin.firestore();
    const me = await db.doc(`users/${uid}`).get();
    if (!(me.get("verifiedListener") === true || me.get("verifiedPuller") === true)) {
      res.status(403).send("Verified access required.");
      return;
    }

    const ownerUid = String(req.query.ownerUid || "");
    const campaignId = String(req.query.campaignId || "");
    const beatIndex = Number(req.query.beatIndex);
    const requestedStoragePath = String(req.query.storagePath || "");
    if (!ownerUid || !campaignId || !Number.isInteger(beatIndex)) {
      res.status(400).send("Beat reference required.");
      return;
    }

    const fileInfo = await resolveVerifiedBeatFile(db, ownerUid, campaignId, beatIndex, requestedStoragePath);
    const file = admin.storage().bucket().file(fileInfo.storagePath);
    const [meta] = await file.getMetadata();
    const filename = fileInfo.storagePath.split("/").pop() || `${fileInfo.title || "beat"}.mp3`;
    const resourceId = `${campaignId}_${beatIndex}`;
    await db.doc(`users/${ownerUid}/libraryActivity/download_beat_${resourceId}_${uid}`).set({
      kind: "beat", resourceId, title: fileInfo.title || "Beat",
      actorUid: uid, actorName: me.get("displayName") || "A verified user", type: "download",
      count: admin.firestore.FieldValue.increment(1),
      lastAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.set("Content-Type", meta.contentType || "audio/mpeg");
    if (meta.size) res.set("Content-Length", String(meta.size));
    res.set("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
    file.createReadStream()
      .on("error", (e) => {
        console.error("downloadVerifiedBeatFile stream failed:", e.message);
        if (!res.headersSent) res.status(500).send("Could not download beat.");
        else res.end();
      })
      .pipe(res);
  } catch (e) {
    const code = e instanceof HttpsError && e.code === "permission-denied" ? 403 : 500;
    console.error("downloadVerifiedBeatFile failed:", e.message);
    res.status(code).send(e.message || "Could not download beat.");
  }
});

// ====================================================================
// setVerifiedListener — staff-only: grant/revoke A&R / artist access
// to the Verified beat library and Loop Pool.
// ====================================================================
exports.setVerifiedListener = onCall({ region: REGION }, async (request) => {
  const staffEmail = assertStaff(request.auth);
  await assertCallableRateLimit("setVerifiedListener", request);
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
// setVerifiedRole — staff-only: assign public verified identity role.
// Paid plan remains separate in subscription.tier.
// ====================================================================
exports.setVerifiedRole = onCall({ region: REGION }, async (request) => {
  const staffEmail = assertStaff(request.auth);
  await assertCallableRateLimit("setVerifiedRole", request);
  const { uid } = request.data || {};
  const verifiedRole = String(request.data?.verifiedRole || "").trim();
  const labelName = String(request.data?.labelName || "").trim().slice(0, 80);
  if (!uid || !VERIFIED_ROLES.has(verifiedRole)) {
    throw new HttpsError("invalid-argument", "uid and a valid verified role are required.");
  }
  if (labelName && !isArVerifiedRole(verifiedRole)) {
    throw new HttpsError("invalid-argument", "Label names are only available for A&R roles.");
  }
  const ref = admin.firestore().doc(`users/${uid}`);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "User not found.");
  await ref.set({
    verifiedRole,
    labelName: isArVerifiedRole(verifiedRole) ? labelName : "",
    verifiedRoleUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    verifiedRoleUpdatedBy: staffEmail
  }, { merge: true });
  console.log(`verifiedRole=${verifiedRole || "none"} for ${uid} by ${staffEmail}`);
  return { ok: true, uid, verifiedRole, labelName: isArVerifiedRole(verifiedRole) ? labelName : "" };
});

exports.setStaffRole = onCall({ region: REGION }, async (request) => {
  const staffEmail = assertStaff(request.auth);
  await assertCallableRateLimit("setStaffRole", request);
  const { uid, value } = request.data || {};
  if (!uid || typeof value !== "boolean") {
    throw new HttpsError("invalid-argument", "uid and a boolean value are required.");
  }
  if (!value && uid === request.auth.uid) {
    throw new HttpsError("failed-precondition", "You cannot revoke your own staff access.");
  }

  const user = await admin.auth().getUser(uid);
  const email = String(user.email || "").toLowerCase();
  if (!value && STAFF_EMAILS.includes(email)) {
    throw new HttpsError("failed-precondition", "Owner staff accounts are managed in the server allowlist.");
  }

  const claims = user.customClaims || {};
  await admin.auth().setCustomUserClaims(uid, { ...claims, staff: value });
  await admin.firestore().doc(`users/${uid}`).set({
    staff: value,
    staffUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    staffUpdatedBy: staffEmail
  }, { merge: true });

  console.log(`staff=${value} for ${uid} by ${staffEmail}`);
  return { ok: true, uid, staff: value };
});

// ====================================================================
// adjustCredits — staff-only: add or remove pitch/loop credits.
// delta is a signed integer (positive = grant, negative = debit).
// ====================================================================
exports.adjustCredits = onCall({ region: REGION }, async (request) => {
  const staffEmail = assertStaff(request.auth);
  await assertCallableRateLimit("adjustCredits", request);
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
  await assertCallableRateLimit("banUser", request);
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
  await assertCallableRateLimit("listLoopClaims", request);
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
        const inv  = event.data.object;
        const line = inv.lines?.data?.[0];
        // Stripe moved the price id from line.price.id (old) to
        // line.pricing.price_details.price (2025+ API). Support both.
        const priceId = line?.pricing?.price_details?.price
                     || line?.price?.id
                     || null;
        const tier = tierForPriceId(priceId);
        console.log(`invoice.paid: priceId=${priceId} tier=${tier}`);
        if (tier) {
          const uid = await uidForCustomer(stripe, inv.customer);
          if (uid) {
            await db.doc(`users/${uid}`).update({
              "subscription.tier":     tier,
              "subscription.status":   "active",
              "subscription.renewsAt": line?.period?.end
                ? admin.firestore.Timestamp.fromMillis(line.period.end * 1000) : null
            });
            await applyMonthlyGrants(uid, tier, line?.period?.end || null);
            console.log(`invoice.paid: granted ${tier} credits to ${uid}`);
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

/* ====================================================================
   SPLIT SHEETS — build a publishing split-sheet PDF and route it for
   e-signature via DocuSign (JWT grant). Producer (owner) only.
   ==================================================================== */
async function dsApiClient() {
  const api = new docusign.ApiClient();
  api.setOAuthBasePath(DOCUSIGN_OAUTH_HOST.value());
  const res = await api.requestJWTUserToken(
    DOCUSIGN_INTEGRATION_KEY.value(),
    DOCUSIGN_USER_ID.value(),
    ["signature", "impersonation"],
    Buffer.from(DOCUSIGN_PRIVATE_KEY.value()),
    3600
  );
  api.setBasePath(DOCUSIGN_BASE_PATH.value());
  api.addDefaultHeader("Authorization", "Bearer " + res.body.access_token);
  return api;
}

async function buildSplitSheetPdf({ songTitle, artist, dateCreated, writers }) {
  const pdf  = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink  = rgb(0.07, 0.07, 0.09);
  const dim  = rgb(0.42, 0.42, 0.48);
  const gold = rgb(0.79, 0.64, 0.29);
  const M = 54, W = 612;
  let page = pdf.addPage([612, 792]);
  let y = 748;
  const ensure = (need) => { if (y - need < 56) { page = pdf.addPage([612, 792]); y = 748; } };
  const text = (s, x, size, f = font, c = ink) => page.drawText(String(s == null ? "" : s), { x, y, size, font: f, color: c });

  text("SONG SPLIT SHEET", M, 20, bold);
  text("PluggurBeats", W - M - font.widthOfTextAtSize("PluggurBeats", 10), 10, font, dim);
  y -= 18;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: rgb(0.85, 0.85, 0.88) });
  y -= 22;

  text("SONG TITLE", M, 8, bold, dim); text("RECORDING ARTIST", M + 280, 8, bold, dim);
  y -= 14; text(songTitle || "-", M, 12, bold); text(artist || "-", M + 280, 12, bold);
  y -= 24; text("DATE CREATED", M, 8, bold, dim); text("COVERS", M + 280, 8, bold, dim);
  y -= 14; text(dateCreated || "-", M, 11); text("Publishing rights (composition) only", M + 280, 11);
  y -= 26;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: rgb(0.85, 0.85, 0.88) });
  y -= 18;
  text("CONTRIBUTORS", M, 9, bold, gold);
  y -= 13;
  text("Master (sound recording) ownership is a separate agreement, NOT covered by this split sheet.", M, 8, font, dim);
  y -= 20;

  writers.forEach((w, i) => {
    ensure(146);
    const boxTop = y, boxH = 138;
    page.drawRectangle({ x: M, y: boxTop - boxH, width: W - 2 * M, height: boxH, borderColor: rgb(0.85, 0.85, 0.88), borderWidth: 0.6, color: rgb(0.985, 0.985, 0.99) });
    const pad = 14;
    let yy = boxTop - 22;
    const cell = (label, val, x, w2) => {
      page.drawText(label, { x, y: yy, size: 7, font: bold, color: dim });
      page.drawText(String(val == null || val === "" ? "-" : val), { x, y: yy - 12, size: 9.5, font: font, color: ink });
    };
    page.drawText(`${i + 1}.  ${w.legalName || "-"}`, { x: M + pad, y: yy, size: 12, font: bold, color: ink });
    page.drawText(`${w.pct || 0}%`, { x: W - M - pad - 44, y: yy, size: 13, font: bold, color: gold });
    yy -= 28;
    cell("ROLE", w.role, M + pad); cell("PRO", w.pro, M + pad + 150); cell("PUBLISHER", w.publisher, M + pad + 250); cell("CAE / IPI", w.ipi, M + pad + 400);
    yy -= 32;
    cell("EMAIL", w.email, M + pad); cell("PHONE", w.phone, M + pad + 250);
    yy -= 32;
    cell("ADDRESS", w.address, M + pad);
    yy -= 26;
    page.drawText("Signature:", { x: M + pad, y: yy, size: 9, font: bold, color: dim });
    page.drawText(`/s${i + 1}/`, { x: M + pad + 58, y: yy, size: 9, font: font, color: rgb(0.92, 0.92, 0.94) });
    page.drawText("Date:", { x: M + pad + 330, y: yy, size: 9, font: bold, color: dim });
    page.drawText(`/d${i + 1}/`, { x: M + pad + 366, y: yy, size: 9, font: font, color: rgb(0.92, 0.92, 0.94) });
    y = boxTop - boxH - 14;
  });

  ensure(26);
  const total = writers.reduce((s, w) => s + (Number(w.pct) || 0), 0);
  text(`TOTAL: ${total}%`, M, 11, bold, total === 100 ? rgb(0.1, 0.5, 0.3) : rgb(0.7, 0.1, 0.1));
  y -= 24; ensure(20);
  text("Generated via PluggurBeats. Each contributor signs electronically through DocuSign.", M, 8, font, dim);

  const bytes = await pdf.save();
  return Buffer.from(bytes).toString("base64");
}

exports.generateSplitSheet = onCall({ region: REGION, secrets: DS_SECRETS }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  await assertCallableRateLimit("generateSplitSheet", request);
  const uid = request.auth.uid;
  const db  = admin.firestore();
  const { campaignId, beatIndex, song, writers } = request.data || {};

  if (!campaignId || beatIndex == null) throw new HttpsError("invalid-argument", "campaignId and beatIndex are required.");
  if (!song || !song.title) throw new HttpsError("invalid-argument", "Song title is required.");
  if (!Array.isArray(writers) || writers.length === 0) throw new HttpsError("invalid-argument", "Add at least one contributor.");
  for (const w of writers) {
    if (!w.legalName || !w.legalName.trim()) throw new HttpsError("invalid-argument", "Every contributor needs a legal name.");
    if (!w.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(w.email)) throw new HttpsError("invalid-argument", `A valid email is required for ${w.legalName || "each contributor"} (needed to sign).`);
  }
  const total = writers.reduce((s, w) => s + (Number(w.pct) || 0), 0);
  if (Math.round(total) !== 100) throw new HttpsError("failed-precondition", `Ownership percentages must total exactly 100% (currently ${total}%).`);

  const campSnap = await db.doc(`users/${uid}/campaigns/${campaignId}`).get();
  if (!campSnap.exists) throw new HttpsError("not-found", "Campaign not found.");
  const beat = (campSnap.get("beats") || [])[beatIndex];
  const beatTitle = beat?.title || song.title;

  const clean = writers.map((w) => ({
    legalName: (w.legalName || "").trim(), role: (w.role || "").trim(), email: (w.email || "").trim(),
    phone: (w.phone || "").trim(), address: (w.address || "").trim(), pro: (w.pro || "").trim(),
    publisher: (w.publisher || "").trim(), ipi: (w.ipi || "").trim(), pct: Number(w.pct) || 0
  }));

  const pdfBase64 = await buildSplitSheetPdf({ songTitle: song.title, artist: song.artist || "", dateCreated: song.dateCreated || "", writers: clean });

  const env = new docusign.EnvelopeDefinition();
  env.emailSubject = `Sign the split sheet - ${song.title}`;
  const doc = new docusign.Document();
  doc.documentBase64 = pdfBase64; doc.name = `Split Sheet - ${beatTitle}`; doc.fileExtension = "pdf"; doc.documentId = "1";
  env.documents = [doc];
  const signers = clean.map((w, i) => {
    const signer = docusign.Signer.constructFromObject({ email: w.email, name: w.legalName, recipientId: String(i + 1), routingOrder: "1" });
    const signHere = docusign.SignHere.constructFromObject({ anchorString: `/s${i + 1}/`, anchorUnits: "pixels", anchorXOffset: "2", anchorYOffset: "-6" });
    const dateTab  = docusign.DateSigned.constructFromObject({ anchorString: `/d${i + 1}/`, anchorUnits: "pixels", anchorXOffset: "2", anchorYOffset: "-6" });
    signer.tabs = docusign.Tabs.constructFromObject({ signHereTabs: [signHere], dateSignedTabs: [dateTab] });
    return signer;
  });
  env.recipients = docusign.Recipients.constructFromObject({ signers });
  env.status = "sent";

  let envelopeId;
  try {
    const api = await dsApiClient();
    const envApi = new docusign.EnvelopesApi(api);
    const result = await envApi.createEnvelope(DOCUSIGN_ACCOUNT_ID.value(), { envelopeDefinition: env });
    envelopeId = result.envelopeId;
  } catch (e) {
    const msg = e?.response?.body?.message || e.message || String(e);
    console.error("DocuSign createEnvelope failed:", msg);
    throw new HttpsError("internal", "Could not send for signature: " + msg);
  }

  const sheetRef = db.collection(`users/${uid}/splitSheets`).doc();
  await sheetRef.set({
    campaignId, beatIndex, beatTitle,
    song: { title: song.title, artist: song.artist || "", dateCreated: song.dateCreated || "" },
    writers: clean, envelopeId, status: "sent",
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  await db.doc(`dsEnvelopes/${envelopeId}`).set({ uid, sheetId: sheetRef.id });
  console.log(`Split sheet ${sheetRef.id} sent (envelope ${envelopeId}) by ${uid}`);
  return { ok: true, sheetId: sheetRef.id, envelopeId };
});

exports.refreshSplitSheetStatus = onCall({ region: REGION, secrets: DS_SECRETS }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  await assertCallableRateLimit("refreshSplitSheetStatus", request);
  const uid = request.auth.uid;
  const db  = admin.firestore();
  const { sheetId } = request.data || {};
  if (!sheetId) throw new HttpsError("invalid-argument", "sheetId required.");
  const ref  = db.doc(`users/${uid}/splitSheets/${sheetId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Split sheet not found.");
  try {
    const api = await dsApiClient();
    const envApi = new docusign.EnvelopesApi(api);
    const env = await envApi.getEnvelope(DOCUSIGN_ACCOUNT_ID.value(), snap.get("envelopeId"));
    await ref.update({ status: (env.status || "sent").toLowerCase(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return { ok: true, status: env.status };
  } catch (e) {
    const msg = e?.response?.body?.message || e.message || String(e);
    throw new HttpsError("internal", "Could not refresh status: " + msg);
  }
});

exports.docusignConnect = onRequest({ region: REGION, secrets: [DOCUSIGN_CONNECT_SECRET] }, async (req, res) => {
  if (req.query.token !== DOCUSIGN_CONNECT_SECRET.value()) { res.status(401).send("bad token"); return; }
  try {
    const body = req.body || {};
    const envelopeId = body?.data?.envelopeId || body?.envelopeId || body?.data?.envelopeSummary?.envelopeId;
    const status = body?.data?.envelopeSummary?.status || body?.status || body?.event;
    if (envelopeId) {
      const db = admin.firestore();
      const map = await db.doc(`dsEnvelopes/${envelopeId}`).get();
      if (map.exists) {
        const { uid, sheetId } = map.data();
        await db.doc(`users/${uid}/splitSheets/${sheetId}`).update({
          status: (status || "sent").toString().toLowerCase(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }
    res.status(200).send("ok");
  } catch (e) { console.error("docusignConnect error:", e.message); res.status(200).send("ok"); }
});
