import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { collection, doc, limit, orderBy, query, where } from "firebase/firestore";
import { auth } from "../firebase/auth.js";
import { db } from "../firebase/db.js";
import { useLiveCollection, useLiveDoc, call } from "../lib/live.js";
import { avatarInitial, resolveAvatarUrl } from "../lib/avatar.js";
import { canPlanSubmitToRole, isArRole, verifiedRoleLabel, verifiedRoleMeta } from "../lib/roles.js";
import { usePushAutoRegister } from "../lib/usePush.js";
import {
  ArrowLeft, ArrowRight, BarChart2, CalendarDays, ChevronDown, Disc3, Filter,
  Library, ListMusic, LogOut, Menu, MessageSquarePlus, MoreHorizontal, Music2,
  Pause, Play, RefreshCw, Search, Send, Share2, ShieldCheck, Tag, TrendingUp, X
} from "lucide-react";
import "./Verified.css";

/* ─── palette constants ─────────────────────────────────────── */
const ACCENT = {
  "Trap":      "linear-gradient(140deg,#7C5CFF 0%,#3A1F9E 100%)",
  "Drill":     "linear-gradient(140deg,#6EC1FF 0%,#2B6FA8 100%)",
  "R&B":       "linear-gradient(140deg,#E4C16B 0%,#9E6B1A 100%)",
  "Pop":       "linear-gradient(140deg,#FF6B9D 0%,#A82855 100%)",
  "Afrobeats": "linear-gradient(140deg,#7CE2A4 0%,#268B4E 100%)",
  "Hip-Hop":   "linear-gradient(140deg,#FF6B6B 0%,#A82020 100%)",
  "Reggaeton": "linear-gradient(140deg,#FFB347 0%,#A86010 100%)"
};
const accentFor = (g) => ACCENT[g] || "linear-gradient(140deg,#A29DAC 0%,#4A4358 100%)";
const SORTS = [["newest","Newest"],["title","Title"],["producer","Producer"],["genre","Genre"]];
const PAGE_SIZE      = 80;
const BEAT_PAGE_SIZE = 25;
const LOOP_PAGE_SIZE = 50;
const FN_BASE        = "https://us-central1-pluggurbeats.cloudfunctions.net";
const REQUEST_GENRES = ["Trap","Drill","R&B","Pop","Afrobeats","Hip-Hop","Reggaeton","Other"];

/* ─── shared UI primitives — Obsidian Studio Admin theme ──────── */
const GoldBtn = ({ className = "", children, ...p }) => (
  <button
    className={`inline-flex items-center justify-center gap-2 rounded-none border border-[#f2ca50] bg-[#f2ca50] px-4 py-2 text-[13px] font-semibold uppercase tracking-wider text-[#3c2f00] transition hover:bg-[#f2ca50]/90 disabled:opacity-40 ${className}`}
    {...p}
  >{children}</button>
);
const GhostBtn = ({ className = "", children, ...p }) => (
  <button
    className={`inline-flex items-center justify-center gap-2 rounded-none border border-[#4d4635] px-4 py-2 text-[13px] uppercase tracking-wider text-[#99907c] transition hover:border-[#f2ca50]/60 hover:text-[#e8e0d0] disabled:opacity-40 ${className}`}
    {...p}
  >{children}</button>
);
const IconBtn = ({ className = "", children, ...p }) => (
  <button
    className={`grid h-9 w-9 place-items-center rounded-none border border-[#262626] bg-[#0e0e0e] text-[#99907c] transition hover:border-[#4d4635] hover:text-[#e8e0d0] active:scale-[0.97] ${className}`}
    {...p}
  >{children}</button>
);
const Skeleton = ({ className = "" }) => (
  <div className={`relative overflow-hidden rounded-none bg-[#1c1b1b] ${className}`}>
    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[shimmer_1.4s_infinite]" />
  </div>
);
const EqBars = () => <span className="eq-bars"><i /><i /><i /><i /></span>;

/* ─── helpers ────────────────────────────────────────────────── */
const normalizeTag   = (t) => String(t || "").trim().toLowerCase();
const itemHandle     = (item, tab) => tab === "beats"
  ? (item.producer?.instagram || item.producer?.name || "Unknown producer")
  : (item.makerName || "Unknown maker");
