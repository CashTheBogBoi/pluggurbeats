import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, setDoc, collection, query, where, orderBy, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { auth, db, storage } from "../firebase.js";
import { useLiveDoc, useLiveCollection, call } from "../lib/live.js";
import {
  LayoutDashboard, Rocket, BarChart3, FileText, Disc3, CreditCard, ArrowLeft,
  LogOut, Menu, X, Plus, Trash2, Upload, Check, ChevronDown, Music2, Mail, Phone,
  Settings, Sparkles, TrendingUp, Clock, CheckCircle2, XCircle, ArrowRight, Wallet
} from "lucide-react";

/* ============================ domain constants ============================ */
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
const GENRES = ["Trap", "Drill", "R&B", "Pop", "Afrobeats", "Hip-Hop", "Other"];
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function uploadFile(file, path, onProgress) {
  const task = uploadBytesResumable(ref(storage, path), file);
  return new Promise((resolve, reject) => {
    task.on("state_changed",
      (snap) => onProgress && onProgress(Math.round(snap.bytesTransferred / snap.totalBytes * 100)),
      reject, () => resolve(path));
  });
}

const NAV = [
  { v: "overview", label: "Overview", Icon: LayoutDashboard },
  { v: "loops", label: "Loop Drops", Icon: Disc3 },
  { v: "submit", label: "Start a campaign", Icon: Rocket },
  { v: "analytics", label: "Pitch analytics", Icon: BarChart3 },
  { v: "paperwork", label: "Paperwork", Icon: FileText },
  { v: "billing", label: "Billing & credits", Icon: CreditCard }
];

/* ============================ ui primitives ============================ */
const Card = ({ className = "", children, ...p }) => (
  <div className={`rounded-2xl border border-line bg-ink-2/70 backdrop-blur-sm ${className}`} {...p}>{children}</div>
);
const Eyebrow = ({ children }) => (
  <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-gold flex items-center gap-2.5">
    <span className="h-px w-5 bg-gold/70" />{children}
  </div>
);
const GoldBtn = ({ className = "", children, ...p }) => (
  <button className={`inline-flex items-center justify-center gap-2 rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-[#1a1405] transition active:translate-y-px hover:bg-gold-deep disabled:opacity-50 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet ${className}`} {...p}>{children}</button>
);
const GhostBtn = ({ className = "", children, ...p }) => (
  <button className={`inline-flex items-center justify-center gap-2 rounded-full border border-strong bg-transparent px-5 py-2.5 text-sm font-semibold text-bone transition hover:border-bone hover:bg-white/5 active:translate-y-px disabled:opacity-50 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet ${className}`} {...p}>{children}</button>
);
const inputCls = "w-full rounded-xl border border-strong bg-ink px-3.5 py-2.5 text-sm text-bone placeholder:text-bone-dim/50 transition focus:border-gold/60 focus:outline-none focus:ring-1 focus:ring-gold/30";
const Label = ({ children }) => <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-bone-dim">{children}</label>;
const SectionHead = ({ eyebrow, title, sub }) => (
  <div className="mb-6">
    {eyebrow && <div className="mb-2"><Eyebrow>{eyebrow}</Eyebrow></div>}
    <h1 className="font-display text-3xl tracking-tight text-bone">{title}</h1>
    {sub && <p className="mt-2 max-w-xl text-sm text-bone-dim">{sub}</p>}
  </div>
);
const Stat = ({ value, label, accent = "text-bone", hint }) => (
  <Card className="p-4">
    <div className={`font-display text-3xl leading-none ${accent}`}>{value}</div>
    <div className="mt-2 text-[13px] text-bone-dim">{label}</div>
    {hint && <div className="mt-1 text-[11px] text-ok">{hint}</div>}
  </Card>
);
const Skeleton = ({ className = "" }) => (
  <div className={`relative overflow-hidden rounded-xl bg-white/5 ${className}`}>
    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[shimmer_1.4s_infinite]" />
  </div>
);

