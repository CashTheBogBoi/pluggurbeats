import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, limit as qLimit, orderBy, query, where } from "firebase/firestore";
import {
  LayoutGrid, Users, Disc3, Search, RefreshCw, X, Check, Gauge, Megaphone,
  Send, DollarSign, TrendingUp, Trash2, Eye, Pin, PinOff,
  MapPin, ShieldCheck, Ban, Plus, Minus, ChevronRight, ChevronDown, Clock,
  CreditCard, XCircle
} from "lucide-react";
import { auth } from "../firebase/auth.js";
import { db } from "../firebase/db.js";
import { call, useLiveCollection } from "../lib/live.js";
import { isArRole, VERIFIED_ROLES, verifiedRoleLabel } from "../lib/roles.js";
import { usePushAutoRegister } from "../lib/usePush.js";

// Cross-user staff data isn't client-readable under the proven backend's rules
// (that needed the torn-down custom-claim infra), so it comes through Cloud
// Function callables. React Query keeps it fresh with refetchInterval (auto-
// refresh, no manual reload) and invalidates after each moderation action.
const STATUS_BY_TAB = {
  pending: ["pending_review"],
  approved: ["approved", "pitched", "no_contacts", "send_failed"],
  rejected: ["rejected"]
};
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

/* ============================ Obsidian style atoms ============================ */
const EYEBROW = "font-mono text-[11px] uppercase tracking-[0.18em] text-[#f2ca50]";
const LABEL = "font-mono text-[10px] uppercase tracking-[0.14em] text-[#99907c]";
const CARD = "bg-[#0e0e0e] border border-[#262626]";
const DISPLAY = "font-display tracking-tight text-[#e5e2e1]";

const BADGE = {
  pending_review: "border border-[#f2ca50]/40 text-[#f2ca50]",
  approved: "bg-[#2a2a2a] text-[#7CE2A4]",
  pitched: "bg-[#2a2a2a] text-[#6EC1FF]",
  rejected: "bg-[#93000a]/40 text-[#ffdad6]",
  send_failed: "bg-[#93000a]/40 text-[#ffdad6]",
  no_contacts: "border border-[#4d4635] text-[#99907c]"
};

function Btn({ variant = "ghost", className = "", ...p }) {
  const variants = {
    gold: "border border-[#f2ca50] text-[#f2ca50] hover:bg-[#f2ca50] hover:text-[#3c2f00]",
    ghost: "border border-[#4d4635] text-[#d0c5af] hover:bg-[#2a2a2a] hover:border-[#99907c]",
    danger: "border border-[#ffb4ab] text-[#ffb4ab] hover:bg-[#ffb4ab]/10",
    approve: "border border-[#7CE2A4] text-[#7CE2A4] hover:bg-[#7CE2A4]/10"
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 px-5 py-2.5 font-mono text-[12px] uppercase tracking-wider transition-colors active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none ${variants[variant]} ${className}`}
      {...p}
    />
  );
}

function StatusBadge({ status }) {
  const label = (status || "").replace(/_/g, " ");
  return <span className={`px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] whitespace-nowrap ${BADGE[status] || BADGE.no_contacts}`}>{label}</span>;
}

// Safari renders native <select> chrome that ignores our dark theme; strip the
// platform appearance and draw our own chevron so it matches across browsers.
function Select({ wrapClass = "", className = "", children, ...p }) {
  return (
    <div className={`relative inline-flex ${wrapClass}`}>
      <select {...p} className={`appearance-none [-webkit-appearance:none] w-full bg-[#0e0e0e] border border-[#4d4635] focus:border-[#f2ca50] focus:outline-none text-[#d0c5af] text-sm pl-3 pr-9 py-2.5 ${className}`}>
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#99907c]" />
    </div>
  );
}

// Review window: 48h from submission, or 24h for rush campaigns (mirrors the
// backend's reviewPriorityMeta thresholds). Ticks live like the Stitch timer.
const reviewDeadline = (c) => (c.createdAt ? c.createdAt + (c.rush ? 24 : 48) * 3600e3 : null);

