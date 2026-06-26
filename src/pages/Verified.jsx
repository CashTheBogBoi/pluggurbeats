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
import {
  ArrowLeft, CalendarDays, ChevronDown, Disc3, Filter, Library,
  ListMusic, LogOut, Menu, MessageSquarePlus, Music2, Pause, Play, RefreshCw, Search, Send, Share2, ShieldCheck, Tag, X
} from "lucide-react";
import "./Verified.css";

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
const SORTS = [
  ["newest", "Newest"],
  ["title", "Title"],
  ["producer", "Producer"],
  ["genre", "Genre"]
];
const PAGE_SIZE = 80;
const BEAT_PAGE_SIZE = 25;
const LOOP_PAGE_SIZE = 50;
const FN_BASE = "https://us-central1-pluggurbeats.cloudfunctions.net";
const REQUEST_GENRES = ["Trap", "Drill", "R&B", "Pop", "Afrobeats", "Hip-Hop", "Reggaeton", "Other"];

const buttonBase = "inline-flex items-center justify-center gap-2 rounded-full text-sm font-semibold transition-[background,border-color,color,opacity,transform] duration-140 ease-expo active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50";
const GoldBtn = ({ className = "", children, ...p }) => (
  <button className={`${buttonBase} bg-gold px-5 py-2.5 text-[#1a1405] hover:bg-gold-deep ${className}`} {...p}>{children}</button>
);
const GhostBtn = ({ className = "", children, ...p }) => (
  <button className={`${buttonBase} border border-strong bg-transparent px-4 py-2 text-bone hover:border-bone hover:bg-white/5 ${className}`} {...p}>{children}</button>
);
const IconBtn = ({ className = "", children, ...p }) => (
  <button className={`grid h-9 w-9 place-items-center rounded-lg border border-line bg-ink text-bone-dim transition active:scale-[0.98] hover:border-strong hover:text-bone ${className}`} {...p}>{children}</button>
);
const Skeleton = ({ className = "" }) => (
  <div className={`relative overflow-hidden rounded-lg bg-white/5 ${className}`}>
    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[shimmer_1.4s_infinite]" />
  </div>
);
const EqBars = () => (
  <span className="eq-bars"><i /><i /><i /><i /></span>
);
const normalizeTag = (t) => String(t || "").trim().toLowerCase();
const itemHandle = (item, tab) => tab === "beats"
  ? (item.producer?.instagram || item.producer?.name || "Unknown producer")
  : (item.makerName || "Unknown maker");