const itemDate       = (ms) => ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
const fmtClock       = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};
const waveformBars   = (seed = "", count = 84) => {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return Array.from({ length: count }, (_, i) => {
    hash = (hash * 1664525 + 1013904223 + i) >>> 0;
    const lift  = 18 + (hash % 34);
    const taper = i > count * 0.68 ? .55 : i < 2 ? .72 : 1;
    return Math.max(10, Math.round(lift * taper));
  });
};
const cleanFileName      = (name, fallback = "audio") => {
  const base = String(name || fallback).trim() || fallback;
  return base.replace(/[/\\:*?"<>|]/g, "").replace(/\s+/g, " ").slice(0, 80);
};
const cleanAudioFileName = (name, fallback = "audio.mp3") => {
  const raw  = String(name || fallback).split("?")[0].split("#")[0].trim() || fallback;
  const safe = raw.replace(/[/\\:*?"<>|]/g, "").replace(/\s+/g, " ").slice(0, 120);
  return /\.[a-z0-9]{2,5}$/i.test(safe) ? safe : `${safe}.mp3`;
};
const splitList          = (value) => [...new Set(String(value || "").split(/[,\n]/).map((i) => i.trim()).filter(Boolean))].slice(0, 10);
const storageFileName    = (path) => {
  const last = String(path || "").split("/").filter(Boolean).pop() || "";
  try { return decodeURIComponent(last); } catch { return last; }
};
const mimeExt  = (mime) => { if (/wav/i.test(mime)) return "wav"; if (/mpeg|mp3/i.test(mime)) return "mp3"; if (/mp4|m4a|aac/i.test(mime)) return "m4a"; return "mp3"; };
const urlExt   = (url)  => { const clean = String(url || "").split("?")[0].toLowerCase(); const match = clean.match(/\.([a-z0-9]{2,5})$/i); return match?.[1] || ""; };
const openDownload  = (url, filename = "") => { const a = document.createElement("a"); a.href = url; a.download = filename; a.rel = "noopener"; document.body.appendChild(a); a.click(); document.body.removeChild(a); };
const downloadBlob  = (blob, filename) => { const objectUrl = URL.createObjectURL(blob); openDownload(objectUrl, filename); window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); };

async function exportAudio(url, title, fallbackMessage, preferredFileName = "") {
  const fallbackName = cleanFileName(title, "audio");
  const guessedExt  = urlExt(url) || "mp3";
  const fileName    = preferredFileName
    ? cleanAudioFileName(preferredFileName, `${fallbackName}.${guessedExt}`)
    : cleanAudioFileName(`${fallbackName}.${guessedExt}`);
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const [{ Share }, { Filesystem, Directory }, { FileTransfer }] = await Promise.all([
        import("@capacitor/share"), import("@capacitor/filesystem"), import("@capacitor/file-transfer")
      ]);
      const canShare = await Share.canShare().catch(() => ({ value: true }));
      if (!canShare.value) throw new Error("Native share is unavailable.");
      const { uri } = await Filesystem.getUri({ directory: Directory.Cache, path: fileName });
      await FileTransfer.downloadFile({ url, path: uri });
      await Share.share({ title: fallbackName, text: fallbackName, files: [uri], dialogTitle: "Export Audio" });
      return "shared";
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error("Could not prepare audio.");
    const blob = await response.blob();
    downloadBlob(blob, preferredFileName ? fileName : cleanAudioFileName(`${fallbackName}.${mimeExt(blob.type)}`));
    return "downloaded";
  } catch (e) {
    if (e?.name === "AbortError") return "cancelled";
    throw e;
  }
}

async function isNativePlatform() {
  try { const { Capacitor } = await import("@capacitor/core"); return Capacitor.isNativePlatform(); } catch { return false; }
}

async function downloadVerifiedBeatDirect(item) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Sign in again to download this beat.");
  const params = new URLSearchParams({ ownerUid: item.ownerUid || "", campaignId: item.campaignId || "", beatIndex: String(item.beatIndex ?? ""), storagePath: item.storagePath || "" });
  const response = await fetch(`${FN_BASE}/downloadVerifiedBeatFile?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(await response.text() || "Could not download beat.");
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const filenameMatch = disposition.match(/filename="([^"]+)"/i);
  const ext = filenameMatch ? "" : `.${mimeExt(blob.type)}`;
  downloadBlob(blob, filenameMatch?.[1] || `${cleanFileName(item.title, "Beat")}${ext}`);
  return "downloaded";
}

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════ */
export default function Verified() {
  const navigate = useNavigate();
  const [user, setUser]           = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tab, setTab]             = useState("overview");
  const [search, setSearch]       = useState("");
  const [genre, setGenre]         = useState("");
  const [tag, setTag]             = useState("");
  const [sort, setSort]           = useState("newest");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId]     = useState("");
  const [playerItem, setPlayerItem]     = useState(null);
  const [playerClosing, setPlayerClosing] = useState(false);
  const [player, setPlayer]       = useState({ id: "", kind: "", src: "", playing: false, current: 0, duration: 0, loading: false });
  const [toast, setToast]         = useState("");
  const [dotMenu, setDotMenu]     = useState(null);   // item id with open dot-menu
  const [detailItem, setDetailItem] = useState(null); // item for BeatDetailPopup
  const [requestDraft, setRequestDraft] = useState({ title: "", brief: "", requestType: "loops", genres: [], tags: "", references: "", deadline: "" });
  const [requestBusy, setRequestBusy] = useState(false);

  const audioRef          = useRef(null);
  const toastTimer        = useRef(null);
  const lastAvatar        = useRef(null);
  const previewUrlCache   = useRef(new Map());
  const prewarmedPreview  = useRef("");
  const viewed            = useRef(new Set());

  const showToast = (t) => { setToast(t); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(""), 3000); };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u || !u.emailVerified) { navigate("/"); return; }
      setUser(u); setAuthReady(true);
    });
    return () => unsub();
  }, [navigate]);

  const uid = user?.uid;
  usePushAutoRegister(uid, { onTap: (data) => { if (data?.route) navigate(data.route); } });
  const { data: profile } = useLiveDoc(["me", uid], () => doc(db, "users", uid), { enabled: !!uid });
  const isListener    = profile?.verifiedListener === true;
  const isPuller      = profile?.verifiedPuller === true;
  const hasAccess     = isListener || isPuller;
  const roleMeta      = verifiedRoleMeta(profile?.verifiedRole || "");
  const roleFamily    = roleMeta.family;
  const plan          = profile?.subscription?.tier || "free";
  const canCreateRequests = Boolean(roleFamily);
  const requestTypeOptions = roleFamily === "producer"
    ? [["loops","Loops"]]
    : [["beats","Beats"],["loops","Loops"],["both","Both"]];
  const gate = !authReady || profile === undefined ? "loading" : (hasAccess ? "ok" : "denied");

  const staffQ = useQuery({
    queryKey: ["verified","staff-access",uid],
    queryFn:  () => call("checkStaffAccess").then((d) => d || {}),
    enabled:  gate === "ok", retry: false, staleTime: 5 * 60 * 1000
  });
  const isStaff = staffQ.data?.staff === true;

  const requestsQ = useQuery({
    queryKey: ["verified","requests",uid],
    queryFn:  () => call("listCampaignRequests", { limit: 50 }).then((d) => d || {}),
    enabled:  gate === "ok", retry: false, staleTime: 30 * 1000, refetchInterval: 60 * 1000
  });

  useEffect(() => {
    if (!profile || profile.__error) return;
    const key = profile.photoURL || profile.avatarPath || user?.photoURL || "";
    if (key === lastAvatar.current) return;
    lastAvatar.current = key;
    resolveAvatarUrl(profile, user).then(setAvatarUrl).catch(() => setAvatarUrl(""));
  }, [profile, user]);

  const beatsQ = useInfiniteQuery({
    queryKey: ["library","beats","paged",genre,tag],
    queryFn:  ({ pageParam = null }) => call("listApprovedBeats", { pageSize: BEAT_PAGE_SIZE, cursor: pageParam, genre, tag }).then((d) => d || {}),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage?.hasMore ? lastPage.nextCursor : undefined,
    enabled: gate === "ok", refetchInterval: 60000
  });
  const loopsQ = useInfiniteQuery({
    queryKey: ["pool","loops","paged"],
    queryFn:  ({ pageParam = null }) => call("listLiveLoops", { pageSize: LOOP_PAGE_SIZE, cursor: pageParam }).then((d) => d || {}),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage?.hasMore ? lastPage.nextCursor : undefined,
    enabled: gate === "ok" && isPuller, refetchInterval: 60000
  });

  const beats = useMemo(() => {
    const seen = new Set();
    return (beatsQ.data?.pages?.flatMap((p) => p.beats || []) || []).filter((beat) => {
      const id = beat.id || `${beat.ownerUid || ""}:${beat.campaignId || ""}:${beat.beatIndex ?? ""}:${beat.title || ""}`;
      if (seen.has(id)) return false; seen.add(id); return true;
    });
  }, [beatsQ.data]);
  const loops        = useMemo(() => loopsQ.data?.pages?.flatMap((p) => p.loops || []) || [], [loopsQ.data]);
  const activeItems  = tab === "beats" ? beats : loops;
  const activeQuery  = tab === "beats" ? beatsQ : loopsQ;
  const isLoading    = activeQuery.isLoading;
  const isError      = activeQuery.isError;
  const errMsg       = activeQuery.error?.message;
  const canFetchMore = activeQuery.hasNextPage === true;

  const libraryMeta = useMemo(() => {
    const genres = [...new Set(beats.concat(loops).map((x) => x.genre).filter(Boolean))].sort();
    const tags   = [...new Set(beats.flatMap((b) => Array.isArray(b.tags) ? b.tags : []).map(normalizeTag).filter(Boolean))].sort();
    return { genres, tags };
  }, [beats, loops]);

  const filteredItems = useMemo(() => {
    const q    = search.trim().toLowerCase();
    const list = activeItems.filter((item) => {
      if (genre && item.genre !== genre) return false;
      const tags = Array.isArray(item.tags) ? item.tags.map(normalizeTag).filter(Boolean) : [];
      if (tab === "beats" && tag && !tags.includes(tag)) return false;
      if (!q) return true;
      return [item.title, item.genre, item.key, item.bpm, itemHandle(item, tab), ...tags].some((f) => String(f || "").toLowerCase().includes(q));
    });
    return [...list].sort((a, b) => {
      if (sort === "title")    return String(a.title || "").localeCompare(String(b.title || ""));
      if (sort === "producer") return itemHandle(a, tab).localeCompare(itemHandle(b, tab));
      if (sort === "genre")    return String(a.genre || "").localeCompare(String(b.genre || ""));
      return (b.pitchedAt || b.createdAt || 0) - (a.pitchedAt || a.createdAt || 0);
    });
  }, [activeItems, genre, search, sort, tab, tag]);

  const visibleItems    = filteredItems.slice(0, visibleCount);
  const selectedItem    = filteredItems.find((item) => item.id === selectedId) || filteredItems[0] || activeItems[0] || null;
  const activeFilters   = [search && "search", genre && genre, tag && `#${tag}`].filter(Boolean);
  const canShowMoreLocal = visibleItems.length < filteredItems.length;
  const canLoadMore     = canShowMoreLocal || canFetchMore;

  const campaignRequests  = requestsQ.data?.requests || [];
  const requestAnalytics  = requestsQ.data?.analytics || {};
  const myRequests        = useMemo(() => campaignRequests.filter((req) => req.isMine), [campaignRequests]);
  const requestsToday     = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);
    return myRequests.filter((req) => req.createdAt && new Date(req.createdAt).toISOString().slice(0, 10) === todayKey).length;
  }, [myRequests]);

  const { data: inboundSubmissions } = useLiveCollection(
    ["me", uid, "inbound-submissions"],
    () => uid ? query(collection(db, `users/${uid}/inboundSubmissions`), orderBy("submittedAt", "desc"), limit(50)) : null,
    {
      enabled: gate === "ok" && !!roleFamily && (tab === "overview" || tab === "requests"),
      map: (d) => {
        const r = d.data();
        return {
          id: d.id,
          producerName:      r.producerName || "Producer",
          producerInstagram: r.producerInstagram || "",
          beats:             Array.isArray(r.beats) ? r.beats : [],
          beatCount:         r.beatCount || 1,
          creditsSpent:      r.creditsSpent || 1,
          targetRequestId:   r.targetRequestId || "",
          targetRequestTitle: r.targetRequestTitle || "",
          kind:              r.kind || "beats",
          status:            r.status || "pending_review",
          submittedAt:       r.submittedAt?.toMillis ? r.submittedAt.toMillis() : null
        };
      }
    }
  );

  const { data: submittedCampaigns } = useLiveCollection(
    ["me", uid, "submitted-campaigns"],
    () => uid ? query(collection(db, `users/${uid}/campaigns`), where("targetRequestId", "!=", ""), orderBy("targetRequestId"), orderBy("createdAt", "desc"), limit(20)) : null,
    {
      enabled: gate === "ok" && tab === "requests",
      map: (d) => {
        const r = d.data();
        return {
          id: d.id,
          targetRequestId:    r.targetRequestId || "",
          targetRequestTitle: r.targetRequestTitle || "Untitled request",
          targetRequesterRole: r.targetRequesterRole || "",
          beats:  Array.isArray(r.beats) ? r.beats : [],
          status: r.status || "pending_review",
          tier:   r.tier || "free",
          createdAt: r.createdAt?.toMillis ? r.createdAt.toMillis() : null
        };
      }
    }
  );

  async function createRequest() {
    if (requestBusy) return;
    setRequestBusy(true);
    try {
      const res = await call("createCampaignRequest", { ...requestDraft, tags: splitList(requestDraft.tags), references: splitList(requestDraft.references) });
      if (res?.ok) {
        setRequestDraft({ title: "", brief: "", requestType: roleFamily === "producer" ? "loops" : "beats", genres: [], tags: "", references: "", deadline: "" });
        await requestsQ.refetch();
        showToast("Request posted to Verified.");
      }
    } catch (e) {
      showToast(e.message || "Could not post request.");
    } finally {
      setRequestBusy(false);
    }
  }

  function submitToRequest(req) {
    sessionStorage.setItem("pluggurbeats:targetRequest", JSON.stringify(req));
    const mode = req.requestType === "loops" ? "loopRequest" : "request";
    navigate(`/dashboard?${mode}=${encodeURIComponent(req.id)}`);
  }

  useEffect(() => { setVisibleCount(PAGE_SIZE); setSelectedId(""); }, [tab, search, genre, tag, sort]);
  useEffect(() => {
    setRequestDraft((draft) => {
      const allowed = requestTypeOptions.map(([value]) => value);
      if (allowed.includes(draft.requestType)) return draft;
      return { ...draft, requestType: allowed[0] || "loops" };
    });
  }, [roleFamily]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const readAudioTime = () => ({ current: Number.isFinite(audio.currentTime) ? audio.currentTime : 0, duration: Number.isFinite(audio.duration) ? audio.duration : 0 });
    const onTime      = () => setPlayer((p) => p.id && audio.src ? { ...p, ...readAudioTime() } : p);
    const onLoadStart = () => setPlayer((p) => p.id && audio.src ? { ...p, loading: true } : p);
    const onLoaded    = () => setPlayer((p) => p.id && audio.src ? { ...p, ...readAudioTime(), loading: false } : p);
    const onCanPlay   = () => setPlayer((p) => p.id && audio.src ? { ...p, loading: false, duration: readAudioTime().duration || p.duration || 0 } : p);
    const onPlaying   = () => setPlayer((p) => ({ ...p, playing: true, loading: false }));
    const onWaiting   = () => setPlayer((p) => p.id && audio.src ? { ...p, loading: true } : p);
    const onPause     = () => setPlayer((p) => ({ ...p, playing: false }));
    const onEnded     = () => setPlayer((p) => ({ ...p, playing: false, current: 0 }));
    const onError     = () => setPlayer((p) => p.id && audio.src ? { ...p, playing: false, loading: false } : p);
    audio.addEventListener("timeupdate",     onTime);
    audio.addEventListener("durationchange", onTime);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("loadstart",      onLoadStart);
    audio.addEventListener("canplay",        onCanPlay);
    audio.addEventListener("playing",        onPlaying);
    audio.addEventListener("waiting",        onWaiting);
    audio.addEventListener("pause",          onPause);
    audio.addEventListener("ended",          onEnded);
    audio.addEventListener("error",          onError);
    return () => {
      audio.removeEventListener("timeupdate",     onTime);
      audio.removeEventListener("durationchange", onTime);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("loadstart",      onLoadStart);
      audio.removeEventListener("canplay",        onCanPlay);
      audio.removeEventListener("playing",        onPlaying);
      audio.removeEventListener("waiting",        onWaiting);
      audio.removeEventListener("pause",          onPause);
      audio.removeEventListener("ended",          onEnded);
      audio.removeEventListener("error",          onError);
    };
  }, [gate]); // re-run once gate === "ok" so the <audio> element exists and listeners actually attach

  async function resolvePreviewUrl(item, kind) {
    const normalizedKind = kind === "loops" ? "loop" : "beat";
    const cacheKey = normalizedKind === "loop"
      ? `loop:${item.id}`
      : `beat:${item.ownerUid}:${item.campaignId}:${item.beatIndex}`;
    const cached = previewUrlCache.current.get(cacheKey);
    if (cached) return cached;
    const payload = normalizedKind === "loop"
      ? { kind: "loop", loopId: item.id }
      : { kind: "beat", ownerUid: item.ownerUid, campaignId: item.campaignId, beatIndex: item.beatIndex, storagePath: item.storagePath || "" };
    const res = await call("getVerifiedPreviewUrl", payload);
    if (!res?.url) throw new Error("Preview is not available for this track.");
    previewUrlCache.current.set(cacheKey, res.url);
    if (previewUrlCache.current.size > 12) { const oldest = previewUrlCache.current.keys().next().value; previewUrlCache.current.delete(oldest); }
    return res.url;
  }

  useEffect(() => {
    const first = visibleItems[0] || selectedItem;
    if (!first || !hasAccess) return;
    const normalizedKind = tab === "loops" ? "loop" : "beat";
    const cacheKey = normalizedKind === "loop" ? `loop:${first.id}` : `beat:${first.ownerUid}:${first.campaignId}:${first.beatIndex}`;
    if (previewUrlCache.current.has(cacheKey) || prewarmedPreview.current === cacheKey) return;
    let cancelled = false;
    prewarmedPreview.current = cacheKey;
    const run = () => {
      resolvePreviewUrl(first, tab).then((url) => {
        if (cancelled || !url) return;
        const audio = audioRef.current;
        if (audio && !player.src && audio.src !== url) { audio.preload = "metadata"; audio.src = url; audio.load(); }
      }).catch(() => { if (prewarmedPreview.current === cacheKey) prewarmedPreview.current = ""; });
    };
    const idle = window.requestIdleCallback ? window.requestIdleCallback(run, { timeout: 1200 }) : window.setTimeout(run, 250);
    return () => {
      cancelled = true;
      if (prewarmedPreview.current === cacheKey && !previewUrlCache.current.has(cacheKey)) prewarmedPreview.current = "";
      if (window.cancelIdleCallback && typeof idle === "number") window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, [hasAccess, selectedItem?.id, tab, visibleItems, player.src]);

  async function togglePlayback(item, kind = tab, forcePlay = false) {
    const audio = audioRef.current;
    if (!audio) return;
    const id = item.id;
    setPlayerItem({ ...item, kind });
    setSelectedId(id);
    if (!forcePlay && player.id === id && !audio.paused) {
      setPlayer((p) => p.id === id ? { ...p, playing: false, loading: false } : p);
      audio.pause(); return;
    }
    setPlayer((p) => ({ ...p, id, kind, loading: true, playing: false }));
    let playUrl = "";
    try { playUrl = await resolvePreviewUrl(item, kind); } catch (e) {
      showToast(e.message || "Could not load preview.");
      setPlayer((p) => ({ ...p, id, kind, loading: false, playing: false })); return;
    }
    if (player.id !== id || player.src !== playUrl) {
      audio.pause();
      if (audio.src !== playUrl) { audio.removeAttribute("src"); audio.load(); audio.src = playUrl; }
      audio.currentTime = 0;
      setPlayer({ id, kind, src: playUrl, playing: false, current: 0, duration: 0, loading: true });
      if (kind === "beats") markBeatView(item); else markLoopView(item);
    }
    audio.play()
      .then(() => setPlayer((p) => p.id === id ? { ...p, playing: !audio.paused, loading: false, current: Number.isFinite(audio.currentTime) ? audio.currentTime : p.current, duration: Number.isFinite(audio.duration) ? audio.duration : p.duration } : p))
      .catch(() => setPlayer((p) => ({ ...p, loading: false, playing: false })));
  }

  function seekPlayback(item, percent) {
    const audio = audioRef.current;
    if (!audio || player.id !== item.id || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const next    = Math.min(100, Math.max(0, Number(percent) || 0));
    const current = audio.duration * (next / 100);
    audio.currentTime = current;
    setPlayer((p) => p.id === item.id ? { ...p, current, duration: audio.duration } : p);
  }

  function chooseTrack(item, kind) { setSelectedId(item.id); setPlayerItem({ ...item, kind }); togglePlayback(item, kind, true); }

  function loadMore() {
    if (canShowMoreLocal) { setVisibleCount((n) => n + PAGE_SIZE); return; }
    if (canFetchMore && !activeQuery.isFetchingNextPage) activeQuery.fetchNextPage();
  }

  async function doPull(loop, btn) {
    btn.disabled = true;
    try {
      const res     = await call("pullLoop", { loopId: loop.id });
      const outcome = await exportAudio(res.url, loop.title || "Loop", "downloaded");
      if (outcome === "shared") showToast("Export sheet opened. A split claim was created with the maker.");
      else if (outcome === "downloaded") showToast("Loop export started. A split claim was created with the maker.");
      loopsQ.refetch();
    } catch (e) { showToast(e.message || "Could not pull loop."); } finally { btn.disabled = false; }
  }

  function markBeatView(b) {
    if (!b?.ownerUid || viewed.current.has("b" + b.id)) return;
    viewed.current.add("b" + b.id);
    call("recordLibraryView", { kind: "beat", ownerUid: b.ownerUid, campaignId: b.campaignId, beatIndex: b.beatIndex, title: b.title }).catch(() => {});
  }
  function markLoopView(l) {
    if (!l?.id || viewed.current.has("l" + l.id)) return;
    viewed.current.add("l" + l.id);
    call("recordLibraryView", { kind: "loop", loopId: l.id }).catch(() => {});
  }

  async function doDownloadBeat(b, btn) {
    btn.disabled = true;
    try {
      let outcome = "downloaded";
      if (await isNativePlatform()) {
        const res = await call("downloadLibraryBeat", { ownerUid: b.ownerUid, campaignId: b.campaignId, beatIndex: b.beatIndex, storagePath: b.storagePath || "" });
        outcome = await exportAudio(res.url, b.title || "Beat", "downloaded", storageFileName(b.storagePath));
      } else {
        outcome = await downloadVerifiedBeatDirect(b);
      }
      if (outcome === "shared") showToast("Export sheet opened. The producer can see this in analytics.");
      else if (outcome === "downloaded") showToast("Export started. The producer can see this in analytics.");
    } catch (e) { showToast(e.message || "Could not download."); } finally { btn.disabled = false; }
  }

  function clearFilters() { setSearch(""); setGenre(""); setTag(""); }
  function switchTab(next) { setTab(next); clearFilters(); setSidebarOpen(false); setDotMenu(null); }

  // Close dot menu on outside click
  useEffect(() => {
    if (!dotMenu) return;
    const handler = () => setDotMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [dotMenu]);

  /* ── gate screens ── */
  if (gate === "loading") {
    return (
      <div className="grid min-h-screen place-items-center bg-[#131313] text-[#99907c]">
        <div className="flex items-center gap-3 text-sm">
          <span className="h-4 w-4 animate-spin rounded-none border-2 border-[#f2ca50]/30 border-t-[#f2ca50]" />
          Checking access...
        </div>
      </div>
    );
  }
  if (gate === "denied") {
    return (
      <div className="grid min-h-screen place-items-center bg-[#131313] px-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="grid h-16 w-16 place-items-center border border-[#262626] bg-[#0e0e0e] text-[#99907c]"><ShieldCheck size={28} /></span>
          <h2 className="text-2xl font-semibold text-[#e8e0d0]">Verified access required</h2>
          <p className="max-w-sm text-sm leading-relaxed text-[#99907c]">PluggUrBeat Verified is only for artists, A&Rs, and producers verified by our team. Paid plans do not grant Verified library access. Contact us to request verification.</p>
          <a href="/"><GoldBtn className="mt-2"><ArrowLeft size={16} /> Back to PluggurBeats</GoldBtn></a>
        </div>
      </div>
    );
  }

  const initial = avatarInitial(profile?.displayName || user?.email);

  return (
    <div className="min-h-screen bg-[#131313] font-sans text-[#e8e0d0]">
      <audio ref={audioRef} preload="none" className="hidden" />

      {/* sidebar backdrop */}
      {sidebarOpen && <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* beat detail popup */}
      {detailItem && (
        <BeatDetailPopup
          item={detailItem}
          player={player}
          onToggle={() => togglePlayback(detailItem, detailItem._kind || tab, true)}
          onClose={() => setDetailItem(null)}
          onExport={(btn) => doDownloadBeat(detailItem, btn)}
        />
      )}

      <div className="flex min-h-screen">
        <LibrarySidebar
          open={sidebarOpen}
          tab={tab}
          isPuller={isPuller}
          beats={beats}
          loops={loops}
          genres={libraryMeta.genres}
          tags={libraryMeta.tags}
          genre={genre}
          tag={tag}
          switchTab={switchTab}
          setGenre={(v) => { setGenre(v); setSidebarOpen(false); }}
          setTag={(v) => { setTag(v); setSidebarOpen(false); }}
          clearFilters={clearFilters}
        />

        <div className="min-w-0 flex-1 lg:pl-[276px]">
          {/* ── header ── */}
          <header
            className="sticky top-0 z-30 flex items-center gap-3 border-b border-[#262626] bg-[#131313]/70 px-4 py-2.5 backdrop-blur-xl sm:px-6 lg:px-8"
            style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.625rem)" }}
          >
            <IconBtn className="lg:hidden" onClick={() => setSidebarOpen(true)}><Menu size={18} /></IconBtn>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-[#e8e0d0]">
                {tab === "overview" ? "Overview" : tab === "requests" ? "Verified Requests" : tab === "beats" ? "Verified Beats" : "Loop Pool"}
              </div>
              <div className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-[#99907c]">
                {tab === "overview"
                  ? `${beats.length} beats · ${(inboundSubmissions || []).length} submissions`
                  : tab === "requests"
                  ? `${campaignRequests.length} open`
                  : `${filteredItems.length} visible · ${activeItems.length}${canFetchMore ? "+" : ""} loaded`}
              </div>
            </div>
            <button
              className="hidden items-center gap-2 rounded-none border border-[#262626] bg-[#0e0e0e] px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#99907c] transition hover:border-[#4d4635] hover:text-[#e8e0d0] sm:flex"
              onClick={() => activeQuery.refetch()}
            >
              <RefreshCw size={13} /> Refresh
            </button>
            <button
              className="hidden items-center gap-2 rounded-none border border-[#4d4635] bg-[#f2ca50]/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#f2ca50] transition hover:bg-[#f2ca50]/15 sm:flex"
              onClick={() => navigate("/dashboard")}
            >
              <ArrowLeft size={13} /> Dashboard
            </button>
            {isStaff && (
              <button
                className="hidden items-center gap-2 rounded-none border border-[#262626] bg-[#0e0e0e] px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#99907c] transition hover:border-[#4d4635] hover:text-[#e8e0d0] sm:flex"
                onClick={() => navigate("/staff")}
              >
                <ShieldCheck size={13} /> Staff
              </button>
            )}
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-none border border-[#262626] bg-[#0e0e0e] font-semibold text-sm text-[#f2ca50]"
              style={avatarUrl ? { backgroundImage: `url("${avatarUrl}")`, backgroundSize: "cover" } : undefined}
            >
              {avatarUrl ? "" : initial}
            </span>
            <IconBtn onClick={() => signOut(auth).then(() => navigate("/"))}><LogOut size={17} /></IconBtn>
          </header>

          {/* ── main content ── */}
          <main
            className="px-4 py-5 sm:px-6 lg:px-8 lg:py-7"
            style={{ paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + ${playerItem ? "12rem" : "7rem"})` }}
          >
            {tab === "overview" ? (
              <OverviewDashboard
                profile={profile}
                beats={beats}
                myRequests={myRequests}
                inboundSubmissions={inboundSubmissions || []}
                analytics={requestAnalytics}
                requestsToday={requestsToday}
                onGoBeats={() => switchTab("beats")}
                onGoRequests={() => switchTab("requests")}
              />
            ) : tab === "requests" ? (
              <RequestHub
                profile={profile}
                avatarUrl={avatarUrl}
                canCreate={canCreateRequests}
                roleMeta={roleMeta}
                isAr={isArRole(profile?.verifiedRole || "")}
                requestTypeOptions={requestTypeOptions}
                draft={requestDraft}
                setDraft={setRequestDraft}
                busy={requestBusy}
                onCreate={createRequest}
                requests={campaignRequests}
                myRequests={myRequests}
                requestsToday={requestsToday}
                analytics={requestAnalytics}
                submittedCampaigns={submittedCampaigns || []}
                inboundSubmissions={inboundSubmissions || []}
                loading={requestsQ.isLoading}
                error={requestsQ.error?.message || ""}
                plan={plan}
                onSubmitRequest={submitToRequest}
                player={player}
                onPlayBeat={(b) => chooseTrack({ ...b, id: `beat:${b.ownerUid}:${b.campaignId}:${b.beatIndex}` }, "beats")}
                onDownloadBeat={(b, btn) => doDownloadBeat({ ...b, id: `beat:${b.ownerUid}:${b.campaignId}:${b.beatIndex}` }, btn)}
              />
            ) : (
              <>
                <div className="mb-5 border-b border-[#262626] pb-5">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#f2ca50]">
                    <span className="mr-2 inline-block h-px w-5 bg-[#f2ca50]/70 align-middle" />
                    {tab === "beats" ? "Library" : "Producer Pool"}
                  </div>
                  <div className="flex items-end justify-between gap-4">
                    <h1 className="text-2xl font-semibold tracking-tight text-[#e8e0d0]">
                      {tab === "beats" ? "Verified Beats" : "Loop Pool"}
                    </h1>
                    <div className="flex items-center gap-1.5 pb-0.5 font-mono text-[10px] text-[#4d4635]">
                      <span>{filteredItems.length} shown</span>
                      <span>·</span>
                      <span>{activeItems.length}{canFetchMore ? "+" : ""} total</span>
                    </div>
                  </div>
                </div>

                <Toolbar
                  tab={tab}
                  search={search} setSearch={setSearch}
                  genre={genre}   setGenre={setGenre}
                  tag={tag}       setTag={setTag}
                  sort={sort}     setSort={setSort}
                  genres={libraryMeta.genres}
                  tags={libraryMeta.tags}
                  activeFilters={activeFilters}
                  clearFilters={clearFilters}
                />

                <section className="overflow-hidden border border-[#262626] bg-[#0e0e0e]">
                  <div className="hidden border-b border-[#262626] px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#99907c] lg:flex lg:items-center lg:gap-4">
                    <div className="w-8 shrink-0 text-center">#</div>
                    <div className="flex-1">Title &amp; Info</div>
                    <div className="w-8 shrink-0 text-right">Actions</div>
                  </div>

                  {isLoading && <LoadingRows />}
                  {isError && <EmptyState icon={<ShieldCheck size={24} />} title="Could not load library" body={errMsg || "Try refreshing the library."} />}
                  {!isLoading && !isError && filteredItems.length === 0 && (
                    <EmptyState
                      icon={tab === "beats" ? <Music2 size={24} /> : <Disc3 size={24} />}
                      title={activeItems.length ? "No results match" : tab === "beats" ? "No approved beats yet" : "No live loops yet"}
                      body={activeItems.length ? "Clear a filter or search for a different producer, genre, tag, BPM, or key." : "New approved music will land here automatically."}
                      action={activeFilters.length ? <GhostBtn onClick={clearFilters}>Clear filters</GhostBtn> : null}
                    />
                  )}
                  {!isLoading && !isError && visibleItems.length > 0 && (
                    <div className="divide-y divide-[#262626]">
                      {visibleItems.map((item, index) => (
                        <LibraryRow
                          key={item.id}
                          item={item}
                          index={index}
                          tab={tab}
                          selected={selectedItem?.id === item.id}
                          onSelect={() => chooseTrack(item, tab)}
                          player={player}
                          dotMenuOpen={dotMenu === item.id}
                          onDotMenu={(e) => { e.stopPropagation(); setDotMenu(dotMenu === item.id ? null : item.id); }}
                          onExport={(btn) => { setDotMenu(null); tab === "beats" ? doDownloadBeat(item, btn) : doPull(item, btn); }}
                          onMoreInfo={() => { setDotMenu(null); setDetailItem({ ...item, _kind: tab }); }}
                        />
                      ))}
                    </div>
                  )}
                </section>

                {!isLoading && !isError && canLoadMore && (
                  <div className="mt-4 flex justify-center">
                    <GhostBtn onClick={loadMore} disabled={activeQuery.isFetchingNextPage}>
                      {activeQuery.isFetchingNextPage ? "Loading..." : canShowMoreLocal ? `Show ${Math.min(PAGE_SIZE, filteredItems.length - visibleItems.length)} more` : "Load more from library"}
                    </GhostBtn>
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      </div>

      {/* bottom player */}
      {playerItem && (
        <BottomPlayer
          item={playerItem}
          player={player}
          closing={playerClosing}
          onToggle={() => togglePlayback(playerItem, playerItem.kind || tab)}
          onSeek={(pct) => seekPlayback(playerItem, pct)}
          onExport={(btn) => playerItem.kind === "loops" ? doPull(playerItem, btn) : doDownloadBeat(playerItem, btn)}
          onClose={() => {
            audioRef.current?.pause();
            setPlayerClosing(true);
            setTimeout(() => { setPlayerItem(null); setPlayerClosing(false); }, 260);
          }}
        />
      )}

      {/* toast */}
      <div className={`pointer-events-none fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-none border border-[#4d4635] bg-[#0e0e0e] px-5 py-3 text-sm font-medium text-[#e8e0d0] shadow-lg transition-[opacity,transform] duration-260 lg:bottom-6 ${toast ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}>
        {toast}
      </div>

      {/* bottom nav */}
      <nav
        className="fixed inset-x-0 bottom-0 z-50 flex border-t border-[#262626] bg-[#131313]/95 backdrop-blur-xl lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {[
          ["overview", <BarChart2 size={19} />, "Overview"],
          ["requests", <Send size={19} />, "Requests"],
          ["beats",    <Music2 size={19} />, "Beats"],
          ...(isPuller ? [["loops", <Disc3 size={19} />, "Loops"]] : []),
        ].map(([t, Icon, label]) => (
          <button
            key={t}
            onClick={() => switchTab(t)}
            className={`flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 transition-colors active:scale-[0.94] ${tab === t ? "text-[#f2ca50]" : "text-[#99907c]"}`}
          >
            <span className={`flex h-7 w-12 items-center justify-center transition-colors ${tab === t ? "bg-[#f2ca50]/12" : ""}`}>{Icon}</span>
            <span className="text-[9px] font-medium leading-none tracking-tight uppercase">{label}</span>
          </button>
        ))}
        <button onClick={() => setSidebarOpen(true)} className="flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 text-[#99907c] transition-colors active:scale-[0.94]">
          <span className="flex h-7 w-12 items-center justify-center"><Filter size={19} /></span>
          <span className="text-[9px] font-medium leading-none tracking-tight uppercase">Filters</span>
        </button>
        {isStaff && (
          <button onClick={() => navigate("/staff")} className="flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 text-[#99907c] transition-colors active:scale-[0.94]">
            <span className="flex h-7 w-12 items-center justify-center"><ShieldCheck size={19} /></span>
            <span className="text-[9px] font-medium leading-none tracking-tight uppercase">Staff</span>
          </button>
        )}
        <button onClick={() => navigate("/dashboard")} className="flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 text-[#99907c] transition-colors active:scale-[0.94]">
          <span className="flex h-7 w-12 items-center justify-center"><ArrowLeft size={19} /></span>
          <span className="text-[9px] font-medium leading-none tracking-tight uppercase">Studio</span>
        </button>
      </nav>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   OVERVIEW DASHBOARD
═══════════════════════════════════════════════════════════════ */
function StatCard({ value, label, sub, accent }) {
  return (
    <div className="border border-[#262626] bg-[#0e0e0e] p-4">
      <div className={`text-2xl font-semibold tabular-nums ${accent ? "text-[#f2ca50]" : "text-[#e8e0d0]"}`}>{value}</div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[#99907c]">{label}</div>
      {sub && <div className="mt-0.5 text-[11px] text-[#4d4635]">{sub}</div>}
    </div>
  );
}

function OverviewDashboard({ profile, beats, myRequests, inboundSubmissions, analytics, requestsToday, onGoBeats, onGoRequests }) {
  const totalCreditsSpent  = inboundSubmissions.reduce((s, r) => s + (r.creditsSpent || 0), 0);
  const totalBeatsReceived = inboundSubmissions.reduce((s, r) => s + (r.beatCount || 0), 0);
  const approved           = analytics.mineApproved || 0;
  const totalSubs          = analytics.mineSubmissions || inboundSubmissions.length;
  const approvalRate       = totalSubs > 0 ? Math.round((approved / totalSubs) * 100) : null;

  const topGenre = useMemo(() => {
    const map = new Map();
    inboundSubmissions.forEach((s) => s.beats.forEach((b) => { if (b.genre) map.set(b.genre, (map.get(b.genre) || 0) + 1); }));
    let top = null, max = 0;
    map.forEach((count, genre) => { if (count > max) { max = count; top = genre; } });
    return top;
  }, [inboundSubmissions]);

  const recentSubs = inboundSubmissions.slice(0, 5);
  const name       = profile?.displayName?.split(" ")[0] || "there";

  return (
    <div className="mx-auto max-w-3xl">
      {/* welcome */}
      <div className="mb-6 border-b border-[#262626] pb-5">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#f2ca50]">
          <span className="mr-2 inline-block h-px w-5 bg-[#f2ca50]/70 align-middle" />
          Verified Studio
        </div>
        <h1 className="text-2xl font-semibold text-[#e8e0d0]">Good to see you, {name}</h1>
        <p className="mt-1 text-[13px] text-[#99907c]">Here's your Verified dashboard at a glance.</p>
      </div>

      {/* stat grid */}
      <div className="mb-6 grid grid-cols-2 gap-px border border-[#262626] bg-[#262626] sm:grid-cols-3">
        <StatCard value={beats.length} label="Beats in Library" sub="Approved catalog" />
        <StatCard value={myRequests.length} label="Active Requests" sub={`${requestsToday} posted today`} />
        <StatCard value={analytics.mineViews || 0} label="Total Views" sub="On your requests" />
        <StatCard value={inboundSubmissions.length} label="Submissions Received" sub={`${totalBeatsReceived} beats total`} accent />
        <StatCard value={totalCreditsSpent} label="Credits Spent on You" sub="By producers reaching you" accent />
        <StatCard
          value={approvalRate !== null ? `${approvalRate}%` : "—"}
          label="Approval Rate"
          sub={approved > 0 ? `${approved} approved` : "No approvals yet"}
        />
      </div>

      {/* top genre chip */}
      {topGenre && (
        <div className="mb-6 flex items-center gap-3 border border-[#262626] bg-[#0e0e0e] px-4 py-3">
          <TrendingUp size={14} className="shrink-0 text-[#f2ca50]" />
          <span className="text-[13px] text-[#99907c]">Top genre in your submissions:</span>
          <span className="rounded-none border border-[#4d4635] bg-[#1c1b1b] px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-[#f2ca50]">{topGenre}</span>
        </div>
      )}

      {/* recent submissions */}
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#99907c]">Recent Submissions</span>
        {inboundSubmissions.length > 5 && (
          <button onClick={onGoRequests} className="flex items-center gap-1 text-[11px] text-[#f2ca50] hover:underline">
            View all <ArrowRight size={11} />
          </button>
        )}
      </div>

      {inboundSubmissions.length === 0 ? (
        <div className="flex flex-col items-center gap-4 border border-[#262626] bg-[#0e0e0e] py-12 text-center">
          <Music2 size={28} className="text-[#4d4635]" />
          <div>
            <div className="text-[14px] font-semibold text-[#e8e0d0]">No submissions yet</div>
            <p className="mt-1 text-[13px] text-[#99907c]">Post a request and producers will send you beats.</p>
          </div>
          <GoldBtn onClick={onGoRequests}>Post a Request <ArrowRight size={14} /></GoldBtn>
        </div>
      ) : (
        <div className="divide-y divide-[#262626] border border-[#262626]">
          {recentSubs.map((s) => {
            const date   = s.submittedAt ? new Date(s.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
            const handle = s.producerInstagram ? (s.producerInstagram.startsWith("@") ? s.producerInstagram : `@${s.producerInstagram}`) : null;
            return (
              <div key={s.id} className="flex items-center gap-3 bg-[#0e0e0e] px-4 py-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-none border border-[#262626] bg-[#131313] font-mono text-[11px] text-[#f2ca50]">
                  {(s.producerName || "P")[0].toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-[#e8e0d0]">{s.producerName}</span>
                    {handle && <span className="font-mono text-[10px] text-[#99907c]">{handle}</span>}
                  </div>
                  <div className="truncate text-[11px] text-[#99907c]">
                    {s.beatCount} beat{s.beatCount !== 1 ? "s" : ""} · Re: {s.targetRequestTitle || "your request"}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {date && <span className="font-mono text-[10px] text-[#4d4635]">{date}</span>}
                  <span className="font-mono text-[10px] text-[#99907c]">{s.creditsSpent} cr</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* quick actions */}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <GoldBtn className="w-full justify-center" onClick={onGoRequests}>
          <MessageSquarePlus size={14} /> Post Request
        </GoldBtn>
        <GhostBtn className="w-full justify-center" onClick={onGoBeats}>
          <Music2 size={14} /> Browse Beats
        </GhostBtn>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   BEAT DETAIL POPUP (3-dot → More Info)
═══════════════════════════════════════════════════════════════ */
function BeatDetailPopup({ item, player, onToggle, onClose, onExport }) {
  const bars     = useMemo(() => waveformBars(item.id || item.title || "track", 60), [item.id, item.title]);
  const isActive = player.id === item.id;
  const playing  = isActive && player.playing;
  const progress = isActive && player.duration ? Math.min(100, (player.current / player.duration) * 100) : 0;
  const handle   = itemHandle(item, item._kind || "beats");
  const tags     = Array.isArray(item.tags) ? item.tags.map(normalizeTag).filter(Boolean).slice(0, 5) : [];
  const genreGrad = accentFor(item.genre);
  const genreHex  = genreGrad.match(/#[a-fA-F0-9]{6}/)?.[0] || null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md border border-[#262626] bg-[#0e0e0e] sm:mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* top accent bar from genre */}
        <div className="h-0.5 w-full" style={{ background: genreGrad }} />

        {/* header */}
        <div className="flex items-start justify-between border-b border-[#262626] px-5 py-4">
          <div className="min-w-0">
            <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#99907c]">Beat Detail</div>
            <div className="mt-0.5 truncate text-[15px] font-semibold text-[#e8e0d0]">{item.title || "Untitled"}</div>
            <div className="font-mono text-[11px] text-[#99907c]">{handle}</div>
          </div>
          <button onClick={onClose} className="ml-3 shrink-0 grid h-7 w-7 place-items-center border border-[#262626] text-[#99907c] hover:border-[#4d4635] hover:text-[#e8e0d0] transition">
            <X size={14} />
          </button>
        </div>

        {/* waveform + play */}
        <div className="border-b border-[#262626] px-5 py-4">
          {/* dual-layer waveform — played side uses clipPath for smooth animation */}
          <div className="relative h-14 select-none">
            {/* base bars — unplayed */}
            <div className="absolute inset-0 flex items-end gap-[2px]">
              {bars.map((h, i) => (
                <div key={i} className="w-[2px] shrink-0" style={{ height: `${h}%`, background: "#3a3a3a" }} />
              ))}
            </div>
            {/* played bars — clipped from right */}
            <div
              className="absolute inset-0 flex items-end gap-[2px]"
              style={{ clipPath: `inset(0 ${100 - progress}% 0 0)` }}
            >
              {bars.map((h, i) => (
                <div key={i} className="w-[2px] shrink-0" style={{ height: `${h}%`, background: genreHex || "#f2ca50" }} />
              ))}
            </div>
            {/* playhead */}
            {isActive && progress > 0 && (
              <div
                className="absolute inset-y-0 w-px bg-white/25"
                style={{ left: `${progress}%` }}
              />
            )}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="font-mono text-[10px] text-[#99907c]">
              {isActive ? `${fmtClock(player.current)} / ${player.duration ? fmtClock(player.duration) : "--:--"}` : "--:--"}
            </span>
            <button
              onClick={onToggle}
              className="flex h-8 w-8 items-center justify-center border border-[#f2ca50] bg-[#f2ca50]/10 text-[#f2ca50] transition hover:bg-[#f2ca50]/20"
            >
              {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
            </button>
          </div>
        </div>

        {/* metadata */}
        <div className="border-b border-[#262626] px-5 py-4">
          <div className="grid grid-cols-3 gap-3">
            {item.bpm && (
              <div className="border border-[#262626] bg-[#131313] px-3 py-2">
                <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#99907c]">Tempo</div>
                <div className="mt-0.5 text-[14px] font-semibold text-[#e8e0d0]">{item.bpm} <span className="text-[10px] text-[#99907c]">BPM</span></div>
              </div>
            )}
            {item.key && (
              <div className="border border-[#262626] bg-[#131313] px-3 py-2">
                <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#99907c]">Key</div>
                <div className="mt-0.5 text-[13px] font-semibold text-[#e8e0d0]">{item.key}</div>
              </div>
            )}
            {item.genre && (
              <div className="border border-[#262626] bg-[#131313] px-3 py-2">
                <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#99907c]">Genre</div>
                <div
                  className="mt-0.5 text-[12px] font-semibold uppercase tracking-wide"
                  style={{ color: genreHex || "#f2ca50" }}
                >{item.genre}</div>
              </div>
            )}
          </div>

          {tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span key={t} className="rounded-none border border-[#4d4635] bg-[#1c1b1b] px-2 py-0.5 font-mono text-[10px] text-[#f2ca50]">#{t}</span>
              ))}
            </div>
          )}
        </div>

        {/* producer info */}
        {(item.producer?.name || handle) && (
          <div className="border-b border-[#262626] px-5 py-3">
            <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#99907c]">Producer</div>
            <div className="mt-1 text-[13px] text-[#e8e0d0]">{item.producer?.name || handle}</div>
            {item.producer?.instagram && (
              <div className="font-mono text-[11px] text-[#99907c]">
                {item.producer.instagram.startsWith("@") ? item.producer.instagram : `@${item.producer.instagram}`}
              </div>
            )}
          </div>
        )}

        {/* actions */}
        <div className="flex gap-3 px-5 py-4">
          <GoldBtn
            className="flex-1 justify-center"
            onClick={(e) => onExport(e.currentTarget)}
          >
            <Share2 size={14} /> Export
          </GoldBtn>
          <GhostBtn className="flex-1 justify-center" onClick={onClose}>
            Close
          </GhostBtn>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SIDEBAR
═══════════════════════════════════════════════════════════════ */
function LibrarySidebar({ open, tab, isPuller, beats, loops, genres, tags, genre, tag, switchTab, setGenre, setTag, clearFilters }) {
  const genreCounts = useMemo(() => {
    const map = new Map();
    beats.concat(loops).forEach((item) => { if (item.genre) map.set(item.genre, (map.get(item.genre) || 0) + 1); });
    return map;
  }, [beats, loops]);

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 flex w-[276px] flex-col border-r border-[#262626] bg-[#0e0e0e]/95 px-4 py-5 backdrop-blur-xl transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.25rem)" }}
    >
      <div className="mb-6 flex items-center justify-between px-2">
        <div className="flex items-center gap-2.5 font-mono text-sm uppercase tracking-[0.14em] text-[#f2ca50]"><EqBars /> Verified</div>
        <button className="grid h-7 w-7 place-items-center border border-[#262626] text-[#99907c] hover:text-[#e8e0d0] transition lg:hidden" onClick={() => switchTab(tab)}><X size={15} /></button>
      </div>

      <SidebarSection title="Browse">
        <SidebarButton active={tab === "overview"}  icon={<BarChart2 size={15} />} label="Overview"  onClick={() => switchTab("overview")} />
        <SidebarButton active={tab === "requests"}  icon={<Send size={15} />}      label="Requests"  onClick={() => switchTab("requests")} />
        <SidebarButton active={tab === "beats"}     icon={<Music2 size={15} />}    label="Beats"     count={beats.length} onClick={() => switchTab("beats")} />
        {isPuller && <SidebarButton active={tab === "loops"} icon={<Disc3 size={15} />} label="Loop Pool" count={loops.length} onClick={() => switchTab("loops")} />}
      </SidebarSection>

      <SidebarSection title="Genres">
        <SidebarButton active={!genre} icon={<Library size={15} />} label="All genres" count={beats.length + loops.length} onClick={() => setGenre("")} />
        {genres.slice(0, 12).map((g) => (
          <SidebarButton key={g} active={genre === g} swatch={accentFor(g)} label={g} count={genreCounts.get(g) || 0} onClick={() => setGenre(g)} />
        ))}
      </SidebarSection>

      {tab === "beats" && tags.length > 0 && (
        <SidebarSection title="Tags">
          <div className="flex flex-wrap gap-1.5 px-1">
            {tags.slice(0, 24).map((t) => (
              <button
                key={t}
                onClick={() => setTag(tag === t ? "" : t)}
                className={`rounded-none border px-2 py-1 font-mono text-[10px] transition ${tag === t ? "border-[#f2ca50] bg-[#f2ca50]/12 text-[#f2ca50]" : "border-[#262626] bg-[#131313] text-[#99907c] hover:border-[#4d4635] hover:text-[#e8e0d0]"}`}
              >#{t}</button>
            ))}
          </div>
        </SidebarSection>
      )}

      <div className="mt-auto border border-[#262626] bg-[#131313] p-3">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-[#e8e0d0]"><ShieldCheck size={13} className="text-[#f2ca50]" /> Verified access</div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-[#99907c]">Approved beats and live loops refresh automatically as the catalog grows.</p>
        <button onClick={clearFilters} className="mt-3 text-[12px] font-semibold text-[#f2ca50] hover:underline">Reset library filters</button>
      </div>
    </aside>
  );
}

/* ═══════════════════════════════════════════════════════════════
   REQUEST HUB
═══════════════════════════════════════════════════════════════ */
function RequestHub({ profile, avatarUrl, canCreate, roleMeta, isAr, requestTypeOptions, draft, setDraft, busy, onCreate, requests, myRequests, requestsToday = 0, analytics, loading, error, plan, onSubmitRequest, submittedCampaigns = [], inboundSubmissions = [], player, onPlayBeat, onDownloadBeat }) {
  const name        = profile?.displayName || "Verified user";
  const initial     = avatarInitial(name);
  const DAILY_LIMIT = 5;
  const limitReached = requestsToday >= DAILY_LIMIT;
  const remaining    = Math.max(0, DAILY_LIMIT - requestsToday);
  const canPost      = canCreate && !limitReached && draft.title.trim().length >= 4 && draft.brief.trim().length >= 20;
  const roleLabel    = roleMeta.label || "No role";

  const toggleGenre = (genre) => {
    setDraft((d) => {
      const current = Array.isArray(d.genres) ? d.genres : [];
      return { ...d, genres: current.includes(genre) ? current.filter((g) => g !== genre) : [...current, genre].slice(0, 6) };
    });
  };

  return (
    <div className="mx-auto max-w-3xl">
      {/* page header */}
      <div className="mb-6 border-b border-[#262626] pb-5">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#f2ca50]">
          <span className="mr-2 inline-block h-px w-5 bg-[#f2ca50]/70 align-middle" />
          Requests
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[#e8e0d0]">Verified Requests</h1>
            <p className="mt-1 text-[13px] text-[#99907c]">A&Rs, artists, and producers post what they need. Contact details stay private.</p>
          </div>
          <div className="hidden shrink-0 items-center gap-2.5 sm:flex">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-none border border-[#262626] bg-[#0e0e0e] font-semibold text-sm text-[#f2ca50]"
              style={avatarUrl ? { backgroundImage: `url("${avatarUrl}")`, backgroundSize: "cover" } : undefined}
            >{avatarUrl ? "" : initial}</span>
            <div>
              <div className="text-[13px] font-semibold text-[#e8e0d0]">{name}</div>
              <div className="font-mono text-[10px] text-[#99907c]">{roleLabel}{isAr && profile?.labelName ? ` · ${profile.labelName}` : ""}</div>
            </div>
          </div>
        </div>
      </div>

      {/* analytics row */}
      <div className="mb-6 grid grid-cols-2 gap-px border border-[#262626] bg-[#262626] sm:grid-cols-4">
        {[
          [analytics.mineViews || 0, "Views"],
          [analytics.mineSubmissions || 0, "Submissions"],
          [analytics.mineApproved || 0, "Approved"],
          [myRequests.length, "Open requests"],
        ].map(([val, lbl]) => (
          <div key={lbl} className="bg-[#0e0e0e] p-3">
            <div className="text-xl font-semibold tabular-nums text-[#e8e0d0]">{val}</div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[#99907c]">{lbl}</div>
          </div>
        ))}
      </div>

      {/* create request */}
      <div className="mb-6 border border-[#262626] bg-[#0e0e0e]">
        <div className="flex items-center justify-between border-b border-[#262626] px-4 py-3">
          <span className="text-[13px] font-semibold text-[#e8e0d0]">Create request</span>
          {roleMeta.family === "producer" && (
            <span className="rounded-none bg-[#7C5CFF]/20 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[#b9a8ff]">Loop requests only</span>
          )}
        </div>

        {!canCreate ? (
          <div className="flex items-center gap-3 px-4 py-8 text-[#99907c]">
            <ShieldCheck size={18} className="shrink-0 text-[#4d4635]" />
            <span className="text-[13px]">Staff must assign a verified role before this profile can create requests.</span>
          </div>
        ) : (
          <div className="p-4">
            {/* type selector */}
            <div className="mb-3 flex flex-wrap gap-1.5">
              {requestTypeOptions.map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setDraft((d) => ({ ...d, requestType: value }))}
                  className={`rounded-none border px-3 py-1.5 text-[12px] font-medium transition ${draft.requestType === value ? "border-[#f2ca50] bg-[#f2ca50]/10 text-[#f2ca50]" : "border-[#262626] bg-[#131313] text-[#99907c] hover:border-[#4d4635] hover:text-[#e8e0d0]"}`}
                >{label}</button>
              ))}
            </div>

            {/* title */}
            <input
              className="mb-3 h-10 w-full rounded-none border border-[#262626] bg-[#131313] px-3 text-[13px] text-[#e8e0d0] placeholder-[#99907c] outline-none transition focus:border-[#f2ca50]/60"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="Request title"
            />

            {/* brief */}
            <textarea
              className="mb-3 w-full resize-y rounded-none border border-[#262626] bg-[#131313] px-3 py-2.5 text-[13px] text-[#e8e0d0] placeholder-[#99907c] outline-none transition focus:border-[#f2ca50]/60"
              rows={4}
              value={draft.brief}
              onChange={(e) => setDraft((d) => ({ ...d, brief: e.target.value }))}
              placeholder="Describe the sound, references, mood, BPM, and what makes a submission useful."
            />

            {/* genre toggles */}
            <div className="mb-3 flex flex-wrap gap-1.5">
              {REQUEST_GENRES.map((genre) => (
                <button
                  key={genre}
                  onClick={() => toggleGenre(genre)}
                  className={`rounded-none border px-3 py-1 text-[11px] font-medium transition ${draft.genres?.includes(genre) ? "border-[#f2ca50] bg-[#f2ca50]/10 text-[#f2ca50]" : "border-[#262626] bg-[#131313] text-[#99907c] hover:border-[#4d4635] hover:text-[#e8e0d0]"}`}
                >{genre}</button>
              ))}
            </div>

            {/* refs + tags row */}
            <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                className="h-9 w-full rounded-none border border-[#262626] bg-[#131313] px-3 text-[13px] text-[#e8e0d0] placeholder-[#99907c] outline-none transition focus:border-[#f2ca50]/60"
                value={draft.references}
                onChange={(e) => setDraft((d) => ({ ...d, references: e.target.value }))}
                placeholder="References (comma separated)"
              />
              <input
                className="h-9 w-full rounded-none border border-[#262626] bg-[#131313] px-3 text-[13px] text-[#e8e0d0] placeholder-[#99907c] outline-none transition focus:border-[#f2ca50]/60"
                value={draft.tags}
                onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))}
                placeholder="Tags (comma separated)"
              />
            </div>

            {/* footer */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-[12px] text-[#99907c]">
                <CalendarDays size={12} />
                <input
                  type="date"
                  value={draft.deadline}
                  onChange={(e) => setDraft((d) => ({ ...d, deadline: e.target.value }))}
                  className="h-8 rounded-none border border-[#262626] bg-[#131313] px-2 text-[12px] text-[#e8e0d0] outline-none transition focus:border-[#f2ca50]/60 [color-scheme:dark]"
                />
              </label>
              <div className="flex items-center gap-3">
                <span className={`font-mono text-[10px] uppercase tracking-wider ${limitReached ? "text-red-400" : "text-[#99907c]"}`}>
                  {limitReached ? "Daily limit reached" : `${remaining}/${DAILY_LIMIT} left today`}
                </span>
                <GoldBtn disabled={!canPost || busy} onClick={onCreate}>
                  <Send size={13} /> {busy ? "Posting..." : "Post request"}
                </GoldBtn>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* inbound inbox */}
      {roleMeta.family ? <InboundInbox submissions={inboundSubmissions} player={player} onPlayBeat={onPlayBeat} onDownloadBeat={onDownloadBeat} /> : null}

      {/* submitted beats */}
      {submittedCampaigns.length > 0 && (
        <div className="mt-2">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#99907c]">Submitted beats</span>
            <span className="font-mono text-[10px] text-[#4d4635]">{submittedCampaigns.length} sent</span>
          </div>
          <div className="divide-y divide-[#262626] border border-[#262626]">
            {submittedCampaigns.map((campaign) => <SubmittedCampaignRow key={campaign.id} campaign={campaign} />)}
          </div>
        </div>
      )}
    </div>
  );
}

const INBOUND_STATUS = {
  pending_review: { label: "Under review", color: "var(--gold, #d4a017)" },
  approved:       { label: "Approved",     color: "var(--good, #4ade80)" },
  pitched:        { label: "Delivered",    color: "var(--good, #4ade80)" },
  rejected:       { label: "Not selected", color: "var(--bone-dim, #9a9087)" },
  live:           { label: "Live",         color: "var(--good, #4ade80)" }
};

function InboundInbox({ submissions, player, onPlayBeat, onDownloadBeat }) {
  const totalCredits = submissions.reduce((s, r) => s + (r.creditsSpent || 0), 0);
  const totalBeats   = submissions.reduce((s, r) => s + (r.beatCount || 0), 0);
  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#99907c]">Received submissions</span>
        <span className="font-mono text-[10px] text-[#4d4635]">{submissions.length} total · {totalBeats} beats · {totalCredits} credits</span>
      </div>

      {submissions.length === 0 ? (
        <div className="flex items-center gap-3 border border-[#262626] bg-[#0e0e0e] px-4 py-8 text-[#99907c]">
          <Music2 size={18} className="shrink-0 text-[#4d4635]" />
          <span className="text-[13px]">No submissions yet. Beats sent to your requests will appear here.</span>
        </div>
      ) : (
        <div className="divide-y divide-[#262626] border border-[#262626]">
          {submissions.map((s) => {
            const status = INBOUND_STATUS[s.status] || INBOUND_STATUS.pending_review;
            const date   = s.submittedAt ? new Date(s.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
            const handle = s.producerInstagram ? (s.producerInstagram.startsWith("@") ? s.producerInstagram : `@${s.producerInstagram}`) : null;
            return (
              <div key={s.id} className="bg-[#0e0e0e] px-4 py-3">
                {/* producer row */}
                <div className="flex items-center gap-3">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-none border border-[#262626] bg-[#131313] font-mono text-[11px] text-[#f2ca50]">
                    {(s.producerName || "P")[0].toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-[#e8e0d0]">{s.producerName}</span>
                      {handle && <span className="font-mono text-[10px] text-[#99907c]">{handle}</span>}
                    </div>
                    {s.targetRequestTitle && (
                      <div className="text-[11px] text-[#99907c]">Re: {s.targetRequestTitle}</div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-[10px] font-medium" style={{ color: status.color }}>{status.label}</div>
                    {date && <div className="font-mono text-[10px] text-[#4d4635]">{date}</div>}
                  </div>
                </div>

                {/* beats */}
                {s.beats.length > 0 && (
                  <div className="mt-3 divide-y divide-[#1c1b1b] border border-[#1c1b1b] bg-[#131313]">
                    {s.beats.map((b, i) => {
                      const canPlay = !!(b.ownerUid && b.campaignId && b.beatIndex != null);
                      const bid     = canPlay ? `beat:${b.ownerUid}:${b.campaignId}:${b.beatIndex}` : null;
                      const playing = bid && player?.id === bid && player?.playing;
                      return (
                        <div key={i} className="flex items-center gap-2.5 px-3 py-2.5">
                          {canPlay && onPlayBeat && (
                            <button
                              onClick={() => onPlayBeat(b)}
                              aria-label={playing ? "Pause" : "Play"}
                              className="grid h-7 w-7 shrink-0 place-items-center rounded-none border border-[#262626] bg-[#0e0e0e] text-[#f2ca50] transition hover:border-[#4d4635]"
                            >
                              {playing ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" className="ml-0.5" />}
                            </button>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-medium text-[#e8e0d0]">{b.title || "Untitled"}</div>
                            {(b.genre || b.bpm || b.key) && (
                              <div className="font-mono text-[10px] text-[#99907c]">{[b.genre, b.bpm ? `${b.bpm} BPM` : "", b.key].filter(Boolean).join(" · ")}</div>
                            )}
                          </div>
                          {canPlay && onDownloadBeat && (
                            <button
                              onClick={(e) => onDownloadBeat(b, e.currentTarget)}
                              aria-label="Download"
                              title="Download"
                              className="grid h-7 w-7 shrink-0 place-items-center rounded-none border border-[#262626] bg-[#0e0e0e] text-[#99907c] transition hover:border-[#4d4635] hover:text-[#e8e0d0]"
                            >
                              <Share2 size={12} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* credits footer */}
                <div className="mt-2 flex items-center justify-between">
                  <span className="font-mono text-[10px] text-[#4d4635]">{s.creditsSpent} credit{s.creditsSpent !== 1 ? "s" : ""} spent</span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-[#4d4635]">{s.kind === "loop" ? "Loop" : "Beat campaign"}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RequestStat({ value, label }) {
  return <div><b>{value}</b><span>{label}</span></div>;
}

const SUBMISSION_STATUS = {
  pending_review: { label: "Under review", color: "var(--gold)" },
  pitched:        { label: "Delivered",    color: "var(--good, #4ade80)" },
  approved:       { label: "Approved",     color: "var(--good, #4ade80)" },
  rejected:       { label: "Not selected", color: "var(--bone-dim)" }
};

function SubmittedCampaignRow({ campaign }) {
  const statusMeta = SUBMISSION_STATUS[campaign.status] || { label: campaign.status, color: "var(--bone-dim)" };
  const beatTitles = campaign.beats.map((b) => b.title).filter(Boolean);
  const date       = campaign.createdAt ? new Date(campaign.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
  const roleLabel  = campaign.targetRequesterRole ? verifiedRoleLabel(campaign.targetRequesterRole) : "";
  return (
    <div className="bg-[#0e0e0e] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-[#e8e0d0]">
            {campaign.targetRequestTitle}{roleLabel ? ` · ${roleLabel}` : ""}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {beatTitles.length > 0
              ? beatTitles.map((t, i) => <span key={i} className="rounded-none border border-[#262626] bg-[#131313] px-2 py-0.5 font-mono text-[10px] text-[#99907c]">{t}</span>)
              : <span className="font-mono text-[10px] text-[#99907c]">{campaign.beats.length} beat{campaign.beats.length !== 1 ? "s" : ""}</span>
            }
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-[10px] font-medium" style={{ color: statusMeta.color }}>{statusMeta.label}</div>
          {date && <div className="font-mono text-[10px] text-[#4d4635]">{date}</div>}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   LIBRARY ROW — with 3-dot menu
═══════════════════════════════════════════════════════════════ */
function LibraryRow({ item, index, tab, selected, player, onSelect, dotMenuOpen, onDotMenu, onExport, onMoreInfo }) {
  const tags      = Array.isArray(item.tags) ? item.tags.map(normalizeTag).filter(Boolean).slice(0, 3) : [];
  const handle    = itemHandle(item, tab);
  const date      = itemDate(item.pitchedAt || item.createdAt);
  const isActive  = player.id === item.id;
  const genreGrad = accentFor(item.genre);
  const genreHex  = genreGrad.match(/#[a-fA-F0-9]{6}/)?.[0] || null;

  const playing = isActive && player.playing;

  return (
    <div
      className={`group relative flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors ${
        isActive ? "bg-[#f2ca50]/[0.05]" : selected ? "bg-[#f2ca50]/[0.02]" : "hover:bg-[#1c1b1b]"
      }`}
      onClick={onSelect}
    >
      {/* full-height left accent on active */}
      {(isActive || selected) && <div className="absolute inset-y-0 left-0 w-0.5 bg-[#f2ca50]" />}

      {/* number → play/pause on hover */}
      <div className="hidden w-8 shrink-0 items-center justify-center lg:flex">
        {isActive ? (
          <button
            onClick={(e) => { e.stopPropagation(); onSelect(); }}
            className="grid h-6 w-6 place-items-center text-[#f2ca50] transition hover:opacity-75"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing
              ? <Pause size={13} fill="currentColor" />
              : <Play size={13} fill="currentColor" className="ml-0.5" />}
          </button>
        ) : (
          <>
            <span className="font-mono text-[11px] text-[#4d4635] group-hover:hidden">{index + 1}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onSelect(); }}
              className="hidden h-6 w-6 items-center justify-center text-[#99907c] transition hover:text-[#e8e0d0] group-hover:flex"
              aria-label="Play"
            >
              <Play size={13} fill="currentColor" className="ml-0.5" />
            </button>
          </>
        )}
      </div>

      {/* title + meta */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={`truncate text-[14px] font-semibold leading-tight transition-colors ${isActive ? "text-[#f2ca50]" : "text-[#e8e0d0]"}`}>
            {item.title || "Untitled"}
          </span>
          {isActive && (
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-[#f2ca50]/60">
              {playing ? "▶ playing" : "⏸ paused"}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="truncate font-mono text-[11px] text-[#99907c]">{handle}</span>
          {date && <span className="shrink-0 font-mono text-[11px] text-[#4d4635]">{date}</span>}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {item.genre && (
            <span
              className="rounded-none px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide"
              style={{
                background: genreHex ? `${genreHex}1a` : "rgba(255,255,255,0.06)",
                color:      genreHex || "#99907c",
                border:     `1px solid ${genreHex ? `${genreHex}38` : "rgba(255,255,255,0.1)"}`
              }}
            >{item.genre}</span>
          )}
          {item.bpm && (
            <span className="rounded-none border border-[#262626] bg-[#131313] px-2 py-0.5 font-mono text-[10px] text-[#99907c]">{item.bpm} BPM</span>
          )}
          {item.key && (
            <span className="rounded-none border border-[#262626] bg-[#131313] px-2 py-0.5 font-mono text-[10px] text-[#99907c]">{item.key}</span>
          )}
          {tags.map((t) => (
            <span key={t} className="rounded-none border border-[#4d4635] bg-[#1c1b1b] px-2 py-0.5 font-mono text-[10px] text-[#f2ca50]">#{t}</span>
          ))}
          {tab === "loops" && item.exclusivity && (
            <span className={`rounded-none px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide border ${item.exclusivity === "shared" ? "border-[#6EC1FF]/40 bg-[#6EC1FF]/10 text-[#6EC1FF]" : "border-[#f2ca50]/40 bg-[#f2ca50]/10 text-[#f2ca50]"}`}>
              {item.exclusivity === "shared" ? `Shared${item.pullCount ? ` · ${item.pullCount}` : ""}` : "Exclusive"}
            </span>
          )}
        </div>
      </div>

      {/* actions */}
      <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
        <button
          className="flex h-8 w-8 items-center justify-center text-[#4d4635] transition hover:text-[#e8e0d0]"
          onClick={onDotMenu}
          title="Options"
        >
          <MoreHorizontal size={15} />
        </button>

        {dotMenuOpen && (
          <div className="absolute right-0 top-full z-20 mt-1 w-36 border border-[#262626] bg-[#0e0e0e] shadow-xl">
            <button
              className="flex w-full items-center gap-2 px-3 py-2.5 text-[12px] text-[#e8e0d0] hover:bg-[#1c1b1b] transition"
              onClick={(e) => onExport(e.currentTarget)}
            >
              <Share2 size={13} className="text-[#99907c]" /> {tab === "loops" ? "Pull loop" : "Export"}
            </button>
            <div className="border-t border-[#262626]" />
            <button
              className="flex w-full items-center gap-2 px-3 py-2.5 text-[12px] text-[#e8e0d0] hover:bg-[#1c1b1b] transition"
              onClick={onMoreInfo}
            >
              <Music2 size={13} className="text-[#99907c]" /> More Info
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TOOLBAR
═══════════════════════════════════════════════════════════════ */
function Toolbar({ tab, search, setSearch, genre, setGenre, tag, setTag, sort, setSort, genres, tags, activeFilters, clearFilters }) {
  return (
    <div
      className="sticky z-20 mb-4 border border-[#262626] bg-[#131313]/85 p-2 backdrop-blur-xl"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 60px)" }}
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#99907c]" />
          <input
            className="h-10 w-full rounded-none border border-[#262626] bg-[#0e0e0e] pl-9 pr-9 text-sm text-[#e8e0d0] placeholder-[#99907c] outline-none transition focus:border-[#f2ca50]/60"
            placeholder={tab === "beats" ? "Search beats, producers, tags, BPM, key..." : "Search loops, makers, BPM, key..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && <button className="absolute right-3 top-1/2 -translate-y-1/2 text-[#99907c] hover:text-[#e8e0d0]" onClick={() => setSearch("")}><X size={13} /></button>}
        </div>
        <div className="flex flex-wrap gap-2">
          <SelectControl icon={<Filter size={13} />}   value={genre} onChange={setGenre} options={[["","All genres"], ...genres.map((g) => [g,g])]} />
          {tab === "beats" && tags.length > 0 && <SelectControl icon={<Tag size={13} />} value={tag} onChange={setTag} options={[["","All tags"], ...tags.map((t) => [t,`#${t}`])]} />}
          <SelectControl icon={<ListMusic size={13} />} value={sort}  onChange={setSort}  options={SORTS} />
        </div>
      </div>
      {activeFilters.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {activeFilters.map((f) => <span key={f} className="rounded-none border border-[#262626] bg-[#131313] px-2 py-0.5 font-mono text-[10px] text-[#99907c]">{f}</span>)}
          <button className="ml-1 text-[12px] font-semibold text-[#f2ca50] hover:underline" onClick={clearFilters}>Clear</button>
        </div>
      )}
    </div>
  );
}

function SelectControl({ icon, value, onChange, options }) {
  const label = options.find(([v]) => v === value)?.[1] ?? options[0]?.[1];
  return (
    <div className="relative">
      <div className="pointer-events-none flex h-8 items-center gap-1.5 rounded-none border border-[#262626] bg-[#0e0e0e] px-2.5 text-[#99907c]">
        <span>{icon}</span>
        <span className="text-xs font-medium text-[#e8e0d0]">{label}</span>
        <ChevronDown size={11} className="text-[#99907c]" />
      </div>
      <select className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, lbl]) => <option key={v} value={v}>{lbl}</option>)}
      </select>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   BOTTOM PLAYER
═══════════════════════════════════════════════════════════════ */
function BottomPlayer({ item, player, closing, onToggle, onSeek, onExport, onClose }) {
  const playing  = player.id === item.id && player.playing;
  const loading  = player.id === item.id && player.loading;
  const progress = player.id === item.id && player.duration ? Math.min(100, Math.max(0, player.current / player.duration * 100)) : 0;
  const current  = player.id === item.id ? player.current : 0;
  const duration = player.id === item.id ? player.duration : 0;
  const handle   = itemHandle(item, item.kind || "beats");
  const genreGrad = accentFor(item.genre);
  const bars      = useMemo(() => waveformBars(item.id || item.title || "track"), [item.id, item.title]);

  return (
    <div
      className={`vf-now-playing${closing ? " is-closing" : ""}`}
      style={{ "--vf-progress": `${progress}%`, "--genre-grad": genreGrad }}
    >
      <div className="vf-now-accent-line" />
      <div className="vf-now-art" style={{ background: genreGrad }}>
        <span>{(item.genre || item.title || "P")[0]}</span>
      </div>
      <div className="vf-now-info">
        <div className="vf-now-title">{item.title || "Untitled"}</div>
        <div className="vf-now-sub">{handle}{item.genre && <span className="vf-now-genre-chip">{item.genre}</span>}</div>
      </div>
      <button className={`vf-now-play${playing ? " is-playing" : ""}${loading ? " is-loading" : ""}`} onClick={onToggle}>
        <span className="vf-now-play-ring" />
        {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" style={{ marginLeft: "2px" }} />}
      </button>
      <div className={`vf-now-scrub-zone${loading ? " loading" : ""}`}>
        <div className="vf-now-wave" aria-hidden="true">
          {bars.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}
          <span className="vf-now-wave-played">{bars.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</span>
        </div>
        <input className="vf-now-scrub-input" type="range" min="0" max="100" step="0.1" value={duration ? progress : 0} disabled={!duration} aria-label="Seek audio" onChange={(e) => onSeek?.(e.target.value)} />
        <div className="vf-now-timestamps"><span>{fmtClock(current)}</span><span>{duration ? fmtClock(duration) : "--:--"}</span></div>
      </div>
      <button className="vf-now-action" onClick={(e) => onExport(e.currentTarget)} title="Export audio"><Share2 size={16} /></button>
      <button className="vf-now-close" onClick={onClose} title="Close player"><X size={15} /></button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MISC COMPONENTS
═══════════════════════════════════════════════════════════════ */
function SidebarSection({ title, children }) {
  return (
    <div className="mb-5">
      <div className="mb-2 px-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#99907c]">{title}</div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function SidebarButton({ active, icon, swatch, label, count, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`group flex min-h-[36px] items-center gap-3 rounded-none px-2.5 py-2 text-left text-[13px] font-semibold transition ${active ? "bg-[#f2ca50]/10 text-[#f2ca50]" : "text-[#99907c] hover:bg-[#1c1b1b] hover:text-[#e8e0d0]"}`}
    >
      {swatch
        ? <span className="h-4 w-4 shrink-0" style={{ background: swatch }} />
        : <span className={`grid h-4 w-4 place-items-center ${active ? "text-[#f2ca50]" : "text-[#99907c]"}`}>{icon}</span>
      }
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {typeof count === "number" && <span className="font-mono text-[10px] text-[#4d4635]">{count}</span>}
    </button>
  );
}

function LoadingRows() {
  return (
    <div className="divide-y divide-[#262626]">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="hidden h-4 w-8 lg:block" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="mt-1.5 h-3 w-1/4" />
            <div className="mt-2 flex gap-1.5">
              <Skeleton className="h-5 w-14" />
              <Skeleton className="h-5 w-12" />
              <Skeleton className="h-5 w-10" />
            </div>
          </div>
          <Skeleton className="h-6 w-6 shrink-0" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon, title, body, action }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-20 text-center">
      <span className="grid h-14 w-14 place-items-center border border-[#262626] bg-[#131313] text-[#4d4635]">{icon}</span>
      <div>
        <div className="text-[15px] font-semibold text-[#e8e0d0]">{title}</div>
        <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-[#99907c]">{body}</p>
      </div>
      {action}
    </div>
  );
}
