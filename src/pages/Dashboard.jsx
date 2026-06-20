import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDocs, setDoc, collection, query, where, orderBy, serverTimestamp, onSnapshot } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { auth, db, storage, fns } from "../firebase.js";
import "./Dashboard.css";

const submitCampaignFn = httpsCallable(fns, "submitCampaign");
const reconcileCreditsFn = httpsCallable(fns, "reconcileCredits");
const submitLoopFn = httpsCallable(fns, "submitLoop");
const createSubscriptionCheckoutFn = httpsCallable(fns, "createSubscriptionCheckout");
const buyCreditPackFn = httpsCallable(fns, "buyCreditPack");

const PITCH_COSTS = { "trap-a": 2, "trap-r": 1, "rb-a": 2, "rb-r": 1, "pop-a": 2, "afro-r": 1, "drill-r": 1, "reg-r": 1, "anr-major-trap": 3, "anr-major-pop": 3, "anr-indie": 3, "anr-sync": 3, "anr-mgmt": 3 };
const ANR_IDS = new Set(["anr-major-trap", "anr-major-pop", "anr-indie", "anr-sync", "anr-mgmt"]);
const TIER_CAPS = { free: { beats: 5, lanes: 1, anr: false }, plugg: { beats: 15, lanes: 3, anr: false }, pro: { beats: 25, lanes: Infinity, anr: true } };
const ARTIST_TARGETS = [
  { id: "trap-a", lane: "Trap", tier: "A-list", reach: "~18 desks", cost: 2 },
  { id: "trap-r", lane: "Trap", tier: "Rising", reach: "~40 desks", cost: 1 },
  { id: "rb-a", lane: "R&B", tier: "A-list", reach: "~12 desks", cost: 2 },
  { id: "rb-r", lane: "R&B", tier: "Rising", reach: "~33 desks", cost: 1 },
  { id: "pop-a", lane: "Pop", tier: "Major", reach: "~15 desks", cost: 2 },
  { id: "afro-r", lane: "Afrobeats", tier: "Rising", reach: "~26 desks", cost: 1 },
  { id: "drill-r", lane: "Drill", tier: "Rising", reach: "~22 desks", cost: 1 },
  { id: "reg-r", lane: "Reggaeton", tier: "Rising", reach: "~19 desks", cost: 1 }
];
const ANR_TARGETS = [
  { id: "anr-major-trap", lane: "Major label", tier: "Hip-hop A&R", reach: "~9 contacts", cost: 3 },
  { id: "anr-major-pop", lane: "Major label", tier: "Pop A&R", reach: "~7 contacts", cost: 3 },
  { id: "anr-indie", lane: "Indie / distro", tier: "A&R", reach: "~24 contacts", cost: 3 },
  { id: "anr-sync", lane: "Sync / placement", tier: "Music supervisor", reach: "~14 contacts", cost: 3 },
  { id: "anr-mgmt", lane: "Management", tier: "Artist managers", reach: "~31 contacts", cost: 3 }
];
const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const KEY_OPTS = [...KEYS.map((k) => k + " Major"), ...KEYS.map((k) => k + " Minor")];
const ROLE_OPTS = ["Producer", "Co-producer", "Writer", "Vocalist", "Mix engineer", "Other"];
const TIER_RANK = { free: 0, plugg: 1, pro: 2 };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function uploadFile(file, path, onProgress) {
  const task = uploadBytesResumable(ref(storage, path), file);
  return new Promise((resolve, reject) => {
    task.on("state_changed",
      (snap) => onProgress && onProgress(Math.round(snap.bytesTransferred / snap.totalBytes * 100)),
      reject,
      () => resolve(path));
  });
}

const NAV = [
  { v: "overview", label: "Overview", icon: <><path d="M3 12l9-9 9 9" /><path d="M5 10v10h14V10" /></> },
  { v: "submit", label: "Start a campaign", icon: <path d="M12 5v14M5 12h14" /> },
  { v: "analytics", label: "Pitch analytics", icon: <path d="M4 19V5M4 19h16M8 17v-6M13 17V8M18 17v-9" /> },
  { v: "paperwork", label: "Paperwork", icon: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /><path d="M10 13h5M10 17h5" /></> },
  { v: "loops", label: "Loop Drops", icon: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></> },
  { v: "billing", label: "Billing & credits", icon: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></> }
];

