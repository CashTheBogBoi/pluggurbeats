import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { onAuthStateChanged, signOut, updateProfile } from "firebase/auth";
import { doc, setDoc, collection, query, where, orderBy, limit, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytesResumable } from "firebase/storage";
import { auth } from "../firebase/auth.js";
import { db } from "../firebase/db.js";
import { storage } from "../firebase/storage.js";
import { useLiveDoc, useLiveCollection, call } from "../lib/live.js";
import { hasVerifiedAccess } from "../lib/userRouting.js";
import { verifiedRoleLabel } from "../lib/roles.js";
import { avatarInitial, isAvatarImage, resolveAvatarUrl, uploadProfileAvatar } from "../lib/avatar.js";
import {
  LayoutDashboard, Rocket, BarChart3, FileText, Disc3, CreditCard, ArrowLeft,
  LogOut, Menu, X, Plus, Trash2, Upload, Check, ChevronDown, Music2, Mail, Phone,
  Settings, Sparkles, TrendingUp, Clock, CheckCircle2, XCircle, ArrowRight, Wallet,
  ShieldCheck, Eye, Download, RefreshCw, Send, PenLine
} from "lucide-react";

/* ============================ domain constants ============================ */
const ANR_IDS = new Set(["anr-major-trap", "anr-major-pop", "anr-indie", "anr-sync", "anr-mgmt"]);
const TIER_CAPS = { free: { beats: 5, lanes: 0, anr: false }, plugg: { beats: 15, lanes: 0, anr: false }, pro: { beats: 25, lanes: 5, anr: true } };
const ARTIST_TARGETS = [
  { id: "trap-a", lane: "Trap", tier: "A-list", reach: "~18 desks" },
  { id: "trap-r", lane: "Trap", tier: "Rising", reach: "~40 desks" },
  { id: "rb-a", lane: "R&B", tier: "A-list", reach: "~12 desks" },
  { id: "rb-r", lane: "R&B", tier: "Rising", reach: "~33 desks" },
  { id: "pop-a", lane: "Pop", tier: "Major", reach: "~15 desks" },
  { id: "afro-r", lane: "Afrobeats", tier: "Rising", reach: "~26 desks" },
  { id: "drill-r", lane: "Drill", tier: "Rising", reach: "~22 desks" },
  { id: "reg-r", lane: "Reggaeton", tier: "Rising", reach: "~19 desks" }
];
const ANR_TARGETS = [
  { id: "anr-major-trap", lane: "Major label", tier: "Hip-hop A&R", reach: "~9 contacts" },
  { id: "anr-major-pop", lane: "Major label", tier: "Pop A&R", reach: "~7 contacts" },
  { id: "anr-indie", lane: "Indie / distro", tier: "A&R", reach: "~24 contacts" },
  { id: "anr-sync", lane: "Sync / placement", tier: "Music supervisor", reach: "~14 contacts" },
  { id: "anr-mgmt", lane: "Management", tier: "Artist managers", reach: "~31 contacts" }
];
const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const KEY_OPTS = [...KEYS.map((k) => k + " Major"), ...KEYS.map((k) => k + " Minor")];
const ROLE_OPTS = ["Producer", "Co-producer", "Writer", "Vocalist", "Mix engineer", "Other"];
const TIER_RANK = { free: 0, plugg: 1, pro: 2 };
const GENRES = ["Trap", "Drill", "R&B", "Pop", "Afrobeats", "Hip-Hop", "Other"];
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const makeUploadId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
};
const isMp3File = (file) => file && /\.mp3$/i.test(file.name || "");
const normalizeTags = (value) => [...new Set(
  String(value || "")
    .split(/[,\n]/)
    .map((t) => t.trim().toLowerCase().replace(/^#/, ""))
    .filter(Boolean)
)].slice(0, 8);

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
  <div className="mb-5 lg:mb-6">
    {/* marketing eyebrow is a website tell — desktop only; mobile uses the iOS large-title look */}
    {eyebrow && <div className="mb-2 hidden lg:block"><Eyebrow>{eyebrow}</Eyebrow></div>}
    <h1 className="font-display text-[26px] leading-[1.1] tracking-tight text-bone lg:text-3xl">{title}</h1>
    {sub && <p className="mt-1.5 max-w-xl text-sm text-bone-dim lg:mt-2">{sub}</p>}
  </div>
);
const Stat = ({ value, label, accent = "text-bone", hint }) => (
  <Card className="p-3.5 lg:p-4">
    <div className={`font-display text-[26px] leading-none lg:text-3xl ${accent}`}>{value}</div>
    <div className="mt-1.5 text-[12px] leading-tight text-bone-dim lg:mt-2 lg:text-[13px]">{label}</div>
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
  const [targetRequest, setTargetRequest] = useState(null);

  const toastTimer = useRef(null);
  const reconcileTried = useRef(false);
  const ensureTried = useRef(false);
  const lastAvatarKey = useRef(null);

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
  const verifiedAccess = hasVerifiedAccess(profile);
  const navItems = useMemo(() => (
    verifiedAccess
      ? [...NAV.slice(0, 1), { v: "verified", href: "/verified", label: "Verified", Icon: ShieldCheck }, ...NAV.slice(1)]
      : NAV
  ), [verifiedAccess]);

  useEffect(() => {
    if (!uid || ensureTried.current) return;
    if (profileDoc === null) {
      ensureTried.current = true;
      setDoc(doc(db, "users", uid), {
        displayName: user.displayName || "", email: user.email || "", phone: "",
        ...(user.photoURL ? { photoURL: user.photoURL } : {}),
        createdAt: serverTimestamp(),
        subscription: { tier: "free", status: "active", stripeCustomerId: null, stripeSubId: null, renewsAt: null },
        pitchCredits: { balance: 0, monthlyGrant: 0, lastGrantAt: null },
        loopCredits: { balance: 5, monthlyGrant: 5, lastGrantAt: serverTimestamp() },
        verifiedPuller: false
      }).catch((e) => console.error("ensure user doc:", e.message));
    }
  }, [uid, profileDoc, user]);

  useEffect(() => {
    if (!profileDoc || profileDoc.__error) return;
    const key = profileDoc.photoURL || profileDoc.avatarPath || user?.photoURL || "";
    if (key === lastAvatarKey.current) return;
    lastAvatarKey.current = key;
    resolveAvatarUrl(profileDoc, user).then(setAvatarUrl).catch(() => setAvatarUrl(""));
  }, [profileDoc, user]);

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
    const p = new URLSearchParams(location.search);
    const beatRequestId = p.get("request");
    const loopRequestId = p.get("loopRequest");
    const requestId = loopRequestId || beatRequestId;
    if (!requestId) return;
    try {
      const stored = JSON.parse(sessionStorage.getItem("pluggurbeats:targetRequest") || "null");
      if (stored?.id === requestId) {
        setTargetRequest(stored);
        setView(loopRequestId ? "loops" : "submit");
        history.replaceState({}, "", location.pathname);
      }
    } catch {
      sessionStorage.removeItem("pluggurbeats:targetRequest");
    }
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => { if (!e.target.closest("[data-me]") && !e.target.closest("[data-menu]")) setMenuOpen(false); };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [menuOpen]);

  const go = (v) => { setView(v); setNavOpen(false); window.scrollTo(0, 0); };

  const pickRequest = (req) => {
    if (!req?.id) return;
    setTargetRequest(req);
    try { sessionStorage.setItem("pluggurbeats:targetRequest", JSON.stringify(req)); } catch {}
    go(req.requestType === "loops" ? "loops" : "submit");
  };

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
  const initial = avatarInitial(name);

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
          {navItems.map(({ v, href, label, Icon }) => {
            const active = view === v;
            if (href) {
              return (
                <a key={v} href={href}
                  className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-bone-dim transition hover:bg-white/5 hover:text-bone">
                  <Icon size={18} className="text-gold" />
                  {label}
                  <span className="ml-auto rounded-full border border-gold/30 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold">Access</span>
                </a>
              );
            }
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
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-ink/70 px-4 py-2.5 backdrop-blur-xl sm:px-6 lg:px-10" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.625rem)" }}>
          {/* mobile account avatar + menu (sidebar handles this on desktop) */}
          <div className="relative lg:hidden">
            <button data-me onClick={() => setMenuOpen((v) => !v)} className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-gold to-violet font-display text-sm text-[#1a1405]" style={avatarUrl ? { backgroundImage: `url("${avatarUrl}")`, backgroundSize: "cover" } : undefined}>{avatarUrl ? "" : initial}</button>
            {menuOpen && (
              <div data-menu className="absolute left-0 top-[48px] z-50 w-60 overflow-hidden rounded-2xl border border-strong bg-ink-3 shadow-card">
                <div className="border-b border-line px-4 py-3">
                  <div className="truncate text-sm font-semibold">{name}</div>
                  <div className="truncate text-[11px] text-bone-dim">{user?.email}</div>
                </div>
                <button onClick={() => { setMenuOpen(false); setProfileOpen(true); }} className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-bone hover:bg-white/5"><Settings size={15} /> Profile &amp; settings</button>
                <button onClick={() => { setMenuOpen(false); go("billing"); }} className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-bone hover:bg-white/5"><CreditCard size={15} /> Billing &amp; credits</button>
                <div className="h-px bg-line" />
                <button onClick={() => signOut(auth)} className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-bad hover:bg-bad/10"><LogOut size={15} /> Sign out</button>
              </div>
            )}
          </div>
          <div className="ml-auto"><CreditPills tier={tier} pitch={pitchBalance} loop={loopBalance} onClick={() => go("billing")} /></div>
        </header>

        <main className="mx-auto max-w-[1180px] px-4 pt-5 pb-28 sm:px-6 lg:px-10 lg:pt-8 lg:pb-8">
          <div key={view} className="animate-fade-up">
            {view === "overview" && <Overview name={name} campaigns={campaigns} tier={tier} pitch={pitchBalance} go={go} onPickRequest={pickRequest} uid={uid} />}
            {view === "submit" && <CampaignBuilder tier={tier} caps={caps} pitchBalance={pitchBalance} user={user} profile={profile} campaignCount={campaigns.length} targetRequest={targetRequest} clearTargetRequest={() => setTargetRequest(null)} showToast={showToast} onSubmitted={() => go("analytics")} onGoToBilling={() => go("billing")} />}
            {view === "analytics" && <Analytics campaigns={campaigns} uid={uid} tier={tier} />}
            {view === "paperwork" && <Paperwork campaigns={campaigns} uid={uid} profile={profile} showToast={showToast} />}
            {view === "loops" && <LoopDrops user={user} pitchBalance={pitchBalance} loopBalance={loopBalance} targetRequest={targetRequest} clearTargetRequest={() => setTargetRequest(null)} showToast={showToast} />}
            {view === "billing" && <Billing tier={tier} profile={profile} pitchBalance={pitchBalance} loopBalance={loopBalance} startSubscription={startSubscription} buyPack={buyPack} />}
          </div>
        </main>
      </div>

      {profileOpen && <ProfileModal user={user} profile={profile} onClose={() => setProfileOpen(false)} />}

      {/* ---- mobile bottom nav ---- */}
      <nav
        className="fixed inset-x-0 bottom-0 z-50 flex border-t border-line bg-ink-2/95 backdrop-blur-xl lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {navItems.map(({ v, href, label, Icon }) => {
          const active = view === v;
          const short = {
            "Overview": "Home",
            "Verified": "Verified",
            "Loop Drops": "Loops",
            "Start a campaign": "Campaign",
            "Pitch analytics": "Analytics",
            "Billing & credits": "Billing"
          }[label] ?? label;
          return (
            <button
              key={v}
              onClick={() => href ? (window.location.href = href) : go(v)}
              className={`flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 transition ${active || href ? "text-gold" : "text-bone-dim active:text-bone"}`}
            >
              <span className={`flex h-7 w-12 items-center justify-center rounded-full transition ${active ? "bg-gold/12" : ""}`}>
                <Icon size={19} strokeWidth={active ? 2.4 : 1.8} />
              </span>
              <span className="text-[9px] font-medium leading-none tracking-tight">{short}</span>
            </button>
          );
        })}
      </nav>

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
    <div className={`pointer-events-none fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-strong bg-ink-3 px-5 py-3 text-sm font-medium text-bone shadow-card transition-all lg:bottom-6 ${text ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}>{text}</div>
  );
}

/* ============================ overview ============================ */
function Overview({ name, campaigns, tier, pitch, go, onPickRequest, uid }) {
  const sent = campaigns.reduce((s, c) => s + (Array.isArray(c.pitchedTo) ? c.pitchedTo.length : 0), 0);
  const opens = campaigns.reduce((s, c) => s + (c.opens || 0), 0);
  const downs = campaigns.reduce((s, c) => s + (c.downloads || 0), 0);
  const recent = [...campaigns].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)).slice(0, 4);
  const firstName = (name || "").split(" ")[0] || name;

  return (
    <section>
      <SectionHead eyebrow="Welcome back" title={`Hey ${firstName} 👋`} sub="Here's where your records stand right now." />

      {tier === "free" && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 border-gold/30 bg-gold/[0.06] p-4 lg:mb-6 lg:p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold/15 text-gold"><Sparkles size={20} /></span>
            <div>
              <div className="font-display text-base lg:text-lg">Activate your studio</div>
              <div className="text-[13px] text-bone-dim lg:text-sm">Subscribe to Plugg or Pro to start pitching campaigns.</div>
            </div>
          </div>
          <GoldBtn className="w-full sm:w-auto" onClick={() => go("billing")}>See plans <ArrowRight size={16} /></GoldBtn>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Stat value={campaigns.length || 0} label="Campaigns submitted" />
        <Stat value={sent || 0} label="Pitches sent" />
        <Stat value={sent ? Math.round(opens / sent * 100) + "%" : "—"} label="Open rate" accent="text-gold" />
        <Stat value={downs || 0} label="Beat downloads" accent="text-ok" />
      </div>

      {/* Requests + Recent campaigns — visible to all tiers */}
      <div className="mt-4 grid gap-3 lg:mt-6 lg:grid-cols-2 lg:gap-4">
        <RequestForum onPick={onPickRequest} uid={uid} />

        <Card className="p-4 lg:p-5">
          <div className="mb-3 flex items-center justify-between lg:mb-4">
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
      </div>

      {/* Quick actions — full width below */}
      <Card className="mt-3 p-4 lg:mt-4 lg:p-5">
        <h3 className="mb-3 font-display text-lg lg:mb-4">Quick actions</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Start a campaign", desc: "Beats → lanes → pitch", Icon: Rocket, v: "submit" },
            { label: "Check analytics", desc: "Opens & downloads", Icon: BarChart3, v: "analytics" },
            { label: "Drop a loop", desc: "Earn from the pool", Icon: Disc3, v: "loops" },
            { label: "File paperwork", desc: "Split sheets", Icon: FileText, v: "paperwork" }
          ].map(({ label, desc, Icon, v }) => (
            <button key={v} onClick={() => go(v)} className="group flex items-center gap-3 rounded-xl border border-line bg-ink p-3 text-left transition hover:border-strong hover:bg-white/[0.03] active:scale-[0.98]">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 text-gold transition group-hover:bg-gold/15"><Icon size={17} /></span>
              <span className="flex-1">
                <span className="block text-sm font-medium text-bone">{label}</span>
                <span className="block text-[12px] text-bone-dim">{desc}</span>
              </span>
            </button>
          ))}
        </div>
      </Card>
    </section>
  );
}

/* ---- open requests feed (Pro overview) ---- */
const REQUEST_TYPE_META = {
  beats: { label: "Beats", Icon: Music2, color: "text-gold", bg: "bg-gold/10" },
  loops: { label: "Loops", Icon: Disc3, color: "text-ok", bg: "bg-ok/10" },
  both:  { label: "Beats + Loops", Icon: Sparkles, color: "text-violet", bg: "bg-violet/10" }
};

function UserProfilePopup({ req, allRequests = [], onClose }) {
  if (!req) return null;
  const initial = avatarInitial(req.createdByName);

  // Analytics derived from all visible requests by this poster
  const theirRequests = allRequests.filter((r) => r.createdByUid === req.createdByUid);
  const totalViews = theirRequests.reduce((s, r) => s + (r.viewCount || 0), 0);
  const totalSubmissions = theirRequests.reduce((s, r) => s + (r.submissionCount || 0), 0);
  const totalApproved = theirRequests.reduce((s, r) => s + (r.approvedSubmissionCount || 0), 0);
  const requestCount = theirRequests.length;

  const postedAgo = req.createdAt ? (() => {
    const diff = Date.now() - req.createdAt;
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  })() : null;

  const TYPE_META = {
    beats: { label: "Beats", color: "text-gold" },
    loops: { label: "Loops", color: "text-ok" },
    both:  { label: "Beats + Loops", color: "text-violet" }
  };
  const typeMeta = TYPE_META[req.requestType] || TYPE_META.beats;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-4 sm:items-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-white/[0.09] bg-ink-3 shadow-card"
        style={{ animation: "fade-up .25s cubic-bezier(0.23,1,0.32,1) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* header gradient */}
        <div className="h-14 bg-gradient-to-br from-violet/40 to-gold/30" />

        <div className="relative px-5 pb-5">
          {/* avatar + close */}
          <div className="relative -mt-8 mb-3 flex items-end justify-between">
            <span
              className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl border-2 border-ink-3 bg-gradient-to-br from-violet to-gold font-display text-xl font-bold text-[#1a1405]"
              style={req.createdByPhotoURL ? { backgroundImage: `url("${req.createdByPhotoURL}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
            >{req.createdByPhotoURL ? "" : initial}</span>
            <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-white/[0.07] text-bone-dim hover:bg-white/10 hover:text-bone transition-colors">
              <X size={15} />
            </button>
          </div>

          {/* identity */}
          <div className="mb-1 font-display text-lg font-bold text-bone leading-tight">{req.createdByName}</div>
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {req.createdByRoleLabel && (
              <span className="rounded-full bg-violet/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-violet">{req.createdByRoleLabel}</span>
            )}
            {req.labelName && (
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-bone-dim">{req.labelName}</span>
            )}
            {req.createdByLocation && (
              <span className="text-[11px] text-bone-dim/70">{req.createdByLocation}</span>
            )}
          </div>

          {/* analytics row */}
          <div className="mb-3 grid grid-cols-3 divide-x divide-white/[0.07] overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.03]">
            <div className="flex flex-col items-center py-2.5 px-2">
              <span className="font-display text-[18px] font-bold text-bone leading-none">{requestCount}</span>
              <span className="mt-1 font-mono text-[9px] uppercase tracking-wide text-bone-dim/60">Requests</span>
            </div>
            <div className="flex flex-col items-center py-2.5 px-2">
              <span className="font-display text-[18px] font-bold text-bone leading-none">{totalViews}</span>
              <span className="mt-1 font-mono text-[9px] uppercase tracking-wide text-bone-dim/60">Views</span>
            </div>
            <div className="flex flex-col items-center py-2.5 px-2">
              <span className="font-display text-[18px] font-bold text-bone leading-none">{totalSubmissions}</span>
              <span className="mt-1 font-mono text-[9px] uppercase tracking-wide text-bone-dim/60">Submissions</span>
            </div>
          </div>

          {/* this request */}
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.04] p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-bone-dim/60">This request</div>
              <div className="flex items-center gap-2">
                <span className={`font-mono text-[9px] uppercase tracking-widest font-semibold ${typeMeta.color}`}>{typeMeta.label}</span>
                {postedAgo && <span className="text-[10px] text-bone-dim/40">{postedAgo}</span>}
              </div>
            </div>
            <div className="text-[13px] font-semibold text-bone leading-snug">{req.title}</div>
            {req.brief && <div className="mt-1 line-clamp-3 text-[12px] text-bone-dim leading-relaxed">{req.brief}</div>}
            {(req.genres?.length > 0 || req.tags?.length > 0) && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {(req.genres || []).map((g) => (
                  <span key={g} className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-bone">{g}</span>
                ))}
                {(req.tags || []).map((t) => (
                  <span key={t} className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[10px] text-bone-dim">#{t}</span>
                ))}
              </div>
            )}
            {/* per-request stats */}
            <div className="mt-2.5 flex items-center gap-3 text-[11px] text-bone-dim/50">
              <span className="flex items-center gap-1"><Eye size={11} /> {req.viewCount || 0} views</span>
              <span className="flex items-center gap-1"><Send size={11} /> {req.submissionCount || 0} submissions</span>
              {totalApproved > 0 && <span className="flex items-center gap-1 text-ok"><CheckCircle2 size={11} /> {totalApproved} approved</span>}
              {req.deadline && <span className="flex items-center gap-1"><Clock size={11} /> Due {req.deadline}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RequestForum({ onPick, uid }) {
  const [openId, setOpenId] = useState(null);
  const [profileReq, setProfileReq] = useState(null);
  const viewed = useRef(new Set());
  const feedRef = useRef(null);

  // Live Firestore listener — open requests stream in the instant they're posted.
  const { data } = useLiveCollection(
    ["dash", "requests", "live"],
    () => query(
      collection(db, "campaignRequests"),
      where("status", "==", "open"),
      orderBy("createdAt", "desc"),
      limit(30)
    ),
    {
      map: (d) => {
        const r = d.data();
        return {
          id: d.id,
          createdByUid: r.createdByUid || "",
          createdByName: r.createdByName || "Verified user",
          createdByPhotoURL: r.createdByPhotoURL || "",
          createdByRole: r.createdByRole || "",
          createdByRoleLabel: r.createdByRole ? verifiedRoleLabel(r.createdByRole) : "",
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
          createdAt: r.createdAt?.toMillis ? r.createdAt.toMillis() : null,
          isMine: !!uid && r.createdByUid === uid
        };
      }
    }
  );

  const loading = data === undefined;
  // Listener returns newest-first; reverse a copy so the newest "text" sits at the bottom like a chat.
  const requests = [...(data || [])].reverse();

  // Pin the feed to the bottom (latest message) on load and whenever new requests arrive.
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [requests.length]);

  const toggle = (req) => {
    const next = openId === req.id ? null : req.id;
    setOpenId(next);
    if (next && !req.isMine && !viewed.current.has(req.id)) {
      viewed.current.add(req.id);
      call("recordCampaignRequestView", { requestId: req.id }).catch(() => {});
    }
  };

  return (
    <Card className="mt-4 overflow-hidden p-0 lg:mt-6" style={{ overflow: "visible" }}>
      {/* header */}
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 lg:px-5">
        <div className="flex items-center gap-2">
          <div className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
          </div>
          <span className="font-display text-[15px] font-semibold leading-tight text-bone">Open requests</span>
          <span className="font-mono text-[11px] text-bone-dim">{requests.length} live</span>
        </div>
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-bone-dim/50">Live</span>
      </div>

      {profileReq && <UserProfilePopup req={profileReq} allRequests={requests} onClose={() => setProfileReq(null)} />}

      {/* feed */}
      {loading ? (
        <div className="flex flex-col gap-5 px-4 py-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-end gap-2.5">
              <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-2.5 w-24 rounded-full" />
                <Skeleton className="h-16 w-4/5 rounded-[18px] rounded-bl-[5px]" />
              </div>
            </div>
          ))}
        </div>
      ) : requests.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/5 text-bone-dim"><Send size={22} /></span>
          <p className="text-sm text-bone-dim">No open requests yet.</p>
        </div>
      ) : (
        <div ref={feedRef} className="req-scroll flex flex-col gap-3 overflow-y-auto px-4 py-5 lg:px-5" style={{ height: "340px" }}>
          {requests.map((req, i) => (
            <RequestBubble key={req.id} req={req} index={i} open={openId === req.id} onToggle={() => toggle(req)} onPick={onPick} onAvatarClick={() => setProfileReq(req)} />
          ))}
        </div>
      )}
    </Card>
  );
}