function Countdown({ deadline }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!deadline) return null;
  const diff = deadline - now;
  const overdue = diff <= 0;
  const total = Math.abs(Math.floor(diff / 1000));
  const hh = String(Math.floor(total / 3600)).padStart(2, "0");
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums ${overdue ? "text-[#ffb4ab]" : "text-[#f2ca50]"}`}>
      <Clock size={11} />{overdue ? "OVERDUE +" : ""}{hh}:{mm}:{ss}
    </span>
  );
}

export default function Staff() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [who, setWho] = useState("");
  const [ready, setReady] = useState(false);
  const [view, setView] = useState("overview");
  const [staffNavOpen, setStaffNavOpen] = useState(false);
  const [tab, setTab] = useState("pending");
  const [search, setSearch] = useState("");
  const [pkg, setPkg] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [openIdx, setOpenIdx] = useState(null);
  const [reject, setReject] = useState(null); // { path, reason, note, busy }
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [uid, setUid] = useState(null);
  const toastTimer = useRef(null);

  usePushAutoRegister(uid, { onTap: (data) => { if (data?.route) navigate(data.route); } });

  const showToast = (t) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2800);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user || !user.emailVerified) { navigate("/"); return; }
      setWho(user.email);
      setUid(user.uid);
      setReady(true);
    });
    return () => unsub();
  }, [navigate]);

  // ---- live-ish staff data (auto-refreshing callables) ----
  const campaignsQ = useQuery({
    queryKey: ["staff", "campaigns"],
    queryFn: () => call("listReviewCampaigns").then((d) => d.campaigns || []),
    enabled: ready,
    refetchInterval: 15000
  });
  const usersQ = useQuery({
    queryKey: ["staff", "users"],
    queryFn: () => call("listUsers").then((d) => d.users || []),
    enabled: ready && view === "users",
    refetchInterval: 20000
  });
  const claimsQ = useQuery({
    queryKey: ["staff", "claims"],
    queryFn: () => call("listLoopClaims").then((d) => d.claims || []),
    enabled: ready && view === "loops",
    refetchInterval: 20000
  });
  const reviewLoopsQ = useQuery({
    queryKey: ["staff", "reviewLoops"],
    queryFn: () => call("listReviewLoops").then((d) => d.loops || []),
    enabled: ready && view === "loopReview",
    refetchInterval: 20000
  });
  const overviewQ = useQuery({
    queryKey: ["staff", "overview"],
    queryFn: () => call("getStaffOverview"),
    enabled: ready && view === "overview",
    refetchInterval: 30000
  });

  // Non-staff users hit permission-denied → send them to their dashboard.
  useEffect(() => {
    const m = campaignsQ.error?.message || "";
    if (campaignsQ.error && /permission|denied|not authorized/i.test(m)) navigate("/dashboard");
  }, [campaignsQ.error, navigate]);

  const campaigns = campaignsQ.data || [];
  const users = usersQ.data || [];
  const claims = claimsQ.data || [];
  const reviewLoops = reviewLoopsQ.data || [];
  const gate = (!ready || campaignsQ.isLoading) ? "loading" : (campaignsQ.isError ? "error" : "ok");
  const loadErr = campaignsQ.error?.message || "";

  const switchView = (v) => {
    setView(v);
    setStaffNavOpen(false);
    window.scrollTo(0, 0);
  };
  const refreshCampaigns = () => qc.invalidateQueries({ queryKey: ["staff", "campaigns"] });
  const refreshUsers = () => qc.invalidateQueries({ queryKey: ["staff", "users"] });
  const refreshReviewLoops = () => qc.invalidateQueries({ queryKey: ["staff", "reviewLoops"] });

  // ---- loop moderation (mirror of campaign moderation) ----
  async function decideLoop(loopId) {
    try {
      await call("moderateLoop", { loopId, decision: "live" });
      refreshReviewLoops();
      showToast("Loop approved — live in the pool.");
    } catch (e) { showToast("Failed: " + (e.message || e)); }
  }

  // ---- campaign moderation ----
  async function decide(path) {
    try {
      await call("moderateCampaign", { path, decision: "approved" });
      refreshCampaigns();
      showToast("Approved — pitching now.");
    } catch (e) { showToast("Failed: " + (e.message || e)); }
  }
  async function repitch(path) {
    try {
      await call("moderateCampaign", { path, decision: "approved" });
      refreshCampaigns();
      showToast("Re-pitch triggered — pitching now.");
    } catch (e) { showToast("Failed: " + (e.message || e)); }
  }
  async function removeFromLibrary(path) {
    try {
      const res = await call("removeFromLibrary", { path });
      refreshCampaigns();
      showToast(`Removed ${res.removed} beat${res.removed !== 1 ? "s" : ""} from the library.`);
    } catch (e) { showToast("Failed: " + (e.message || e)); }
  }
  async function runVerifiedBackfill() {
    if (backfillBusy) return;
    setBackfillBusy(true);
    let cursor = null;
    let campaignsProcessed = 0;
    let beatsIndexed = 0;
    try {
      for (let page = 0; page < 200; page++) {
        const res = await call("backfillVerifiedBeats", { pageSize: 50, cursor });
        campaignsProcessed += res.campaignsProcessed || 0;
        beatsIndexed += res.beatsIndexed || 0;
        cursor = res.nextCursor || null;
        showToast(`Indexed ${beatsIndexed} verified beat${beatsIndexed === 1 ? "" : "s"}...`);
        if (!res.hasMore) break;
      }
      showToast(`Verified beat index updated: ${beatsIndexed} beat${beatsIndexed === 1 ? "" : "s"} from ${campaignsProcessed} campaign${campaignsProcessed === 1 ? "" : "s"}.`);
    } catch (e) {
      showToast("Backfill failed: " + (e.message || e));
    } finally {
      setBackfillBusy(false);
    }
  }
  async function confirmReject() {
    setReject((r) => ({ ...r, busy: true }));
    try {
      if (reject.kind === "loop") {
        await call("moderateLoop", { loopId: reject.loopId, decision: "rejected", reason: reject.reason, note: (reject.note || "").trim() });
        refreshReviewLoops();
        setReject(null);
        showToast("Loop rejected — maker notified by email.");
      } else {
        await call("moderateCampaign", { path: reject.path, decision: "rejected", reason: reject.reason, note: (reject.note || "").trim() });
        refreshCampaigns();
        setReject(null);
        showToast("Campaign rejected — producer notified by email.");
      }
    } catch (e) {
      showToast("Failed: " + (e.message || e));
      setReject((r) => ({ ...r, busy: false }));
    }
  }

  // ---- user actions (callable → invalidate the users query) ----
  async function toggleVP(idx) {
    const u = users[idx]; const next = !u.verifiedPuller;
    try {
      await call("setVerifiedPuller", { uid: u.uid, value: next });
      refreshUsers();
      showToast(`${u.displayName || u.email}: loop pull access ${next ? "granted" : "revoked"}.`);
    } catch (e) { showToast("Failed: " + (e.message || e)); }
  }
  async function toggleVL(idx) {
    const u = users[idx]; const next = !u.verifiedListener;
    try {
      await call("setVerifiedListener", { uid: u.uid, value: next });
      refreshUsers();
      showToast(`${u.displayName || u.email}: verified library access ${next ? "granted" : "revoked"}.`);
    } catch (e) { showToast("Failed: " + (e.message || e)); }
  }
  async function toggleStaff(idx) {
    const u = users[idx]; const next = !u.staff;
    if (u.staffLocked && !next) { showToast("Owner staff accounts are managed in the server allowlist."); return; }
    const label = u.displayName || u.email;
    if (next && !confirm(`Grant staff access to ${label}? They will be able to review campaigns and manage users after their token refreshes.`)) return;
    if (!next && !confirm(`Remove staff access from ${label}?`)) return;
    try {
      await call("setStaffRole", { uid: u.uid, value: next });
      refreshUsers();
      showToast(`${label}: staff access ${next ? "granted" : "revoked"}. ${next ? "They may need to sign out and back in." : ""}`);
    } catch (e) { showToast("Failed: " + (e.message || e)); }
  }
  async function saveVerifiedRole(idx, verifiedRole, labelName) {
    const u = users[idx];
    try {
      const res = await call("setVerifiedRole", { uid: u.uid, verifiedRole, labelName });
      refreshUsers();
      showToast(`${u.displayName || u.email}: role set to ${verifiedRoleLabel(res.verifiedRole)}.`);
    } catch (e) { showToast("Failed: " + (e.message || e)); }
  }
  async function adjustCredits(idx, kind, sign, amount) {
    const u = users[idx];
    const amt = parseInt(amount || "0", 10);
    if (!amt || amt < 1) { showToast("Enter a valid amount."); return; }
    try {
      const res = await call("adjustCredits", { uid: u.uid, kind, delta: sign * amt });
      refreshUsers();
      showToast(`${kind} credits ${sign > 0 ? "+" + amt : -amt} for ${u.displayName || u.email}. New balance: ${res.newBalance}`);
    } catch (e) { showToast("Failed: " + (e.message || e)); }
  }
  async function toggleBan(idx) {
    const u = users[idx]; const next = !u.banned;
    if (next && !confirm(`Ban ${u.displayName || u.email}? This disables their account immediately.`)) return;
    try {
      await call("banUser", { uid: u.uid, banned: next });
      refreshUsers();
      showToast(`${u.displayName || u.email} ${next ? "banned" : "unbanned"}.`);
    } catch (e) { showToast("Failed: " + (e.message || e)); }
  }
  async function cancelSubscription(idx) {
    const u = users[idx];
    if (!confirm(`Cancel ${u.displayName || u.email}'s ${u.tier} subscription immediately? This does not issue a refund — handle that in Stripe separately if needed.`)) return;
    try {
      const res = await call("cancelUserSubscription", { uid: u.uid });
      refreshUsers();
      showToast(res.canceled ? `Subscription canceled for ${u.displayName || u.email}.` : `${u.displayName || u.email} has no active paid subscription.`);
    } catch (e) { showToast("Failed: " + (e.message || e)); }
  }

  // ---- derived ----
  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, rejected: 0 };
    campaigns.forEach((cp) => {
      if (STATUS_BY_TAB.pending.includes(cp.status)) c.pending++;
      else if (STATUS_BY_TAB.rejected.includes(cp.status)) c.rejected++;
      else c.approved++;
    });
    return c;
  }, [campaigns]);

  const stats = useMemo(() => {
    const weekAgo = Date.now() - 7 * 864e5;
    return {
      pending: campaigns.filter((c) => c.status === "pending_review").length,
      sensitive: campaigns.filter((c) => c.status === "pending_review" && c.timeSensitive).length,
      week: campaigns.filter((c) => STATUS_BY_TAB.approved.includes(c.status) && c.moderatedAt && c.moderatedAt >= weekAgo).length,
      pitched: campaigns.filter((c) => c.status === "pitched").length
    };
  }, [campaigns]);

  const filteredCampaigns = useMemo(() => {
    const q = search.toLowerCase();
    const wanted = STATUS_BY_TAB[tab];
    return campaigns.filter((c) => {
      if (!wanted.includes(c.status)) return false;
      if (pkg && c.package !== pkg) return false;
      if (q) {
        const name = (c.producer.name || "").toLowerCase();
        const ig = (c.producer.instagram || "").toLowerCase();
        if (!name.includes(q) && !ig.includes(q)) return false;
      }
      return true;
    });
  }, [campaigns, tab, search, pkg]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.toLowerCase();
    return users.map((u, i) => ({ u, i })).filter(({ u }) =>
      !q || (u.displayName || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q)
      || (u.location || "").toLowerCase().includes(q) || (u.uid || "").toLowerCase().includes(q));
  }, [users, userSearch]);

  if (gate === "loading") {
    return (
      <div className="min-h-screen bg-[#131313] text-[#99907c] grid place-items-center font-mono text-sm uppercase tracking-[0.16em]">
        Checking access…
      </div>
    );
  }

  const META = {
    overview: { watermark: "O/V", eyebrow: "Staff / Overview", title: "Studio overview", desc: "Live revenue, growth, and the verified request board — post announcements and moderate the feed." },
    campaigns: { watermark: "C/Q", eyebrow: "Staff / Campaigns", title: "Campaign queue", desc: "Review submissions, inspect beats, and push approved campaigns into the pitch flow." },
    users: { watermark: "U/M", eyebrow: "Staff / Users", title: "User control", desc: "Find accounts, manage credits, grant access, and handle user status." },
    loopReview: { watermark: "L/R", eyebrow: "Staff / Loop Review", title: "Loop review", desc: "Approve or reject submitted loops before they enter the verified pool." },
    loops: { watermark: "L/C", eyebrow: "Staff / Loops", title: "Loop claims", desc: "Track loop pull activity and placements across the verified pool." }
  };
  const meta = META[view];

  const NAV = [
    { id: "overview", icon: Gauge, label: "Overview", count: 0 },
    { id: "campaigns", icon: LayoutGrid, label: "Campaigns", count: campaigns.length },
    { id: "users", icon: Users, label: "Users", count: users.length },
    { id: "loopReview", icon: ShieldCheck, label: "Loop Review", count: reviewLoops.length },
    { id: "loops", icon: Disc3, label: "Loop Claims", count: claims.length }
  ];

  return (
    <div className="min-h-screen bg-[#131313] text-[#e5e2e1] font-sans flex flex-col">
      {/* Top app bar */}
      <header className="sticky top-0 z-50 h-16 bg-[#131313]/95 backdrop-blur border-b border-[#353534] flex items-center justify-between px-4 md:px-8">
        <div className="flex items-center gap-3">
          <button className="md:hidden text-[#99907c]" onClick={() => setStaffNavOpen(true)} aria-label="Open navigation">
            <LayoutGrid size={20} />
          </button>
          <span className="material-eq flex items-end gap-[2px] h-4">
            <i className="w-[3px] h-2 bg-[#f2ca50] animate-pulse" />
            <i className="w-[3px] h-4 bg-[#f2ca50]" />
            <i className="w-[3px] h-3 bg-[#f2ca50] animate-pulse" />
          </span>
          <h1 className={`${DISPLAY} text-xl text-[#f2ca50]`}>Pluggur Staff</h1>
        </div>
        <nav className="hidden md:flex items-center gap-2">
          {NAV.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => switchView(id)}
              className={`font-mono text-[12px] uppercase tracking-wider px-3 py-2 transition-colors ${view === id ? "text-[#f2ca50]" : "text-[#99907c] hover:bg-[#2a2a2a] hover:text-[#e5e2e1]"}`}
            >
              {label}
            </button>
          ))}
          <div className="w-px h-5 bg-[#353534] mx-2" />
          <button onClick={() => navigate("/verified")} className="font-mono text-[12px] uppercase tracking-wider px-3 py-2 text-[#99907c] hover:text-[#e5e2e1]">Verified</button>
          <button onClick={() => navigate("/dashboard")} className="font-mono text-[12px] uppercase tracking-wider px-3 py-2 text-[#99907c] hover:text-[#e5e2e1]">Dashboard</button>
          <button onClick={() => signOut(auth).then(() => navigate("/"))} className="font-mono text-[12px] uppercase tracking-wider px-3 py-2 text-[#99907c] hover:text-[#ffb4ab]">Sign out</button>
        </nav>
      </header>

      {/* Mobile drawer */}
      {staffNavOpen && (
        <div className="md:hidden fixed inset-0 z-[60] flex" onClick={() => setStaffNavOpen(false)}>
          <div className="absolute inset-0 bg-black/70" />
          <aside className="relative w-[80vw] max-w-[300px] h-full bg-[#0e0e0e] border-r border-[#353534] p-6 flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className={`${DISPLAY} text-lg text-[#f2ca50]`}>Pluggur Staff</h2>
              <button onClick={() => setStaffNavOpen(false)} className="text-[#99907c]"><X size={20} /></button>
            </div>
            {NAV.map(({ id, icon: Icon, label, count }) => (
              <button key={id} onClick={() => switchView(id)}
                className={`flex items-center justify-between px-3 py-3 font-mono text-[13px] uppercase tracking-wider transition-colors ${view === id ? "bg-[#f2ca50] text-[#3c2f00]" : "text-[#d0c5af] hover:bg-[#2a2a2a]"}`}>
                <span className="flex items-center gap-3"><Icon size={16} /> {label}</span>
                <span className="opacity-70">{count || ""}</span>
              </button>
            ))}
            <div className="mt-auto pt-6 border-t border-[#353534] flex flex-col gap-2">
              <button onClick={() => navigate("/verified")} className="text-left font-mono text-[12px] uppercase tracking-wider text-[#99907c] py-2">Verified</button>
              <button onClick={() => navigate("/dashboard")} className="text-left font-mono text-[12px] uppercase tracking-wider text-[#99907c] py-2">Dashboard</button>
              <div className="text-[11px] text-[#99907c] truncate">{who}</div>
              <button onClick={() => signOut(auth).then(() => navigate("/"))} className="text-left font-mono text-[12px] uppercase tracking-wider text-[#ffb4ab] py-2">Sign out</button>
            </div>
          </aside>
        </div>
      )}

      {/* Corner watermark */}
      <div className="fixed top-16 right-0 p-6 opacity-[0.04] pointer-events-none select-none z-0">
        <span className="font-mono text-[120px] font-bold leading-none">{meta.watermark}</span>
      </div>

      <main className="flex-grow w-full max-w-[1280px] mx-auto px-4 md:px-8 py-10 md:py-14 pb-28 md:pb-14 relative z-10">
        {/* Head */}
        <div className="mb-10">
          <span className={EYEBROW}>{meta.eyebrow}</span>
          <h2 className={`${DISPLAY} text-[32px] md:text-[44px] mt-2`}>{meta.title}</h2>
          <p className="text-[#99907c] mt-3 max-w-2xl leading-relaxed">{meta.desc}</p>
        </div>

        {/* OVERVIEW */}
        {view === "overview" && (
          <OverviewBoard data={overviewQ.data} loading={overviewQ.isLoading} queueStats={stats} showToast={showToast} />
        )}

        {/* CAMPAIGNS */}
        {view === "campaigns" && (
          <section className="flex flex-col gap-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Stat label="Time sensitive" value={gate === "error" ? "—" : stats.sensitive} urgent />
              <Stat label="Pending review" value={gate === "error" ? "—" : stats.pending} />
              <Stat label="Approved this week" value={gate === "error" ? "—" : stats.week} />
              <Stat label="Successfully pitched" value={gate === "error" ? "—" : stats.pitched} />
            </div>

            <div className={`${CARD} bg-[#0e0e0e]`}>
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-4 border-b border-[#262626]">
                <div className="inline-flex border border-[#353534]">
                  {["pending", "approved", "rejected"].map((t) => (
                    <button key={t} onClick={() => setTab(t)}
                      className={`px-4 py-2 font-mono text-[12px] uppercase tracking-wider transition-colors ${tab === t ? "bg-[#f2ca50] text-[#3c2f00]" : "text-[#99907c] hover:bg-[#2a2a2a]"}`}>
                      {t} <span className="opacity-70 ml-1">{counts[t]}</span>
                    </button>
                  ))}
                </div>
                <div className="flex flex-col sm:flex-row gap-3 lg:justify-end flex-1">
                  <div className="relative flex-1 max-w-md">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#99907c]" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search producer or Instagram"
                      className="w-full bg-[#0e0e0e] border border-[#4d4635] focus:border-[#f2ca50] focus:outline-none text-[#e5e2e1] text-sm py-2.5 pl-10 pr-3 placeholder:text-[#99907c]/60" />
                  </div>
                  <Select value={pkg} onChange={(e) => setPkg(e.target.value)}>
                    <option value="">All packages</option>
                    <option value="starter">Starter</option>
                    <option value="pro">Pro</option>
                    <option value="label">Label</option>
                  </Select>
                  <Btn variant="ghost" disabled={backfillBusy} onClick={runVerifiedBackfill}>
                    {backfillBusy ? "Indexing…" : "Backfill index"}
                  </Btn>
                </div>
              </div>

              <div className="divide-y divide-[#262626]">
                {gate === "error"
                  ? <div className="p-16 text-center text-[#99907c] text-sm">Could not load campaigns: {loadErr}</div>
                  : filteredCampaigns.length === 0
                    ? <div className="p-16 text-center text-[#99907c] text-sm">No {tab} campaigns{search ? " matching your search" : ""}.</div>
                    : filteredCampaigns.map((c, i) => (
                      <CampaignCard key={c.path} c={c} index={i + 1}
                        onApprove={decide}
                        onReject={(path) => setReject({ path, reason: "Low quality mix", note: "" })}
                        onRetry={repitch}
                        onRemoveLibrary={removeFromLibrary} />
                    ))}
              </div>
            </div>
          </section>
        )}

        {/* LOOP REVIEW */}
        {view === "loopReview" && (
          <section className={`${CARD}`}>
            <div className="hidden md:grid grid-cols-[40px_minmax(0,1.6fr)_120px_110px_24px] gap-3 px-5 py-3 border-b border-[#262626]">
              {["#", "Loop / Maker", "Model", "Spec", ""].map((h, i) => <span key={i} className={LABEL}>{h}</span>)}
            </div>
            <div className="divide-y divide-[#262626]">
              {reviewLoopsQ.isLoading ? <div className="p-16 text-center text-[#99907c] text-sm">Loading loops…</div>
                : reviewLoops.length === 0 ? <div className="p-16 text-center text-[#99907c] text-sm">No loops awaiting review.</div>
                  : reviewLoops.map((l, i) => (
                    <LoopReviewCard key={l.id} l={l} index={i + 1}
                      onApprove={decideLoop}
                      onReject={(loopId) => setReject({ kind: "loop", loopId, reason: "Low quality", note: "" })} />
                  ))}
            </div>
          </section>
        )}

        {/* USERS */}
        {view === "users" && (
          <section>
            <div className="relative max-w-2xl mb-8">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#99907c]" />
              <input value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="Search by name, email, location, or UID…"
                className="w-full bg-[#0e0e0e] border-b border-[#353534] focus:border-[#f2ca50] focus:outline-none text-[#e5e2e1] py-4 pl-12 pr-4 placeholder:text-[#99907c]/60" />
            </div>
            {usersQ.isLoading ? <div className="p-16 text-center text-[#99907c] text-sm">Loading users…</div>
              : filteredUsers.length === 0 ? <div className="p-16 text-center text-[#99907c] text-sm">No users found.</div>
                : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredUsers.map(({ u, i }) => <UserCard key={u.uid} u={u} onOpen={() => setOpenIdx(i)} />)}
                  </div>
                )}
          </section>
        )}

        {/* LOOP CLAIMS */}
        {view === "loops" && (
          <section className={`${CARD}`}>
            <div className="hidden md:grid grid-cols-[1fr_1fr_1fr_120px] gap-3 px-5 py-3 border-b border-[#262626]">
              {["Loop", "Maker", "Puller", "Status"].map((h) => <span key={h} className={LABEL}>{h}</span>)}
            </div>
            <div className="divide-y divide-[#262626]">
              {claimsQ.isLoading ? <div className="p-16 text-center text-[#99907c] text-sm">Loading loop claims…</div>
                : claims.length === 0 ? <div className="p-16 text-center text-[#99907c] text-sm">No loop claims yet.</div>
                  : claims.map((c, i) => <LoopClaimRow key={`${c.loopId || "loop"}-${i}`} claim={c} />)}
            </div>
          </section>
        )}
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 h-16 bg-[#0e0e0e]/95 backdrop-blur border-t border-[#353534] flex justify-around items-center">
        {NAV.map(({ id, icon: Icon, label, count }) => (
          <button key={id} onClick={() => switchView(id)} className={`flex flex-col items-center gap-1 ${view === id ? "text-[#f2ca50]" : "text-[#99907c]"}`}>
            <Icon size={20} />
            <span className="font-mono text-[9px] uppercase tracking-wider">{label}</span>
            {!!count && <span className="absolute -mt-9 ml-6 min-w-4 px-1 bg-[#f2ca50] text-[#3c2f00] text-[9px] font-mono text-center">{count}</span>}
          </button>
        ))}
      </nav>

      {openIdx !== null && users[openIdx] && (
        <UserModal user={users[openIdx]} idx={openIdx} onClose={() => setOpenIdx(null)}
          onToggleVP={toggleVP} onToggleVL={toggleVL} onToggleStaff={toggleStaff} onSaveRole={saveVerifiedRole} onAdjust={adjustCredits} onToggleBan={toggleBan} onCancelSubscription={cancelSubscription} />
      )}

      {reject && (
        <Overlay onClose={() => setReject(null)}>
          <div className={`${CARD} bg-[#1c1b1b] w-full max-w-md p-7 relative`}>
            <button className="absolute top-4 right-4 text-[#99907c] hover:text-[#e5e2e1]" onClick={() => setReject(null)}><X size={18} /></button>
            <h3 className={`${DISPLAY} text-xl mb-5`}>Reject campaign</h3>
            <label className={`${LABEL} block mb-2`}>Reason</label>
            <Select wrapClass="w-full mb-4" className="text-[#e5e2e1]" value={reject.reason} onChange={(e) => setReject((r) => ({ ...r, reason: e.target.value }))}>
              <option>Low quality mix</option>
              <option>Wrong genre</option>
              <option>Needs revision</option>
              <option>Incomplete submission</option>
              <option>Does not meet quality standards</option>
              <option>Other</option>
            </Select>
            <label className={`${LABEL} block mb-2`}>Additional note (optional — sent to producer)</label>
            <textarea value={reject.note} onChange={(e) => setReject((r) => ({ ...r, note: e.target.value }))}
              placeholder="e.g. The mix is too muddy on the low end — resubmit after mastering."
              className="w-full min-h-[88px] bg-[#0e0e0e] border border-[#4d4635] focus:border-[#f2ca50] focus:outline-none text-[#e5e2e1] text-sm px-3 py-2.5 mb-5 resize-y placeholder:text-[#99907c]/50" />
            <div className="flex flex-col sm:flex-row gap-3">
              <Btn variant="danger" disabled={reject.busy} onClick={confirmReject} className="flex-1">{reject.busy ? "Rejecting…" : "Confirm rejection"}</Btn>
              <Btn variant="ghost" onClick={() => setReject(null)} className="flex-1">Cancel</Btn>
            </div>
          </div>
        </Overlay>
      )}

      {/* Toast */}
      <div className={`fixed left-1/2 -translate-x-1/2 z-[100] px-5 py-3 bg-[#1c1b1b] border border-[#f2ca50]/50 text-[#e5e2e1] text-sm transition-all duration-200 ${toast ? "opacity-100 bottom-20 md:bottom-6" : "opacity-0 pointer-events-none bottom-14 md:bottom-2"}`}>
        {toast}
      </div>
    </div>
  );
}