const itemDate = (ms) => ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
const fmtClock = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};
const waveformBars = (seed = "", count = 84) => {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return Array.from({ length: count }, (_, i) => {
    hash = (hash * 1664525 + 1013904223 + i) >>> 0;
    const lift = 18 + (hash % 34);
    const taper = i > count * 0.68 ? .55 : i < 2 ? .72 : 1;
    return Math.max(10, Math.round(lift * taper));
  });
};
const cleanFileName = (name, fallback = "audio") => {
  const base = String(name || fallback).trim() || fallback;
  return base.replace(/[/\\:*?"<>|]/g, "").replace(/\s+/g, " ").slice(0, 80);
};
const cleanAudioFileName = (name, fallback = "audio.mp3") => {
  const raw = String(name || fallback).split("?")[0].split("#")[0].trim() || fallback;
  const safe = raw.replace(/[/\\:*?"<>|]/g, "").replace(/\s+/g, " ").slice(0, 120);
  return /\.[a-z0-9]{2,5}$/i.test(safe) ? safe : `${safe}.mp3`;
};
const splitList = (value) => [...new Set(String(value || "")
  .split(/[,\n]/)
  .map((item) => item.trim())
  .filter(Boolean)
)].slice(0, 10);
const storageFileName = (path) => {
  const last = String(path || "").split("/").filter(Boolean).pop() || "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
};
const mimeExt = (mime) => {
  if (/wav/i.test(mime)) return "wav";
  if (/mpeg|mp3/i.test(mime)) return "mp3";
  if (/mp4|m4a|aac/i.test(mime)) return "m4a";
  return "mp3";
};
const urlExt = (url) => {
  const clean = String(url || "").split("?")[0].toLowerCase();
  const match = clean.match(/\.([a-z0-9]{2,5})$/i);
  return match?.[1] || "";
};
const openDownload = (url, filename = "") => {
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
};
const downloadBlob = (blob, filename) => {
  const objectUrl = URL.createObjectURL(blob);
  openDownload(objectUrl, filename);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};
async function exportAudio(url, title, fallbackMessage, preferredFileName = "") {
  const fallbackName = cleanFileName(title, "audio");
  const guessedExt = urlExt(url) || "mp3";
  const fileName = preferredFileName
    ? cleanAudioFileName(preferredFileName, `${fallbackName}.${guessedExt}`)
    : cleanAudioFileName(`${fallbackName}.${guessedExt}`);
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const [{ Share }, { Filesystem, Directory }, { FileTransfer }] = await Promise.all([
        import("@capacitor/share"),
        import("@capacitor/filesystem"),
        import("@capacitor/file-transfer")
      ]);
      const canShare = await Share.canShare().catch(() => ({ value: true }));
      if (!canShare.value) throw new Error("Native share is unavailable.");
      const { uri } = await Filesystem.getUri({ directory: Directory.Cache, path: fileName });
      await FileTransfer.downloadFile({ url, path: uri });
      await Share.share({
        title: fallbackName,
        text: fallbackName,
        files: [uri],
        dialogTitle: "Export Audio"
      });
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
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

async function downloadVerifiedBeatDirect(item) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Sign in again to download this beat.");
  const params = new URLSearchParams({
    ownerUid: item.ownerUid || "",
    campaignId: item.campaignId || "",
    beatIndex: String(item.beatIndex ?? ""),
    storagePath: item.storagePath || ""
  });
  const response = await fetch(`${FN_BASE}/downloadVerifiedBeatFile?${params}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(await response.text() || "Could not download beat.");
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const filenameMatch = disposition.match(/filename="([^"]+)"/i);
  const ext = filenameMatch ? "" : `.${mimeExt(blob.type)}`;
  downloadBlob(blob, filenameMatch?.[1] || `${cleanFileName(item.title, "Beat")}${ext}`);
  return "downloaded";
}

export default function Verified() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tab, setTab] = useState("requests");
  const [search, setSearch] = useState("");
  const [genre, setGenre] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState("newest");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState("");
  const [playerItem, setPlayerItem] = useState(null);
  const [playerClosing, setPlayerClosing] = useState(false);
  const [player, setPlayer] = useState({ id: "", kind: "", src: "", playing: false, current: 0, duration: 0, loading: false });
  const [toast, setToast] = useState("");
  const [requestDraft, setRequestDraft] = useState({
    title: "",
    brief: "",
    requestType: "loops",
    genres: [],
    tags: "",
    references: "",
    deadline: ""
  });
  const [requestBusy, setRequestBusy] = useState(false);
  const audioRef = useRef(null);
  const toastTimer = useRef(null);
  const lastAvatar = useRef(null);
  const previewUrlCache = useRef(new Map());
  const prewarmedPreview = useRef("");
  const viewed = useRef(new Set());

  const showToast = (t) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3000);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u || !u.emailVerified) { navigate("/"); return; }
      setUser(u); setAuthReady(true);
    });
    return () => unsub();
  }, [navigate]);

  const uid = user?.uid;
  const { data: profile } = useLiveDoc(["me", uid], () => doc(db, "users", uid), { enabled: !!uid });
  const isListener = profile?.verifiedListener === true;
  const isPuller = profile?.verifiedPuller === true;
  const hasAccess = isListener || isPuller;
  const roleMeta = verifiedRoleMeta(profile?.verifiedRole || "");
  const roleFamily = roleMeta.family;
  const plan = profile?.subscription?.tier || "free";
  const canCreateRequests = Boolean(roleFamily);
  const requestTypeOptions = roleFamily === "producer"
    ? [["loops", "Loops"]]
    : [["beats", "Beats"], ["loops", "Loops"], ["both", "Both"]];
  const gate = !authReady || profile === undefined ? "loading" : (hasAccess ? "ok" : "denied");
  const staffQ = useQuery({
    queryKey: ["verified", "staff-access", uid],
    queryFn: () => call("checkStaffAccess").then((d) => d || {}),
    enabled: gate === "ok",
    retry: false,
    staleTime: 5 * 60 * 1000
  });
  const isStaff = staffQ.data?.staff === true;
  const requestsQ = useQuery({
    queryKey: ["verified", "requests", uid],
    queryFn: () => call("listCampaignRequests", { limit: 50 }).then((d) => d || {}),
    enabled: gate === "ok",
    retry: false,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000
  });

  useEffect(() => {
    if (!profile || profile.__error) return;
    const key = profile.photoURL || profile.avatarPath || user?.photoURL || "";
    if (key === lastAvatar.current) return;
    lastAvatar.current = key;
    resolveAvatarUrl(profile, user).then(setAvatarUrl).catch(() => setAvatarUrl(""));
  }, [profile, user]);

  const beatsQ = useInfiniteQuery({
    queryKey: ["library", "beats", "paged", genre, tag],
    queryFn: ({ pageParam = null }) => call("listApprovedBeats", { pageSize: BEAT_PAGE_SIZE, cursor: pageParam, genre, tag }).then((d) => d || {}),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage?.hasMore ? lastPage.nextCursor : undefined,
    enabled: gate === "ok",
    refetchInterval: 60000
  });
  const loopsQ = useInfiniteQuery({
    queryKey: ["pool", "loops", "paged"],
    queryFn: ({ pageParam = null }) => call("listLiveLoops", { pageSize: LOOP_PAGE_SIZE, cursor: pageParam }).then((d) => d || {}),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage?.hasMore ? lastPage.nextCursor : undefined,
    enabled: gate === "ok" && isPuller,
    refetchInterval: 60000
  });

  const beats = useMemo(() => {
    const seen = new Set();
    return (beatsQ.data?.pages?.flatMap((p) => p.beats || []) || []).filter((beat) => {
      const id = beat.id || `${beat.ownerUid || ""}:${beat.campaignId || ""}:${beat.beatIndex ?? ""}:${beat.title || ""}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [beatsQ.data]);
  const loops = useMemo(() => loopsQ.data?.pages?.flatMap((p) => p.loops || []) || [], [loopsQ.data]);
  const activeItems = tab === "beats" ? beats : loops;
  const activeQuery = tab === "beats" ? beatsQ : loopsQ;
  const isLoading = activeQuery.isLoading;
  const isError = activeQuery.isError;
  const errMsg = activeQuery.error?.message;
  const canFetchMore = activeQuery.hasNextPage === true;

  const libraryMeta = useMemo(() => {
    const genres = [...new Set(beats.concat(loops).map((x) => x.genre).filter(Boolean))].sort();
    const tags = [...new Set(beats.flatMap((b) => Array.isArray(b.tags) ? b.tags : []).map(normalizeTag).filter(Boolean))].sort();
    return { genres, tags };
  }, [beats, loops]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = activeItems.filter((item) => {
      if (genre && item.genre !== genre) return false;
      const tags = Array.isArray(item.tags) ? item.tags.map(normalizeTag).filter(Boolean) : [];
      if (tab === "beats" && tag && !tags.includes(tag)) return false;
      if (!q) return true;
      return [
        item.title,
        item.genre,
        item.key,
        item.bpm,
        itemHandle(item, tab),
        ...tags
      ].some((field) => String(field || "").toLowerCase().includes(q));
    });
    return [...list].sort((a, b) => {
      if (sort === "title") return String(a.title || "").localeCompare(String(b.title || ""));
      if (sort === "producer") return itemHandle(a, tab).localeCompare(itemHandle(b, tab));
      if (sort === "genre") return String(a.genre || "").localeCompare(String(b.genre || ""));
      return (b.pitchedAt || b.createdAt || 0) - (a.pitchedAt || a.createdAt || 0);
    });
  }, [activeItems, genre, search, sort, tab, tag]);

  const visibleItems = filteredItems.slice(0, visibleCount);
  const selectedItem = filteredItems.find((item) => item.id === selectedId) || filteredItems[0] || activeItems[0] || null;
  const activeFilters = [search && "search", genre && genre, tag && `#${tag}`].filter(Boolean);
  const canShowMoreLocal = visibleItems.length < filteredItems.length;
  const canLoadMore = canShowMoreLocal || canFetchMore;
  const campaignRequests = requestsQ.data?.requests || [];
  const requestAnalytics = requestsQ.data?.analytics || {};
  const myRequests = useMemo(() => campaignRequests.filter((req) => req.isMine), [campaignRequests]);
  // Count my requests posted today (UTC, matching the server's daily counter key) for the 5/day limit.
  const requestsToday = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);
    return myRequests.filter((req) => req.createdAt && new Date(req.createdAt).toISOString().slice(0, 10) === todayKey).length;
  }, [myRequests]);

  // Beats submitted directly to A&R / artist / producer requests (not library pitches).
  const { data: submittedCampaigns } = useLiveCollection(
    ["me", uid, "submitted-campaigns"],
    () => uid ? query(
      collection(db, `users/${uid}/campaigns`),
      where("targetRequestId", "!=", ""),
      orderBy("targetRequestId"),
      orderBy("createdAt", "desc"),
      limit(20)
    ) : null,
    {
      enabled: gate === "ok" && tab === "requests",
      map: (d) => {
        const r = d.data();
        return {
          id: d.id,
          targetRequestId: r.targetRequestId || "",
          targetRequestTitle: r.targetRequestTitle || "Untitled request",
          targetRequesterRole: r.targetRequesterRole || "",
          beats: Array.isArray(r.beats) ? r.beats : [],
          status: r.status || "pending_review",
          tier: r.tier || "free",
          createdAt: r.createdAt?.toMillis ? r.createdAt.toMillis() : null
        };
      }
    }
  );

  async function createRequest() {
    if (requestBusy) return;
    setRequestBusy(true);
    try {
      const res = await call("createCampaignRequest", {
        ...requestDraft,
        tags: splitList(requestDraft.tags),
        references: splitList(requestDraft.references)
      });
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

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setSelectedId("");
  }, [tab, search, genre, tag, sort]);

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
    const readAudioTime = () => ({
      current: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
      duration: Number.isFinite(audio.duration) ? audio.duration : 0
    });
    const onTime = () => setPlayer((p) => p.src === audio.src ? { ...p, ...readAudioTime() } : p);
    const onLoadStart = () => setPlayer((p) => p.src === audio.src ? { ...p, loading: true } : p);
    const onLoaded = () => setPlayer((p) => p.src === audio.src ? { ...p, ...readAudioTime(), loading: false } : p);
    const onCanPlay = () => setPlayer((p) => p.src === audio.src ? { ...p, loading: false, duration: readAudioTime().duration || p.duration || 0 } : p);
    const onPlaying = () => setPlayer((p) => ({ ...p, playing: true, loading: false }));
    const onWaiting = () => setPlayer((p) => p.src === audio.src ? { ...p, loading: true } : p);
    const onPause = () => setPlayer((p) => ({ ...p, playing: false }));
    const onEnded = () => setPlayer((p) => ({ ...p, playing: false, current: 0 }));
    const onError = () => setPlayer((p) => p.src === audio.src ? { ...p, playing: false, loading: false } : p);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", onTime);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("loadstart", onLoadStart);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("durationchange", onTime);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("loadstart", onLoadStart);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, []);

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
    if (previewUrlCache.current.size > 12) {
      const oldest = previewUrlCache.current.keys().next().value;
      previewUrlCache.current.delete(oldest);
    }
    return res.url;
  }

  useEffect(() => {
    const first = visibleItems[0] || selectedItem;
    if (!first || !hasAccess) return;
    const normalizedKind = tab === "loops" ? "loop" : "beat";
    const cacheKey = normalizedKind === "loop"
      ? `loop:${first.id}`
      : `beat:${first.ownerUid}:${first.campaignId}:${first.beatIndex}`;
    if (previewUrlCache.current.has(cacheKey) || prewarmedPreview.current === cacheKey) return;

    let cancelled = false;
    prewarmedPreview.current = cacheKey;
    const run = () => {
      resolvePreviewUrl(first, tab)
        .then((url) => {
          if (cancelled || !url) return;
          const audio = audioRef.current;
          if (audio && !player.src && audio.src !== url) {
            audio.preload = "metadata";
            audio.src = url;
            audio.load();
          }
        })
        .catch(() => {
          if (prewarmedPreview.current === cacheKey) prewarmedPreview.current = "";
        });
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
      audio.pause();
      return;
    }
    setPlayer((p) => ({ ...p, id, kind, loading: true, playing: false }));
    let playUrl = "";
    try {
      playUrl = await resolvePreviewUrl(item, kind);
    } catch (e) {
      showToast(e.message || "Could not load preview.");
      setPlayer((p) => ({ ...p, id, kind, loading: false, playing: false }));
      return;
    }
    if (player.id !== id || player.src !== playUrl) {
      audio.pause();
      if (audio.src !== playUrl) {
        audio.removeAttribute("src");
        audio.load();
        audio.src = playUrl;
      }
      audio.currentTime = 0;
      setPlayer({ id, kind, src: playUrl, playing: false, current: 0, duration: 0, loading: true });
      if (kind === "beats") markBeatView(item);
      else markLoopView(item);
    }
    audio.play()
      .then(() => setPlayer((p) => p.id === id ? {
        ...p,
        playing: !audio.paused,
        loading: false,
        current: Number.isFinite(audio.currentTime) ? audio.currentTime : p.current,
        duration: Number.isFinite(audio.duration) ? audio.duration : p.duration
      } : p))
      .catch(() => setPlayer((p) => ({ ...p, loading: false, playing: false })));
  }

  function seekPlayback(item, percent) {
    const audio = audioRef.current;
    if (!audio || player.id !== item.id || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const next = Math.min(100, Math.max(0, Number(percent) || 0));
    const current = audio.duration * (next / 100);
    audio.currentTime = current;
    setPlayer((p) => p.id === item.id ? { ...p, current, duration: audio.duration } : p);
  }

  function chooseTrack(item, kind) {
    setSelectedId(item.id);
    setPlayerItem({ ...item, kind });
    togglePlayback(item, kind, true);
  }

  function loadMore() {
    if (canShowMoreLocal) {
      setVisibleCount((n) => n + PAGE_SIZE);
      return;
    }
    if (canFetchMore && !activeQuery.isFetchingNextPage) {
      activeQuery.fetchNextPage();
    }
  }

  async function doPull(loop, btn) {
    btn.disabled = true;
    try {
      const res = await call("pullLoop", { loopId: loop.id });
      const outcome = await exportAudio(res.url, loop.title || "Loop", "downloaded");
      if (outcome === "shared") showToast("Export sheet opened. A split claim was created with the maker.");
      else if (outcome === "downloaded") showToast("Loop export started. A split claim was created with the maker.");
      loopsQ.refetch();
    } catch (e) {
      showToast(e.message || "Could not pull loop.");
    } finally {
      btn.disabled = false;
    }
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
    } catch (e) {
      showToast(e.message || "Could not download.");
    } finally {
      btn.disabled = false;
    }
  }

  function clearFilters() {
    setSearch("");
    setGenre("");
    setTag("");
  }

  function switchTab(next) {
    setTab(next);
    clearFilters();
    setSidebarOpen(false);
  }

  if (gate === "loading") {
    return (
      <div className="grid min-h-screen place-items-center bg-ink text-bone-dim">
        <div className="flex items-center gap-3 text-sm">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
          Checking access...
        </div>
      </div>
    );
  }

  if (gate === "denied") {
    return (
      <div className="grid min-h-screen place-items-center bg-ink px-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-2xl bg-bad/10 text-bad"><ShieldCheck size={28} /></span>
          <h2 className="font-display text-2xl text-bone">Verified access required</h2>
          <p className="max-w-sm text-sm leading-relaxed text-bone-dim">PluggUrBeat Verified is invite-only for A&Rs, artists, and verified producers. Contact us to request access.</p>
          <a href="/"><GoldBtn className="mt-2"><ArrowLeft size={16} /> Back to PluggurBeats</GoldBtn></a>
        </div>
      </div>
    );
  }

  const initial = avatarInitial(profile?.displayName || user?.email);

  return (
    <div className="min-h-screen bg-ink font-sans text-bone">
      <audio ref={audioRef} preload="none" className="hidden" />
      {sidebarOpen && <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setSidebarOpen(false)} />}
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
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-ink/75 px-4 py-2.5 backdrop-blur-xl sm:px-6 lg:px-8" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.625rem)" }}>
            <IconBtn className="lg:hidden" onClick={() => setSidebarOpen(true)}><Menu size={18} /></IconBtn>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-bone">{tab === "requests" ? "Verified Requests" : tab === "beats" ? "Verified Beats" : "Loop Pool"}</div>
              <div className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-bone-dim">{tab === "requests" ? `${campaignRequests.length} open` : `${filteredItems.length} visible · ${activeItems.length}${canFetchMore ? "+" : ""} loaded`}</div>
            </div>
            <button
              className="hidden items-center gap-2 rounded-full border border-line bg-ink px-3 py-1.5 text-xs font-semibold text-bone-dim transition-colors duration-140 ease-expo active:scale-[0.95] hover:border-strong hover:text-bone sm:flex"
              onClick={() => activeQuery.refetch()}
            >
              <RefreshCw size={13} /> Refresh
            </button>
            <button
              className="hidden items-center gap-2 rounded-full border border-gold/35 bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold transition-colors duration-140 ease-expo active:scale-[0.95] hover:border-gold/60 hover:bg-gold/15 sm:flex"
              onClick={() => navigate("/dashboard")}
            >
              <ArrowLeft size={13} /> Dashboard
            </button>
            {isStaff && (
              <button
                className="hidden items-center gap-2 rounded-full border border-line bg-ink px-3 py-1.5 text-xs font-semibold text-bone-dim transition-colors duration-140 ease-expo active:scale-[0.95] hover:border-strong hover:text-bone sm:flex"
                onClick={() => navigate("/staff")}
              >
                <ShieldCheck size={13} /> Staff
              </button>
            )}
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-gold to-violet font-display text-sm font-bold text-[#1a1405]"
              style={avatarUrl ? { backgroundImage: `url("${avatarUrl}")`, backgroundSize: "cover" } : undefined}
            >
              {avatarUrl ? "" : initial}
            </span>
            <IconBtn onClick={() => signOut(auth).then(() => navigate("/"))}><LogOut size={17} /></IconBtn>
          </header>

          <main className="px-4 py-5 sm:px-6 lg:px-8 lg:py-7" style={{ paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + ${playerItem ? "12rem" : "7rem"})` }}>
            {tab === "requests" ? (
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
                loading={requestsQ.isLoading}
                error={requestsQ.error?.message || ""}
                plan={plan}
                onSubmitRequest={submitToRequest}
              />
            ) : (
              <>
                <LibraryHero tab={tab} selectedItem={selectedItem} total={`${activeItems.length}${canFetchMore ? "+" : ""}`} filtered={filteredItems.length} isPuller={isPuller} />

                <Toolbar
                  tab={tab}
                  search={search}
                  setSearch={setSearch}
                  genre={genre}
                  setGenre={setGenre}
                  tag={tag}
                  setTag={setTag}
                  sort={sort}
                  setSort={setSort}
                  genres={libraryMeta.genres}
                  tags={libraryMeta.tags}
                  activeFilters={activeFilters}
                  clearFilters={clearFilters}
                />

                <section className="overflow-hidden rounded-xl border border-line bg-ink-2/55">
                  <div className="hidden border-b border-line px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-bone-dim lg:flex lg:items-center lg:gap-4">
                    <div className="w-6 shrink-0 text-center">#</div>
                    <div className="w-14 shrink-0" />
                    <div className="flex-1">Title &amp; Info</div>
                    <div className="w-9 shrink-0" />
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
                    <div className="divide-y divide-line">
                      {visibleItems.map((item, index) => (
                        <LibraryRow
                          key={item.id}
                          item={item}
                          index={index}
                          tab={tab}
                          selected={selectedItem?.id === item.id}
                          onSelect={() => chooseTrack(item, tab)}
                          player={player}
                          onDownload={doDownloadBeat}
                          onPull={doPull}
                        />
                      ))}
                    </div>
                  )}
                </section>

                {!isLoading && !isError && canLoadMore && (
                  <div className="mt-4 flex justify-center">
                    <GhostBtn onClick={loadMore} disabled={activeQuery.isFetchingNextPage}>
                      {activeQuery.isFetchingNextPage
                        ? "Loading..."
                        : canShowMoreLocal
                          ? `Show ${Math.min(PAGE_SIZE, filteredItems.length - visibleItems.length)} more`
                          : "Load more from library"}
                    </GhostBtn>
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      </div>

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

      <div className={`pointer-events-none fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-strong bg-ink-3 px-5 py-3 text-sm font-medium text-bone shadow-card transition-[opacity,transform] duration-260 ease-expo lg:bottom-6 ${toast ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}>
        {toast}
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-50 flex border-t border-line bg-ink-2/95 backdrop-blur-xl lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <button onClick={() => switchTab("requests")} className={`flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 transition-colors duration-140 ease-expo active:scale-[0.94] ${tab === "requests" ? "text-gold" : "text-bone-dim"}`}>
          <span className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-140 ease-expo ${tab === "requests" ? "bg-gold/12" : ""}`}><Send size={19} strokeWidth={tab === "requests" ? 2.4 : 1.8} /></span>
          <span className="text-[9px] font-medium leading-none tracking-tight">Requests</span>
        </button>
        <button onClick={() => switchTab("beats")} className={`flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 transition-colors duration-140 ease-expo active:scale-[0.94] ${tab === "beats" ? "text-gold" : "text-bone-dim"}`}>
          <span className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-140 ease-expo ${tab === "beats" ? "bg-gold/12" : ""}`}><Music2 size={19} strokeWidth={tab === "beats" ? 2.4 : 1.8} /></span>
          <span className="text-[9px] font-medium leading-none tracking-tight">Beats</span>
        </button>
        {isPuller && (
          <button onClick={() => switchTab("loops")} className={`flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 transition-colors duration-140 ease-expo active:scale-[0.94] ${tab === "loops" ? "text-gold" : "text-bone-dim"}`}>
            <span className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-140 ease-expo ${tab === "loops" ? "bg-gold/12" : ""}`}><Disc3 size={19} strokeWidth={tab === "loops" ? 2.4 : 1.8} /></span>
            <span className="text-[9px] font-medium leading-none tracking-tight">Loops</span>
          </button>
        )}
        <button onClick={() => setSidebarOpen(true)} className="flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 text-bone-dim transition-colors duration-140 ease-expo active:scale-[0.94] active:text-bone">
          <span className="flex h-7 w-12 items-center justify-center rounded-full"><Filter size={19} /></span>
          <span className="text-[9px] font-medium leading-none tracking-tight">Filters</span>
        </button>
        <button onClick={() => navigate("/dashboard")} className="flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 text-bone-dim transition-colors duration-140 ease-expo active:scale-[0.94] active:text-bone">
          <span className="flex h-7 w-12 items-center justify-center rounded-full"><ArrowLeft size={19} /></span>
          <span className="text-[9px] font-medium leading-none tracking-tight">Studio</span>
        </button>
        {isStaff && (
          <button onClick={() => navigate("/staff")} className="flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 text-bone-dim transition-colors duration-140 ease-expo active:scale-[0.94] active:text-bone">
            <span className="flex h-7 w-12 items-center justify-center rounded-full"><ShieldCheck size={19} /></span>
            <span className="text-[9px] font-medium leading-none tracking-tight">Staff</span>
          </button>
        )}
      </nav>
    </div>
  );
}

function LibrarySidebar({ open, tab, isPuller, beats, loops, genres, tags, genre, tag, switchTab, setGenre, setTag, clearFilters }) {
  const genreCounts = useMemo(() => {
    const map = new Map();
    beats.concat(loops).forEach((item) => { if (item.genre) map.set(item.genre, (map.get(item.genre) || 0) + 1); });
    return map;
  }, [beats, loops]);

  return (
    <aside className={`fixed inset-y-0 left-0 z-50 flex w-[276px] flex-col border-r border-line bg-ink-2/95 px-4 py-5 backdrop-blur-xl transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`} style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.25rem)" }}>
      <div className="mb-6 flex items-center justify-between px-2">
        <div className="flex items-center gap-2.5 font-display text-lg tracking-tight"><EqBars /> Verified</div>
        <IconBtn className="lg:hidden" onClick={() => switchTab(tab)}><X size={17} /></IconBtn>
      </div>

      <SidebarSection title="Browse">
        <SidebarButton active={tab === "requests"} icon={<Send size={17} />} label="Requests" onClick={() => switchTab("requests")} />
        <SidebarButton active={tab === "beats"} icon={<Music2 size={17} />} label="Beats" count={beats.length} onClick={() => switchTab("beats")} />
        {isPuller && <SidebarButton active={tab === "loops"} icon={<Disc3 size={17} />} label="Loop Pool" count={loops.length} onClick={() => switchTab("loops")} />}
      </SidebarSection>

      <SidebarSection title="Genres">
        <SidebarButton active={!genre} icon={<Library size={17} />} label="All genres" count={beats.length + loops.length} onClick={() => setGenre("")} />
        {genres.slice(0, 12).map((g) => (
          <SidebarButton key={g} active={genre === g} swatch={accentFor(g)} label={g} count={genreCounts.get(g) || 0} onClick={() => setGenre(g)} />
        ))}
      </SidebarSection>

      {tab === "beats" && tags.length > 0 && (
        <SidebarSection title="Tags">
          <div className="flex flex-wrap gap-1.5 px-1">
            {tags.slice(0, 24).map((t) => (
              <button key={t} onClick={() => setTag(tag === t ? "" : t)} className={`rounded-full border px-2 py-1 font-mono text-[10px] transition-colors duration-140 ease-expo active:scale-[0.94] ${tag === t ? "border-gold bg-gold/12 text-gold" : "border-line bg-ink text-bone-dim hover:border-strong hover:text-bone"}`}>#{t}</button>
            ))}
          </div>
        </SidebarSection>
      )}

      <div className="mt-auto rounded-2xl border border-line bg-ink p-3">
        <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={15} className="text-gold" /> Verified access</div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-bone-dim">Approved beats and live loops refresh automatically as the catalog grows.</p>
        <button onClick={clearFilters} className="mt-3 text-[12px] font-semibold text-gold hover:underline">Reset library filters</button>
      </div>
    </aside>
  );
}

function RequestHub({ profile, avatarUrl, canCreate, roleMeta, isAr, requestTypeOptions, draft, setDraft, busy, onCreate, requests, myRequests, requestsToday = 0, analytics, loading, error, plan, onSubmitRequest, submittedCampaigns = [] }) {
  const name = profile?.displayName || "Verified user";
  const initial = avatarInitial(name);
  const DAILY_LIMIT = 5;
  const limitReached = requestsToday >= DAILY_LIMIT;
  const remaining = Math.max(0, DAILY_LIMIT - requestsToday);
  const canPost = canCreate && !limitReached && draft.title.trim().length >= 4 && draft.brief.trim().length >= 20;
  const roleLabel = roleMeta.label || "No role";
  const visibleRequests = requests.slice(0, 6);

  const toggleGenre = (genre) => {
    setDraft((d) => {
      const current = Array.isArray(d.genres) ? d.genres : [];
      return { ...d, genres: current.includes(genre) ? current.filter((g) => g !== genre) : [...current, genre].slice(0, 6) };
    });
  };

  return (
    <section className="vf-requests">
      <div className="vf-request-head">
        <div>
          <div className="vf-kicker"><MessageSquarePlus size={14} /> Requests</div>
          <h1>Verified Requests</h1>
          <p>A&R, artists, and producers can post what they need. Contact details stay private.</p>
        </div>
        <div className="vf-request-profile">
          <span className="vf-request-avatar" style={avatarUrl ? { backgroundImage: `url("${avatarUrl}")` } : undefined}>{avatarUrl ? "" : initial}</span>
          <div>
            <b>{name}</b>
            <span>{roleLabel}{isAr && profile?.labelName ? ` · ${profile.labelName}` : ""}</span>
          </div>
        </div>
      </div>

      <div className="vf-request-grid">
        <div className="vf-request-composer">
          <div className="vf-panel-title">
            <span>Create request</span>
            {roleMeta.family === "producer" && <em>Loop requests only</em>}
          </div>
          {!canCreate ? (
            <div className="vf-request-empty">
              <ShieldCheck size={18} />
              <span>Staff must assign a verified role before this profile can create requests.</span>
            </div>
          ) : (
            <>
              <div className="vf-type-row">
                {requestTypeOptions.map(([value, label]) => (
                  <button key={value} className={draft.requestType === value ? "active" : ""} onClick={() => setDraft((d) => ({ ...d, requestType: value }))}>{label}</button>
                ))}
              </div>
              <input className="vf-request-input" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="Request title" />
              <textarea className="vf-request-textarea" rows="4" value={draft.brief} onChange={(e) => setDraft((d) => ({ ...d, brief: e.target.value }))} placeholder="Briefly describe the sound, artist references, mood, BPM, and what would make a submission useful." />
              <div className="vf-genre-row">
                {REQUEST_GENRES.map((genre) => (
                  <button key={genre} className={draft.genres?.includes(genre) ? "active" : ""} onClick={() => toggleGenre(genre)}>{genre}</button>
                ))}
              </div>
              <div className="vf-request-two">
                <input className="vf-request-input" value={draft.references} onChange={(e) => setDraft((d) => ({ ...d, references: e.target.value }))} placeholder="References, comma separated" />
                <input className="vf-request-input" value={draft.tags} onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))} placeholder="Tags, comma separated" />
              </div>
              <div className="vf-request-footer">
                <label><CalendarDays size={13} /><input type="date" value={draft.deadline} onChange={(e) => setDraft((d) => ({ ...d, deadline: e.target.value }))} /></label>
                <div className="vf-post-actions">
                  <span className={`vf-daily-count ${limitReached ? "is-maxed" : ""}`}>{limitReached ? "Daily limit reached (5/5)" : `${remaining} of ${DAILY_LIMIT} left today`}</span>
                  <button disabled={!canPost || busy} onClick={onCreate}><Send size={14} /> {busy ? "Posting..." : "Post request"}</button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="vf-request-side">
          <div className="vf-panel-title"><span>My analytics</span><em>{myRequests.length} open</em></div>
          <div className="vf-request-stats">
            <RequestStat value={analytics.mineViews || 0} label="Views" />
            <RequestStat value={analytics.mineSubmissions || 0} label="Submissions" />
            <RequestStat value={analytics.mineApproved || 0} label="Approved" />
            <RequestStat value={analytics.mineEmails || 0} label="Emails" />
          </div>
          {myRequests.length > 0 && (
            <div className="vf-my-request-list">
              {myRequests.slice(0, 3).map((req) => <span key={req.id}>{req.title}</span>)}
            </div>
          )}
        </div>
      </div>

      <div className="vf-feed-head">
        <span>Open requests</span>
        <em>{loading ? "Loading" : `${requests.length} live`}</em>
      </div>
      {error ? <div className="vf-request-empty">{error}</div> : (
        <div className="vf-request-feed">
          {loading && visibleRequests.length === 0 ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)
          ) : visibleRequests.length === 0 ? (
            <div className="vf-request-empty">No open requests yet.</div>
          ) : visibleRequests.map((request) => (
            <RequestCard key={request.id} request={request} plan={plan} onSubmit={onSubmitRequest} />
          ))}
        </div>
      )}

      {submittedCampaigns.length > 0 && (
        <>
          <div className="vf-feed-head" style={{ marginTop: "2rem" }}>
            <span>Submitted beats</span>
            <em>{submittedCampaigns.length} sent</em>
          </div>
          <div className="vf-submitted-list">
            {submittedCampaigns.map((campaign) => (
              <SubmittedCampaignRow key={campaign.id} campaign={campaign} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function RequestStat({ value, label }) {
  return (
    <div>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function RequestCard({ request, plan, onSubmit }) {
  const initial = avatarInitial(request.createdByName);
  const typeLabel = request.requestType === "both" ? "Beats + loops" : request.requestType === "beats" ? "Beats" : "Loops";
  const date = request.deadline ? new Date(`${request.deadline}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
  const roleAllowed = canPlanSubmitToRole(plan, request.createdByRole);
  const isLoopOnly = request.requestType === "loops";
  const canSubmit = roleAllowed;
  const buttonLabel = roleAllowed ? (isLoopOnly ? "Submit loop" : "Submit campaign") : `${verifiedRoleLabel(request.createdByRole)} requires upgrade`;
  return (
    <article className="vf-request-card">
      <div className="vf-request-card-top">
        <span className="vf-request-avatar" style={request.createdByPhotoURL ? { backgroundImage: `url("${request.createdByPhotoURL}")` } : undefined}>{request.createdByPhotoURL ? "" : initial}</span>
        <div className="min-w-0">
          <h3>{request.createdByName}</h3>
          <p>{request.createdByRoleLabel}{request.labelName ? ` · ${request.labelName}` : ""}</p>
        </div>
        <span className="vf-request-type">{typeLabel}</span>
      </div>
      <h4>{request.title}</h4>
      <p className="vf-request-brief">{request.brief}</p>
      <div className="vf-request-meta">
        {date && <span>Due {date}</span>}
        {(request.genres || []).slice(0, 3).map((genre) => <span key={genre}>{genre}</span>)}
        {(request.references || []).slice(0, 2).map((ref) => <span key={ref}>{ref}</span>)}
      </div>
      <button className="vf-request-submit" disabled={!canSubmit} onClick={() => onSubmit(request)}>{buttonLabel}</button>
    </article>
  );
}

const SUBMISSION_STATUS = {
  pending_review: { label: "Under review", color: "var(--gold)" },
  pitched:        { label: "Delivered", color: "var(--good, #4ade80)" },
  approved:       { label: "Approved", color: "var(--good, #4ade80)" },
  rejected:       { label: "Not selected", color: "var(--bone-dim)" }
};

function SubmittedCampaignRow({ campaign }) {
  const statusMeta = SUBMISSION_STATUS[campaign.status] || { label: campaign.status, color: "var(--bone-dim)" };
  const beatTitles = campaign.beats.map((b) => b.title).filter(Boolean);
  const date = campaign.createdAt ? new Date(campaign.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
  const roleLabel = campaign.targetRequesterRole ? verifiedRoleLabel(campaign.targetRequesterRole) : "";
  return (
    <div className="vf-submitted-row">
      <div className="vf-submitted-meta">
        <span className="vf-submitted-status" style={{ color: statusMeta.color }}>{statusMeta.label}</span>
        {date && <span className="vf-submitted-date">{date}</span>}
      </div>
      <div className="vf-submitted-request">{campaign.targetRequestTitle}{roleLabel ? ` · ${roleLabel}` : ""}</div>
      <div className="vf-submitted-beats">
        {beatTitles.length > 0
          ? beatTitles.map((t, i) => <span key={i}>{t}</span>)
          : <span>{campaign.beats.length} beat{campaign.beats.length !== 1 ? "s" : ""}</span>}
      </div>
    </div>
  );
}

function SidebarSection({ title, children }) {
  return (
    <div className="mb-5">
      <div className="mb-2 px-2 font-mono text-[10px] uppercase tracking-[0.16em] text-bone-dim">{title}</div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function SidebarButton({ active, icon, swatch, label, count, onClick }) {
  return (
    <button onClick={onClick} className={`group flex min-h-[38px] items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm font-semibold transition-colors duration-140 ease-expo active:scale-[0.97] ${active ? "bg-white/[0.075] text-bone" : "text-bone-dim hover:bg-white/5 hover:text-bone"}`}>
      {swatch ? <span className="h-5 w-5 rounded-md shadow-inner" style={{ background: swatch }} /> : <span className={`grid h-5 w-5 place-items-center rounded-md ${active ? "bg-gold/12 text-gold" : "bg-white/5 text-bone-dim group-hover:text-bone"}`}>{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {typeof count === "number" && <span className="font-mono text-[10px] text-bone-dim">{count}</span>}
    </button>
  );
}

function LibraryHero({ tab, selectedItem, total, filtered, isPuller }) {
  const title = tab === "beats" ? "Verified Beats" : "Loop Pool";
  const subtitle = tab === "beats"
    ? "Approved producer submissions, searchable by genre, tags, BPM, key, and producer."
    : "Live loops ready for verified producers to pull into sessions.";
  const heroGenre = selectedItem?.genre || (tab === "beats" ? "Trap" : "Loop");
  const handle = selectedItem ? itemHandle(selectedItem, tab) : (isPuller ? "Verified catalog" : "Verified listener");

  return (
    <section className="mb-5 grid gap-4 sm:gap-5 lg:grid-cols-[minmax(220px,320px)_1fr] lg:items-end">
      <div className="hidden sm:block">
        <ArtTile genre={heroGenre} title={selectedItem?.title || title} size="large" />
      </div>
      <div className="pb-1">
        <div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-gold">
          <span className="h-px w-5 bg-gold/70" /> {tab === "beats" ? "Library" : "Producer pool"}
        </div>
        <h1 className="font-display text-[30px] leading-none tracking-tight text-bone sm:text-5xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-bone-dim sm:mt-3">{subtitle}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-bone-dim">
          <span className="rounded-full border border-line bg-ink-2 px-3 py-1">{filtered} shown</span>
          <span className="rounded-full border border-line bg-ink-2 px-3 py-1">{total} total</span>
          <span className="rounded-full border border-line bg-ink-2 px-3 py-1">{handle}</span>
        </div>
      </div>
    </section>
  );
}

function Toolbar({ tab, search, setSearch, genre, setGenre, tag, setTag, sort, setSort, genres, tags, activeFilters, clearFilters }) {
  return (
    <div className="sticky z-20 mb-4 rounded-xl border border-line bg-ink/85 p-2 backdrop-blur-xl" style={{ top: "calc(env(safe-area-inset-top, 0px) + 60px)" }}>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-bone-dim/50" />
          <input
            className="h-10 w-full rounded-lg border border-strong bg-ink-2 pl-9 pr-9 text-sm text-bone placeholder:text-bone-dim/50 outline-none transition focus:border-gold/60 focus:ring-1 focus:ring-gold/30"
            placeholder={tab === "beats" ? "Search beats, producers, tags, BPM, key..." : "Search loops, makers, BPM, key..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && <button className="absolute right-3 top-1/2 -translate-y-1/2 text-bone-dim hover:text-bone" onClick={() => setSearch("")}><X size={13} /></button>}
        </div>
        <div className="flex flex-wrap gap-2">
          <SelectControl icon={<Filter size={13} />} value={genre} onChange={setGenre} options={[["", "All genres"], ...genres.map((g) => [g, g])]} />
          {tab === "beats" && tags.length > 0 && <SelectControl icon={<Tag size={13} />} value={tag} onChange={setTag} options={[["", "All tags"], ...tags.map((t) => [t, `#${t}`])]} />}
          <SelectControl icon={<ListMusic size={13} />} value={sort} onChange={setSort} options={SORTS} />
        </div>
      </div>
      {activeFilters.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {activeFilters.map((f) => <span key={f} className="rounded-full border border-line bg-ink-3 px-2 py-0.5 font-mono text-[10px] text-bone-dim">{f}</span>)}
          <button className="ml-1 text-[12px] font-semibold text-gold hover:underline" onClick={clearFilters}>Clear</button>
        </div>
      )}
    </div>
  );
}

function SelectControl({ icon, value, onChange, options }) {
  const label = options.find(([v]) => v === value)?.[1] ?? options[0]?.[1];
  return (
    <div className="relative">
      <div className="pointer-events-none flex h-8 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 text-bone-dim">
        <span className="text-bone-dim/60">{icon}</span>
        <span className="text-xs font-medium text-bone">{label}</span>
        <ChevronDown size={11} className="text-bone-dim/50" />
      </div>
      <select
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([v, lbl]) => <option key={v} value={v}>{lbl}</option>)}
      </select>
    </div>
  );
}

function LibraryRow({ item, index, tab, selected, player, onSelect, onDownload, onPull }) {
  const tags = Array.isArray(item.tags) ? item.tags.map(normalizeTag).filter(Boolean).slice(0, 3) : [];
  const handle = itemHandle(item, tab);
  const date = itemDate(item.pitchedAt || item.createdAt);
  const isActive = player.id === item.id;
  const genreGrad = accentFor(item.genre);
  const genreHex = genreGrad.match(/#[a-fA-F0-9]{6}/)?.[0] || null;

  return (
    <div
      className={`group relative flex cursor-pointer items-center gap-4 px-4 py-3.5 transition-[background,transform] duration-140 ease-expo active:scale-[0.98] ${selected || isActive ? "bg-gold/[0.05]" : "hover:bg-white/[0.028]"}`}
      onClick={onSelect}
    >
      {(selected || isActive) && (
        <div className="absolute left-0 top-3 bottom-3 w-0.5 rounded-r-full bg-gold" />
      )}

      <div className="hidden w-6 shrink-0 text-center font-mono text-[11px] text-bone-dim lg:block">{index + 1}</div>

      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl" style={{ background: genreGrad }}>
        <span className="absolute inset-0 flex select-none items-center justify-center font-display text-3xl font-black text-white opacity-[0.12]">
          {(item.genre || item.title || "T")[0]}
        </span>
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/55 opacity-0 transition-opacity duration-140 ease-out group-hover:opacity-100">
          <Play size={18} fill="white" className="ml-0.5 text-white" />
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-semibold text-bone leading-tight" title={item.title}>{item.title || "Untitled"}</span>
          {isActive && (
            <span className="shrink-0 rounded-full bg-gold/15 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold">
              {player.playing ? "playing" : "selected"}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="truncate font-mono text-[11px] text-bone-dim">{handle}</span>
          {date && <span className="shrink-0 font-mono text-[11px] text-bone-dim/50">{date}</span>}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {item.bpm && (
            <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2 py-0.5 font-mono text-[10px] text-bone-dim">
              {item.bpm} BPM
            </span>
          )}
          {item.key && (
            <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2 py-0.5 font-mono text-[10px] text-bone-dim">
              {item.key}
            </span>
          )}
          {item.genre && (
            <span
              className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide"
              style={{
                background: genreHex ? `${genreHex}1a` : "rgba(255,255,255,0.06)",
                color: genreHex || "rgba(245,243,242,0.55)",
                border: `1px solid ${genreHex ? `${genreHex}38` : "rgba(255,255,255,0.1)"}`,
              }}
            >
              {item.genre}
            </span>
          )}
          {tags.map((t) => (
            <span key={t} className="rounded-full border border-gold/22 bg-gold/[0.07] px-2 py-0.5 font-mono text-[10px] text-gold">
              #{t}
            </span>
          ))}
        </div>
      </div>

      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <button
          className="flex h-9 w-9 items-center justify-center rounded-full border border-transparent text-bone-dim transition duration-150 hover:border-white/10 hover:bg-white/[0.07] hover:text-bone active:scale-[0.92]"
          onClick={(e) => tab === "beats" ? onDownload(item, e.currentTarget) : onPull(item, e.currentTarget)}
          title={tab === "beats" ? "Export audio" : "Export loop"}
        >
          <Share2 size={15} />
        </button>
      </div>
    </div>
  );
}

function TrackPreview({ item, isActive, playing, loading, progress, current, duration, onToggle, onSeek }) {
  const bars = useMemo(() => waveformBars(item.id || item.title || "track"), [item.id, item.title]);
  return (
    <div
      className={`vf-player ${isActive ? "active" : ""} ${loading ? "loading" : ""}`}
      style={{ "--vf-progress": `${progress}%` }}
    >
      <div className="vf-scrub">
        <span className="vf-wave" aria-hidden="true">
          {bars.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}
          <span className="vf-wave-played">
            {bars.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}
          </span>
        </span>
        <input
          className="vf-scrub-input"
          type="range"
          min="0"
          max="100"
          step="0.1"
          value={duration ? progress : 0}
          disabled={!duration}
          aria-label="Seek audio"
          onChange={(e) => onSeek?.(e.target.value)}
        />
      </div>
      <span className="vf-time">
        <span>{fmtClock(current)}</span>
        <b>/</b>
        <span>{duration ? fmtClock(duration) : "--:--"}</span>
      </span>
      <button className="vf-player-icon" onClick={onToggle} title={playing ? "Pause preview" : "Play preview"}>
        {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
      </button>
    </div>
  );
}

function BottomPlayer({ item, player, closing, onToggle, onSeek, onExport, onClose }) {
  const playing = player.id === item.id && player.playing;
  const loading = player.id === item.id && player.loading;
  const progress = player.id === item.id && player.duration
    ? Math.min(100, Math.max(0, player.current / player.duration * 100))
    : 0;
  const current = player.id === item.id ? player.current : 0;
  const duration = player.id === item.id ? player.duration : 0;
  const handle = itemHandle(item, item.kind || "beats");
  const genreGrad = accentFor(item.genre);
  const bars = useMemo(() => waveformBars(item.id || item.title || "track"), [item.id, item.title]);

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
        <div className="vf-now-sub">
          {handle}
          {item.genre && <span className="vf-now-genre-chip">{item.genre}</span>}
        </div>
      </div>

      <button
        className={`vf-now-play${playing ? " is-playing" : ""}${loading ? " is-loading" : ""}`}
        onClick={onToggle}
        title={playing ? "Pause" : "Play preview"}
      >
        <span className="vf-now-play-ring" />
        {playing
          ? <Pause size={16} fill="currentColor" />
          : <Play size={16} fill="currentColor" style={{ marginLeft: "2px" }} />}
      </button>

      <div className={`vf-now-scrub-zone${loading ? " loading" : ""}`}>
        <div className="vf-now-wave" aria-hidden="true">
          {bars.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}
          <span className="vf-now-wave-played">
            {bars.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}
          </span>
        </div>
        <input
          className="vf-now-scrub-input"
          type="range" min="0" max="100" step="0.1"
          value={duration ? progress : 0}
          disabled={!duration}
          aria-label="Seek audio"
          onChange={(e) => onSeek?.(e.target.value)}
        />
        <div className="vf-now-timestamps">
          <span>{fmtClock(current)}</span>
          <span>{duration ? fmtClock(duration) : "--:--"}</span>
        </div>
      </div>

      <button className="vf-now-action" onClick={(e) => onExport(e.currentTarget)} title="Export audio">
        <Share2 size={16} />
      </button>
      <button className="vf-now-close" onClick={onClose} title="Close player">
        <X size={15} />
      </button>
    </div>
  );
}

function ArtTile({ genre, title, size = "small" }) {
  const letter = (genre || title || "P")[0];
  const large = size === "large";
  return (
    <div
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-xl shadow-inner ${large ? "aspect-square w-full max-w-[320px]" : "h-11 w-11"}`}
      style={{ background: accentFor(genre) }}
    >
      <span className={`font-display font-black leading-none text-white opacity-[0.15] select-none ${large ? "text-[110px]" : "text-3xl"}`}>{letter}</span>
      {large && <span className="absolute bottom-4 right-4 text-white/35"><Music2 size={42} /></span>}
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <Skeleton className="hidden h-4 w-6 lg:block" />
          <Skeleton className="h-14 w-14 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="mt-1.5 h-3 w-1/4" />
            <div className="mt-2 flex gap-1.5">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-5 w-12 rounded-full" />
            </div>
          </div>
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon, title, body, action }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-20 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/5 text-bone-dim">{icon}</span>
      <div>
        <div className="font-display text-xl text-bone">{title}</div>
        <p className="mt-1 max-w-sm text-sm leading-relaxed text-bone-dim">{body}</p>
      </div>
      {action}
    </div>
  );
}