export default function Dashboard() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [view, setView] = useState("overview");
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState({});
  const [campaigns, setCampaigns] = useState([]);
  const [events, setEvents] = useState({});
  const [toast, setToast] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);

  const toastTimer = useRef(null);
  const eventUnsubs = useRef({});
  const reconcileTried = useRef(false);
  const lastAvatarPath = useRef(null);

  const showToast = (t) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  };

  const tier = profile.subscription?.tier || "free";
  const caps = TIER_CAPS[tier] || TIER_CAPS.free;
  const pitchBalance = profile.pitchCredits?.balance || 0;
  const loopBalance = profile.loopCredits?.balance || 0;

  // ---- auth + live listeners ----
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u || !u.emailVerified) { signOut(auth).then(() => navigate("/")); return; }
      setUser(u);
      setReady(true);

      const unsubUser = onSnapshot(doc(db, "users", u.uid), async (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        let avatarUrl = profile.avatarUrl;
        if (data.avatarPath && data.avatarPath !== lastAvatarPath.current) {
          lastAvatarPath.current = data.avatarPath;
          try { avatarUrl = await getDownloadURL(ref(storage, data.avatarPath)); } catch { /* ignore */ }
        }
        setProfile((prev) => ({ ...prev, ...data, email: u.email, avatarUrl: avatarUrl || prev.avatarUrl }));

        const t = data.subscription?.tier || "free";
        const grantMissing = ["plugg", "pro"].includes(t) && (!data.pitchCredits?.lastGrantAt || !data.subscription?.renewsAt);
        if (grantMissing && !reconcileTried.current) {
          reconcileTried.current = true;
          try { const res = await reconcileCreditsFn(); if (res.data?.granted) showToast(`Your ${cap(t)} credits are now active.`); } catch { /* ignore */ }
        }
      });

      const unsubCamps = onSnapshot(collection(db, "users", u.uid, "campaigns"), (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setCampaigns(list);
        const ids = new Set(list.map((c) => c.id));
        Object.keys(eventUnsubs.current).forEach((id) => {
          if (!ids.has(id)) { eventUnsubs.current[id](); delete eventUnsubs.current[id]; setEvents((p) => { const n = { ...p }; delete n[id]; return n; }); }
        });
        list.forEach((c) => {
          if (eventUnsubs.current[c.id]) return;
          eventUnsubs.current[c.id] = onSnapshot(collection(db, "users", u.uid, "campaigns", c.id, "events"), (evSnap) => {
            const evs = evSnap.docs.map((d) => { const e = d.data(); return { type: e.type, contact: e.contact, timestamp: e.timestamp?.toMillis ? e.timestamp.toMillis() : null }; });
            setEvents((p) => ({ ...p, [c.id]: evs }));
          });
        });
      });

      // store cleanups
      eventUnsubs.current.__user = unsubUser;
      eventUnsubs.current.__camps = unsubCamps;
    });
    return () => {
      unsub();
      Object.values(eventUnsubs.current).forEach((fn) => { try { fn(); } catch { /* ignore */ } });
      eventUnsubs.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- checkout return ----
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    let msg = null;
    if (p.get("sub") === "success") msg = "Subscription active — your credits will appear shortly.";
    if (p.get("pack") === "success") msg = "Payment received — credits added to your balance.";
    if (p.get("sub") === "cancel" || p.get("pack") === "cancel") msg = "Checkout canceled.";
    if (msg) {
      setTimeout(() => showToast(msg), 600);
      history.replaceState({}, "", location.pathname);
      setView("billing");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // dismiss profile menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => { if (!e.target.closest(".me") && !e.target.closest("#dash-profile-menu")) setMenuOpen(false); };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [menuOpen]);

  const go = (v) => { setView(v); setNavOpen(false); window.scrollTo(0, 0); };

  async function startSubscription(plan, btn) {
    const orig = btn.textContent; btn.disabled = true; btn.textContent = "Redirecting…";
    try { const { data } = await createSubscriptionCheckoutFn({ plan }); if (data?.url) location.href = data.url; else throw new Error("No checkout URL returned."); }
    catch (e) { showToast(e.message || "Could not start checkout."); btn.disabled = false; btn.textContent = orig; }
  }
  async function buyPack(pack, btn) {
    const orig = btn.textContent; btn.disabled = true; btn.textContent = "Redirecting…";
    try { const { data } = await buyCreditPackFn({ pack }); if (data?.url) location.href = data.url; else throw new Error("No checkout URL returned."); }
    catch (e) { showToast(e.message || "Could not start checkout."); btn.disabled = false; btn.textContent = orig; }
  }

  const initial = (profile.displayName || user?.displayName || user?.email || "?")[0].toUpperCase();
  const avatarStyle = profile.avatarUrl ? { backgroundImage: `url("${profile.avatarUrl}")` } : undefined;

  if (!ready) return <div id="dash-root"><div style={{ padding: "120px 20px", textAlign: "center", color: "var(--bone-dim)" }}>Loading…</div></div>;

  return (
    <div id="dash-root">
      <div className="app">
        <div className={`scrim${navOpen ? " show" : ""}`} onClick={() => setNavOpen(false)} />
        <aside className={navOpen ? "open" : ""}>
          <div className="brand"><span className="eqmini"><i /><i /><i /><i /></span> PluggurBeats</div>
          <div className="navlabel">Workspace</div>
          {NAV.map((n) => (
            <button key={n.v} className={`navitem${view === n.v ? " active" : ""}`} onClick={() => go(n.v)}>
              <svg viewBox="0 0 24 24">{n.icon}</svg> {n.label}
            </button>
          ))}
          <a className="navitem" href="/"><svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7" /></svg> Marketing site</a>
          <div className="navspace" />
          <div className="me" style={{ cursor: "pointer", position: "relative" }} onClick={() => setMenuOpen((v) => !v)}>
            <div className="avatar" style={avatarStyle}>{profile.avatarUrl ? "" : initial}</div>
            <div><div className="nm">{profile.displayName || "—"}</div><div className="em">{user?.email || ""}</div></div>
            <span style={{ marginLeft: "auto", color: "var(--bone-dim)", fontSize: "11px" }}>▲</span>
          </div>
          {menuOpen && (
            <div id="dash-profile-menu" style={{ position: "absolute", bottom: "80px", left: "12px", right: "12px", background: "var(--ink-3)", border: "1px solid var(--line-strong)", borderRadius: "14px", overflow: "hidden", zIndex: 10 }}>
              <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
                <div style={{ fontSize: "13px", fontWeight: 600 }}>{profile.displayName || "—"}</div>
                <div style={{ fontSize: "11px", color: "var(--bone-dim)" }}>{user?.email || ""}</div>
              </div>
              <button onClick={() => { setMenuOpen(false); setProfileOpen(true); }} style={menuBtn}>Profile &amp; settings</button>
              <button onClick={() => { setMenuOpen(false); go("billing"); }} style={menuBtn}>Billing</button>
              <div style={{ height: "1px", background: "var(--line)" }} />
              <button onClick={() => signOut(auth)} style={{ ...menuBtn, color: "var(--bad)" }}>Sign out</button>
            </div>
          )}
        </aside>

        <main>
          <div className="topbar">
            <button onClick={() => setNavOpen(true)} aria-label="Menu">☰</button>
            <div className="brand" style={{ padding: 0 }}><span className="eqmini"><i /><i /><i /><i /></span> PluggurBeats</div>
            <div style={{ width: "42px" }} />
          </div>

          {view === "overview" && <Overview campaigns={campaigns} go={go} />}
          {view === "submit" && <CampaignBuilder tier={tier} caps={caps} pitchBalance={pitchBalance} user={user} profile={profile} campaignCount={campaigns.length} showToast={showToast} onSubmitted={() => go("analytics")} />}
          {view === "analytics" && <Analytics campaigns={campaigns} events={events} />}
          {view === "paperwork" && <Paperwork campaigns={campaigns} showToast={showToast} />}
          {view === "loops" && <LoopDrops user={user} loopBalance={loopBalance} showToast={showToast} />}
          {view === "billing" && <Billing tier={tier} profile={profile} pitchBalance={pitchBalance} loopBalance={loopBalance} startSubscription={startSubscription} buyPack={buyPack} />}
        </main>
      </div>

      {profileOpen && <ProfileModal user={user} profile={profile} onClose={() => setProfileOpen(false)} setProfile={setProfile} showToast={showToast} />}

      <div id="dash-toast" className={toast ? "show" : ""}>{toast}</div>
    </div>
  );
}

const menuBtn = { width: "100%", textAlign: "left", padding: "12px 16px", background: "none", border: 0, color: "var(--bone)", fontSize: "14px", cursor: "pointer" };

// ---------------- Overview ----------------
function Overview({ campaigns, go }) {
  const sent = campaigns.reduce((s, c) => s + (Array.isArray(c.pitchedTo) ? c.pitchedTo.length : 0), 0);
  const opens = campaigns.reduce((s, c) => s + (c.opens || 0), 0);
  const downs = campaigns.reduce((s, c) => s + (c.downloads || 0), 0);
  return (
    <section>
      <div className="page-head"><div className="eyebrow">Welcome back</div><h1>Studio overview</h1><p>Where your records stand right now.</p></div>
      <div className="stats">
        <div className="stat"><div className="v">{campaigns.length || "0"}</div><div className="l">Campaigns submitted</div></div>
        <div className="stat"><div className="v">{sent || "0"}</div><div className="l">Beats uploaded</div></div>
        <div className="stat"><div className="v">{sent ? Math.round(opens / sent * 100) + "%" : "—"}</div><div className="l">Open rate</div></div>
        <div className="stat"><div className="v">{downs || "0"}</div><div className="l">Beat downloads</div></div>
      </div>
      <div className="card" style={{ marginTop: "18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}><h3 style={{ fontSize: "18px" }}>Pick up where you left off</h3></div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
          <button className="card" style={overviewCard} onClick={() => go("submit")}><h4 style={{ fontSize: "16px", marginBottom: "6px" }}>Start a campaign →</h4><p className="hint">Pick a package, load your beats, choose targets, pay.</p></button>
          <button className="card" style={overviewCard} onClick={() => go("analytics")}><h4 style={{ fontSize: "16px", marginBottom: "6px" }}>Check analytics →</h4><p className="hint">See who opened, downloaded and played.</p></button>
          <button className="card" style={overviewCard} onClick={() => go("paperwork")}><h4 style={{ fontSize: "16px", marginBottom: "6px" }}>File paperwork →</h4><p className="hint">Build split sheets and log collaborators.</p></button>
        </div>
      </div>
    </section>
  );
}
const overviewCard = { textAlign: "left", cursor: "pointer", color: "var(--bone)" };

// ---------------- Campaign Builder ----------------
let beatSeq = 0;
const newBeat = (name = "", ig = "") => ({ uid: ++beatSeq, title: "", genre: "Trap", key: KEY_OPTS[0], bpm: "", file: null, storagePath: "", status: "No file", open: true, progress: 0, collabs: [{ name, role: "Producer", instagram: ig, phone: "" }] });

function CampaignBuilder({ tier, caps, pitchBalance, user, profile, campaignCount, showToast, onSubmitted }) {
  const [bName, setBName] = useState("");
  const [bIg, setBIg] = useState("");
  const [beats, setBeats] = useState([newBeat()]);
  const [selected, setSelected] = useState([]);
  const [seg, setSeg] = useState("artists");
  const [rush, setRush] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const [submitBtn, setSubmitBtn] = useState("Submit for review →");
  const [busy, setBusy] = useState(false);
  const [pay, setPay] = useState(null); // { beats, targets, addons, cost }
  const [payMsg, setPayMsg] = useState(null);
  const [payBusy, setPayBusy] = useState(false);

  const isFree = tier === "free";
  const cost = useMemo(() => selected.reduce((s, id) => s + (PITCH_COSTS[id] || 0), 0) + (rush ? 2 : 0) + (feedback ? 1 : 0), [selected, rush, feedback]);
  const noCredit = cost > 0 && cost > pitchBalance;

  const patchBeat = (uid, patch) => setBeats((prev) => prev.map((b) => (b.uid === uid ? { ...b, ...patch } : b)));
  const patchCollab = (uid, i, patch) => setBeats((prev) => prev.map((b) => b.uid === uid ? { ...b, collabs: b.collabs.map((c, j) => (j === i ? { ...c, ...patch } : c)) } : b));

  const addBeat = () => { if (beats.length >= caps.beats) { showToast(`Your plan allows up to ${caps.beats} beats per campaign.`); return; } setBeats((p) => [...p, newBeat(bName, bIg)]); };
  const removeBeat = (uid) => { if (beats.length <= 1) { showToast("Keep at least one beat."); return; } setBeats((p) => p.filter((b) => b.uid !== uid)); };

  const toggleTarget = (id) => {
    const locked = ANR_IDS.has(id) && !caps.anr;
    if (locked) { showToast("A&R / management lanes require a Pro subscription."); return; }
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= caps.lanes) { showToast(`Your ${tier} plan allows ${caps.lanes === Infinity ? "unlimited" : caps.lanes} lane${caps.lanes === 1 ? "" : "s"}. Deselect one or upgrade.`); return prev; }
      return [...prev, id];
    });
  };

  async function review() {
    if (!bName.trim() || !bIg.trim()) { showToast("Add your name and Instagram."); return; }
    const named = beats.filter((b) => b.title.trim());
    if (named.length === 0) { showToast("Name at least one beat."); return; }
    if (named.find((b) => !b.file && !b.storagePath)) { showToast("Attach a file to every named beat before continuing."); return; }
    if (selected.length === 0) { showToast("Select at least one target."); return; }
    if (cost > pitchBalance) { showToast("Not enough pitch credits. Buy a pack to continue."); return; }

    const storagePrefix = `campaign${campaignCount + 1}`;
    setBusy(true); setSubmitBtn("Uploading beats…");
    try {
      await Promise.all(named.map(async (b) => {
        if (!b.file) return;
        const ext = b.file.name.split(".").pop();
        const title = (b.title.trim() || "beat").toUpperCase();
        const handles = [bIg, ...b.collabs.map((c) => c.instagram.trim())].filter(Boolean).map((ig) => (ig.startsWith("@") ? ig : "@" + ig));
        const igPart = [...new Set(handles)].length ? `(${[...new Set(handles)].join(", ")})` : "";
        const safeName = `${title}${igPart}`.replace(/[/\\:*?"<>|]/g, "");
        const path = `beats/${user.uid}/${storagePrefix}/${safeName}.${ext}`;
        patchBeat(b.uid, { status: "Uploading…" });
        await uploadFile(new File([b.file], `${safeName}.${ext}`, { type: b.file.type }), path, (pct) => patchBeat(b.uid, { progress: pct }));
        patchBeat(b.uid, { storagePath: path, file: null, status: "Uploaded ✓" });
        b.storagePath = path;
      }));
    } catch (e) { showToast("Upload failed: " + e.message); setBusy(false); setSubmitBtn("Submit for review →"); return; }

    const builtBeats = named.map((b) => ({ title: b.title.trim(), genre: b.genre, key: b.key, bpm: b.bpm, storagePath: b.storagePath, collabs: b.collabs.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), role: c.role, instagram: c.instagram.trim(), phone: c.phone.trim() })) }));
    const addons = [...(rush ? ["rush"] : []), ...(feedback ? ["feedback"] : [])];
    setBusy(false); setSubmitBtn("Submit for review →");
    setPayMsg(null);
    setPay({ beats: builtBeats, targets: selected, addons, cost });
  }

  async function doPay() {
    setPayBusy(true); setPayMsg(null);
    try {
      await submitCampaignFn({ producer: { name: bName.trim(), instagram: bIg.trim(), email: user?.email || "", phone: profile?.phone || "" }, beats: pay.beats, targets: pay.targets, addons: pay.addons });
      setPayMsg({ text: "✓ Campaign submitted — now pending review.", kind: "ok" });
      setTimeout(() => { setPay(null); onSubmitted(); showToast("Campaign submitted for review — you'll be notified once it's approved."); }, 1000);
    } catch (e) { setPayMsg({ text: e.message || "Submission failed. Try again.", kind: "err" }); setPayBusy(false); }
  }

  const addonLabels = pay ? pay.addons.map((a) => (a === "rush" ? "Rush (+2cr)" : "Feedback (+1cr)")).join(", ") : "";
  const capLabel = caps.lanes === Infinity ? selected.length : `${selected.length} of ${caps.lanes}`;

  return (
    <section>
      <div className="page-head">
        <div className="eyebrow">New campaign</div>
        <h1>Start a campaign</h1>
        <p>Load your beats, pick your target lanes, and submit. <span style={{ color: "var(--gold)" }}>{tier === "pro" ? "Pro: approved campaigns email directly to artist & A&R inboxes." : tier === "plugg" ? "Plugg: approved campaigns are added to the Verified library." : ""}</span></p>
      </div>

      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: "6px" }}>Pitch credits</div>
          <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: "36px", lineHeight: 1 }}>{pitchBalance}<span style={{ fontSize: "15px", fontWeight: 400, color: "var(--bone-dim)", fontFamily: "'Inter'" }}> available</span></div>
          <div className="hint" style={{ marginTop: "4px" }}>{isFree ? "Upgrade to Plugg or Pro to start campaigns" : `${cap(tier)} plan · ${caps.beats} beats / ${caps.lanes === Infinity ? "unlimited lanes" : "up to " + caps.lanes + " lane" + (caps.lanes !== 1 ? "s" : "")} · ${tier === "plugg" ? "Verified library" : "Email + library"}`}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="hint" style={{ marginBottom: "4px" }}>Campaign cost</div>
          <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: "28px", lineHeight: 1 }}>{cost}</div>
          <div className="hint" style={{ color: noCredit ? "var(--bad)" : undefined }}>credits</div>
        </div>
      </div>

      {isFree ? (
        <div className="card" style={{ textAlign: "center", padding: "40px 24px" }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.4" style={{ margin: "0 auto 14px", display: "block" }}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
          <h2 style={{ fontSize: "22px", marginBottom: "10px" }}>Campaigns require a subscription</h2>
          <p className="hint" style={{ maxWidth: "380px", margin: "0 auto 22px", lineHeight: 1.65 }}>Upgrade to <strong>Plugg</strong> to get your beats into the Verified library, or <strong>Pro</strong> to also blast directly to artist &amp; A&amp;R inboxes.</p>
          <a href="/#pricing" className="btn btn-gold" style={{ textDecoration: "none" }}>See plans →</a>
        </div>
      ) : (
        <div>
          <div className="card">
            <h3 style={{ fontSize: "18px", marginBottom: "18px" }}>1 · Your details</h3>
            <div className="row2">
              <div className="field"><label>Your name <span className="req">*</span></label><input className="inp" placeholder="Your name" value={bName} onChange={(e) => setBName(e.target.value)} /></div>
              <div className="field"><label>Your Instagram <span className="req">*</span></label><input className="inp" placeholder="@yourhandle" value={bIg} onChange={(e) => setBIg(e.target.value)} /></div>
            </div>
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <h3 style={{ fontSize: "18px" }}>2 · Your beats</h3>
              <span className="mono hint">{beats.length} / {caps.beats}</span>
            </div>
            <p className="hint" style={{ marginBottom: "16px" }}>Each beat uploads when you submit. MP3 or WAV — untagged mixes pitch best.</p>
            {beats.map((b, i) => (
              <div className="beat-card" key={b.uid}>
                <div className="beat-header" onClick={() => patchBeat(b.uid, { open: !b.open })}>
                  <span className="beat-num">{String(i + 1).padStart(2, "0")}</span>
                  <span className="beat-title-preview" style={{ color: b.title.trim() ? "var(--bone)" : "var(--bone-dim)" }}>{b.title.trim() || "Untitled beat"}</span>
                  <span className={`beat-status ${b.status.includes("Uploaded") ? "uploaded" : b.status.includes("Uploading") ? "uploading" : "pending"}`}>{b.file ? "Ready" : b.status}</span>
                  <span className={`beat-chevron${b.open ? " open" : ""}`}>▼</span>
                </div>
                {b.open && (
                  <div className="beat-body open">
                    <div className="row3" style={{ marginBottom: "12px" }}>
                      <div className="field" style={{ margin: 0 }}><label>Beat title <span className="req">*</span></label><input className="inp" placeholder="e.g. Midnight Run" value={b.title} onChange={(e) => patchBeat(b.uid, { title: e.target.value })} /></div>
                      <div className="field" style={{ margin: 0 }}><label>Genre</label><select className="inp" value={b.genre} onChange={(e) => patchBeat(b.uid, { genre: e.target.value })}>{["Trap", "Drill", "R&B", "Pop", "Afrobeats", "Hip-Hop", "Other"].map((g) => <option key={g}>{g}</option>)}</select></div>
                      <div className="field" style={{ margin: 0 }}><label>Key</label><select className="inp" value={b.key} onChange={(e) => patchBeat(b.uid, { key: e.target.value })}>{KEY_OPTS.map((k) => <option key={k}>{k}</option>)}</select></div>
                    </div>
                    <div className="row2" style={{ marginBottom: "16px" }}>
                      <div className="field" style={{ margin: 0 }}><label>BPM</label><input className="inp" type="number" min="40" max="300" placeholder="e.g. 140" value={b.bpm} onChange={(e) => patchBeat(b.uid, { bpm: e.target.value })} /></div>
                      <div className="field" style={{ margin: 0 }}>
                        <label>File <span className="req">*</span></label>
                        <label className={`upload-btn${b.file || b.storagePath ? " done" : ""}`} style={{ width: "100%", display: "block", textAlign: "center" }}>
                          {b.file ? (b.file.name.length > 28 ? b.file.name.slice(0, 26) + "…" : b.file.name) : b.storagePath ? "Uploaded ✓" : "Attach MP3 / WAV"}
                          <input type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" style={{ display: "none" }} onChange={(e) => { const f = e.target.files[0]; if (f) patchBeat(b.uid, { file: f, status: "Ready" }); }} />
                        </label>
                        {b.progress > 0 && b.progress < 100 && <div className="progress-bar show"><div className="progress-fill" style={{ width: b.progress + "%" }} /></div>}
                      </div>
                    </div>
                    <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--bone-dim)", marginBottom: "10px" }}>Collaborators</div>
                    {b.collabs.map((c, j) => (
                      <div className="beat-collab-row" key={j}>
                        <input className="inp" placeholder="Name" value={c.name} onChange={(e) => patchCollab(b.uid, j, { name: e.target.value })} />
                        <select className="inp" value={c.role} onChange={(e) => patchCollab(b.uid, j, { role: e.target.value })}>{ROLE_OPTS.map((r) => <option key={r}>{r}</option>)}</select>
                        <input className="inp" placeholder="@instagram" value={c.instagram} onChange={(e) => patchCollab(b.uid, j, { instagram: e.target.value })} />
                        <input className="inp" placeholder="Phone #" type="tel" value={c.phone} onChange={(e) => patchCollab(b.uid, j, { phone: e.target.value })} />
                        <button className="iconbtn" onClick={() => patchBeat(b.uid, { collabs: b.collabs.filter((_, k) => k !== j) })} title="Remove">✕</button>
                      </div>
                    ))}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px" }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => patchBeat(b.uid, { collabs: [...b.collabs, { name: "", role: "Producer", instagram: "", phone: "" }] })}>+ Add collaborator</button>
                      <button className="iconbtn" style={{ color: "var(--bad)" }} onClick={() => removeBeat(b.uid)} title="Remove beat">✕</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <button className="btn btn-ghost btn-sm" disabled={beats.length >= caps.beats} onClick={addBeat}>+ Add beat</button>
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <h3 style={{ fontSize: "18px" }}>3 · Who should hear it</h3>
              <span className="mono hint">{selected.length} / {caps.lanes === Infinity ? "∞" : caps.lanes}</span>
            </div>
            <p className="hint" style={{ marginBottom: "14px" }}>Anonymized target segments by lane and tier — not named individuals. Your plan sets how many you can pick.</p>
            <div className="seg">
              <button className={seg === "artists" ? "active" : ""} onClick={() => setSeg("artists")}>Artist targets</button>
              <button className={seg === "anr" ? "active" : ""} onClick={() => setSeg("anr")}>A&amp;R / labels</button>
            </div>
            <div className="tgrid">
              {(seg === "artists" ? ARTIST_TARGETS : ANR_TARGETS).map((t) => {
                const locked = ANR_IDS.has(t.id) && !caps.anr;
                const on = selected.includes(t.id);
                return (
                  <div className={`target${on ? " on" : ""}`} key={t.id} onClick={() => toggleTarget(t.id)}>
                    <div className="check">✓</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div className="tk">{t.tier.toUpperCase()}</div>
                      <div className="mono" style={{ fontSize: "11px", color: "var(--gold)" }}>{t.cost}cr</div>
                    </div>
                    <h4>{t.lane}</h4>
                    <div className="reach">{t.reach}</div>
                    {locked && <div style={{ fontFamily: "Space Mono,monospace", fontSize: "10px", letterSpacing: ".1em", color: "var(--bad)", marginTop: "6px" }}>PRO ONLY</div>}
                  </div>
                );
              })}
            </div>
            <p className="hint" style={{ marginTop: "16px" }}>{selected.length ? `${selected.length} target${selected.length > 1 ? "s" : ""} selected` : "No targets selected yet."}</p>
          </div>

          <div className="card" style={{ marginTop: 0 }}>
            <h3 style={{ fontSize: "16px", marginBottom: "14px" }}>Add-ons <span className="hint" style={{ fontSize: "12px", fontWeight: 400 }}>(optional)</span></h3>
            <label style={addonRow}>
              <input type="checkbox" checked={rush} onChange={(e) => setRush(e.target.checked)} style={addonCb} />
              <div><span style={{ fontWeight: 600 }}>Rush queue</span><span className="mono" style={{ fontSize: "11px", color: "var(--gold)", marginLeft: "8px" }}>+2 credits</span><div className="hint">Priority review — first pitch within 48h</div></div>
            </label>
            <label style={{ ...addonRow, marginBottom: 0 }}>
              <input type="checkbox" checked={feedback} onChange={(e) => setFeedback(e.target.checked)} style={addonCb} />
              <div><span style={{ fontWeight: 600 }}>Written feedback</span><span className="mono" style={{ fontSize: "11px", color: "var(--gold)", marginLeft: "8px" }}>+1 credit</span><div className="hint">Summary from our pitching team after the campaign closes</div></div>
            </label>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "16px", marginTop: "8px" }}>
            {noCredit && <span style={{ fontSize: "13px", color: "var(--bad)" }}>Not enough pitch credits — buy a pack.</span>}
            <button className="btn btn-gold" disabled={busy || noCredit} onClick={review}>{submitBtn}</button>
          </div>
        </div>
      )}

      {pay && (
        <div className="overlay show" onClick={(e) => { if (e.target === e.currentTarget) setPay(null); }}>
          <div className="modal" role="dialog" aria-modal="true">
            <button className="x" onClick={() => setPay(null)} aria-label="Close">✕</button>
            <h3 style={{ fontSize: "22px" }}>Submit for review</h3>
            <div className="summary">
              <div className="line"><span>Beats</span><span>{pay.beats.length}</span></div>
              <div className="line"><span>Targets</span><span>{capLabel}</span></div>
              <div className="line"><span>Add-ons</span><span>{addonLabels || "None"}</span></div>
              <div className="total" style={{ display: "flex", justifyContent: "space-between" }}><span>Credit cost</span><span>{pay.cost} credits</span></div>
            </div>
            <div style={{ background: "var(--ink)", border: "1px solid var(--line)", borderRadius: "10px", padding: "11px 14px", marginBottom: "4px", display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
              <span style={{ color: "var(--bone-dim)" }}>Balance after submission</span><span style={{ fontWeight: 600 }}>{pitchBalance - pay.cost} credits</span>
            </div>
            <p className="hint" style={{ margin: "14px 0" }}>{tier === "pro" ? "Our team reviews every campaign before any beats are pitched. Pro plan: approved campaigns email directly to artist & A&R inboxes." : "Our team reviews every campaign before any beats are pitched. Plugg plan: approved campaigns are added to the Verified library."}</p>
            {payMsg && <div className={`msg ${payMsg.kind}`}>{payMsg.text}</div>}
            <button className="btn btn-gold" style={{ width: "100%" }} disabled={payBusy} onClick={doPay}>{payBusy ? "Submitting…" : "Submit campaign for review"}</button>
            <p className="mono" style={{ fontSize: "11px", color: "var(--bone-dim)", textAlign: "center", margin: "12px 0 0" }}>Campaign goes to pending review — no pitches sent until staff approves</p>
          </div>
        </div>
      )}
    </section>
  );
}
const addonRow = { display: "flex", alignItems: "flex-start", gap: "12px", cursor: "pointer", marginBottom: "14px" };
const addonCb = { width: "16px", height: "16px", marginTop: "3px", accentColor: "var(--gold)", flex: "none" };

// ---------------- Analytics ----------------
function Analytics({ campaigns, events }) {
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
  const fmt = (ms) => (ms ? new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
  const cms = (c) => (c.createdAt?.toMillis ? c.createdAt.toMillis() : (typeof c.createdAt === "number" ? c.createdAt : null));

  const underReview = campaigns.filter((c) => c.status === "pending_review");
  const approved = campaigns.filter((c) => ["approved", "pitched"].includes(c.status));
  const rejected = campaigns.filter((c) => c.status === "rejected");

  let sent = 0, opens = 0, downloads = 0, clicks = 0; const recipients = [];
  for (const c of campaigns) {
    sent += Array.isArray(c.pitchedTo) ? c.pitchedTo.length : 0;
    const byContact = new Map();
    (events[c.id] || []).forEach((e) => {
      const key = e.contact || "unknown";
      if (!byContact.has(key)) byContact.set(key, { opened: false, downloaded: false, clicked: false, last: null });
      const rec = byContact.get(key);
      if (e.type === "opened") rec.opened = true;
      if (e.type === "downloaded") rec.downloaded = true;
      if (e.type === "clicked") rec.clicked = true;
      if (e.timestamp && (!rec.last || e.timestamp > rec.last)) rec.last = e.timestamp;
    });
    let n = 0;
    byContact.forEach((rec) => { n++; if (rec.opened) opens++; if (rec.downloaded) downloads++; if (rec.clicked) clicks++; recipients.push({ label: `Contact ${n}`, campaign: c.id, opened: rec.opened, downloaded: rec.downloaded, last: rec.last }); });
  }
  const openRate = sent ? Math.round(opens / sent * 100) : 0;
  const funnel = [["Sent", sent, 100], ["Opened", opens, sent ? Math.round(opens / sent * 100) : 0], ["Downloaded", downloads, sent ? Math.round(downloads / sent * 100) : 0]];

  return (
    <section>
      <div className="page-head"><div className="eyebrow">Analytics</div><h1>Pitch analytics</h1><p>Live email and engagement tracking for your campaigns.</p></div>

      <div className="card" style={{ marginBottom: "18px" }}>
        <h3 style={{ fontSize: "17px", marginBottom: "14px" }}>Campaign status</h3>
        <div className="stats" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
          <div className="stat"><div className="v" style={{ color: "var(--info)" }}>{underReview.length}</div><div className="l">Under review</div></div>
          <div className="stat"><div className="v" style={{ color: "var(--ok)" }}>{approved.length}</div><div className="l">Approved</div></div>
          <div className="stat"><div className="v" style={{ color: "var(--bad)" }}>{rejected.length}</div><div className="l">Rejected</div></div>
        </div>
        {rejected.length > 0 && (
          <div>
            <div className="navlabel" style={{ padding: "18px 0 8px" }}>Rejection feedback</div>
            {rejected.map((c, i) => {
              const title = (Array.isArray(c.beats) && c.beats.length) ? c.beats.map((b) => b.title).filter(Boolean).join(", ") : "Campaign";
              return (
                <div key={i} style={{ background: "var(--ink)", border: "1px solid var(--bad)", borderRadius: "12px", padding: "16px", marginBottom: "10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: "14px" }}>{title}</strong>
                    {c.creditRefunded && <span className="pill downloaded">{c.creditCost} credit{c.creditCost !== 1 ? "s" : ""} refunded</span>}
                  </div>
                  <p style={{ margin: "10px 0 0", fontSize: "13px" }}><span style={{ color: "var(--bad)", fontWeight: 600 }}>Reason:</span> {c.rejectionReason || "No reason provided"}</p>
                  {c.rejectionNote && <p style={{ margin: "8px 0 0", color: "var(--bone-dim)", fontSize: "13px" }}>{c.rejectionNote}</p>}
                  <p style={{ margin: "10px 0 0", color: "var(--bone-dim)", fontSize: "12px" }}>Submitted {fmtDate(cms(c))}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="stats">
        <div className="stat"><div className="v">{sent}</div><div className="l">Emails sent</div></div>
        <div className="stat"><div className="v">{opens}</div><div className="l">Opened</div><div className="d up">{sent ? `${openRate}% open rate` : ""}</div></div>
        <div className="stat"><div className="v">{downloads}</div><div className="l">Beats downloaded</div></div>
        <div className="stat"><div className="v">{clicks}</div><div className="l">Link clicks</div></div>
      </div>

      <div className="card" style={{ marginTop: "18px" }}>
        <h3 style={{ fontSize: "17px", marginBottom: "8px" }}>Conversion funnel</h3>
        {sent ? funnel.map(([k, val, pct]) => (
          <div className="meter" key={k}><div className="top"><span>{k}</span><span className="pct">{val} · {pct}%</span></div><div className="bar"><i style={{ width: pct + "%" }} /></div></div>
        )) : <p className="hint">Engagement data will appear once pitches go out.</p>}
      </div>

      <div className="card">
        <h3 style={{ fontSize: "17px", marginBottom: "14px" }}>Per-pitch activity</h3>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Recipient</th><th>Campaign</th><th>Opened</th><th>Downloaded</th><th>Last activity</th></tr></thead>
            <tbody>
              {recipients.length ? recipients.map((r, i) => (
                <tr key={i}>
                  <td>{r.label}</td>
                  <td className="mono" style={{ fontSize: "12px" }}>{r.campaign}</td>
                  <td>{r.opened ? <span className="pill opened">opened</span> : <span style={{ color: "var(--bone-dim)" }}>—</span>}</td>
                  <td>{r.downloaded ? <span className="pill downloaded">downloaded</span> : <span style={{ color: "var(--bone-dim)" }}>—</span>}</td>
                  <td style={{ color: "var(--bone-dim)" }}>{fmt(r.last)}</td>
                </tr>
              )) : <tr><td colSpan="5" style={{ color: "var(--bone-dim)", textAlign: "center", padding: "24px" }}>No engagement yet — opens and downloads appear here once recipients interact.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// ---------------- Paperwork ----------------
function Paperwork({ campaigns, showToast }) {
  const beatTitles = useMemo(() => {
    const set = new Set();
    campaigns.forEach((c) => Array.isArray(c.beats) && c.beats.forEach((b) => b.title && set.add(b.title)));
    return [...set];
  }, [campaigns]);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [writers, setWriters] = useState([{ name: "", role: "Producer", pct: "", ig: "" }]);
  const total = writers.reduce((t, w) => t + (parseFloat(w.pct) || 0), 0);
  const ok = Math.abs(total - 100) < 0.01;
  const patch = (i, p) => setWriters((prev) => prev.map((w, j) => (j === i ? { ...w, ...p } : w)));

  return (
    <section>
      <div className="page-head"><div className="eyebrow">Documents</div><h1>Paperwork</h1><p>Build a split sheet, log collaborators, and upload executed agreements.</p></div>
      <div className="card">
        <h3 style={{ fontSize: "18px", marginBottom: "14px" }}>Split sheet</h3>
        <div className="row2">
          <div className="field"><label>Song / beat title <span className="req">*</span></label>
            <select className="inp" value={title} onChange={(e) => setTitle(e.target.value)}>
              {beatTitles.length ? <><option value="">Select a beat…</option>{beatTitles.map((t) => <option key={t}>{t}</option>)}</> : <option value="">No beats yet — start a campaign first</option>}
            </select>
          </div>
          <div className="field"><label>Date</label><input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr .7fr 1fr auto", gap: "10px", margin: "14px 0 8px" }} className="hint mono">
          <span>Writer / producer</span><span>Role</span><span>Split %</span><span>Instagram / PRO</span><span />
        </div>
        {writers.map((w, i) => (
          <div className="wrow" key={i}>
            <input className="inp" placeholder="Name" value={w.name} onChange={(e) => patch(i, { name: e.target.value })} />
            <select className="inp" value={w.role} onChange={(e) => patch(i, { role: e.target.value })}><option>Producer</option><option>Writer</option><option>Vocalist</option><option>Co-producer</option></select>
            <input className="inp" type="number" min="0" max="100" placeholder="0" value={w.pct} onChange={(e) => patch(i, { pct: e.target.value })} />
            <input className="inp" placeholder="@ig / PRO" value={w.ig} onChange={(e) => patch(i, { ig: e.target.value })} />
            <button className="iconbtn" onClick={() => setWriters((p) => p.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button className="btn btn-ghost btn-sm" onClick={() => setWriters((p) => [...p, { name: "", role: "Producer", pct: "", ig: "" }])}>+ Add writer</button>
        <div className="splitbar"><div className={`num ${ok ? "ok" : "bad"}`}>{total}%</div><div className="hint">splits must total exactly 100% to submit</div></div>
        <div style={{ marginTop: "18px", display: "flex", gap: "12px" }}>
          <button className="btn btn-gold" disabled={!ok} onClick={() => { if (!title) { showToast("Add the song title first."); return; } showToast("Split sheet submitted — saved to this campaign. (demo)"); }}>Submit split sheet</button>
          <button className="btn btn-ghost" onClick={() => showToast("Generate a PDF copy server-side")}>Download PDF</button>
        </div>
      </div>
      <div className="card">
        <h3 style={{ fontSize: "18px", marginBottom: "12px" }}>Upload signed documents</h3>
        <div className="drop" onClick={() => showToast("Wire uploads to Firebase Storage")}><strong>Drop split sheets, work-for-hire, or licenses</strong><br /><span className="hint">PDF · DOCX · PNG — stored against this campaign</span></div>
      </div>
      <div className="card">
        <h3 style={{ fontSize: "17px", marginBottom: "14px" }}>On file</h3>
        <div style={{ overflowX: "auto" }}>
          <table><thead><tr><th>Document</th><th>Type</th><th>Status</th><th>Updated</th></tr></thead>
            <tbody><tr><td colSpan="4" style={{ color: "var(--bone-dim)", textAlign: "center", padding: "24px" }}>No documents on file yet.</td></tr></tbody></table>
        </div>
      </div>
    </section>
  );
}

// ---------------- Loop Drops ----------------
function LoopDrops({ user, loopBalance, showToast }) {
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("Trap");
  const [bpm, setBpm] = useState("");
  const [key, setKey] = useState(KEY_OPTS[0]);
  const [tags, setTags] = useState("");
  const [file, setFile] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [myLoops, setMyLoops] = useState(null);

  const loadLoops = async () => {
    if (!user) return;
    try {
      const snap = await getDocs(query(collection(db, "loops"), where("makerUid", "==", user.uid), orderBy("createdAt", "desc")));
      setMyLoops(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch { setMyLoops([]); }
  };
  useEffect(() => { loadLoops(); /* eslint-disable-next-line */ }, [user]);

  async function submit() {
    if (!title.trim()) { setMsg({ text: "Add a title.", kind: "err" }); return; }
    if (!file) { setMsg({ text: "Attach an audio file.", kind: "err" }); return; }
    setBusy(true); setMsg(null);
    try {
      const ext = file.name.split(".").pop().toLowerCase();
      const safeName = title.replace(/[/\\:*?"<>|]/g, "") + "." + ext;
      const folder = Date.now().toString(36) + Math.random().toString(36).slice(2);
      const storagePath = `loops/${user.uid}/${folder}/${safeName}`;
      await uploadFile(file, storagePath, setProgress);
      await submitLoopFn({ title: title.trim(), bpm: bpm || null, key, genre, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), storagePath });
      setMsg({ text: "Loop submitted!", kind: "ok" });
      setTitle(""); setBpm(""); setTags(""); setFile(null); setProgress(0);
      loadLoops();
      setTimeout(() => setMsg(null), 3000);
    } catch (e) { setMsg({ text: e.message || "Submission failed.", kind: "err" }); }
    finally { setBusy(false); }
  }

  return (
    <section>
      <div className="page-head"><div className="eyebrow">Loop Drops</div><h1>Loop marketplace</h1><p>Submit loops to the pool, or pull them into your beats if you're verified.</p></div>
      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "16px", marginBottom: "18px" }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: "6px" }}>Loop credits</div>
          <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: "36px", lineHeight: 1 }}>{loopBalance}<span style={{ fontSize: "15px", fontWeight: 400, color: "var(--bone-dim)", fontFamily: "'Inter'" }}> available</span></div>
          <div className="hint" style={{ marginTop: "4px" }}>1 credit per loop submitted · replenish monthly with your plan</div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ fontSize: "18px", marginBottom: "18px" }}>Upload a loop</h3>
        <div className="row2">
          <div className="field"><label>Title <span className="req">*</span></label><input className="inp" placeholder="e.g. Dark trap 808" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="field"><label>Genre</label><select className="inp" value={genre} onChange={(e) => setGenre(e.target.value)}>{["Trap", "Drill", "R&B", "Pop", "Afrobeats", "Hip-Hop", "Other"].map((g) => <option key={g}>{g}</option>)}</select></div>
        </div>
        <div className="row3">
          <div className="field"><label>BPM</label><input className="inp" type="number" min="40" max="300" placeholder="140" value={bpm} onChange={(e) => setBpm(e.target.value)} /></div>
          <div className="field"><label>Key</label><select className="inp" value={key} onChange={(e) => setKey(e.target.value)}>{KEY_OPTS.map((k) => <option key={k}>{k}</option>)}</select></div>
          <div className="field"><label>Tags (comma-separated)</label><input className="inp" placeholder="dark, 808, minimal" value={tags} onChange={(e) => setTags(e.target.value)} /></div>
        </div>
        <div className="field">
          <label>Audio file <span className="req">*</span></label>
          <label className={`upload-btn${file ? " done" : ""}`} style={{ display: "inline-block" }}>
            {file ? (file.name.length > 28 ? file.name.slice(0, 26) + "…" : file.name) : "Attach MP3 / WAV"}
            <input type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" style={{ display: "none" }} onChange={(e) => setFile(e.target.files[0] || null)} />
          </label>
          {progress > 0 && progress < 100 && <div className="progress-bar show"><div className="progress-fill" style={{ width: progress + "%" }} /></div>}
        </div>
        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
        <button className="btn btn-gold" disabled={busy} onClick={submit}>{busy ? "Submitting…" : "Submit loop — 1 credit"}</button>
      </div>

      <div className="card" style={{ marginTop: "18px" }}>
        <h3 style={{ fontSize: "17px", marginBottom: "14px" }}>My submitted loops</h3>
        {myLoops === null ? <p className="hint" style={{ textAlign: "center", padding: "20px" }}>Loading…</p>
          : myLoops.length === 0 ? <p className="hint" style={{ textAlign: "center", padding: "20px" }}>No loops submitted yet.</p>
            : myLoops.map((l) => {
              const spec = [l.genre, l.key, l.bpm && l.bpm + " BPM"].filter(Boolean).join(" · ");
              return (
                <div key={l.id} style={{ background: "var(--ink)", border: "1px solid var(--line-strong)", borderRadius: "12px", padding: "14px", marginBottom: "10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "15px" }}>{l.title}</div>
                      <div className="hint" style={{ marginTop: "4px" }}>{spec}</div>
                      {l.tags && l.tags.length > 0 && <div className="hint" style={{ marginTop: "4px" }}>{l.tags.map((t, i) => <span key={i} style={{ display: "inline-block", background: "var(--ink-3)", border: "1px solid var(--line)", borderRadius: "999px", padding: "2px 8px", fontSize: "11px", margin: "2px 3px 0 0" }}>{t}</span>)}</div>}
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <span className="pill" style={{ background: "rgba(124,226,164,.14)", color: l.status === "live" ? "var(--ok)" : "var(--bone-dim)" }}>{l.status || "live"}</span>
                      <div className="hint" style={{ marginTop: "6px" }}>{l.downloads || 0} pull{l.downloads !== 1 ? "s" : ""}</div>
                    </div>
                  </div>
                </div>
              );
            })}
      </div>

      <div className="card" style={{ background: "var(--ink-3)", borderColor: "var(--line)", marginTop: 0 }}>
        <p style={{ fontSize: "13px", color: "var(--bone-dim)", margin: 0 }}>Want to pull loops? Visit <a href="/verified" style={{ color: "var(--gold)", fontWeight: 600 }}>PluggUrBeat Verified</a> — the curated library for verified producers, A&amp;Rs, and artists.</p>
      </div>
    </section>
  );
}

// ---------------- Billing ----------------
function Billing({ tier, profile, pitchBalance, loopBalance, startSubscription, buyPack }) {
  const status = profile.subscription?.status || (tier === "free" ? "no active plan" : "active");
  const renews = profile.subscription?.renewsAt;
  const renewMs = renews?.toMillis ? renews.toMillis() : (typeof renews === "number" ? renews : null);
  const planBtn = (plan) => {
    if (tier === plan) return { label: "Current plan", disabled: true, cls: "btn-ghost", outline: "2px solid var(--gold)" };
    return { label: TIER_RANK[plan] > TIER_RANK[tier] ? "Upgrade" : "Switch to " + cap(plan), disabled: false, cls: "btn-gold", outline: "none" };
  };
  const pb = planBtn("plugg"), pr = planBtn("pro");

  return (
    <section>
      <div className="page-head"><div className="eyebrow">Billing</div><h1>Plans &amp; credits</h1><p>Manage your subscription and top up campaign or loop credits.</p></div>

      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "20px" }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: "6px" }}>Current plan</div>
          <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: "30px", lineHeight: 1 }}>{cap(tier)}</div>
          <div className="hint" style={{ marginTop: "4px" }}>{tier === "free" ? "Subscribe to start running campaigns" : `Status: ${status}${renewMs ? " · renews " + new Date(renewMs).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}`}</div>
        </div>
        <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
          <div style={balTile}><div style={balNum}>{pitchBalance}</div><div className="hint" style={{ marginTop: "2px" }}>Pitch credits</div></div>
          <div style={balTile}><div style={balNum}>{loopBalance}</div><div className="hint" style={{ marginTop: "2px" }}>Loop credits</div></div>
        </div>
      </div>

      <h3 style={{ fontSize: "18px", margin: "26px 0 14px" }}>Subscription</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: "16px" }}>
        <div className="card" style={{ margin: 0, display: "flex", flexDirection: "column", outline: pb.outline }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><h4 style={{ fontSize: "20px" }}>Plugg</h4><div><span style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: "24px" }}>$29</span><span className="hint">/mo</span></div></div>
          <ul style={planUl}><li>15 pitch + 20 loop credits monthly</li><li>Up to 15 beats, 3 lanes per campaign</li><li>Approved campaigns added to Verified library</li></ul>
          <button className={`btn ${pb.cls}`} style={{ width: "100%", marginTop: "auto" }} disabled={pb.disabled} onClick={(e) => startSubscription("plugg", e.currentTarget)}>{pb.label}</button>
        </div>
        <div className="card" style={{ margin: 0, display: "flex", flexDirection: "column", borderColor: "var(--gold)", outline: pr.outline }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><h4 style={{ fontSize: "20px" }}>Pro <span className="mono" style={{ fontSize: "10px", color: "var(--gold)", border: "1px solid var(--gold-deep)", borderRadius: "999px", padding: "2px 8px", marginLeft: "4px" }}>EMAIL BLAST</span></h4><div><span style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: "24px" }}>$99</span><span className="hint">/mo</span></div></div>
          <ul style={planUl}><li>50 pitch + 60 loop credits monthly</li><li>Up to 25 beats, unlimited lanes</li><li>A&amp;R / management lanes unlocked</li><li>Approved campaigns email directly to inboxes</li></ul>
          <button className={`btn ${pr.cls}`} style={{ width: "100%", marginTop: "auto" }} disabled={pr.disabled} onClick={(e) => startSubscription("pro", e.currentTarget)}>{pr.label}</button>
        </div>
      </div>

      <h3 style={{ fontSize: "18px", margin: "26px 0 14px" }}>Campaign (pitch) credit packs</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "16px" }}>
        <PackCard label="10 credits" sub="$25 · $2.50 each" onBuy={(e) => buyPack("pack10", e.currentTarget)} />
        <PackCard label="25 credits" sub="$50 · $2.00 each" onBuy={(e) => buyPack("pack25", e.currentTarget)} />
      </div>

      <h3 style={{ fontSize: "18px", margin: "26px 0 14px" }}>Loop credit packs</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "16px" }}>
        <PackCard label="20 credits" sub="$10 · $0.50 each" onBuy={(e) => buyPack("loop20", e.currentTarget)} />
        <PackCard label="50 credits" sub="$20 · $0.40 each" onBuy={(e) => buyPack("loop50", e.currentTarget)} />
      </div>

      <p className="hint" style={{ marginTop: "24px" }}>Secure checkout via Stripe. Credits are added to your balance the moment payment clears.</p>
    </section>
  );
}
const balTile = { background: "var(--ink)", border: "1px solid var(--line)", borderRadius: "12px", padding: "14px 20px", textAlign: "center", minWidth: "120px" };
const balNum = { fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: "26px" };
const planUl = { listStyle: "none", padding: 0, margin: "14px 0", fontSize: "13px", color: "var(--bone-dim)", display: "flex", flexDirection: "column", gap: "8px" };
function PackCard({ label, sub, onBuy }) {
  return (
    <div className="card" style={{ margin: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px" }}>
      <div><div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: "22px" }}>{label}</div><div className="hint">{sub}</div></div>
      <button className="btn btn-ghost btn-sm" onClick={onBuy}>Buy</button>
    </div>
  );
}

// ---------------- Profile Modal ----------------
function ProfileModal({ user, profile, onClose, setProfile, showToast }) {
  const [name, setName] = useState(profile.displayName || user?.displayName || "");
  const [location, setLocation] = useState(profile.location || "");
  const [bio, setBio] = useState(profile.bio || "");
  const [avatar, setAvatar] = useState(null);
  const [preview, setPreview] = useState(profile.avatarUrl || "");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      let avatarPath = profile.avatarPath || null;
      if (avatar) {
        const ext = (avatar.name.split(".").pop() || "jpg").toLowerCase();
        avatarPath = `avatars/${user.uid}/avatar.${ext}`;
        await uploadBytesResumable(ref(storage, avatarPath), avatar);
      }
      const data = { displayName: name.trim(), location: location.trim(), bio: bio.trim(), ...(avatarPath ? { avatarPath } : {}) };
      await setDoc(doc(db, "users", user.uid), data, { merge: true });
      let avatarUrl = profile.avatarUrl;
      if (avatar) { try { avatarUrl = await getDownloadURL(ref(storage, avatarPath)); } catch { /* ignore */ } }
      setProfile((prev) => ({ ...prev, ...data, avatarUrl }));
      setMsg({ text: "Saved.", kind: "ok" });
      setTimeout(onClose, 700);
    } catch (e) { setMsg({ text: e.message || "Could not save.", kind: "err" }); }
    finally { setBusy(false); }
  }

  const initial = (name || user?.email || "?")[0].toUpperCase();
  return (
    <div className="overlay show" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true">
        <button className="x" onClick={onClose} aria-label="Close">✕</button>
        <h3 style={{ fontSize: "22px", marginBottom: "18px" }}>Profile &amp; settings</h3>
        <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "18px" }}>
          <div style={{ width: "72px", height: "72px", borderRadius: "50%", flex: "none", background: preview ? `center/cover url("${preview}")` : "linear-gradient(135deg,var(--gold),var(--violet))", display: "grid", placeItems: "center", fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: "28px", color: "#1a1405" }}>{preview ? "" : initial}</div>
          <div>
            <label className="btn btn-ghost btn-sm" style={{ display: "inline-block" }}>Upload photo
              <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={(e) => { const f = e.target.files[0]; if (f) { setAvatar(f); setPreview(URL.createObjectURL(f)); } }} />
            </label>
            <p className="hint" style={{ margin: "6px 0 0" }}>PNG, JPG or WEBP · square works best</p>
          </div>
        </div>
        <div className="field"><label>Display name</label><input className="inp" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>Location</label><input className="inp" placeholder="City, Country" value={location} onChange={(e) => setLocation(e.target.value)} /></div>
        <div className="field"><label>Bio</label><textarea className="inp" rows="4" placeholder="Tell us about your sound…" style={{ resize: "vertical" }} value={bio} onChange={(e) => setBio(e.target.value)} /></div>
        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
        <button className="btn btn-gold" style={{ width: "100%" }} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save profile"}</button>
      </div>
    </div>
  );
}