function Stat({ label, value, urgent }) {
  return (
    <div className={`p-5 border ${urgent ? "border-[#ffb4ab]/30 bg-[#93000a]/10" : "border-[#262626] bg-[#0e0e0e]"}`}>
      <div className={`font-display font-extrabold text-[34px] leading-none ${urgent ? "text-[#ffb4ab]" : "text-[#e5e2e1]"}`}>{value}</div>
      <div className={`mt-2 font-mono text-[10px] uppercase tracking-[0.12em] ${urgent ? "text-[#ffb4ab]" : "text-[#99907c]"}`}>{label}</div>
    </div>
  );
}

function CampaignCard({ c, index, onApprove, onReject, onRetry, onRemoveLibrary }) {
  const [open, setOpen] = useState(false);
  const isPending = c.status === "pending_review";
  const isSendFailed = c.status === "send_failed";
  const showDetail = ["pitched", "approved", "send_failed"].includes(c.status);
  const producer = c.producer || {};
  const beats = c.beats || [];
  const targets = c.targets || [];

  return (
    <article>
      <button onClick={() => setOpen((o) => !o)} className="w-full grid grid-cols-[32px_1fr_auto] md:grid-cols-[40px_minmax(0,1.7fr)_120px_90px_130px_24px] items-center gap-3 px-4 md:px-5 py-4 text-left hover:bg-[#1a1a1a] transition-colors">
        <span className="font-mono text-[13px] text-[#99907c]">{index}</span>
        <div className="min-w-0">
          <h3 className="font-display text-[16px] text-[#e5e2e1] truncate">{producer.name || "Unknown producer"}</h3>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[12px] text-[#99907c]">
            {producer.instagram && <span>{producer.instagram}</span>}
            {producer.email && <span className="hidden md:inline">{producer.email}</span>}
          </div>
        </div>
        <div className="hidden md:grid gap-1.5 text-[13px] text-[#d0c5af] capitalize">
          <span>{c.package || "—"}</span>
          <div className="flex flex-wrap gap-1.5">
            {c.timeSensitive && <Pill tone="urgent">{c.priorityLabel || "Time sensitive"}</Pill>}
            {c.rush && <Pill tone="gold">Rush</Pill>}
            {c.tier === "pro" && <Pill tone="info">Pro</Pill>}
          </div>
          {isPending && <Countdown deadline={reviewDeadline(c)} />}
        </div>
        <div className="hidden md:block">
          <div className="font-display font-extrabold text-[20px] text-[#e5e2e1]">{beats.length}</div>
          <div className="text-[11px] text-[#99907c]">{c.pitches} pitches</div>
        </div>
        <div className="hidden md:block"><StatusBadge status={c.status} /></div>
        <span className="flex md:hidden items-center gap-2">{isPending ? <Countdown deadline={reviewDeadline(c)} /> : <StatusBadge status={c.status} />}</span>
        <ChevronRight size={16} className={`hidden md:block text-[#99907c] transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="px-4 md:px-5 pb-5 md:pl-[60px]">
          <div className="flex flex-wrap gap-x-5 gap-y-2 mb-3 text-[12px] text-[#99907c]">
            <span>{fmtDate(c.createdAt)}</span>
            <span className="font-mono">{c.id}</span>
            <span>Targets: {targets.length ? targets.join(", ") : "—"}</span>
          </div>

          {beats.map((b, i) => {
            const spec = [b.genre, b.key, b.bpm && b.bpm + " BPM"].filter(Boolean).join(" · ");
            return (
              <div key={i} className="grid md:grid-cols-[minmax(220px,1fr)_minmax(260px,.9fr)] items-center gap-3 mt-2 p-3 bg-[#0e0e0e] border border-[#262626]">
                <div className="min-w-0">
                  <span className="block font-semibold text-[14px] text-[#e5e2e1] truncate">{b.title}</span>
                  <span className="block mt-1 font-mono text-[11px] text-[#99907c]">{spec}</span>
                </div>
                {b.playUrl ? <audio controls preload="none" src={b.playUrl} className="w-full h-9" /> : <div className="font-mono text-[11px] text-[#99907c]">No file</div>}
                {(b.collabs || []).length > 0 && (
                  <div className="md:col-span-2 flex flex-wrap gap-1.5 text-[12px] text-[#99907c]">
                    {b.collabs.map((x, j) => <span key={j} className="px-2 py-1 border border-[#262626] bg-[#1c1b1b]">{x.name}{x.instagram ? " " + x.instagram : ""}{x.role ? " · " + x.role : ""}</span>)}
                  </div>
                )}
              </div>
            );
          })}

          {showDetail && <PitchDetail c={c} />}

          {isPending && (
            <div className="flex flex-wrap gap-3 mt-4">
              <Btn variant="approve" onClick={() => onApprove(c.path)}><Check size={14} /> Approve &amp; pitch</Btn>
              <Btn variant="danger" onClick={() => onReject(c.path)}><X size={14} /> Reject</Btn>
            </div>
          )}
          {isSendFailed && (
            <div className="flex flex-wrap gap-3 mt-4">
              <Btn variant="gold" onClick={() => onRetry(c.path)}><RefreshCw size={14} /> Retry pitch</Btn>
            </div>
          )}
          {c.status === "pitched" && onRemoveLibrary && (
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <Btn variant="danger" onClick={() => onRemoveLibrary(c.path)}><Trash2 size={14} /> Remove from library</Btn>
              {c.targetRequestTitle && <span className="text-[12px] text-[#99907c]">Targeted submission — re: {c.targetRequestTitle}</span>}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function Pill({ tone, children }) {
  const tones = {
    urgent: "bg-[#93000a]/30 text-[#ffb4ab]",
    gold: "bg-[#f2ca50]/15 text-[#f2ca50]",
    info: "bg-[#6EC1FF]/15 text-[#6EC1FF]"
  };
  return <span className={`inline-flex px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] ${tones[tone]}`}>{children}</span>;
}

function LoopReviewCard({ l, index, onApprove, onReject }) {
  const [open, setOpen] = useState(false);
  const spec = [l.genre, l.key, l.bpm && l.bpm + " BPM"].filter(Boolean).join(" · ");
  const shared = l.exclusivity === "shared";
  return (
    <article>
      <button onClick={() => setOpen((o) => !o)} className="w-full grid grid-cols-[32px_1fr_auto] md:grid-cols-[40px_minmax(0,1.6fr)_120px_110px_24px] items-center gap-3 px-4 md:px-5 py-4 text-left hover:bg-[#1a1a1a] transition-colors">
        <span className="font-mono text-[13px] text-[#99907c]">{index}</span>
        <div className="min-w-0">
          <h3 className="font-display text-[16px] text-[#e5e2e1] truncate">{l.title}</h3>
          <div className="mt-1 text-[12px] text-[#99907c] truncate">{l.makerName || "Unknown maker"}{l.targetRequestTitle ? ` · for "${l.targetRequestTitle}"` : ""}</div>
        </div>
        <div className="hidden md:block"><Pill tone={shared ? "info" : "gold"}>{shared ? "Shared" : "Exclusive"}</Pill></div>
        <span className="hidden md:block font-mono text-[11px] text-[#99907c] truncate">{spec || "—"}</span>
        <ChevronRight size={16} className={`hidden md:block text-[#99907c] transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="px-4 md:px-5 pb-5 md:pl-[60px]">
          <div className="flex flex-wrap gap-x-5 gap-y-2 mb-3 text-[12px] text-[#99907c]">
            <span>{fmtDate(l.createdAt)}</span>
            <span className="font-mono">{l.id}</span>
            <span className="md:hidden">{spec || "—"}</span>
            <span className="md:hidden">{shared ? "Shared" : "Exclusive"}</span>
          </div>
          {l.playUrl ? <audio controls preload="none" src={l.playUrl} className="w-full h-9 mb-3" /> : <div className="font-mono text-[11px] text-[#99907c] mb-3">No file</div>}
          {Array.isArray(l.tags) && l.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3 text-[12px] text-[#99907c]">
              {l.tags.map((t, j) => <span key={j} className="px-2 py-1 border border-[#262626] bg-[#1c1b1b]">#{t}</span>)}
            </div>
          )}
          <div className="flex flex-wrap gap-3 mt-2">
            <Btn variant="approve" onClick={() => onApprove(l.id)}><Check size={14} /> Approve &amp; go live</Btn>
            <Btn variant="danger" onClick={() => onReject(l.id)}><X size={14} /> Reject</Btn>
          </div>
        </div>
      )}
    </article>
  );
}

function LoopClaimRow({ claim: c }) {
  const date = c.createdAt ? new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_120px] items-center gap-2 md:gap-3 px-5 py-4">
      <div>
        <span className="inline-block font-mono text-[11px] px-2 py-1 border border-[#262626] bg-[#0e0e0e] text-[#e5e2e1] break-all">{c.loopId || "—"}</span>
        <small className="block mt-1.5 text-[11px] text-[#99907c]">{date}</small>
      </div>
      <div className="font-mono text-[12px] text-[#d0c5af] break-all">{c.makerUid || "—"}</div>
      <div className="font-mono text-[12px] text-[#d0c5af] break-all">{c.pullerUid || "—"}</div>
      <StatusBadge status={c.status === "placed" ? "approved" : "pending_review"} />
    </div>
  );
}