function RequestBubble({ req, index, open, onToggle, onPick, onAvatarClick }) {
  const meta = REQUEST_TYPE_META[req.requestType] || REQUEST_TYPE_META.beats;
  const TypeIcon = meta.Icon;
  const initial = avatarInitial(req.createdByName);
  const canSubmitBeat = req.requestType === "beats" || req.requestType === "both";
  const canSubmitLoop = req.requestType === "loops" || req.requestType === "both";

  return (
    <div className="msg-row flex items-end gap-2.5" style={{ "--i": index }}>
      {/* avatar pinned to bottom-left */}
      <div className="flex shrink-0 items-end">
        <button
          onClick={(e) => { e.stopPropagation(); onAvatarClick(); }}
          className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-violet to-gold font-display text-[11px] font-bold text-[#1a1405] ring-0 transition-transform duration-130 ease-expo active:scale-[0.9] hover:ring-2 hover:ring-white/20"
          style={req.createdByPhotoURL ? { backgroundImage: `url("${req.createdByPhotoURL}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
          aria-label={`View ${req.createdByName}'s profile`}
        >{req.createdByPhotoURL ? "" : initial}</button>
      </div>

      {/* bubble column — max 84% width like iMessage */}
      <div className="flex min-w-0 max-w-[84%] flex-col gap-1">
        {/* sender name row */}
        <div className="flex flex-wrap items-center gap-1.5 pl-1">
          <span className="text-[11px] font-semibold text-bone-dim">{req.createdByName}</span>
          {req.createdByRoleLabel && (
            <span className="rounded-full bg-violet/15 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-violet">{req.createdByRoleLabel}</span>
          )}
          {req.labelName && (
            <span className="text-[10px] text-bone-dim/60">{req.labelName}</span>
          )}
        </div>

        {/* the bubble — role=button (not <button>) so the submit actions inside aren't nested buttons */}
        <div
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onClick={onToggle}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
          className={`bubble-tail w-full cursor-pointer px-3.5 py-2.5 text-left transition-all duration-150 active:scale-[0.98] ${
            open ? "bg-violet/[0.15]" : "bg-white/[0.08] hover:bg-white/[0.11]"
          }`}
        >
          {/* type pill inside bubble top */}
          <span className={`mb-1.5 inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-widest opacity-70 ${meta.color}`}>
            <TypeIcon size={8} strokeWidth={2.5} /> {meta.label}
          </span>

          {/* title = the "message text" */}
          <div className="text-[14px] font-semibold leading-snug text-bone">{req.title}</div>

          {/* brief — clamps to 2 lines when closed */}
          <div className={`mt-0.5 text-[12px] leading-relaxed text-white/50 ${open ? "" : "line-clamp-2"}`}>
            {req.brief}
          </div>

          {/* expanded detail */}
          {open && (
            <div className="mt-3 border-t border-white/[0.08] pt-3" onClick={(e) => e.stopPropagation()}>
              {((req.genres?.length || 0) > 0 || (req.tags?.length || 0) > 0) && (
                <div className="mb-2.5 flex flex-wrap gap-1.5">
                  {(req.genres || []).map((g) => (
                    <span key={`g-${g}`} className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-bone">{g}</span>
                  ))}
                  {(req.tags || []).map((t) => (
                    <span key={`t-${t}`} className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[10px] text-bone-dim">#{t}</span>
                  ))}
                </div>
              )}

              {(req.references?.length || 0) > 0 && (
                <div className="mb-2 text-[11px] text-white/40">
                  <span className="font-semibold text-bone-dim">Ref: </span>{req.references.join(" · ")}
                </div>
              )}

              <div className="mb-3 flex flex-wrap gap-3 text-[11px] text-white/35">
                {req.deadline && <span className="inline-flex items-center gap-1"><Clock size={11} /> Due {req.deadline}</span>}
                <span className="inline-flex items-center gap-1"><Eye size={11} /> {req.viewCount || 0} views</span>
                <span className="inline-flex items-center gap-1"><Send size={11} /> {req.submissionCount || 0} submissions</span>
              </div>

              {req.isMine ? (
                <div className="rounded-lg bg-white/5 px-3 py-2 text-[11px] text-bone-dim">Your request.</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {canSubmitBeat && (
                    <GoldBtn className="py-2 text-[12px]" onClick={() => onPick({ ...req, requestType: "beats" })}>
                      <Rocket size={12} /> Submit campaign
                    </GoldBtn>
                  )}
                  {canSubmitLoop && (
                    canSubmitBeat
                      ? <button onClick={() => onPick({ ...req, requestType: "loops" })} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3.5 py-2 text-[12px] font-medium text-bone transition hover:bg-white/10 active:scale-[0.97]"><Disc3 size={12} /> Submit loop</button>
                      : <GoldBtn className="py-2 text-[12px]" onClick={() => onPick({ ...req, requestType: "loops" })}><Disc3 size={12} /> Submit loop</GoldBtn>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
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
const newBeat = (name = "", ig = "") => ({ uid: ++beatSeq, uploadId: makeUploadId(), title: "", genre: "Trap", key: KEY_OPTS[0], bpm: "", tags: [], tagDraft: "", file: null, storagePath: "", status: "No file", open: true, progress: 0, collabs: [{ name, role: "Producer", instagram: ig, phone: "" }] });

function CampaignBuilder({ tier, caps, pitchBalance, user, profile, campaignCount, targetRequest, clearTargetRequest, showToast, onSubmitted, onGoToBilling }) {
  const campaignUploadId = useRef(makeUploadId());
  const [bName, setBName] = useState(profile?.displayName || "");
  const [bIg, setBIg] = useState(profile?.instagram || "");
  const prefilled = useRef(false);
  // Name + Instagram live on the producer's account — prefill them so they
  // don't retype every campaign. Runs once when the profile arrives, and only
  // fills blanks so it never clobbers something the user already edited.
  useEffect(() => {
    if (prefilled.current) return;
    if (profile?.displayName || profile?.instagram) {
      setBName((v) => v || profile.displayName || "");
      setBIg((v) => v || profile.instagram || "");
      prefilled.current = true;
    }
  }, [profile?.displayName, profile?.instagram]);
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

  const isFree = tier === "free" && !targetRequest;
  const beatCost = useMemo(() => beats.filter((b) => b.title.trim()).length, [beats]);
  const rushCost = rush ? 2 : 0;
  const cost = beatCost + rushCost;
  const noCredit = cost > 0 && cost > pitchBalance;

  useEffect(() => {
    if (tier !== "pro" && selected.length) setSelected([]);
  }, [tier, selected.length]);

  const patchBeat = (uid, patch) => setBeats((prev) => prev.map((b) => (b.uid === uid ? { ...b, ...patch } : b)));
  const patchCollab = (uid, i, patch) => setBeats((prev) => prev.map((b) => b.uid === uid ? { ...b, collabs: b.collabs.map((c, j) => (j === i ? { ...c, ...patch } : c)) } : b));
  const addBeat = () => { if (beats.length >= caps.beats) { showToast(`Your plan allows up to ${caps.beats} beats per campaign.`); return; } setBeats((p) => [...p, newBeat(bName, bIg)]); };
  const removeBeat = (uid) => { if (beats.length <= 1) { showToast("Keep at least one beat."); return; } setBeats((p) => p.filter((b) => b.uid !== uid)); };
  const addTags = (uid, raw) => {
    const tags = normalizeTags(raw);
    if (!tags.length) return;
    setBeats((prev) => prev.map((b) => (
      b.uid === uid ? { ...b, tags: [...new Set([...(b.tags || []), ...tags])].slice(0, 8), tagDraft: "" } : b
    )));
  };
  const removeTag = (uid, tag) => setBeats((prev) => prev.map((b) => (
    b.uid === uid ? { ...b, tags: (b.tags || []).filter((t) => t !== tag) } : b
  )));

  const toggleTarget = (id) => {
    if (tier !== "pro") { showToast("Desk targeting is included with Pro."); return; }
    if (ANR_IDS.has(id) && !caps.anr) { showToast("A&R / management lanes require a Pro subscription."); return; }
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= caps.lanes) { showToast(`Your ${tier} plan allows ${caps.lanes} lane${caps.lanes === 1 ? "" : "s"}. Deselect one first.`); return prev; }
      return [...prev, id];
    });
  };

  async function review() {
    if (!bName.trim() || !bIg.trim()) { showToast("Add your name and Instagram."); return; }
    const named = beats.filter((b) => b.title.trim());
    if (named.length === 0) { showToast("Name at least one beat."); return; }
    if (named.find((b) => !b.file && !b.storagePath)) { showToast("Attach a file to every named beat."); return; }
    if (cost > pitchBalance) { showToast("Not enough pitch credits."); return; }

    setBusy(true); setSubmitBtn("Uploading beats…");
    try {
      await Promise.all(named.map(async (b) => {
        if (!b.file) return;
        if (!isMp3File(b.file)) throw new Error("Only .mp3 files can be uploaded.");
        const ext = b.file.name.split(".").pop();
        const title = (b.title.trim() || "beat").toUpperCase();
        const handles = [bIg, ...b.collabs.map((c) => c.instagram.trim())].filter(Boolean).map((ig) => (ig.startsWith("@") ? ig : "@" + ig));
        const igPart = [...new Set(handles)].length ? `(${[...new Set(handles)].join(", ")})` : "";
        const safeName = `${title}${igPart}`.replace(/[/\\:*?"<>|]/g, "");
        const beatUploadId = b.uploadId || makeUploadId();
        const path = `beats/${user.uid}/${campaignUploadId.current}/beats/${beatUploadId}/${safeName}.${ext}`;
        patchBeat(b.uid, { status: "Uploading…" });
        await uploadFile(new File([b.file], `${safeName}.${ext}`, { type: "audio/mpeg" }), path, (pct) => patchBeat(b.uid, { progress: pct }));
        patchBeat(b.uid, { uploadId: beatUploadId, storagePath: path, file: null, status: "Uploaded" });
        b.storagePath = path;
      }));
    } catch (e) { showToast("Upload failed: " + e.message); setBusy(false); setSubmitBtn("Review campaign"); return; }

    const builtBeats = named.map((b) => ({ title: b.title.trim(), genre: b.genre, key: b.key, bpm: b.bpm, tags: normalizeTags([...(b.tags || []), b.tagDraft || ""].join(",")), storagePath: b.storagePath, collabs: b.collabs.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), role: c.role, instagram: c.instagram.trim(), phone: c.phone.trim() })) }));
    const addons = [...(rush ? ["rush"] : []), ...(feedback ? ["feedback"] : [])];
    setBusy(false); setSubmitBtn("Review campaign"); setPayMsg(null);
    setPay({ beats: builtBeats, targets: selected, addons, cost });
  }

  async function doPay() {
    setPayBusy(true); setPayMsg(null);
    try {
      await call("submitCampaign", { producer: { name: bName.trim(), instagram: bIg.trim(), email: user?.email || "", phone: profile?.phone || "" }, beats: pay.beats, targets: pay.targets, addons: pay.addons, targetRequestId: targetRequest?.id || "" });
      // Backfill the account with name/Instagram if it didn't have them yet, so
      // future campaigns auto-fill. Only fills blanks — never overwrites.
      const acct = {};
      if (!profile?.displayName && bName.trim()) acct.displayName = bName.trim();
      if (!profile?.instagram && bIg.trim()) acct.instagram = bIg.trim();
      if (Object.keys(acct).length) setDoc(doc(db, "users", user.uid), acct, { merge: true }).catch(() => {});
      setPayMsg({ text: "Campaign submitted — now pending review.", kind: "ok" });
      setTimeout(() => { campaignUploadId.current = makeUploadId(); sessionStorage.removeItem("pluggurbeats:targetRequest"); clearTargetRequest?.(); setPay(null); onSubmitted(); showToast("Campaign submitted for review."); }, 900);
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
          <GoldBtn onClick={onGoToBilling}>See plans <ArrowRight size={16} /></GoldBtn>
        </Card>
      </section>
    );
  }

  const capLabel = tier === "pro" && selected.length > 0 ? `${selected.length} of ${caps.lanes}` : "Verified library only";
  const addonLabels = pay ? pay.addons.map((a) => (a === "rush" ? "Rush" : "Feedback")).join(", ") : "";

  return (
    <section>
      <SectionHead eyebrow="New campaign" title="Start a campaign" sub={targetRequest ? `Targeting ${targetRequest.createdByName}'s request. Staff review is still required before delivery.` : tier === "pro" ? "Approved campaigns go to Verified; optionally add up to 5 Pro desk lanes." : "Approved campaigns are added to the Verified library."} />

      {targetRequest && (
        <Card className="mb-4 flex flex-col gap-3 border-gold/30 bg-gold/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-gold">Request target</div>
            <div className="mt-1 truncate font-display text-xl text-bone">{targetRequest.title}</div>
            <div className="mt-0.5 text-[13px] text-bone-dim">{targetRequest.createdByName} · {targetRequest.createdByRoleLabel || "Verified"}{targetRequest.labelName ? ` · ${targetRequest.labelName}` : ""}</div>
          </div>
          <GhostBtn className="px-4 py-2 text-[12px]" onClick={() => { sessionStorage.removeItem("pluggurbeats:targetRequest"); clearTargetRequest?.(); }}>Clear target</GhostBtn>
        </Card>
      )}

      {/* cost banner */}
      <Card className="mb-4 flex flex-wrap items-center justify-between gap-4 p-4 lg:mb-6 lg:p-5">
        <div>
          <Eyebrow>Pitch credits</Eyebrow>
          <div className="mt-1 font-display text-4xl leading-none">{pitchBalance}<span className="ml-1 font-sans text-sm font-normal text-bone-dim">available</span></div>
        </div>
        <div className="text-right">
          <div className="text-[12px] text-bone-dim">1 per beat{rush ? " + 2 rush" : ""}</div>
          <div className={`font-display text-3xl leading-none ${noCredit ? "text-bad" : "text-gold"}`}>{cost}</div>
          <div className="text-[11px] text-bone-dim">credits</div>
        </div>
      </Card>

      {/* 1 details */}
      <Card className="mb-4 p-4 lg:p-5">
        <StepHead n={1} title="Your details" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label>Your name *</Label><input className={inputCls} placeholder="Your name" value={bName} onChange={(e) => setBName(e.target.value)} /></div>
          <div><Label>Your Instagram *</Label><input className={inputCls} placeholder="@yourhandle" value={bIg} onChange={(e) => setBIg(e.target.value)} /></div>
        </div>
      </Card>

      {/* 2 beats */}
      <Card className="mb-4 p-4 lg:p-5">
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
                        {b.file ? (b.file.name.length > 24 ? b.file.name.slice(0, 22) + "…" : b.file.name) : b.storagePath ? "Uploaded" : "Attach MP3"}
                        <input type="file" accept=".mp3,audio/mpeg" className="hidden" onChange={(e) => {
                          const f = e.target.files[0];
                          if (!f) return;
                          if (!isMp3File(f)) { showToast("Only .mp3 files can be uploaded."); e.target.value = ""; return; }
                          patchBeat(b.uid, { file: f, storagePath: "", status: "Ready", progress: 0 });
                        }} />
                      </label>
                      {b.progress > 0 && b.progress < 100 && <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-gold transition-all" style={{ width: b.progress + "%" }} /></div>}
                    </div>
                  </div>
                  <div className="mt-3">
                    <Label>Tags</Label>
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-strong bg-ink px-2.5 py-2">
                      {(b.tags || []).map((tag) => (
                        <button key={tag} type="button" onClick={() => removeTag(b.uid, tag)} className="inline-flex items-center gap-1 rounded-full border border-line bg-ink-3 px-2 py-1 font-mono text-[10px] text-bone-dim transition hover:border-bad hover:text-bad">
                          #{tag}<X size={11} />
                        </button>
                      ))}
                      <input
                        className="min-w-[160px] flex-1 bg-transparent px-1 py-1 text-sm text-bone placeholder:text-bone-dim/50 outline-none"
                        placeholder="dark trap, melodic, 808 heavy"
                        value={b.tagDraft || ""}
                        onChange={(e) => patchBeat(b.uid, { tagDraft: e.target.value })}
                        onBlur={(e) => addTags(b.uid, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === ",") {
                            e.preventDefault();
                            addTags(b.uid, e.currentTarget.value);
                          }
                        }}
                      />
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

      {/* 3 desks */}
      <Card className="mb-4 p-4 lg:p-5">
        <StepHead n={3} title="Pro desk targeting" right={<span className="font-mono text-[11px] text-bone-dim">{tier === "pro" ? `${selected.length} / ${caps.lanes}` : "PRO ONLY"}</span>} />
        {tier !== "pro" ? (
          <div className="rounded-xl border border-line bg-ink p-4">
            <div className="font-display text-lg">Verified library delivery</div>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-bone-dim">Plugg campaigns do not use desk targeting. Once approved, your tagged beats go into the Verified library for curators to browse, play, and download.</p>
            <GoldBtn className="mt-4" onClick={onGoToBilling}>Upgrade for Pro desks <ArrowRight size={16} /></GoldBtn>
          </div>
        ) : (
          <>
            <p className="mb-4 text-[13px] text-bone-dim">Optional. Pick up to 5 lanes for direct email delivery; leaving this empty sends the campaign to the Verified library only.</p>
            <div className="mb-4 inline-flex rounded-full border border-line bg-ink p-1">
              {[["artists", "Artist targets"], ["anr", "A&R / labels"]].map(([k, t]) => (
                <button key={k} onClick={() => setSeg(k)} className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition ${seg === k ? "bg-gold text-[#1a1405]" : "text-bone-dim hover:text-bone"}`}>{t}</button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(seg === "artists" ? ARTIST_TARGETS : ANR_TARGETS).map((t) => {
                const locked = ANR_IDS.has(t.id) && !caps.anr;
                const on = selected.includes(t.id);
                const capped = !on && selected.length >= caps.lanes;
                return (
                  <button key={t.id} disabled={locked || capped} onClick={() => toggleTarget(t.id)} className={`relative rounded-xl border p-4 text-left transition disabled:cursor-not-allowed ${on ? "border-gold bg-gold/[0.08]" : "border-line bg-ink hover:border-strong"} ${locked || capped ? "opacity-55" : ""}`}>
                    {on && <span className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-gold text-[#1a1405]"><Check size={12} /></span>}
                    <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-bone-dim">{t.tier}</div>
                    <div className="mt-1.5 font-display text-lg">{t.lane}</div>
                    <div className="text-[12px] text-bone-dim">{t.reach}</div>
                    {capped && <div className="mt-2 font-mono text-[10px] tracking-[0.1em] text-bone-dim">LIMIT REACHED</div>}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </Card>

      {/* add-ons */}
      <Card className="mb-4 p-4 lg:mb-6 lg:p-5">
        <h3 className="mb-4 font-display text-base">Add-ons <span className="text-[12px] font-normal text-bone-dim">(optional)</span></h3>
        {[
          { on: rush, set: setRush, title: "Rush queue", price: "2 credits", desc: "Priority review — pushed to the front of the staff queue" },
          { on: feedback, set: setFeedback, title: "Written feedback", price: "Included", desc: "Summary from our pitching team after the campaign closes" }
        ].map((a) => (
          <label key={a.title} className="flex cursor-pointer items-start gap-3 border-line py-2.5 [&:not(:last-child)]:border-b">
            <input type="checkbox" checked={a.on} onChange={(e) => a.set(e.target.checked)} className="mt-1 h-4 w-4 accent-gold" />
            <div>
              <span className="text-sm font-medium">{a.title}</span>
              <span className="ml-2 font-mono text-[11px] text-gold">{a.price}</span>
              <div className="text-[12px] text-bone-dim">{a.desc}</div>
            </div>
          </label>
        ))}
      </Card>

      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
        {noCredit && <span className="text-center text-[13px] text-bad sm:text-left">Not enough pitch credits.</span>}
        <GoldBtn className="w-full sm:w-auto" disabled={busy || noCredit} onClick={review}>{submitBtn} <ArrowRight size={16} /></GoldBtn>
      </div>

      {pay && (
        <Overlay onClose={() => setPay(null)}>
          <div className="mb-4 flex items-center justify-between"><h3 className="font-display text-2xl">Submit for review</h3><button onClick={() => setPay(null)} className="text-bone-dim hover:text-bone"><X size={20} /></button></div>
          <div className="space-y-2 rounded-xl border border-line bg-ink p-4 text-sm">
            <Row k="Beats" v={pay.beats.length} />
            <Row k="Delivery" v={targetRequest ? `Request: ${targetRequest.createdByRoleLabel || "Verified"}` : capLabel} />
            <Row k="Add-ons" v={addonLabels || "None"} />
            {pay.addons.includes("rush") && <Row k="Rush queue" v="2 credits" />}
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
const fmtDateShort = (ms) => (ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

function Analytics({ campaigns, uid, tier }) {
  const cms = (c) => (c.createdAt?.toMillis ? c.createdAt.toMillis() : (typeof c.createdAt === "number" ? c.createdAt : null));
  const underReview = campaigns.filter((c) => c.status === "pending_review");
  const approved = campaigns.filter((c) => ["approved", "pitched"].includes(c.status));
  const rejected = campaigns.filter((c) => c.status === "rejected");

  const { data: libActivityRaw } = useLiveCollection(["libActivity", uid], () => collection(db, "users", uid, "libraryActivity"), { enabled: !!uid });
  const libActivity = libActivityRaw || [];

  return (
    <section>
      <SectionHead eyebrow="Analytics" title="Pitch analytics" sub="Campaign-by-campaign engagement tracking." />

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
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
                  <p className="mt-2 text-[12px] text-bone-dim">Submitted {fmtDateShort(cms(c))}</p>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Campaign tree */}
      <div className="mt-6">
        <div className="mb-1 flex items-center gap-2"><BarChart3 size={18} className="text-gold" /><h3 className="font-display text-lg">Campaigns</h3></div>
        <p className="mb-4 text-[13px] text-bone-dim">Expand a campaign to see each beat, then expand a beat to see who viewed or downloaded it.</p>
        <CampaignTree campaigns={campaigns} uid={uid} tier={tier} libActivity={libActivity} />
      </div>

      {/* Loop activity (loops are not in campaigns — separate section) */}
      {libActivity.some((r) => r.kind === "loop") && (
        <div className="mt-6">
          <div className="mb-1 flex items-center gap-2"><Disc3 size={18} className="text-gold" /><h3 className="font-display text-lg">Loop Drops activity</h3></div>
          <p className="mb-4 text-[13px] text-bone-dim">Who played or downloaded your loops from the Verified library.</p>
          <LoopActivity uid={uid} libActivity={libActivity} />
        </div>
      )}

      {/* Email engagement upsell for non-Pro */}
      {tier !== "pro" && (
        <Card className="mt-6 flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gold/12 text-gold"><Mail size={18} /></span>
            <div>
              <div className="font-display text-base">Email pitch analytics</div>
              <div className="text-[13px] text-bone-dim">See who opened your email blast and downloaded your beats — Pro subscribers only.</div>
            </div>
          </div>
          <span className="rounded-full border border-gold/40 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-gold">Pro only</span>
        </Card>
      )}
    </section>
  );
}

/* Campaign tree: Campaign → beats → beat detail */
function CampaignTree({ campaigns, uid, tier, libActivity }) {
  const sorted = [...campaigns].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  if (!sorted.length) return (
    <Card className="flex flex-col items-center gap-3 py-10 text-center p-5">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/5 text-bone-dim"><BarChart3 size={22} /></span>
      <p className="text-sm text-bone-dim">No campaigns yet — submit your first to see analytics here.</p>
    </Card>
  );
  return (
    <div className="flex flex-col gap-3">
      {sorted.map((c) => <CampaignRow key={c.id} campaign={c} uid={uid} tier={tier} libActivity={libActivity} />)}
    </div>
  );
}

function CampaignRow({ campaign, uid, tier, libActivity }) {
  const [open, setOpen] = useState(false);
  const ms = campaign.createdAt?.toMillis ? campaign.createdAt.toMillis() : null;
  const beats = campaign.beats || [];
  const title = beats.map((b) => b.title).filter(Boolean).join(", ") || "Campaign";

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-white/[0.02]"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 text-bone-dim"><Music2 size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-bone">{title}</div>
          <div className="text-[12px] text-bone-dim">{beats.length} beat{beats.length !== 1 ? "s" : ""}{ms ? ` · ${fmtDateShort(ms)}` : ""}</div>
        </div>
        <div className="hidden shrink-0 items-center gap-3 sm:flex">
          {(campaign.opens || 0) > 0 && <span className="flex items-center gap-1 font-mono text-[11px] text-bone-dim"><Eye size={11} /> {campaign.opens}</span>}
          {(campaign.downloads || 0) > 0 && <span className="flex items-center gap-1 font-mono text-[11px] text-ok"><Download size={11} /> {campaign.downloads}</span>}
          <StatusBadge status={campaign.status} />
        </div>
        <ChevronDown size={16} className={`ml-1 shrink-0 text-bone-dim transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-line">
          {/* Mobile status + stats */}
          <div className="flex items-center gap-3 px-4 py-2 sm:hidden">
            <StatusBadge status={campaign.status} />
            {(campaign.opens || 0) > 0 && <span className="flex items-center gap-1 font-mono text-[11px] text-bone-dim"><Eye size={11} /> {campaign.opens} opens</span>}
            {(campaign.downloads || 0) > 0 && <span className="flex items-center gap-1 font-mono text-[11px] text-ok"><Download size={11} /> {campaign.downloads} downloads</span>}
          </div>

          {/* Beat rows — each beat has its own library + email sub-sections */}
          {beats.length > 0 ? beats.map((beat, i) => (
            <BeatRow key={i} beat={beat} beatIndex={i} totalBeats={beats.length} campaign={campaign} uid={uid} tier={tier} libActivity={libActivity} />
          )) : (
            <div className="px-4 py-3 text-[13px] text-bone-dim">No beats in this campaign.</div>
          )}
        </div>
      )}
    </Card>
  );
}

function BeatRow({ beat, beatIndex, totalBeats, campaign, uid, tier, libActivity }) {
  const [open, setOpen] = useState(false);
  const n = String(beatIndex + 1).padStart(2, "0");

  // Match library activity for this beat by title
  const beatLib = libActivity.filter((r) => r.title === beat.title && r.kind !== "loop");
  const viewerMap = new Map();
  beatLib.forEach((r) => {
    if (!viewerMap.has(r.actorUid)) viewerMap.set(r.actorUid, { name: r.actorName || "A verified user", viewed: false, downloaded: false, last: 0 });
    const a = viewerMap.get(r.actorUid);
    if (r.actorName) a.name = r.actorName;
    if (r.type === "view") a.viewed = true;
    if (r.type === "download") a.downloaded = true;
    const ms = r.lastAt?.toMillis ? r.lastAt.toMillis() : 0;
    if (ms > a.last) a.last = ms;
  });
  const viewers = [...viewerMap.values()].sort((a, b) => b.last - a.last);
  const viewCount = viewers.filter((v) => v.viewed).length;
  const dlCount = viewers.filter((v) => v.downloaded).length;

  return (
    <div className={beatIndex < totalBeats - 1 ? "border-b border-line" : ""}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.02]"
      >
        <span className="font-mono text-[11px] text-bone-dim">{n}</span>
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-bone">{beat.title || "Untitled"}</span>
          {(beat.genre || beat.bpm || beat.key) && (
            <span className="ml-2 text-[12px] text-bone-dim">{[beat.genre, beat.bpm ? `${beat.bpm} BPM` : "", beat.key].filter(Boolean).join(" · ")}</span>
          )}
        </div>
        {(viewCount > 0 || dlCount > 0) && (
          <div className="hidden shrink-0 items-center gap-2 sm:flex">
            {viewCount > 0 && <span className="flex items-center gap-1 font-mono text-[11px] text-info"><Eye size={10} /> {viewCount}</span>}
            {dlCount > 0 && <span className="flex items-center gap-1 font-mono text-[11px] text-ok"><Download size={10} /> {dlCount}</span>}
          </div>
        )}
        <ChevronDown size={14} className={`ml-1 shrink-0 text-bone-dim transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-line bg-ink/50">
          {/* Library activity sub-section */}
          <BeatSubSection
            icon={<ShieldCheck size={13} className="text-gold" />}
            label="Verified library"
            meta={viewCount > 0 || dlCount > 0 ? `${viewCount} viewed · ${dlCount} downloaded` : "No activity yet"}
          >
            {viewers.length > 0 ? (
              <ActivityList
                headers={["Verified user", "Viewed", "Downloaded", "Last activity"]}
                rows={viewers.map((v) => ({
                  label: v.name,
                  time: fmtTime(v.last),
                  b1: v.viewed ? <Tag c="bg-info/12 text-info"><Eye size={11} className="inline -mt-0.5 mr-1" />viewed</Tag> : null,
                  b2: v.downloaded ? <Tag c="bg-ok/12 text-ok"><Download size={11} className="inline -mt-0.5 mr-1" />downloaded</Tag> : null
                }))}
              />
            ) : (
              <p className="text-[13px] text-bone-dim">No verified library activity for this beat yet.</p>
            )}
          </BeatSubSection>

          {/* Email engagement sub-section (Pro only) */}
          {tier === "pro" ? (
            <BeatEmailSection campaign={campaign} uid={uid} />
          ) : (
            <div className="flex items-center gap-3 border-t border-line px-4 py-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-gold/10 text-gold"><Mail size={12} /></span>
              <span className="text-[13px] text-bone-dim">Email engagement</span>
              <span className="ml-auto rounded-full border border-gold/40 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-gold">Pro only</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BeatSubSection({ icon, label, meta, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-line first:border-t-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.02]"
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-white/5">{icon}</span>
        <span className="flex-1 text-[13px] font-medium text-bone">{label}</span>
        <span className="font-mono text-[11px] text-bone-dim">{meta}</span>
        <ChevronDown size={13} className={`ml-2 shrink-0 text-bone-dim transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="border-t border-line px-4 py-4">{children}</div>}
    </div>
  );
}

function BeatEmailSection({ campaign, uid }) {
  const [open, setOpen] = useState(false);
  const eventsQ = useQuery({
    queryKey: ["emailEvents", uid, campaign.id],
    queryFn: () => call("listCampaignEmailEvents", { campaignId: campaign.id }).then((d) => d.events || []),
    enabled: !!uid && !!campaign.id && open,
    refetchInterval: open ? 15000 : false
  });
  const events = eventsQ.data || [];

  const byContact = new Map();
  const legacyContactKey = (value) => String(value || "").trim();
  const contactKey = (c) => typeof c === "string" ? legacyContactKey(c) : (c?.contactId || c?.viewerUsername || c?.viewerName || "");
  const contactLabel = (c) => typeof c === "string" ? "Verified contact" : (c?.viewerName || c?.viewerUsername || "Verified contact");
  (campaign.pitchedTo || []).forEach((c) => { const k = contactKey(c); if (k) byContact.set(k, { label: contactLabel(c), opened: false, downloaded: false, last: null }); });
  events.forEach((e) => {
    const k = e.contactId || legacyContactKey(e.contact); if (!k) return;
    if (!byContact.has(k)) byContact.set(k, { label: e.viewerName || e.viewerUsername || "Verified contact", opened: false, downloaded: false, last: null });
    const r = byContact.get(k);
    if (e.viewerName || e.viewerUsername) r.label = e.viewerName || e.viewerUsername;
    if (e.type === "opened") r.opened = true;
    if (e.type === "downloaded") r.downloaded = true;
    const tms = e.timestamp?.toMillis ? e.timestamp.toMillis() : null;
    if (tms && (!r.last || tms > r.last)) r.last = tms;
  });
  const rows = [...byContact.values()];
  const hasActivity = (campaign.opens || 0) > 0 || (campaign.downloads || 0) > 0;
  const meta = hasActivity ? `${campaign.opens || 0} opens · ${campaign.downloads || 0} downloads` : "No activity yet";

  return (
    <div className="border-t border-line">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.02]"
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-gold/10 text-gold"><Mail size={12} /></span>
        <span className="flex-1 text-[13px] font-medium text-bone">Email engagement</span>
        <span className="font-mono text-[11px] text-bone-dim">{meta}</span>
        <ChevronDown size={13} className={`ml-2 shrink-0 text-bone-dim transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-line px-4 py-4">
          {rows.length ? (
            <ActivityList
              headers={["Recipient", "Opened", "Downloaded", "Last activity"]}
              rows={rows.map((r) => ({
                label: r.label,
                time: fmtTime(r.last),
                b1: r.opened ? <Tag c="bg-info/12 text-info">opened</Tag> : null,
                b2: r.downloaded ? <Tag c="bg-ok/12 text-ok">downloaded</Tag> : null
              }))}
            />
          ) : hasActivity ? (
            <div className="flex flex-col gap-2">{[0, 1].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <p className="text-[13px] text-bone-dim">Awaiting recipient activity…</p>
          )}
        </div>
      )}
    </div>
  );
}

function LoopActivity({ uid, libActivity }) {
  const loops = libActivity.filter((r) => r.kind === "loop");
  const byRes = new Map();
  loops.forEach((r) => {
    if (!byRes.has(r.resourceId)) byRes.set(r.resourceId, { title: r.title || "Untitled", actors: new Map(), last: 0 });
    const g = byRes.get(r.resourceId);
    if (r.title) g.title = r.title;
    if (!g.actors.has(r.actorUid)) g.actors.set(r.actorUid, { name: r.actorName || "A verified user", viewed: false, downloaded: false, last: 0 });
    const a = g.actors.get(r.actorUid);
    if (r.actorName) a.name = r.actorName;
    if (r.type === "view") a.viewed = true;
    if (r.type === "download") a.downloaded = true;
    const ms = r.lastAt?.toMillis ? r.lastAt.toMillis() : 0;
    if (ms > a.last) a.last = ms;
    if (ms > g.last) g.last = ms;
  });
  const groups = [...byRes.values()].sort((a, b) => b.last - a.last);
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g, gi) => {
        const actors = [...g.actors.values()].sort((a, b) => b.last - a.last);
        return (
          <Card key={gi} className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/5 text-bone-dim"><Disc3 size={14} /></span>
                <strong className="text-sm">{g.title}</strong>
              </div>
              <span className="font-mono text-[11px] text-bone-dim">{actors.filter((a) => a.viewed).length} viewed · {actors.filter((a) => a.downloaded).length} downloaded</span>
            </div>
            <ActivityList
              headers={["Verified user", "Viewed", "Downloaded", "Last activity"]}
              rows={actors.map((a) => ({
                label: a.name,
                time: fmtTime(a.last),
                b1: a.viewed ? <Tag c="bg-info/12 text-info"><Eye size={11} className="inline -mt-0.5 mr-1" />viewed</Tag> : null,
                b2: a.downloaded ? <Tag c="bg-ok/12 text-ok"><Download size={11} className="inline -mt-0.5 mr-1" />downloaded</Tag> : null
              }))}
            />
          </Card>
        );
      })}
    </div>
  );
}
const Tag = ({ c, children }) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c}`}>{children}</span>;

// Activity rows render mobile-first: a stacked label/time + right-aligned status
// chips on phones, upgrading to a 4-column table at sm and up. rows = array of
// { label, time, b1, b2, mono? } where b1/b2 are status chips (or null = none).
function ActivityList({ headers, rows }) {
  return (
    <>
      {/* mobile: stacked rows */}
      <ul className="divide-y divide-line sm:hidden">
        {rows.map((r, i) => (
          <li key={i} className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className={`truncate ${r.mono ? "font-mono text-[12px]" : "text-sm font-medium"}`}>{r.label}</div>
              <div className="mt-1 font-mono text-[11px] text-bone-dim">{r.time}</div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {r.b1}{r.b2}
              {!r.b1 && !r.b2 && <span className="text-[11px] text-bone-dim">No activity</span>}
            </div>
          </li>
        ))}
      </ul>
      {/* desktop: table */}
      <div className="hidden overflow-x-auto scrollbar-slim sm:block">
        <table className="w-full text-left text-[13px]">
          <thead><tr className="text-bone-dim">{headers.map((h) => <th key={h} className="pb-2 font-mono text-[10px] uppercase tracking-wider font-normal">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => (
              <tr key={i}>
                <td className={`py-2 pr-3 ${r.mono ? "font-mono text-[12px]" : "font-medium"}`}>{r.label}</td>
                <td className="py-2 pr-3">{r.b1 || <span className="text-bone-dim">—</span>}</td>
                <td className="py-2 pr-3">{r.b2 || <span className="text-bone-dim">—</span>}</td>
                <td className="py-2 text-bone-dim">{r.time}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ============================ paperwork ============================ */
const PRO_OPTS = ["", "ASCAP", "BMI", "SESAC", "GMR", "SOCAN", "PRS", "Other"];
const newWriter = (o = {}) => ({ legalName: "", role: "Producer", email: "", phone: "", address: "", pro: "", publisher: "", ipi: "", pct: "", ...o });
const sheetStatus = (s) => {
  const m = {
    sent: { t: "Awaiting signatures", c: "bg-info/12 text-info", I: Clock },
    delivered: { t: "Opened by signers", c: "bg-info/12 text-info", I: Clock },
    completed: { t: "Fully signed", c: "bg-ok/12 text-ok", I: CheckCircle2 },
    declined: { t: "Declined", c: "bg-bad/12 text-bad", I: XCircle },
    voided: { t: "Voided", c: "bg-white/8 text-bone-dim", I: XCircle }
  };
  return m[s] || { t: s || "—", c: "bg-white/8 text-bone-dim", I: Clock };
};

function Paperwork({ campaigns, uid, profile, showToast }) {
  // Every beat across the producer's campaigns, with its collaborators.
  const beatOpts = useMemo(() => {
    const out = [];
    campaigns.forEach((c) => (c.beats || []).forEach((b, i) => out.push({
      key: `${c.id}__${i}`, campaignId: c.id, beatIndex: i,
      title: b.title || "Untitled beat", collabs: b.collabs || []
    })));
    return out;
  }, [campaigns]);

  const [selKey, setSelKey] = useState("");
  const [song, setSong] = useState({ title: "", artist: "", dateCreated: new Date().toISOString().slice(0, 10) });
  const [writers, setWriters] = useState([newWriter({ role: "Producer" })]);
  const [busy, setBusy] = useState(false);

  const sel = beatOpts.find((o) => o.key === selKey) || null;
  const total = writers.reduce((t, w) => t + (parseFloat(w.pct) || 0), 0);
  const pctOk = Math.round(total) === 100;
  const patch = (i, p) => setWriters((prev) => prev.map((w, j) => (j === i ? { ...w, ...p } : w)));

  // Live list of split sheets this producer has generated.
  const { data: sheets } = useLiveCollection(["splitSheets", uid], () => collection(db, "users", uid, "splitSheets"), { enabled: !!uid });

  function chooseBeat(key) {
    setSelKey(key);
    const o = beatOpts.find((x) => x.key === key);
    if (!o) return;
    setSong((s) => ({ ...s, title: o.title }));
    // Prefill: producer first, then each listed collaborator.
    const rows = [newWriter({ legalName: profile?.displayName || "", email: profile?.email || "", phone: profile?.phone || "", role: "Producer" })];
    o.collabs.forEach((c) => rows.push(newWriter({ legalName: c.name || "", role: c.role || "Writer", phone: c.phone || "" })));
    setWriters(rows.length ? rows : [newWriter()]);
  }

  async function generate() {
    if (!sel) { showToast("Pick a beat first."); return; }
    if (!song.title.trim()) { showToast("Song title is required."); return; }
    for (const w of writers) {
      if (!w.legalName.trim()) { showToast("Every contributor needs a legal name."); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(w.email.trim())) { showToast(`A valid email is required for ${w.legalName || "each contributor"} (to sign).`); return; }
    }
    if (!pctOk) { showToast(`Splits must total exactly 100% (currently ${total}%).`); return; }
    setBusy(true);
    try {
      await call("generateSplitSheet", {
        campaignId: sel.campaignId, beatIndex: sel.beatIndex,
        song: { title: song.title.trim(), artist: song.artist.trim(), dateCreated: song.dateCreated },
        writers: writers.map((w) => ({ ...w, pct: Number(w.pct) || 0 }))
      });
      showToast("Split sheet sent — every contributor gets a DocuSign email to sign.");
      setSelKey(""); setWriters([newWriter()]); setSong({ title: "", artist: "", dateCreated: new Date().toISOString().slice(0, 10) });
    } catch (e) { showToast(e.message || "Could not send split sheet."); }
    finally { setBusy(false); }
  }

  async function refresh(sheetId, btn) {
    btn.disabled = true;
    try { await call("refreshSplitSheetStatus", { sheetId }); }
    catch (e) { showToast(e.message || "Could not refresh."); }
    finally { btn.disabled = false; }
  }

  return (
    <section>
      <SectionHead eyebrow="Documents" title="Split sheets" sub="Generate a legally-binding publishing split sheet and route it to every collaborator for e-signature via DocuSign." />

      <Card className="mb-4 p-4 lg:mb-6 lg:p-5">
        <div className="mb-4 flex items-center gap-2"><PenLine size={18} className="text-gold" /><h3 className="font-display text-lg">New split sheet</h3></div>

        {beatOpts.length === 0 ? (
          <p className="py-4 text-sm text-bone-dim">No beats yet — start a campaign first, then come back to split it.</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label>Beat *</Label>
                <select className={inputCls} value={selKey} onChange={(e) => chooseBeat(e.target.value)}>
                  <option value="">Select a beat…</option>
                  {beatOpts.map((o) => <option key={o.key} value={o.key}>{o.title}</option>)}
                </select>
              </div>
              <div><Label>Recording artist</Label><input className={inputCls} placeholder="Artist this was made for (optional)" value={song.artist} onChange={(e) => setSong((s) => ({ ...s, artist: e.target.value }))} /></div>
              <div><Label>Song title *</Label><input className={inputCls} value={song.title} onChange={(e) => setSong((s) => ({ ...s, title: e.target.value }))} /></div>
              <div><Label>Date created</Label><input className={inputCls} type="date" value={song.dateCreated} onChange={(e) => setSong((s) => ({ ...s, dateCreated: e.target.value }))} /></div>
            </div>

            {sel && (
              <>
                <div className="mt-5 mb-2 flex items-center justify-between">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-bone-dim">Contributors · publishing splits</div>
                  <span className={`font-display text-lg ${pctOk ? "text-ok" : "text-bad"}`}>{total}%</span>
                </div>
                <div className="flex flex-col gap-3">
                  {writers.map((w, i) => (
                    <div key={i} className="rounded-xl border border-line bg-ink p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="font-mono text-[11px] text-bone-dim">Contributor {i + 1}{i === 0 ? " (you)" : ""}</span>
                        {writers.length > 1 && <button className="flex items-center gap-1 text-[12px] text-bad hover:underline" onClick={() => setWriters((p) => p.filter((_, j) => j !== i))}><Trash2 size={13} /> Remove</button>}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <div><Label>Legal name *</Label><input className={inputCls} value={w.legalName} onChange={(e) => patch(i, { legalName: e.target.value })} /></div>
                        <div><Label>Email * (to sign)</Label><input className={inputCls} type="email" value={w.email} onChange={(e) => patch(i, { email: e.target.value })} /></div>
                        <div><Label>Role</Label><select className={inputCls} value={w.role} onChange={(e) => patch(i, { role: e.target.value })}>{["Producer", "Co-producer", "Songwriter", "Composer", "Topliner", "Lyricist", "Vocalist", "Mix engineer", "Other"].map((r) => <option key={r}>{r}</option>)}</select></div>
                        <div><Label>Ownership %</Label><input className={inputCls} type="number" min="0" max="100" value={w.pct} onChange={(e) => patch(i, { pct: e.target.value })} /></div>
                        <div><Label>PRO</Label><select className={inputCls} value={w.pro} onChange={(e) => patch(i, { pro: e.target.value })}>{PRO_OPTS.map((p) => <option key={p} value={p}>{p || "None / N/A"}</option>)}</select></div>
                        <div><Label>CAE / IPI #</Label><input className={inputCls} value={w.ipi} onChange={(e) => patch(i, { ipi: e.target.value })} /></div>
                        <div><Label>Publisher</Label><input className={inputCls} value={w.publisher} onChange={(e) => patch(i, { publisher: e.target.value })} /></div>
                        <div><Label>Phone</Label><input className={inputCls} type="tel" value={w.phone} onChange={(e) => patch(i, { phone: e.target.value })} /></div>
                        <div><Label>Address</Label><input className={inputCls} value={w.address} onChange={(e) => patch(i, { address: e.target.value })} /></div>
                      </div>
                    </div>
                  ))}
                </div>
                <button className="mt-3 flex items-center gap-1.5 text-sm text-gold hover:underline" onClick={() => setWriters((p) => [...p, newWriter({ role: "Writer" })])}><Plus size={14} /> Add contributor</button>

                <div className="mt-5 flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                  <GoldBtn className="w-full sm:w-auto" disabled={busy || !pctOk} onClick={generate}>{busy ? "Sending…" : <><Send size={15} /> Send for signature</>}</GoldBtn>
                  {!pctOk && <span className="text-center text-[13px] text-bad sm:text-left">Splits must total exactly 100%.</span>}
                </div>
                <p className="mt-3 text-[12px] text-bone-dim">Covers publishing (composition) only — master ownership is a separate agreement. Each contributor receives a DocuSign email and signs electronically.</p>
              </>
            )}
          </>
        )}
      </Card>

      <Card className="p-4 lg:p-5">
        <h3 className="mb-4 font-display text-lg">Your split sheets</h3>
        {sheets === undefined ? <div className="flex flex-col gap-2">{[0, 1].map((i) => <Skeleton key={i} className="h-16" />)}</div>
          : sheets.length === 0 ? <p className="py-6 text-center text-sm text-bone-dim">None yet. Generate one above and it'll track here as collaborators sign.</p>
            : <div className="flex flex-col gap-2.5">{[...sheets].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)).map((s) => {
              const st = sheetStatus(s.status); const I = st.I;
              return (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-ink p-4">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{s.song?.title || s.beatTitle}</div>
                    <div className="text-[12px] text-bone-dim">{(s.writers || []).length} contributor{(s.writers || []).length !== 1 ? "s" : ""} · sent {s.createdAt?.toMillis ? new Date(s.createdAt.toMillis()).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${st.c}`}><I size={12} /> {st.t}</span>
                    <button onClick={(e) => refresh(s.id, e.currentTarget)} className="grid h-8 w-8 place-items-center rounded-lg border border-line text-bone-dim transition hover:border-strong hover:text-bone disabled:opacity-50" title="Refresh status"><RefreshCw size={14} /></button>
                  </div>
                </div>
              );
            })}</div>}
      </Card>
    </section>
  );
}

/* ============================ loop drops ============================ */
function LoopDrops({ user, pitchBalance, loopBalance, targetRequest, clearTargetRequest, showToast }) {
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
    if (!isMp3File(file)) { setMsg({ text: "Only .mp3 files can be uploaded.", kind: "err" }); return; }
    setBusy(true); setMsg(null);
    try {
      const safeName = title.replace(/[/\\:*?"<>|]/g, "") + ".mp3";
      const folder = Date.now().toString(36) + Math.random().toString(36).slice(2);
      const storagePath = `loops/${user.uid}/${folder}/${safeName}`;
      await uploadFile(new File([file], safeName, { type: "audio/mpeg" }), storagePath, setProgress);
      await call("submitLoop", { title: title.trim(), bpm: bpm || null, key, genre, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), storagePath, targetRequestId: targetRequest?.id || "" });
      if (targetRequest) {
        sessionStorage.removeItem("pluggurbeats:targetRequest");
        clearTargetRequest?.();
      }
      setMsg({ text: targetRequest ? "Loop submitted to request!" : "Loop submitted!", kind: "ok" });
      setTitle(""); setBpm(""); setTags(""); setFile(null); setProgress(0);
      setTimeout(() => setMsg(null), 3000);
    } catch (e) { setMsg({ text: e.message || "Submission failed.", kind: "err" }); }
    finally { setBusy(false); }
  }

  return (
    <section>
      <SectionHead eyebrow="Loop Drops" title="Loop marketplace" sub={targetRequest ? `Submitting directly to ${targetRequest.createdByName}'s request.` : "Submit loops to the pool, or pull them into your beats if you're verified."} />
      {targetRequest && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 border-gold/40 bg-gold/[0.06] p-4">
          <div className="min-w-0">
            <Eyebrow>Request target</Eyebrow>
            <div className="mt-1 truncate font-display text-xl text-bone">{targetRequest.title}</div>
            <div className="mt-0.5 text-[13px] text-bone-dim">{targetRequest.createdByName} · {targetRequest.createdByRoleLabel || "Verified"}{targetRequest.labelName ? ` · ${targetRequest.labelName}` : ""}</div>
          </div>
          <GhostBtn className="px-4 py-2 text-[12px]" onClick={() => { sessionStorage.removeItem("pluggurbeats:targetRequest"); clearTargetRequest?.(); }}>Clear target</GhostBtn>
        </Card>
      )}
      <Card className="mb-4 flex flex-wrap items-center justify-between gap-4 p-4 lg:p-5">
        <div className="flex flex-wrap gap-5">
          <div><Eyebrow>Beat credits</Eyebrow><div className="mt-1 font-display text-4xl leading-none">{pitchBalance}<span className="ml-1 font-sans text-sm font-normal text-bone-dim">available</span></div></div>
          <div><Eyebrow>Loop credits</Eyebrow><div className="mt-1 font-display text-4xl leading-none">{loopBalance}<span className="ml-1 font-sans text-sm font-normal text-bone-dim">available</span></div></div>
        </div>
        <div className="text-right text-[12px] text-bone-dim">1 credit per loop submitted<br />replenish monthly with your plan</div>
      </Card>

      <Card className="mb-4 p-4 lg:p-5">
        <h3 className="mb-4 font-display text-lg">Upload a loop</h3>
        <div className="grid gap-3 sm:grid-cols-2"><div><Label>Title *</Label><input className={inputCls} placeholder="e.g. Dark trap 808" value={title} onChange={(e) => setTitle(e.target.value)} /></div><div><Label>Genre</Label><select className={inputCls} value={genre} onChange={(e) => setGenre(e.target.value)}>{GENRES.map((g) => <option key={g}>{g}</option>)}</select></div></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3"><div><Label>BPM</Label><input className={inputCls} type="number" placeholder="140" value={bpm} onChange={(e) => setBpm(e.target.value)} /></div><div><Label>Key</Label><select className={inputCls} value={key} onChange={(e) => setKey(e.target.value)}>{KEY_OPTS.map((k) => <option key={k}>{k}</option>)}</select></div><div><Label>Tags (comma-sep)</Label><input className={inputCls} placeholder="dark, 808, minimal" value={tags} onChange={(e) => setTags(e.target.value)} /></div></div>
        <div className="mt-3">
          <Label>Audio file *</Label>
          <label className={`flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-dashed px-4 py-2.5 text-sm transition ${file ? "border-ok/40 bg-ok/[0.06] text-ok" : "border-strong text-bone-dim hover:border-gold/50 hover:text-bone"}`}>
            {file ? <Check size={15} /> : <Upload size={15} />}{file ? (file.name.length > 28 ? file.name.slice(0, 26) + "…" : file.name) : "Attach MP3"}
            <input type="file" accept=".mp3,audio/mpeg" className="hidden" onChange={(e) => {
              const f = e.target.files[0] || null;
              if (f && !isMp3File(f)) { setMsg({ text: "Only .mp3 files can be uploaded.", kind: "err" }); e.target.value = ""; return; }
              setFile(f);
            }} />
          </label>
          {progress > 0 && progress < 100 && <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-gold" style={{ width: progress + "%" }} /></div>}
        </div>
        {msg && <div className={`mt-3 rounded-lg px-3 py-2 text-[13px] ${msg.kind === "ok" ? "bg-ok/12 text-ok" : "bg-bad/12 text-bad"}`}>{msg.text}</div>}
        <GoldBtn className="mt-4 w-full sm:w-auto" disabled={busy} onClick={submit}>{busy ? "Submitting…" : "Submit loop — 1 credit"}</GoldBtn>
      </Card>

      <Card className="p-4 lg:p-5">
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
    <Card className={`flex flex-col p-4 lg:p-5 ${highlight ? "border-gold/50" : ""} ${btn.ring ? "ring-1 ring-gold" : ""}`}>
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

      <Card className="mb-4 flex flex-wrap items-center justify-between gap-4 p-4 lg:mb-6 lg:gap-5 lg:p-5">
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
        <PlanCard name="Plugg" price="29" plan="plugg" btn={pb} blurb="Land in the Verified library." feats={["15 pitch + 20 loop credits monthly", "1 pitch credit per beat", "Up to 15 beats per campaign", "Approved campaigns added to Verified library"]} />
        <PlanCard name="Pro" price="99" plan="pro" btn={pr} highlight blurb="Blast directly to inboxes." feats={["50 pitch + 60 loop credits monthly", "1 pitch credit per beat", "Up to 25 beats, 5 Pro desk lanes", "A&R / management lanes unlocked", "Approved campaigns can email directly to inboxes"]} />
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
  useEffect(() => {
    const scrollY = window.scrollY || 0;
    const bodyStyle = document.body.style;
    const htmlStyle = document.documentElement.style;
    const prev = {
      bodyOverflow: bodyStyle.overflow,
      bodyTouchAction: bodyStyle.touchAction,
      htmlOverflow: htmlStyle.overflow
    };
    bodyStyle.overflow = "hidden";
    bodyStyle.touchAction = "none";
    htmlStyle.overflow = "hidden";
    return () => {
      bodyStyle.overflow = prev.bodyOverflow;
      bodyStyle.touchAction = prev.bodyTouchAction;
      htmlStyle.overflow = prev.htmlOverflow;
      window.scrollTo(0, scrollY);
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[999] grid place-items-center overflow-y-auto overscroll-contain bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="max-h-[calc(100dvh-32px)] w-full max-w-md animate-fade-up overflow-y-auto rounded-2xl border border-strong bg-ink-2 p-6 shadow-card">{children}</div>
    </div>,
    document.body
  );
}

function ProfileModal({ user, profile, onClose }) {
  const [name, setName] = useState(profile.displayName || user?.displayName || "");
  const [instagram, setInstagram] = useState(profile.instagram || "");
  const [location, setLocation] = useState(profile.location || "");
  const [bio, setBio] = useState(profile.bio || "");
  const [avatar, setAvatar] = useState(null);
  const [preview, setPreview] = useState(profile.avatarUrl || "");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef(null);

  function chooseAvatar(file) {
    if (!file) return;
    if (!isAvatarImage(file)) {
      setMsg({ text: "Upload a JPG, PNG, or WebP image under 5 MB.", kind: "err" });
      return;
    }
    setMsg(null);
    setAvatar(file);
    setPreview(URL.createObjectURL(file));
  }

  async function save() {
    setBusy(true); setMsg(null);
    try {
      let avatarPath = profile.avatarPath || null;
      let photoURL = profile.photoURL || profile.avatarUrl || user?.photoURL || "";
      if (avatar) {
        const uploaded = await uploadProfileAvatar(user.uid, avatar);
        avatarPath = uploaded.avatarPath;
        photoURL = uploaded.photoURL;
      }
      const displayName = name.trim();
      const data = {
        displayName,
        instagram: instagram.trim(),
        location: location.trim(),
        bio: bio.trim(),
        ...(avatarPath ? { avatarPath } : {}),
        ...(photoURL ? { photoURL } : {})
      };
      await setDoc(doc(db, "users", user.uid), data, { merge: true });
      await updateProfile(user, { displayName, ...(photoURL ? { photoURL } : {}) });
      setMsg({ text: "Saved.", kind: "ok" });
      setTimeout(onClose, 700);
    } catch (e) { setMsg({ text: e.message || "Could not save.", kind: "err" }); }
    finally { setBusy(false); }
  }

  const initial = avatarInitial(name || user?.email);
  return (
    <Overlay onClose={onClose}>
      <div className="mb-5 flex items-center justify-between"><h3 className="font-display text-2xl">Profile &amp; settings</h3><button onClick={onClose} className="text-bone-dim hover:text-bone"><X size={20} /></button></div>
      <div className="mb-5 flex items-center gap-4">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-gold to-violet font-display text-2xl text-[#1a1405]" style={preview ? { backgroundImage: `url("${preview}")`, backgroundSize: "cover" } : undefined}>{preview ? "" : initial}</span>
        <GhostBtn type="button" className="px-4 py-2 text-[13px]" onClick={() => fileInputRef.current?.click()}>
          <Upload size={14} /> Upload photo
        </GhostBtn>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => chooseAvatar(e.target.files?.[0])}
        />
      </div>
      <div className="flex flex-col gap-3">
        <div><Label>Display name</Label><input className={inputCls} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label>Instagram</Label><input className={inputCls} placeholder="@yourhandle" value={instagram} onChange={(e) => setInstagram(e.target.value)} /></div>
        <div><Label>Location</Label><input className={inputCls} placeholder="City, Country" value={location} onChange={(e) => setLocation(e.target.value)} /></div>
        <div><Label>Bio</Label><textarea className={`${inputCls} resize-y`} rows="3" placeholder="Tell us about your sound…" value={bio} onChange={(e) => setBio(e.target.value)} /></div>
      </div>
      {msg && <div className={`mt-3 rounded-lg px-3 py-2 text-[13px] ${msg.kind === "ok" ? "bg-ok/12 text-ok" : "bg-bad/12 text-bad"}`}>{msg.text}</div>}
      <GoldBtn className="mt-5 w-full" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save profile"}</GoldBtn>
    </Overlay>
  );
}