/* ============================ shell ============================ */
export default function Dashboard() {
  const navigate = useNavigate();
  const [view, setView] = useState("overview");
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [toast, setToast] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);

  const toastTimer = useRef(null);
  const reconcileTried = useRef(false);
  const ensureTried = useRef(false);
  const lastAvatarPath = useRef(null);

  const showToast = (t) => { setToast(t); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(""), 2800); };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u || !u.emailVerified) { signOut(auth).then(() => navigate("/")); return; }
      setUser(u); setAuthReady(true);
    });
    return () => unsub();
  }, [navigate]);

  const uid = user?.uid;
  const { data: profileDoc } = useLiveDoc(["user", uid], () => doc(db, "users", uid), { enabled: !!uid });
  const { data: campaignsData } = useLiveCollection(["campaigns", uid], () => collection(db, "users", uid, "campaigns"), { enabled: !!uid });
  const campaigns = campaignsData || [];
  const profile = (profileDoc && !profileDoc.__error) ? { ...profileDoc, email: user?.email, avatarUrl: avatarUrl || undefined } : {};

  const tier = profile.subscription?.tier || "free";
  const caps = TIER_CAPS[tier] || TIER_CAPS.free;
  const pitchBalance = profile.pitchCredits?.balance || 0;
  const loopBalance = profile.loopCredits?.balance || 0;

  useEffect(() => {
    if (!uid || ensureTried.current) return;
    if (profileDoc === null) {
      ensureTried.current = true;
      setDoc(doc(db, "users", uid), {
        displayName: user.displayName || "", email: user.email || "", phone: "",
        createdAt: serverTimestamp(),
        subscription: { tier: "free", status: "active", stripeCustomerId: null, stripeSubId: null, renewsAt: null },
        pitchCredits: { balance: 0, monthlyGrant: 0, lastGrantAt: null },
        loopCredits: { balance: 5, monthlyGrant: 5, lastGrantAt: serverTimestamp() },
        verifiedPuller: false
      }).catch((e) => console.error("ensure user doc:", e.message));
    }
  }, [uid, profileDoc, user]);

  useEffect(() => {
    const p = profileDoc?.avatarPath;
    if (p && p !== lastAvatarPath.current) { lastAvatarPath.current = p; getDownloadURL(ref(storage, p)).then(setAvatarUrl).catch(() => {}); }
  }, [profileDoc?.avatarPath]);

  useEffect(() => {
    if (!profileDoc || profileDoc.__error || reconcileTried.current) return;
    const t = profileDoc.subscription?.tier || "free";
    const grantMissing = ["plugg", "pro"].includes(t) && (!profileDoc.pitchCredits?.lastGrantAt || !profileDoc.subscription?.renewsAt);
    if (grantMissing) { reconcileTried.current = true; call("reconcileCredits").then((d) => { if (d?.granted) showToast(`Your ${cap(t)} credits are now active.`); }).catch(() => {}); }
  }, [profileDoc]);

  useEffect(() => {
    const p = new URLSearchParams(location.search);
    let msg = null;
    if (p.get("sub") === "success") msg = "Subscription active — your credits will appear shortly.";
    if (p.get("pack") === "success") msg = "Payment received — credits added to your balance.";
    if (p.get("sub") === "cancel" || p.get("pack") === "cancel") msg = "Checkout canceled.";
    if (msg) { setTimeout(() => showToast(msg), 500); history.replaceState({}, "", location.pathname); setView("billing"); }
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => { if (!e.target.closest("[data-me]") && !e.target.closest("[data-menu]")) setMenuOpen(false); };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [menuOpen]);

  const go = (v) => { setView(v); setNavOpen(false); window.scrollTo(0, 0); };

  async function startSubscription(plan, btn) {
    const orig = btn.textContent; btn.disabled = true; btn.textContent = "Please wait…";
    try { const data = await call("createSubscriptionCheckout", { plan }); if (data?.url) location.href = data.url; else throw new Error("No checkout URL returned."); }
    catch (e) { showToast(e.message || "Could not start checkout."); btn.disabled = false; btn.textContent = orig; }
  }
  async function buyPack(pack, btn) {
    const orig = btn.textContent; btn.disabled = true; btn.textContent = "Redirecting…";
    try { const data = await call("buyCreditPack", { pack }); if (data?.url) location.href = data.url; else throw new Error("No checkout URL returned."); }
    catch (e) { showToast(e.message || "Could not start checkout."); btn.disabled = false; btn.textContent = orig; }
  }

  const name = profile.displayName || user?.displayName || user?.email || "Producer";
  const initial = (name || "?")[0].toUpperCase();

  if (!authReady) {
    return <div className="grid min-h-screen place-items-center bg-ink text-bone-dim"><div className="flex items-center gap-3 text-sm"><span className="h-4 w-4 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />Loading studio…</div></div>;
  }

  return (
    <div className="min-h-screen bg-ink font-sans text-bone">
      {/* mobile scrim */}
      {navOpen && <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setNavOpen(false)} />}

      {/* sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col border-r border-line bg-ink-2/95 px-4 py-5 backdrop-blur-xl transition-transform lg:translate-x-0 ${navOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-2.5 font-display text-lg tracking-tight">
            <span className="h-2.5 w-2.5 rounded-full bg-gold shadow-glow" /> PluggurBeats
          </div>
          <button className="lg:hidden text-bone-dim hover:text-bone" onClick={() => setNavOpen(false)}><X size={20} /></button>
        </div>

        <div className="mt-7 mb-2 px-2 font-mono text-[10px] uppercase tracking-[0.16em] text-bone-dim">Workspace</div>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ v, label, Icon }) => {
            const active = view === v;
            return (
              <button key={v} onClick={() => go(v)}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${active ? "bg-gold/12 text-bone" : "text-bone-dim hover:bg-white/5 hover:text-bone"}`}>
                <Icon size={18} className={active ? "text-gold" : "text-bone-dim group-hover:text-bone"} />
                {label}
                {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-gold" />}
              </button>
            );
          })}
          <a href="/" className="mt-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-bone-dim transition hover:bg-white/5 hover:text-bone">
            <ArrowLeft size={18} /> Marketing site
          </a>
        </nav>

        <div className="relative mt-auto">
          {menuOpen && (
            <div data-menu className="absolute bottom-[58px] left-0 right-0 overflow-hidden rounded-2xl border border-strong bg-ink-3 shadow-card">
              <button onClick={() => { setMenuOpen(false); setProfileOpen(true); }} className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-bone hover:bg-white/5"><Settings size={15} /> Profile &amp; settings</button>
              <button onClick={() => { setMenuOpen(false); go("billing"); }} className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-bone hover:bg-white/5"><CreditCard size={15} /> Billing</button>
              <div className="h-px bg-line" />
              <button onClick={() => signOut(auth)} className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-bad hover:bg-bad/10"><LogOut size={15} /> Sign out</button>
            </div>
          )}
          <button data-me onClick={() => setMenuOpen((v) => !v)} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-ink p-2.5 text-left transition hover:border-strong">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-gold to-violet font-display text-sm text-[#1a1405]" style={avatarUrl ? { backgroundImage: `url("${avatarUrl}")`, backgroundSize: "cover" } : undefined}>{avatarUrl ? "" : initial}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{profile.displayName || "—"}</span>
              <span className="block truncate text-[11px] text-bone-dim">{user?.email}</span>
            </span>
            <ChevronDown size={15} className={`text-bone-dim transition ${menuOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
      </aside>

      {/* main */}
      <div className="lg:pl-[264px]">
        {/* top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-ink/80 px-4 py-3 backdrop-blur-xl sm:px-6">
          <button className="lg:hidden text-bone-dim hover:text-bone" onClick={() => setNavOpen(true)}><Menu size={22} /></button>
          <div className="flex items-center gap-2.5 font-display text-base lg:hidden"><span className="h-2 w-2 rounded-full bg-gold" /> PluggurBeats</div>
          <div className="ml-auto"><CreditPills tier={tier} pitch={pitchBalance} loop={loopBalance} onClick={() => go("billing")} /></div>
        </header>

        <main className="mx-auto max-w-[1180px] px-4 py-8 sm:px-6 lg:px-10">
          <div key={view} className="animate-fade-up">
            {view === "overview" && <Overview name={name} campaigns={campaigns} tier={tier} pitch={pitchBalance} go={go} />}
            {view === "submit" && <CampaignBuilder tier={tier} caps={caps} pitchBalance={pitchBalance} user={user} profile={profile} campaignCount={campaigns.length} showToast={showToast} onSubmitted={() => go("analytics")} />}
            {view === "analytics" && <Analytics campaigns={campaigns} uid={uid} />}
            {view === "paperwork" && <Paperwork campaigns={campaigns} showToast={showToast} />}
            {view === "loops" && <LoopDrops user={user} loopBalance={loopBalance} showToast={showToast} />}
            {view === "billing" && <Billing tier={tier} profile={profile} pitchBalance={pitchBalance} loopBalance={loopBalance} startSubscription={startSubscription} buyPack={buyPack} />}
          </div>
        </main>
      </div>

      {profileOpen && <ProfileModal user={user} profile={profile} onClose={() => setProfileOpen(false)} />}
      <Toast text={toast} />
    </div>
  );
}

function CreditPills({ tier, pitch, loop, onClick }) {
  return (
    <button onClick={onClick} className="group flex items-center gap-1.5 rounded-full border border-line bg-ink-2 p-1 pr-2 transition hover:border-strong">
      <span className="flex items-center gap-1.5 rounded-full bg-gold/10 px-2.5 py-1 text-[13px] font-semibold text-gold"><Rocket size={13} /> {pitch}</span>
      <span className="flex items-center gap-1.5 rounded-full bg-ok/10 px-2.5 py-1 text-[13px] font-semibold text-ok"><Disc3 size={13} /> {loop}</span>
      <span className="hidden px-1 font-mono text-[10px] uppercase tracking-wider text-bone-dim sm:inline">{tier}</span>
    </button>
  );
}

function Toast({ text }) {
  return (
    <div className={`pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-strong bg-ink-3 px-5 py-3 text-sm font-medium text-bone shadow-card transition-all ${text ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}>{text}</div>
  );
}

/* ============================ overview ============================ */
function Overview({ name, campaigns, tier, pitch, go }) {
  const sent = campaigns.reduce((s, c) => s + (Array.isArray(c.pitchedTo) ? c.pitchedTo.length : 0), 0);
  const opens = campaigns.reduce((s, c) => s + (c.opens || 0), 0);
  const downs = campaigns.reduce((s, c) => s + (c.downloads || 0), 0);
  const recent = [...campaigns].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)).slice(0, 4);
  const firstName = (name || "").split(" ")[0] || name;

  return (
    <section>
      <SectionHead eyebrow="Welcome back" title={`Hey ${firstName} 👋`} sub="Here's where your records stand right now." />

      {tier === "free" && (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-4 border-gold/30 bg-gold/[0.06] p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gold/15 text-gold"><Sparkles size={20} /></span>
            <div>
              <div className="font-display text-lg">Activate your studio</div>
              <div className="text-sm text-bone-dim">Subscribe to Plugg or Pro to start pitching campaigns.</div>
            </div>
          </div>
          <GoldBtn onClick={() => go("billing")}>See plans <ArrowRight size={16} /></GoldBtn>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat value={campaigns.length || 0} label="Campaigns submitted" />
        <Stat value={sent || 0} label="Pitches sent" />
        <Stat value={sent ? Math.round(opens / sent * 100) + "%" : "—"} label="Open rate" accent="text-gold" />
        <Stat value={downs || 0} label="Beat downloads" accent="text-ok" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-lg">Recent campaigns</h3>
            <button onClick={() => go("analytics")} className="flex items-center gap-1 text-[13px] text-gold hover:underline">View all <ArrowRight size={13} /></button>
          </div>
          {recent.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/5 text-bone-dim"><Music2 size={22} /></span>
              <p className="text-sm text-bone-dim">No campaigns yet. Load your beats and pick your lanes.</p>
              <GoldBtn onClick={() => go("submit")}><Plus size={16} /> Start a campaign</GoldBtn>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-line">
              {recent.map((c) => {
                const title = (c.beats || []).map((b) => b.title).filter(Boolean).join(", ") || "Campaign";
                return (
                  <div key={c.id} className="flex items-center gap-3 py-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 text-bone-dim"><Music2 size={16} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{title}</div>
                      <div className="truncate text-[12px] text-bone-dim">{(c.beats || []).length} beat{(c.beats || []).length !== 1 ? "s" : ""} · {(c.targets || []).length} lane{(c.targets || []).length !== 1 ? "s" : ""}</div>
                    </div>
                    <StatusBadge status={c.status} />
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 font-display text-lg">Quick actions</h3>
          <div className="flex flex-col gap-2.5">
            {[
              { label: "Start a campaign", desc: "Beats → lanes → pitch", Icon: Rocket, v: "submit" },
              { label: "Check analytics", desc: "Opens & downloads", Icon: BarChart3, v: "analytics" },
              { label: "Drop a loop", desc: "Earn from the pool", Icon: Disc3, v: "loops" },
              { label: "File paperwork", desc: "Split sheets", Icon: FileText, v: "paperwork" }
            ].map(({ label, desc, Icon, v }) => (
              <button key={v} onClick={() => go(v)} className="group flex items-center gap-3 rounded-xl border border-line bg-ink p-3 text-left transition hover:border-strong hover:bg-white/[0.03]">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/5 text-gold transition group-hover:bg-gold/15"><Icon size={17} /></span>
                <span className="flex-1">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-[12px] text-bone-dim">{desc}</span>
                </span>
                <ArrowRight size={15} className="text-bone-dim transition group-hover:translate-x-0.5 group-hover:text-bone" />
              </button>
            ))}
          </div>
        </Card>
      </div>
    </section>
  );
}

function StatusBadge({ status }) {
  const map = {
    pending_review: { t: "Under review", c: "bg-info/12 text-info", I: Clock },
    approved: { t: "Approved", c: "bg-ok/12 text-ok", I: CheckCircle2 },
    pitched: { t: "Pitched", c: "bg-ok/12 text-ok", I: CheckCircle2 },
    rejected: { t: "Rejected", c: "bg-bad/12 text-bad", I: XCircle },
    send_failed: { t: "Send failed", c: "bg-bad/12 text-bad", I: XCircle },
    no_contacts: { t: "No contacts", c: "bg-white/8 text-bone-dim", I: Clock }
  };
  const s = map[status] || { t: status || "—", c: "bg-white/8 text-bone-dim", I: Clock };
  const I = s.I;
  return <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${s.c}`}><I size={12} /> {s.t}</span>;
}

/* ============================ campaign builder ============================ */
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
  const [busy, setBusy] = useState(false);
  const [submitBtn, setSubmitBtn] = useState("Review campaign");
  const [pay, setPay] = useState(null);
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
    if (ANR_IDS.has(id) && !caps.anr) { showToast("A&R / management lanes require a Pro subscription."); return; }
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
    if (named.find((b) => !b.file && !b.storagePath)) { showToast("Attach a file to every named beat."); return; }
    if (selected.length === 0) { showToast("Select at least one target."); return; }
    if (cost > pitchBalance) { showToast("Not enough pitch credits."); return; }

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
        patchBeat(b.uid, { storagePath: path, file: null, status: "Uploaded" });
        b.storagePath = path;
      }));
    } catch (e) { showToast("Upload failed: " + e.message); setBusy(false); setSubmitBtn("Review campaign"); return; }

    const builtBeats = named.map((b) => ({ title: b.title.trim(), genre: b.genre, key: b.key, bpm: b.bpm, storagePath: b.storagePath, collabs: b.collabs.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), role: c.role, instagram: c.instagram.trim(), phone: c.phone.trim() })) }));
    const addons = [...(rush ? ["rush"] : []), ...(feedback ? ["feedback"] : [])];
    setBusy(false); setSubmitBtn("Review campaign"); setPayMsg(null);
    setPay({ beats: builtBeats, targets: selected, addons, cost });
  }

  async function doPay() {
    setPayBusy(true); setPayMsg(null);
    try {
      await call("submitCampaign", { producer: { name: bName.trim(), instagram: bIg.trim(), email: user?.email || "", phone: profile?.phone || "" }, beats: pay.beats, targets: pay.targets, addons: pay.addons });
      setPayMsg({ text: "Campaign submitted — now pending review.", kind: "ok" });
      setTimeout(() => { setPay(null); onSubmitted(); showToast("Campaign submitted for review."); }, 900);
    } catch (e) { setPayMsg({ text: e.message || "Submission failed.", kind: "err" }); setPayBusy(false); }
  }

  if (isFree) {
    return (
      <section>
        <SectionHead eyebrow="New campaign" title="Start a campaign" />
        <Card className="flex flex-col items-center gap-4 p-12 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gold/12 text-gold"><Disc3 size={26} /></span>
          <h2 className="font-display text-2xl">Campaigns require a subscription</h2>
          <p className="max-w-sm text-sm leading-relaxed text-bone-dim">Upgrade to <strong className="text-bone">Plugg</strong> to land in the Verified library, or <strong className="text-bone">Pro</strong> to blast directly to artist &amp; A&amp;R inboxes.</p>
          <a href="/#pricing"><GoldBtn>See plans <ArrowRight size={16} /></GoldBtn></a>
        </Card>
      </section>
    );
  }

  const capLabel = caps.lanes === Infinity ? selected.length : `${selected.length} of ${caps.lanes}`;
  const addonLabels = pay ? pay.addons.map((a) => (a === "rush" ? "Rush (+2)" : "Feedback (+1)")).join(", ") : "";

  return (
    <section>
      <SectionHead eyebrow="New campaign" title="Start a campaign" sub={tier === "pro" ? "Approved campaigns email directly to artist & A&R inboxes." : "Approved campaigns are added to the Verified library."} />

      {/* cost banner */}
      <Card className="mb-6 flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <Eyebrow>Pitch credits</Eyebrow>
          <div className="mt-1 font-display text-4xl leading-none">{pitchBalance}<span className="ml-1 font-sans text-sm font-normal text-bone-dim">available</span></div>
        </div>
        <div className="text-right">
          <div className="text-[12px] text-bone-dim">This campaign</div>
          <div className={`font-display text-3xl leading-none ${noCredit ? "text-bad" : "text-gold"}`}>{cost}</div>
          <div className="text-[11px] text-bone-dim">credits</div>
        </div>
      </Card>

      {/* 1 details */}
      <Card className="mb-4 p-5">
        <StepHead n={1} title="Your details" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label>Your name *</Label><input className={inputCls} placeholder="Your name" value={bName} onChange={(e) => setBName(e.target.value)} /></div>
          <div><Label>Your Instagram *</Label><input className={inputCls} placeholder="@yourhandle" value={bIg} onChange={(e) => setBIg(e.target.value)} /></div>
        </div>
      </Card>

      {/* 2 beats */}
      <Card className="mb-4 p-5">
        <StepHead n={2} title="Your beats" right={<span className="font-mono text-[11px] text-bone-dim">{beats.length} / {caps.beats}</span>} />
        <p className="mb-4 text-[13px] text-bone-dim">Each beat uploads when you submit. MP3 or WAV — untagged mixes pitch best.</p>
        <div className="flex flex-col gap-3">
          {beats.map((b, i) => (
            <div key={b.uid} className="overflow-hidden rounded-xl border border-line bg-ink">
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => patchBeat(b.uid, { open: !b.open })}>
                <span className="font-mono text-[12px] text-bone-dim">{String(i + 1).padStart(2, "0")}</span>
                <span className={`flex-1 truncate text-sm ${b.title.trim() ? "text-bone" : "text-bone-dim"}`}>{b.title.trim() || "Untitled beat"}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${b.status.includes("Uploaded") ? "bg-ok/12 text-ok" : b.status.includes("Uploading") ? "bg-gold/12 text-gold" : b.file ? "bg-info/12 text-info" : "bg-white/8 text-bone-dim"}`}>{b.file && !b.storagePath ? "Ready" : b.status}</span>
                <ChevronDown size={16} className={`text-bone-dim transition ${b.open ? "rotate-180" : ""}`} />
              </button>
              {b.open && (
                <div className="border-t border-line p-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div><Label>Beat title *</Label><input className={inputCls} placeholder="e.g. Midnight Run" value={b.title} onChange={(e) => patchBeat(b.uid, { title: e.target.value })} /></div>
                    <div><Label>Genre</Label><select className={inputCls} value={b.genre} onChange={(e) => patchBeat(b.uid, { genre: e.target.value })}>{GENRES.map((g) => <option key={g}>{g}</option>)}</select></div>
                    <div><Label>Key</Label><select className={inputCls} value={b.key} onChange={(e) => patchBeat(b.uid, { key: e.target.value })}>{KEY_OPTS.map((k) => <option key={k}>{k}</option>)}</select></div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div><Label>BPM</Label><input className={inputCls} type="number" min="40" max="300" placeholder="e.g. 140" value={b.bpm} onChange={(e) => patchBeat(b.uid, { bpm: e.target.value })} /></div>
                    <div>
                      <Label>File *</Label>
                      <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-sm transition ${b.file || b.storagePath ? "border-ok/40 bg-ok/[0.06] text-ok" : "border-strong text-bone-dim hover:border-gold/50 hover:text-bone"}`}>
                        {b.file || b.storagePath ? <Check size={15} /> : <Upload size={15} />}
                        {b.file ? (b.file.name.length > 24 ? b.file.name.slice(0, 22) + "…" : b.file.name) : b.storagePath ? "Uploaded" : "Attach MP3 / WAV"}
                        <input type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" className="hidden" onChange={(e) => { const f = e.target.files[0]; if (f) patchBeat(b.uid, { file: f, status: "Ready" }); }} />
                      </label>
                      {b.progress > 0 && b.progress < 100 && <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-gold transition-all" style={{ width: b.progress + "%" }} /></div>}
                    </div>
                  </div>
                  <div className="mt-4 mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-bone-dim">Collaborators</div>
                  <div className="flex flex-col gap-2">
                    {b.collabs.map((c, j) => (
                      <div key={j} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                        <input className={inputCls} placeholder="Name" value={c.name} onChange={(e) => patchCollab(b.uid, j, { name: e.target.value })} />
                        <select className={inputCls} value={c.role} onChange={(e) => patchCollab(b.uid, j, { role: e.target.value })}>{ROLE_OPTS.map((r) => <option key={r}>{r}</option>)}</select>
                        <input className={inputCls} placeholder="@instagram" value={c.instagram} onChange={(e) => patchCollab(b.uid, j, { instagram: e.target.value })} />
                        <input className={inputCls} placeholder="Phone" type="tel" value={c.phone} onChange={(e) => patchCollab(b.uid, j, { phone: e.target.value })} />
                        <button className="grid place-items-center rounded-lg border border-line text-bone-dim transition hover:border-bad hover:text-bad" onClick={() => patchBeat(b.uid, { collabs: b.collabs.filter((_, k) => k !== j) })}><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <button className="flex items-center gap-1.5 text-[13px] text-gold hover:underline" onClick={() => patchBeat(b.uid, { collabs: [...b.collabs, { name: "", role: "Producer", instagram: "", phone: "" }] })}><Plus size={14} /> Add collaborator</button>
                    <button className="flex items-center gap-1.5 text-[13px] text-bad hover:underline" onClick={() => removeBeat(b.uid)}><Trash2 size={14} /> Remove beat</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <button disabled={beats.length >= caps.beats} onClick={addBeat} className="mt-3 flex items-center gap-1.5 text-sm text-bone-dim transition hover:text-bone disabled:opacity-40"><Plus size={15} /> Add beat</button>
      </Card>

      {/* 3 targets */}
      <Card className="mb-4 p-5">
        <StepHead n={3} title="Who should hear it" right={<span className="font-mono text-[11px] text-bone-dim">{selected.length} / {caps.lanes === Infinity ? "∞" : caps.lanes}</span>} />
        <div className="mb-4 inline-flex rounded-full border border-line bg-ink p-1">
          {[["artists", "Artist targets"], ["anr", "A&R / labels"]].map(([k, t]) => (
            <button key={k} onClick={() => setSeg(k)} className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition ${seg === k ? "bg-gold text-[#1a1405]" : "text-bone-dim hover:text-bone"}`}>{t}</button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(seg === "artists" ? ARTIST_TARGETS : ANR_TARGETS).map((t) => {
            const locked = ANR_IDS.has(t.id) && !caps.anr;
            const on = selected.includes(t.id);
            return (
              <button key={t.id} onClick={() => toggleTarget(t.id)} className={`relative rounded-xl border p-4 text-left transition ${on ? "border-gold bg-gold/[0.08]" : "border-line bg-ink hover:border-strong"} ${locked ? "opacity-60" : ""}`}>
                {on && <span className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-gold text-[#1a1405]"><Check size={12} /></span>}
                <div className="flex items-center justify-between">
                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-bone-dim">{t.tier}</div>
                  <div className="font-mono text-[11px] text-gold">{t.cost}cr</div>
                </div>
                <div className="mt-1.5 font-display text-lg">{t.lane}</div>
                <div className="text-[12px] text-bone-dim">{t.reach}</div>
                {locked && <div className="mt-2 font-mono text-[10px] tracking-[0.1em] text-bad">PRO ONLY</div>}
              </button>
            );
          })}
        </div>
      </Card>

      {/* add-ons */}
      <Card className="mb-6 p-5">
        <h3 className="mb-4 font-display text-base">Add-ons <span className="text-[12px] font-normal text-bone-dim">(optional)</span></h3>
        {[
          { on: rush, set: setRush, title: "Rush queue", price: "+2", desc: "Priority review — first pitch within 48h" },
          { on: feedback, set: setFeedback, title: "Written feedback", price: "+1", desc: "Summary from our pitching team after the campaign closes" }
        ].map((a) => (
          <label key={a.title} className="flex cursor-pointer items-start gap-3 border-line py-2.5 [&:not(:last-child)]:border-b">
            <input type="checkbox" checked={a.on} onChange={(e) => a.set(e.target.checked)} className="mt-1 h-4 w-4 accent-gold" />
            <div>
              <span className="text-sm font-medium">{a.title}</span>
              <span className="ml-2 font-mono text-[11px] text-gold">{a.price} cr</span>
              <div className="text-[12px] text-bone-dim">{a.desc}</div>
            </div>
          </label>
        ))}
      </Card>

      <div className="flex items-center justify-end gap-4">
        {noCredit && <span className="text-[13px] text-bad">Not enough pitch credits.</span>}
        <GoldBtn disabled={busy || noCredit} onClick={review}>{submitBtn} <ArrowRight size={16} /></GoldBtn>
      </div>

      {pay && (
        <Overlay onClose={() => setPay(null)}>
          <div className="mb-4 flex items-center justify-between"><h3 className="font-display text-2xl">Submit for review</h3><button onClick={() => setPay(null)} className="text-bone-dim hover:text-bone"><X size={20} /></button></div>
          <div className="space-y-2 rounded-xl border border-line bg-ink p-4 text-sm">
            <Row k="Beats" v={pay.beats.length} />
            <Row k="Targets" v={capLabel} />
            <Row k="Add-ons" v={addonLabels || "None"} />
            <div className="my-1 h-px bg-line" />
            <Row k="Credit cost" v={`${pay.cost} credits`} bold />
            <Row k="Balance after" v={`${pitchBalance - pay.cost} credits`} muted />
          </div>
          <p className="my-4 text-[13px] text-bone-dim">Our team reviews every campaign before any beats are pitched. No pitches go out until staff approves.</p>
          {payMsg && <div className={`mb-3 rounded-lg px-3 py-2 text-[13px] ${payMsg.kind === "ok" ? "bg-ok/12 text-ok" : "bg-bad/12 text-bad"}`}>{payMsg.text}</div>}
          <GoldBtn className="w-full" disabled={payBusy} onClick={doPay}>{payBusy ? "Submitting…" : "Submit campaign for review"}</GoldBtn>
        </Overlay>
      )}
    </section>
  );
}
const StepHead = ({ n, title, right }) => (
  <div className="mb-4 flex items-center justify-between">
    <div className="flex items-center gap-2.5"><span className="grid h-6 w-6 place-items-center rounded-full bg-gold/12 font-mono text-[11px] text-gold">{n}</span><h3 className="font-display text-lg">{title}</h3></div>
    {right}
  </div>
);
const Row = ({ k, v, bold, muted }) => (
  <div className="flex items-center justify-between"><span className={muted ? "text-bone-dim" : "text-bone-dim"}>{k}</span><span className={bold ? "font-semibold text-bone" : "text-bone"}>{v}</span></div>
);

/* ============================ analytics ============================ */
const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

function Analytics({ campaigns, uid }) {
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
  const cms = (c) => (c.createdAt?.toMillis ? c.createdAt.toMillis() : (typeof c.createdAt === "number" ? c.createdAt : null));
  const underReview = campaigns.filter((c) => c.status === "pending_review");
  const approved = campaigns.filter((c) => ["approved", "pitched"].includes(c.status));
  const rejected = campaigns.filter((c) => c.status === "rejected");
  const pitched = campaigns.filter((c) => ["pitched", "approved", "send_failed"].includes(c.status) && (c.pitchedTo?.length || 0) > 0);
  const sent = campaigns.reduce((s, c) => s + (Array.isArray(c.pitchedTo) ? c.pitchedTo.length : 0), 0);
  const opens = campaigns.reduce((s, c) => s + (c.opens || 0), 0);
  const downloads = campaigns.reduce((s, c) => s + (c.downloads || 0), 0);
  const openRate = sent ? Math.round(opens / sent * 100) : 0;
  const funnel = [["Sent", sent, 100], ["Opened", opens, sent ? Math.round(opens / sent * 100) : 0], ["Downloaded", downloads, sent ? Math.round(downloads / sent * 100) : 0]];

  return (
    <section>
      <SectionHead eyebrow="Analytics" title="Pitch analytics" sub="Live email and engagement tracking for your campaigns." />

      <div className="grid grid-cols-3 gap-4">
        <Stat value={underReview.length} label="Under review" accent="text-info" />
        <Stat value={approved.length} label="Approved" accent="text-ok" />
        <Stat value={rejected.length} label="Rejected" accent="text-bad" />
      </div>

      {rejected.length > 0 && (
        <div className="mt-6">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-bone-dim">Rejection feedback</div>
          <div className="flex flex-col gap-3">
            {rejected.map((c, i) => {
              const title = (c.beats || []).map((b) => b.title).filter(Boolean).join(", ") || "Campaign";
              return (
                <Card key={i} className="border-bad/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm">{title}</strong>
                    {c.creditRefunded && <span className="rounded-full bg-ok/12 px-2.5 py-0.5 text-[11px] font-semibold text-ok">{c.creditCost} credit{c.creditCost !== 1 ? "s" : ""} refunded</span>}
                  </div>
                  <p className="mt-2 text-[13px]"><span className="font-semibold text-bad">Reason:</span> {c.rejectionReason || "No reason provided"}</p>
                  {c.rejectionNote && <p className="mt-1 text-[13px] text-bone-dim">{c.rejectionNote}</p>}
                  <p className="mt-2 text-[12px] text-bone-dim">Submitted {fmtDate(cms(c))}</p>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Stat value={sent} label="Emails sent" />
        <Stat value={opens} label="Opened" accent="text-gold" hint={sent ? `${openRate}% open rate` : ""} />
        <Stat value={downloads} label="Beats downloaded" accent="text-ok" />
      </div>

      <Card className="mt-6 p-5">
        <h3 className="mb-4 font-display text-lg">Conversion funnel</h3>
        {sent ? (
          <div className="flex flex-col gap-3">
            {funnel.map(([k, val, pct]) => (
              <div key={k}>
                <div className="mb-1 flex items-center justify-between text-[13px]"><span>{k}</span><span className="font-mono text-bone-dim">{val} · {pct}%</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-gradient-to-r from-gold-deep to-gold transition-all" style={{ width: pct + "%" }} /></div>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-bone-dim">Engagement data will appear once pitches go out.</p>}
      </Card>

      <Card className="mt-6 p-5">
        <h3 className="mb-4 font-display text-lg">Per-pitch activity</h3>
        {pitched.length ? <div className="flex flex-col gap-5">{pitched.map((c) => <CampaignActivity key={c.id} campaign={c} uid={uid} />)}</div>
          : <p className="text-sm text-bone-dim">No engagement yet — opens and downloads appear here once recipients interact.</p>}
      </Card>
    </section>
  );
}

function CampaignActivity({ campaign, uid }) {
  const { data } = useLiveCollection(["events", uid, campaign.id], () => collection(db, "users", uid, "campaigns", campaign.id, "events"), { enabled: !!uid });
  const events = data || [];
  const byContact = new Map();
  (campaign.pitchedTo || []).forEach((em) => byContact.set(em, { opened: false, downloaded: false, last: null }));
  events.forEach((e) => {
    const k = e.contact; if (!k) return;
    if (!byContact.has(k)) byContact.set(k, { opened: false, downloaded: false, last: null });
    const r = byContact.get(k);
    if (e.type === "opened") r.opened = true;
    if (e.type === "downloaded") r.downloaded = true;
    const tms = e.timestamp?.toMillis ? e.timestamp.toMillis() : (typeof e.timestamp === "number" ? e.timestamp : null);
    if (tms && (!r.last || tms > r.last)) r.last = tms;
  });
  const title = (campaign.beats || []).map((b) => b.title).filter(Boolean).join(", ") || campaign.id;
  const rows = [...byContact.entries()];

  return (
    <div className="rounded-xl border border-line bg-ink p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm">{title}</strong>
        <span className="font-mono text-[11px] text-bone-dim">{campaign.opens || 0} opens · {campaign.downloads || 0} downloads</span>
      </div>
      <div className="overflow-x-auto scrollbar-slim">
        <table className="w-full text-left text-[13px]">
          <thead><tr className="text-bone-dim">{["Recipient", "Opened", "Downloaded", "Last activity"].map((h) => <th key={h} className="pb-2 font-mono text-[10px] uppercase tracking-wider font-normal">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {rows.length ? rows.map(([email, r], i) => (
              <tr key={i}>
                <td className="py-2 pr-3 font-mono text-[12px]">{email}</td>
                <td className="py-2 pr-3">{r.opened ? <Tag c="bg-info/12 text-info">opened</Tag> : <span className="text-bone-dim">—</span>}</td>
                <td className="py-2 pr-3">{r.downloaded ? <Tag c="bg-ok/12 text-ok">downloaded</Tag> : <span className="text-bone-dim">—</span>}</td>
                <td className="py-2 text-bone-dim">{fmtTime(r.last)}</td>
              </tr>
            )) : <tr><td colSpan="4" className="py-4 text-center text-bone-dim">Awaiting recipient activity…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
const Tag = ({ c, children }) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c}`}>{children}</span>;

/* ============================ paperwork ============================ */
function Paperwork({ campaigns, showToast }) {
  const beatTitles = useMemo(() => { const s = new Set(); campaigns.forEach((c) => (c.beats || []).forEach((b) => b.title && s.add(b.title))); return [...s]; }, [campaigns]);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [writers, setWriters] = useState([{ name: "", role: "Producer", pct: "", ig: "" }]);
  const total = writers.reduce((t, w) => t + (parseFloat(w.pct) || 0), 0);
  const ok = Math.abs(total - 100) < 0.01;
  const patch = (i, p) => setWriters((prev) => prev.map((w, j) => (j === i ? { ...w, ...p } : w)));

  return (
    <section>
      <SectionHead eyebrow="Documents" title="Paperwork" sub="Build a split sheet, log collaborators, and upload executed agreements." />
      <Card className="mb-4 p-5">
        <h3 className="mb-4 font-display text-lg">Split sheet</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label>Song / beat title *</Label>
            <select className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)}>
              {beatTitles.length ? <><option value="">Select a beat…</option>{beatTitles.map((t) => <option key={t}>{t}</option>)}</> : <option value="">No beats yet — start a campaign first</option>}
            </select>
          </div>
          <div><Label>Date</Label><input className={inputCls} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {writers.map((w, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1.4fr_1fr_.7fr_1fr_auto]">
              <input className={inputCls} placeholder="Name" value={w.name} onChange={(e) => patch(i, { name: e.target.value })} />
              <select className={inputCls} value={w.role} onChange={(e) => patch(i, { role: e.target.value })}><option>Producer</option><option>Writer</option><option>Vocalist</option><option>Co-producer</option></select>
              <input className={inputCls} type="number" min="0" max="100" placeholder="0" value={w.pct} onChange={(e) => patch(i, { pct: e.target.value })} />
              <input className={inputCls} placeholder="@ig / PRO" value={w.ig} onChange={(e) => patch(i, { ig: e.target.value })} />
              <button className="grid place-items-center rounded-lg border border-line text-bone-dim transition hover:border-bad hover:text-bad" onClick={() => setWriters((p) => p.filter((_, j) => j !== i))}><X size={14} /></button>
            </div>
          ))}
        </div>
        <button className="mt-3 flex items-center gap-1.5 text-sm text-gold hover:underline" onClick={() => setWriters((p) => [...p, { name: "", role: "Producer", pct: "", ig: "" }])}><Plus size={14} /> Add writer</button>
        <div className="mt-4 flex items-center gap-3">
          <span className={`font-display text-2xl ${ok ? "text-ok" : "text-bad"}`}>{total}%</span>
          <span className="text-[13px] text-bone-dim">splits must total exactly 100% to submit</span>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <GoldBtn disabled={!ok} onClick={() => { if (!title) { showToast("Add the song title first."); return; } showToast("Split sheet saved to this campaign."); }}>Submit split sheet</GoldBtn>
          <GhostBtn onClick={() => showToast("PDF export coming soon.")}>Download PDF</GhostBtn>
        </div>
      </Card>
      <Card className="p-5">
        <h3 className="mb-3 font-display text-lg">Upload signed documents</h3>
        <button onClick={() => showToast("Document uploads coming soon.")} className="grid w-full place-items-center gap-1 rounded-xl border border-dashed border-strong py-10 text-center transition hover:border-gold/50">
          <Upload size={22} className="text-bone-dim" />
          <strong className="text-sm">Drop split sheets, work-for-hire, or licenses</strong>
          <span className="text-[12px] text-bone-dim">PDF · DOCX · PNG — stored against this campaign</span>
        </button>
      </Card>
    </section>
  );
}

/* ============================ loop drops ============================ */
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

  const { data: myLoops } = useLiveCollection(["myLoops", user?.uid], () => query(collection(db, "loops"), where("makerUid", "==", user.uid), orderBy("createdAt", "desc")), { enabled: !!user?.uid });

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
      await call("submitLoop", { title: title.trim(), bpm: bpm || null, key, genre, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), storagePath });
      setMsg({ text: "Loop submitted!", kind: "ok" });
      setTitle(""); setBpm(""); setTags(""); setFile(null); setProgress(0);
      setTimeout(() => setMsg(null), 3000);
    } catch (e) { setMsg({ text: e.message || "Submission failed.", kind: "err" }); }
    finally { setBusy(false); }
  }

  return (
    <section>
      <SectionHead eyebrow="Loop Drops" title="Loop marketplace" sub="Submit loops to the pool, or pull them into your beats if you're verified." />
      <Card className="mb-4 flex flex-wrap items-center justify-between gap-4 p-5">
        <div><Eyebrow>Loop credits</Eyebrow><div className="mt-1 font-display text-4xl leading-none">{loopBalance}<span className="ml-1 font-sans text-sm font-normal text-bone-dim">available</span></div></div>
        <div className="text-right text-[12px] text-bone-dim">1 credit per loop submitted<br />replenish monthly with your plan</div>
      </Card>

      <Card className="mb-4 p-5">
        <h3 className="mb-4 font-display text-lg">Upload a loop</h3>
        <div className="grid gap-3 sm:grid-cols-2"><div><Label>Title *</Label><input className={inputCls} placeholder="e.g. Dark trap 808" value={title} onChange={(e) => setTitle(e.target.value)} /></div><div><Label>Genre</Label><select className={inputCls} value={genre} onChange={(e) => setGenre(e.target.value)}>{GENRES.map((g) => <option key={g}>{g}</option>)}</select></div></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3"><div><Label>BPM</Label><input className={inputCls} type="number" placeholder="140" value={bpm} onChange={(e) => setBpm(e.target.value)} /></div><div><Label>Key</Label><select className={inputCls} value={key} onChange={(e) => setKey(e.target.value)}>{KEY_OPTS.map((k) => <option key={k}>{k}</option>)}</select></div><div><Label>Tags (comma-sep)</Label><input className={inputCls} placeholder="dark, 808, minimal" value={tags} onChange={(e) => setTags(e.target.value)} /></div></div>
        <div className="mt-3">
          <Label>Audio file *</Label>
          <label className={`flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-dashed px-4 py-2.5 text-sm transition ${file ? "border-ok/40 bg-ok/[0.06] text-ok" : "border-strong text-bone-dim hover:border-gold/50 hover:text-bone"}`}>
            {file ? <Check size={15} /> : <Upload size={15} />}{file ? (file.name.length > 28 ? file.name.slice(0, 26) + "…" : file.name) : "Attach MP3 / WAV"}
            <input type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" className="hidden" onChange={(e) => setFile(e.target.files[0] || null)} />
          </label>
          {progress > 0 && progress < 100 && <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-gold" style={{ width: progress + "%" }} /></div>}
        </div>
        {msg && <div className={`mt-3 rounded-lg px-3 py-2 text-[13px] ${msg.kind === "ok" ? "bg-ok/12 text-ok" : "bg-bad/12 text-bad"}`}>{msg.text}</div>}
        <GoldBtn className="mt-4" disabled={busy} onClick={submit}>{busy ? "Submitting…" : "Submit loop — 1 credit"}</GoldBtn>
      </Card>

      <Card className="p-5">
        <h3 className="mb-4 font-display text-lg">My submitted loops</h3>
        {!myLoops ? <div className="flex flex-col gap-2">{[0, 1].map((i) => <Skeleton key={i} className="h-16" />)}</div>
          : myLoops.length === 0 ? <p className="py-6 text-center text-sm text-bone-dim">No loops submitted yet.</p>
            : <div className="flex flex-col gap-2.5">{myLoops.map((l) => {
              const spec = [l.genre, l.key, l.bpm && l.bpm + " BPM"].filter(Boolean).join(" · ");
              return (
                <div key={l.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-ink p-4">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{l.title}</div>
                    <div className="text-[12px] text-bone-dim">{spec}</div>
                    {l.tags?.length > 0 && <div className="mt-1 flex flex-wrap gap-1.5">{l.tags.map((t, i) => <span key={i} className="rounded-full border border-line bg-ink-3 px-2 py-0.5 text-[11px] text-bone-dim">{t}</span>)}</div>}
                  </div>
                  <div className="text-right">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${l.status === "used" ? "bg-white/8 text-bone-dim" : "bg-ok/12 text-ok"}`}>{l.status || "live"}</span>
                    <div className="mt-1.5 text-[12px] text-bone-dim">{l.downloads || 0} pull{l.downloads !== 1 ? "s" : ""}</div>
                  </div>
                </div>
              );
            })}</div>}
      </Card>

      <Card className="mt-4 border-line bg-ink-3 p-4">
        <p className="text-[13px] text-bone-dim">Want to pull loops? Visit <a href="/verified" className="font-semibold text-gold hover:underline">PluggUrBeat Verified</a> — the curated library for verified producers, A&amp;Rs, and artists.</p>
      </Card>
    </section>
  );
}

/* ============================ billing ============================ */
function Billing({ tier, profile, pitchBalance, loopBalance, startSubscription, buyPack }) {
  const status = profile.subscription?.status || (tier === "free" ? "no active plan" : "active");
  const renews = profile.subscription?.renewsAt;
  const renewMs = renews?.toMillis ? renews.toMillis() : (typeof renews === "number" ? renews : null);
  const planBtn = (plan) => {
    if (tier === plan) return { label: "Current plan", disabled: true, ghost: true, ring: true };
    if (TIER_RANK[plan] < TIER_RANK[tier]) return { label: "Contact support to downgrade", disabled: true, ghost: true };
    return { label: "Upgrade", disabled: false, ghost: false };
  };
  const pb = planBtn("plugg"), pr = planBtn("pro");

  const PlanCard = ({ name, price, blurb, feats, btn, plan, highlight }) => (
    <Card className={`flex flex-col p-5 ${highlight ? "border-gold/50" : ""} ${btn.ring ? "ring-1 ring-gold" : ""}`}>
      <div className="flex items-baseline justify-between">
        <h4 className="font-display text-xl">{name} {highlight && <span className="ml-1 rounded-full border border-gold/40 px-2 py-0.5 align-middle font-mono text-[9px] tracking-wider text-gold">EMAIL BLAST</span>}</h4>
        <div><span className="font-display text-2xl">${price}</span><span className="text-bone-dim">/mo</span></div>
      </div>
      <p className="mt-1 text-[13px] text-bone-dim">{blurb}</p>
      <ul className="my-4 flex flex-col gap-2 text-[13px] text-bone-dim">{feats.map((f) => <li key={f} className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-gold" /> {f}</li>)}</ul>
      {btn.ghost ? <GhostBtn className="mt-auto w-full" disabled={btn.disabled} onClick={(e) => startSubscription(plan, e.currentTarget)}>{btn.label}</GhostBtn>
        : <GoldBtn className="mt-auto w-full" onClick={(e) => startSubscription(plan, e.currentTarget)}>{btn.label}</GoldBtn>}
    </Card>
  );

  return (
    <section>
      <SectionHead eyebrow="Billing" title="Plans & credits" sub="Manage your subscription and top up campaign or loop credits." />

      <Card className="mb-6 flex flex-wrap items-center justify-between gap-5 p-5">
        <div>
          <Eyebrow>Current plan</Eyebrow>
          <div className="mt-1 font-display text-3xl leading-none">{cap(tier)}</div>
          <div className="mt-1 text-[13px] text-bone-dim">{tier === "free" ? "Subscribe to start running campaigns" : `Status: ${status}${renewMs ? " · renews " + new Date(renewMs).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}`}</div>
        </div>
        <div className="flex gap-3">
          <div className="rounded-xl border border-line bg-ink px-5 py-3 text-center"><div className="font-display text-2xl">{pitchBalance}</div><div className="text-[12px] text-bone-dim">Pitch credits</div></div>
          <div className="rounded-xl border border-line bg-ink px-5 py-3 text-center"><div className="font-display text-2xl">{loopBalance}</div><div className="text-[12px] text-bone-dim">Loop credits</div></div>
        </div>
      </Card>

      <h3 className="mb-4 font-display text-lg">Subscription</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <PlanCard name="Plugg" price="29" plan="plugg" btn={pb} blurb="Land in the Verified library." feats={["15 pitch + 20 loop credits monthly", "Up to 15 beats, 3 lanes per campaign", "Approved campaigns added to Verified library"]} />
        <PlanCard name="Pro" price="99" plan="pro" btn={pr} highlight blurb="Blast directly to inboxes." feats={["50 pitch + 60 loop credits monthly", "Up to 25 beats, unlimited lanes", "A&R / management lanes unlocked", "Approved campaigns email directly to inboxes"]} />
      </div>

      <h3 className="mb-4 mt-8 font-display text-lg">Campaign (pitch) credit packs</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <PackCard label="10 credits" sub="$25 · $2.50 each" Icon={Rocket} onBuy={(e) => buyPack("pack10", e.currentTarget)} />
        <PackCard label="25 credits" sub="$50 · $2.00 each" Icon={Rocket} onBuy={(e) => buyPack("pack25", e.currentTarget)} />
      </div>
      <h3 className="mb-4 mt-8 font-display text-lg">Loop credit packs</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <PackCard label="20 credits" sub="$10 · $0.50 each" Icon={Disc3} onBuy={(e) => buyPack("loop20", e.currentTarget)} />
        <PackCard label="50 credits" sub="$20 · $0.40 each" Icon={Disc3} onBuy={(e) => buyPack("loop50", e.currentTarget)} />
      </div>
      <p className="mt-6 text-[13px] text-bone-dim">Secure checkout via Stripe. Credits are added the moment payment clears.</p>
    </section>
  );
}
function PackCard({ label, sub, Icon, onBuy }) {
  return (
    <Card className="flex items-center justify-between gap-4 p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/5 text-gold"><Icon size={18} /></span>
        <div><div className="font-display text-xl">{label}</div><div className="text-[12px] text-bone-dim">{sub}</div></div>
      </div>
      <GhostBtn onClick={onBuy}><Wallet size={15} /> Buy</GhostBtn>
    </Card>
  );
}

/* ============================ shared overlay + profile ============================ */
function Overlay({ onClose, children }) {
  return (
    <div className="fixed inset-0 z-[55] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md animate-fade-up rounded-2xl border border-strong bg-ink-2 p-6 shadow-card">{children}</div>
    </div>
  );
}

function ProfileModal({ user, profile, onClose }) {
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
      if (avatar) { const ext = (avatar.name.split(".").pop() || "jpg").toLowerCase(); avatarPath = `avatars/${user.uid}/avatar.${ext}`; await uploadBytesResumable(ref(storage, avatarPath), avatar); }
      const data = { displayName: name.trim(), location: location.trim(), bio: bio.trim(), ...(avatarPath ? { avatarPath } : {}) };
      await setDoc(doc(db, "users", user.uid), data, { merge: true });
      setMsg({ text: "Saved.", kind: "ok" });
      setTimeout(onClose, 700);
    } catch (e) { setMsg({ text: e.message || "Could not save.", kind: "err" }); }
    finally { setBusy(false); }
  }

  const initial = (name || user?.email || "?")[0].toUpperCase();
  return (
    <Overlay onClose={onClose}>
      <div className="mb-5 flex items-center justify-between"><h3 className="font-display text-2xl">Profile &amp; settings</h3><button onClick={onClose} className="text-bone-dim hover:text-bone"><X size={20} /></button></div>
      <div className="mb-5 flex items-center gap-4">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-gold to-violet font-display text-2xl text-[#1a1405]" style={preview ? { backgroundImage: `url("${preview}")`, backgroundSize: "cover" } : undefined}>{preview ? "" : initial}</span>
        <label className="cursor-pointer"><GhostBtn className="pointer-events-none px-4 py-2 text-[13px]"><Upload size={14} /> Upload photo</GhostBtn>
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files[0]; if (f) { setAvatar(f); setPreview(URL.createObjectURL(f)); } }} />
        </label>
      </div>
      <div className="flex flex-col gap-3">
        <div><Label>Display name</Label><input className={inputCls} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label>Location</Label><input className={inputCls} placeholder="City, Country" value={location} onChange={(e) => setLocation(e.target.value)} /></div>
        <div><Label>Bio</Label><textarea className={`${inputCls} resize-y`} rows="3" placeholder="Tell us about your sound…" value={bio} onChange={(e) => setBio(e.target.value)} /></div>
      </div>
      {msg && <div className={`mt-3 rounded-lg px-3 py-2 text-[13px] ${msg.kind === "ok" ? "bg-ok/12 text-ok" : "bg-bad/12 text-bad"}`}>{msg.text}</div>}
      <GoldBtn className="mt-5 w-full" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save profile"}</GoldBtn>
    </Overlay>
  );
}