function PitchDetail({ c }) {
  if (!c.pitchedTo?.length) return null;
  const byContact = new Map();
  const legacyContactKey = (value) => String(value || "").trim();
  const contactKey = (contact) => typeof contact === "string" ? legacyContactKey(contact) : (contact?.contactId || contact?.viewerUsername || contact?.viewerName || "");
  const contactLabel = (contact) => typeof contact === "string" ? "Verified contact" : (contact?.viewerName || contact?.viewerUsername || "Verified contact");
  c.pitchedTo.forEach((contact) => {
    const key = contactKey(contact);
    if (key) byContact.set(key, { label: contactLabel(contact), opened: false, downloaded: false, last: null });
  });
  (c.events || []).forEach((e) => {
    const key = e.contactId || legacyContactKey(e.contact);
    const rec = byContact.get(key);
    if (!rec) return;
    if (e.viewerName || e.viewerUsername) rec.label = e.viewerName || e.viewerUsername;
    if (e.type === "opened") rec.opened = true;
    if (e.type === "downloaded") rec.downloaded = true;
    if (e.timestamp && (!rec.last || e.timestamp > rec.last)) rec.last = e.timestamp;
  });
  return (
    <div className="mt-3 p-4 bg-[#0a0a0a] border border-[#262626]">
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 font-mono text-[10px] uppercase tracking-[0.12em]">
        <span className="text-[#f2ca50]">Pitch tracking</span>
        <span className="text-[#99907c]">{c.pitchedTo.length} contacted</span>
        <span className="text-[#99907c]">{c.opens} opens</span>
        <span className="text-[#99907c]">{c.downloads} downloads</span>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left">
            {["Contact", "Opened", "Downloaded", "Last activity"].map((h) => (
              <th key={h} className="py-2 px-2 border-b border-[#262626] font-mono text-[10px] uppercase tracking-[0.08em] text-[#99907c]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...byContact.entries()].map(([key, rec]) => (
            <tr key={key} className="border-b border-[#262626] last:border-0">
              <td className="py-2 px-2 text-[#e5e2e1]">{rec.label}</td>
              <td className="py-2 px-2">{rec.opened ? <span className="font-mono text-[10px] uppercase px-2 py-0.5 bg-[#f2ca50]/15 text-[#f2ca50]">Opened</span> : <span className="text-[#99907c]">—</span>}</td>
              <td className="py-2 px-2">{rec.downloaded ? <span className="font-mono text-[10px] uppercase px-2 py-0.5 bg-[#7CE2A4]/15 text-[#7CE2A4]">Downloaded</span> : <span className="text-[#99907c]">—</span>}</td>
              <td className="py-2 px-2 text-[#99907c]">{fmtDate(rec.last)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserCard({ u, onOpen }) {
  const initial = (u.displayName || u.email || "?")[0].toUpperCase();
  const flagged = u.banned;
  return (
    <button onClick={onOpen} className="text-left bg-[#0e0e0e] border border-[#262626] hover:border-[#f2ca50] hover:bg-[#1a1a1a] transition-all p-5 flex flex-col gap-4 active:scale-[0.99]">
      <div className="flex items-start justify-between gap-3">
        <div className="w-12 h-12 flex-none border border-[#4d4635] bg-[#2a2a2a] grid place-items-center font-display font-extrabold text-[#f2ca50] overflow-hidden"
          style={u.avatarUrl ? { backgroundImage: `url('${u.avatarUrl}')`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>
          {u.avatarUrl ? "" : initial}
        </div>
        <div className="flex flex-wrap gap-1.5 justify-end min-w-0">
          {flagged && <span className="px-2 py-0.5 font-mono text-[10px] uppercase bg-[#93000a]/50 text-[#ffdad6]">Banned</span>}
          {u.staff && <span className="px-2 py-0.5 font-mono text-[10px] uppercase bg-[#2a2a2a] text-[#f2ca50]">Staff</span>}
          {u.verifiedPuller && <span className="px-2 py-0.5 font-mono text-[10px] uppercase bg-[#2a2a2a] text-[#7CE2A4]">Puller</span>}
          {u.verifiedListener && <span className="px-2 py-0.5 font-mono text-[10px] uppercase bg-[#2a2a2a] text-[#6EC1FF]">Listener</span>}
        </div>
      </div>
      <div className="min-w-0">
        <h3 className="font-display text-[18px] text-[#e5e2e1] truncate">{u.displayName || "—"}</h3>
        <p className="font-mono text-[11px] text-[#99907c] truncate mt-0.5">{u.email || ""}</p>
        {u.verifiedRole && <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-[#f2ca50] mt-1.5 truncate">{verifiedRoleLabel(u.verifiedRole)}{u.labelName ? ` · ${u.labelName}` : ""}</p>}
      </div>
      <div className="flex items-center gap-4 pt-3 border-t border-[#262626] font-mono text-[11px] text-[#99907c]">
        <span className="px-2 py-0.5 bg-[#2a2a2a] text-[#f2ca50] uppercase">{u.tier || "free"}</span>
        <span>{u.pitchBalance || 0} pitch</span>
        <span>{u.loopBalance || 0} loop</span>
      </div>
    </button>
  );
}

function Overlay({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {children}
    </div>
  );
}

function UserModal({ user: u, idx, onClose, onToggleVP, onToggleVL, onToggleStaff, onSaveRole, onAdjust, onToggleBan, onCancelSubscription }) {
  const [pitchAmt, setPitchAmt] = useState("5");
  const [loopAmt, setLoopAmt] = useState("5");
  const [role, setRole] = useState(u.verifiedRole || "");
  const [labelName, setLabelName] = useState(u.labelName || "");
  const [roleBusy, setRoleBusy] = useState(false);
  const initial = (u.displayName || u.email || "?")[0].toUpperCase();
  const roleIsAr = isArRole(role);
  const roleDirty = role !== (u.verifiedRole || "") || labelName.trim() !== (u.labelName || "");

  async function submitRole() {
    if (roleBusy) return;
    setRoleBusy(true);
    try { await onSaveRole(idx, role, roleIsAr ? labelName.trim() : ""); }
    finally { setRoleBusy(false); }
  }

  const SectionLabel = ({ children }) => <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#f2ca50] mb-2">{children}</div>;
  const inputCls = "w-full bg-[#0e0e0e] border border-[#4d4635] focus:border-[#f2ca50] focus:outline-none text-[#e5e2e1] text-sm px-3 py-2.5";

  const AccessRow = ({ active, on, off, sub, activeColor, onToggle, disabled }) => (
    <div className="flex items-center justify-between bg-[#0e0e0e] border border-[#262626] p-3.5">
      <div>
        <div className="text-[13px] font-semibold" style={{ color: active ? activeColor : "#99907c" }}>{active ? on : off}</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-[#99907c] mt-0.5">{sub}</div>
      </div>
      <button disabled={disabled} onClick={onToggle}
        className={`font-mono text-[11px] uppercase tracking-wider px-4 py-2 border transition-colors disabled:opacity-40 disabled:pointer-events-none ${active ? "border-[#ffb4ab] text-[#ffb4ab] hover:bg-[#ffb4ab]/10" : "border-[#f2ca50] text-[#f2ca50] hover:bg-[#f2ca50]/10"}`}>
        {active ? "Revoke" : "Grant"}
      </button>
    </div>
  );

  return (
    <Overlay onClose={onClose}>
      <div className="bg-[#1c1b1b] border border-[#353534] w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 relative" role="dialog" aria-modal="true">
        <button className="absolute top-4 right-4 text-[#99907c] hover:text-[#e5e2e1]" onClick={onClose}><X size={18} /></button>

        {/* Header */}
        <div className="flex items-center gap-4 mb-5">
          <div className="w-16 h-16 border border-[#4d4635] bg-[#2a2a2a] grid place-items-center font-display font-extrabold text-2xl text-[#f2ca50] overflow-hidden"
            style={u.avatarUrl ? { backgroundImage: `url('${u.avatarUrl}')`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>
            {u.avatarUrl ? "" : initial}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-display text-xl text-[#e5e2e1]">{u.displayName || "—"}</h2>
              <span className="font-mono text-[10px] uppercase px-2 py-0.5 bg-[#2a2a2a] text-[#f2ca50]">{u.tier || "free"}</span>
              {u.verifiedRole && <span className="font-mono text-[10px] uppercase px-2 py-0.5 bg-[#7C5CFF]/20 text-[#b9a8ff]">{verifiedRoleLabel(u.verifiedRole)}</span>}
              {u.staff && <span className="font-mono text-[10px] uppercase px-2 py-0.5 bg-[#2a2a2a] text-[#f2ca50]">{u.staffLocked ? "owner staff" : "staff"}</span>}
              {u.banned && <span className="font-mono text-[10px] uppercase px-2 py-0.5 bg-[#93000a]/50 text-[#ffdad6]">banned</span>}
            </div>
            <div className="text-[13px] text-[#99907c] mt-0.5 truncate">{u.email || ""}</div>
            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[12px] text-[#99907c]">
              {u.location && <span className="inline-flex items-center gap-1"><MapPin size={11} />{u.location}</span>}
              {u.createdAt && <span>Joined {new Date(u.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>}
              {u.phone && <span>{u.phone}</span>}
            </div>
          </div>
        </div>

        {u.bio && <div className="text-[13px] text-[#d0c5af] leading-relaxed p-3.5 bg-[#0e0e0e] border border-[#262626] mb-3">{u.bio}</div>}
        <div className="font-mono text-[10px] tracking-[0.06em] text-[#99907c] mb-5 break-all">{u.uid}</div>

        {/* Verified role */}
        <SectionLabel>Verified role</SectionLabel>
        <div className="grid gap-2 mb-5 bg-[#0e0e0e] border border-[#262626] p-3">
          <Select wrapClass="w-full" className="text-[#e5e2e1]" value={role} onChange={(e) => { const next = e.target.value; setRole(next); if (!isArRole(next)) setLabelName(""); }}>
            {VERIFIED_ROLES.map((opt) => <option key={opt.value || "none"} value={opt.value}>{opt.label}</option>)}
          </Select>
          {roleIsAr && (
            <input value={labelName} onChange={(e) => setLabelName(e.target.value)} placeholder="Label name, e.g. Atlantic Records" maxLength={80} className={inputCls} />
          )}
          <Btn variant="gold" disabled={!roleDirty || roleBusy} onClick={submitRole} className="w-full">{roleBusy ? "Saving…" : "Save verified role"}</Btn>
        </div>

        {/* Credits */}
        <SectionLabel>Credits</SectionLabel>
        <div className="grid grid-cols-2 gap-3 mb-5">
          {[
            { kind: "pitch", balance: u.pitchBalance, amt: pitchAmt, setAmt: setPitchAmt },
            { kind: "loop", balance: u.loopBalance, amt: loopAmt, setAmt: setLoopAmt }
          ].map(({ kind, balance, amt, setAmt }) => (
            <div key={kind} className="bg-[#0e0e0e] border border-[#262626] p-4">
              <div className="flex items-baseline justify-between mb-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#99907c]">{kind}</span>
                <span className="font-display font-extrabold text-2xl text-[#e5e2e1]">{balance || 0}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <input type="number" min="1" value={amt} onChange={(e) => setAmt(e.target.value)} className="w-12 bg-[#1c1b1b] border border-[#4d4635] text-[#e5e2e1] text-sm text-center px-1 py-1.5" />
                <button onClick={() => onAdjust(idx, kind, 1, amt)} className="flex-1 py-1.5 border border-[#7CE2A4] text-[#7CE2A4] hover:bg-[#7CE2A4]/10 grid place-items-center"><Plus size={14} /></button>
                <button onClick={() => onAdjust(idx, kind, -1, amt)} className="flex-1 py-1.5 border border-[#ffb4ab] text-[#ffb4ab] hover:bg-[#ffb4ab]/10 grid place-items-center"><Minus size={14} /></button>
              </div>
            </div>
          ))}
        </div>

        {/* Access */}
        <SectionLabel>Access</SectionLabel>
        <div className="flex flex-col gap-2 mb-5">
          <AccessRow active={u.verifiedPuller} on="Verified puller" off="Loop pull — not granted" sub="Loop pool access" activeColor="#7CE2A4" onToggle={() => onToggleVP(idx)} />
          <AccessRow active={u.verifiedListener} on="Verified listener" off="Beat library — not granted" sub="A&R / artist library" activeColor="#6EC1FF" onToggle={() => onToggleVL(idx)} />
          <AccessRow active={u.staff} on={u.staffLocked ? "Owner staff" : "Staff access"} off="Staff access — not granted" sub="Staff board + user mgmt" activeColor="#f2ca50" onToggle={() => onToggleStaff(idx)} disabled={u.staffLocked} />
        </div>

        {u.tier && u.tier !== "free" && (
          <>
            <SectionLabel>Subscription</SectionLabel>
            <div className="flex items-center justify-between bg-[#0e0e0e] border border-[#262626] p-3.5 mb-5">
              <div>
                <div className="text-[13px] font-semibold flex items-center gap-1.5 text-[#e5e2e1]"><CreditCard size={13} /> {u.tier} plan</div>
                <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-[#99907c] mt-0.5">Active Stripe subscription</div>
              </div>
              <button onClick={() => onCancelSubscription(idx)}
                className="font-mono text-[11px] uppercase tracking-wider px-4 py-2 border border-[#ffb4ab] text-[#ffb4ab] hover:bg-[#ffb4ab]/10 transition-colors flex items-center gap-1.5">
                <XCircle size={13} /> Cancel
              </button>
            </div>
          </>
        )}

        <button onClick={() => onToggleBan(idx)}
          className={`w-full py-3 font-mono text-[12px] uppercase tracking-wider border transition-colors flex items-center justify-center gap-2 ${u.banned ? "border-[#7CE2A4] text-[#7CE2A4] hover:bg-[#7CE2A4]/10" : "border-[#ffb4ab] text-[#ffb4ab] hover:bg-[#ffb4ab]/10"}`}>
          {u.banned ? <><ShieldCheck size={14} /> Unban this user</> : <><Ban size={14} /> Ban this user</>}
        </button>
      </div>
    </Overlay>
  );
}

/* ============================ Overview board ============================ */
const money = (n) => "$" + (n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
function timeAgo(ms) {
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function OverviewBoard({ data, loading, queueStats, showToast }) {
  const u = data?.users;
  const s = data?.stripe;
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Module title="Revenue" icon={DollarSign} accent>
          {loading ? <ModuleSkeleton /> : s?.error ? (
            <div className="text-[#99907c] text-sm">Stripe unavailable right now. Est. MRR from tiers · <span className="text-[#f2ca50]">{money(data?.estMrr)}</span></div>
          ) : (
            <>
              <BigStat value={money(s?.gross30d)} label="Gross · last 30 days" />
              <div className="grid grid-cols-3 gap-3 mt-4">
                <MiniStat value={money(s?.grossToday)} label="Today" />
                <MiniStat value={s?.paymentCount30d ?? 0} label="Payments 30d" />
                <MiniStat value={s?.activeSubscriptions ?? 0} label="Active subs" />
              </div>
              <div className="mt-3 font-mono text-[11px] text-[#99907c]">Est. MRR from tiers · <span className="text-[#f2ca50]">{money(data?.estMrr)}</span></div>
            </>
          )}
        </Module>

        <Module title="Members" icon={TrendingUp}>
          {loading ? <ModuleSkeleton /> : (
            <>
              <BigStat value={(u?.total ?? 0).toLocaleString()} label="Total accounts" />
              <TierBar tiers={u?.tiers} />
              <div className="grid grid-cols-2 gap-3 mt-4">
                <MiniStat value={`+${u?.new7d ?? 0}`} label="New · 7 days" />
                <MiniStat value={`+${u?.new30d ?? 0}`} label="New · 30 days" />
              </div>
            </>
          )}
        </Module>

        <Module title="Community" icon={ShieldCheck}>
          {loading ? <ModuleSkeleton /> : (
            <div className="grid grid-cols-2 gap-3">
              <MiniStat value={u?.verifiedListeners ?? 0} label="Listeners" />
              <MiniStat value={u?.verifiedPullers ?? 0} label="Pullers" />
              <MiniStat value={u?.staff ?? 0} label="Staff" />
              <MiniStat value={u?.banned ?? 0} label="Banned" danger={!!u?.banned} />
              <MiniStat value={data?.requests?.open ?? 0} label="Open requests" />
              <MiniStat value={queueStats?.pending ?? 0} label="Queue pending" />
            </div>
          )}
        </Module>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4">
        <RequestComposer showToast={showToast} />
        <RequestFeed showToast={showToast} />
      </div>
    </div>
  );
}

function Module({ title, icon: Icon, accent, children }) {
  return (
    <div className={`bg-[#0e0e0e] border ${accent ? "border-[#4d4635]" : "border-[#262626]"} p-5`}>
      <div className="flex items-center gap-2 mb-4">
        <Icon size={15} className="text-[#f2ca50]" />
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#99907c]">{title}</span>
      </div>
      {children}
    </div>
  );
}

function BigStat({ value, label }) {
  return (
    <div>
      <div className="font-display font-extrabold text-[40px] leading-none text-[#e5e2e1]">{value}</div>
      <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#99907c]">{label}</div>
    </div>
  );
}

function MiniStat({ value, label, danger }) {
  return (
    <div className="bg-[#1c1b1b] border border-[#262626] p-3">
      <div className={`font-display font-extrabold text-[20px] leading-none ${danger ? "text-[#ffb4ab]" : "text-[#e5e2e1]"}`}>{value}</div>
      <div className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[#99907c]">{label}</div>
    </div>
  );
}

function ModuleSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-10 w-32 bg-[#2a2a2a]" />
      <div className="h-3 w-20 bg-[#1c1b1b] mt-3" />
      <div className="grid grid-cols-3 gap-3 mt-4">{[0, 1, 2].map((i) => <div key={i} className="h-12 bg-[#1c1b1b]" />)}</div>
    </div>
  );
}

function TierBar({ tiers }) {
  const free = tiers?.free || 0, plugg = tiers?.plugg || 0, pro = tiers?.pro || 0;
  const total = Math.max(free + plugg + pro, 1);
  const seg = [
    { n: pro, c: "#7CE2A4", label: "Pro" },
    { n: plugg, c: "#f2ca50", label: "Plugg" },
    { n: free, c: "#4d4635", label: "Free" }
  ];
  return (
    <div className="mt-4">
      <div className="flex h-2 w-full overflow-hidden bg-[#1c1b1b]">
        {seg.map((x) => x.n > 0 ? <div key={x.label} style={{ width: `${(x.n / total) * 100}%`, background: x.c }} /> : null)}
      </div>
      <div className="flex flex-wrap gap-3 mt-2 font-mono text-[10px] text-[#99907c]">
        {seg.map((x) => <span key={x.label} className="inline-flex items-center gap-1"><i className="inline-block w-2 h-2" style={{ background: x.c }} />{x.label} {x.n}</span>)}
      </div>
    </div>
  );
}

function RequestComposer({ showToast }) {
  const [type, setType] = useState("both");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const isAnnouncement = type === "announcement";
  // Announcements only need a title; requests need a briefing too.
  const canPost = title.trim().length >= 4 && (isAnnouncement || brief.trim().length >= 20);

  async function post() {
    if (!canPost || busy) return;
    setBusy(true);
    try {
      await call("createCampaignRequest", { requestType: type, title: title.trim(), brief: brief.trim() });
      setTitle(""); setBrief("");
      showToast(isAnnouncement ? "Announcement posted." : "Posted to the request board.");
    } catch (e) {
      showToast("Failed: " + (e.message || e));
    } finally { setBusy(false); }
  }

  return (
    <div className={`bg-[#0e0e0e] border p-5 flex flex-col gap-3 self-start transition-colors ${isAnnouncement ? "border-[#f2ca50]/50" : "border-[#262626]"}`}>
      <div className="flex items-center gap-2 mb-1">
        <Megaphone size={15} className="text-[#f2ca50]" />
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#99907c]">{isAnnouncement ? "Post announcement" : "Post to board"}</span>
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isAnnouncement ? "Announcement headline" : "Title — what are you looking for?"} maxLength={90}
        className="w-full bg-[#1c1b1b] border border-[#4d4635] focus:border-[#f2ca50] focus:outline-none text-[#e5e2e1] text-sm px-3 py-2.5 placeholder:text-[#99907c]/60" />
      <textarea value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={isAnnouncement ? "Message to the community (optional)…" : "Briefing — genre, vibe, references, deadline…"} maxLength={900}
        className="w-full min-h-[120px] bg-[#1c1b1b] border border-[#4d4635] focus:border-[#f2ca50] focus:outline-none text-[#e5e2e1] text-sm px-3 py-2.5 resize-y placeholder:text-[#99907c]/50" />
      <div className="flex items-center justify-between gap-3">
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="both">Beats + Loops</option>
          <option value="beats">Beats</option>
          <option value="loops">Loops</option>
          <option value="announcement">Announcement</option>
        </Select>
        <span className="font-mono text-[10px] text-[#99907c]">{brief.trim().length}/900</span>
      </div>
      <Btn variant="gold" disabled={!canPost || busy} onClick={post} className="w-full"><Send size={14} /> {busy ? "Posting…" : isAnnouncement ? "Post announcement" : "Post request"}</Btn>
      <p className="font-mono text-[10px] text-[#99907c] leading-relaxed">{isAnnouncement ? "Broadcasts a staff announcement to everyone's board — no verified role needed." : "Posts as your verified profile into the live board. Requires a verified role on your account."}</p>
    </div>
  );
}

function RequestFeed({ showToast }) {
  const { data } = useLiveCollection(
    ["staff", "requestFeed"],
    () => query(collection(db, "campaignRequests"), where("status", "==", "open"), orderBy("createdAt", "desc"), qLimit(40)),
    {
      map: (d) => {
        const r = d.data();
        return {
          id: d.id,
          name: r.createdByName || "Verified user",
          photo: r.createdByPhotoURL || "",
          roleLabel: r.createdByRole ? verifiedRoleLabel(r.createdByRole) : "",
          staff: r.createdByStaff === true,
          labelName: r.labelName || "",
          type: r.requestType || "loops",
          title: r.title || "",
          brief: r.brief || "",
          views: r.viewCount || 0,
          subs: r.submissionCount || 0,
          pinned: r.pinned === true,
          createdAt: r.createdAt?.toMillis ? r.createdAt.toMillis() : null
        };
      }
    }
  );
  const loading = data === undefined;
  // Pinned posts float to the top; sort is stable so date order holds within groups.
  const items = [...(data || [])].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  async function moderate(id, action) {
    if (action === "delete" && !confirm("Delete this request permanently?")) return;
    try {
      await call("moderateCampaignRequest", { requestId: id, action });
      showToast({ delete: "Request deleted.", close: "Request closed.", pin: "Pinned to top.", unpin: "Unpinned." }[action] || "Updated.");
    } catch (e) { showToast("Failed: " + (e.message || e)); }
  }

  return (
    <div className="bg-[#0e0e0e] border border-[#262626] flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#262626]">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#7CE2A4] opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[#7CE2A4]" /></span>
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#99907c]">Live request board</span>
        </div>
        <span className="font-mono text-[11px] text-[#f2ca50]">{items.length} open</span>
      </div>
      <div className="overflow-y-auto divide-y divide-[#262626]" style={{ maxHeight: 480 }}>
        {loading ? <div className="p-12 text-center text-[#99907c] text-sm">Loading feed…</div>
          : items.length === 0 ? <div className="p-12 text-center text-[#99907c] text-sm">No open requests.</div>
            : items.map((r) => <FeedBubble key={r.id} r={r} onModerate={moderate} />)}
      </div>
    </div>
  );
}

function FeedBubble({ r, onModerate }) {
  const initial = (r.name || "?")[0].toUpperCase();
  const announcement = r.type === "announcement";
  return (
    <div className={`flex gap-3 p-4 ${r.pinned ? "bg-[#f2ca50]/[0.04] border-l-2 border-l-[#f2ca50]" : ""}`}>
      <div className="w-9 h-9 flex-none border border-[#4d4635] bg-[#2a2a2a] grid place-items-center font-display font-bold text-[#f2ca50] overflow-hidden"
        style={r.photo ? { backgroundImage: `url('${r.photo}')`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>
        {r.photo ? "" : initial}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          {r.pinned && <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-[#f2ca50]/15 text-[#f2ca50]"><Pin size={9} /> Pinned</span>}
          <span className="text-[12px] font-semibold text-[#e5e2e1]">{r.name}</span>
          {r.staff
            ? <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-[#f2ca50]/15 text-[#f2ca50]">Staff</span>
            : <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-[#7C5CFF]/20 text-[#b9a8ff]">{r.roleLabel || "Verified"}</span>}
          {r.labelName && <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-[#f2ca50]/12 text-[#f2ca50]">{r.labelName}</span>}
          <span className="font-mono text-[10px] text-[#99907c] ml-auto">{r.createdAt ? timeAgo(r.createdAt) : ""}</span>
        </div>
        <div className={`mt-1 border p-3 ${announcement ? "bg-[#f2ca50]/[0.06] border-[#f2ca50]/40" : "bg-[#1c1b1b] border-[#262626]"}`}>
          <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-widest text-[#f2ca50] mb-1.5">
            {announcement ? <><Megaphone size={10} /> Announcement</> : r.type}
          </span>
          <div className="text-[13px] font-semibold text-[#e5e2e1] leading-snug">{r.title}</div>
          {r.brief && <div className="mt-0.5 text-[12px] text-[#99907c] leading-relaxed line-clamp-3">{r.brief}</div>}
          <div className="flex items-center gap-2 flex-wrap mt-2.5 font-mono text-[10px] text-[#99907c]">
            {!announcement && (
              <>
                <span className="inline-flex items-center gap-1"><Eye size={11} /> {r.views}</span>
                <span className="inline-flex items-center gap-1"><Send size={11} /> {r.subs}</span>
              </>
            )}
            <span className="flex-1" />
            <button onClick={() => onModerate(r.id, r.pinned ? "unpin" : "pin")} className="inline-flex items-center gap-1 px-2 py-1 border border-[#4d4635] text-[#f2ca50] hover:bg-[#f2ca50]/10 uppercase tracking-wider transition-colors">{r.pinned ? <><PinOff size={11} /> Unpin</> : <><Pin size={11} /> Pin</>}</button>
            <button onClick={() => onModerate(r.id, "close")} className="inline-flex items-center gap-1 px-2 py-1 border border-[#4d4635] text-[#d0c5af] hover:bg-[#2a2a2a] uppercase tracking-wider transition-colors"><Ban size={11} /> Close</button>
            <button onClick={() => onModerate(r.id, "delete")} className="inline-flex items-center gap-1 px-2 py-1 border border-[#ffb4ab] text-[#ffb4ab] hover:bg-[#ffb4ab]/10 uppercase tracking-wider transition-colors"><Trash2 size={11} /> Delete</button>
          </div>
        </div>
      </div>
    </div>
  );
}
