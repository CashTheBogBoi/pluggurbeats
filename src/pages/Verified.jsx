import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, collection, query, where, onSnapshot } from "firebase/firestore";
import { ref, getDownloadURL } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { auth, db, fns, storage } from "../firebase.js";
import "./Verified.css";

const listApprovedBeatsFn = httpsCallable(fns, "listApprovedBeats");
const getLoopPlayUrlsFn   = httpsCallable(fns, "getLoopPlayUrls");
const pullLoopFn          = httpsCallable(fns, "pullLoop");

const ACCENT = {
  "Trap": "linear-gradient(140deg,#7C5CFF 0%,#3A1F9E 100%)",
  "Drill": "linear-gradient(140deg,#6EC1FF 0%,#2B6FA8 100%)",
  "R&B": "linear-gradient(140deg,#E4C16B 0%,#9E6B1A 100%)",
  "Pop": "linear-gradient(140deg,#FF6B9D 0%,#A82855 100%)",
  "Afrobeats": "linear-gradient(140deg,#7CE2A4 0%,#268B4E 100%)",
  "Hip-Hop": "linear-gradient(140deg,#FF6B6B 0%,#A82020 100%)",
  "Reggaeton": "linear-gradient(140deg,#FFB347 0%,#A86010 100%)"
};
const accent = (g) => ACCENT[g] || "linear-gradient(140deg,#A29DAC 0%,#4A4358 100%)";

const BeatIcon = () => (
  <svg className="art-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.4">
    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
  </svg>
);
const LoopIcon = () => (
  <svg className="art-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.4">
    <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
);

export default function Verified() {
  const navigate = useNavigate();
  const [gate, setGate] = useState("loading"); // loading | denied | ok
  const [isPuller, setIsPuller] = useState(false);
  const [profile, setProfile] = useState({});
  const [avatarUrl, setAvatarUrl] = useState("");
  const [tab, setTab] = useState("beats");
  const [beats, setBeats] = useState([]);
  const [loops, setLoops] = useState([]);
  const [beatsState, setBeatsState] = useState("loading"); // loading | error | ready
  const [loopsState, setLoopsState] = useState("loading");
  const [errMsg, setErrMsg] = useState("");
  const [search, setSearch] = useState("");
  const [genre, setGenre] = useState("");
  const [toast, setToast] = useState("");
  const [liveAt, setLiveAt] = useState(null);

  const toastTimer    = useRef(null);
  const beatsTimer    = useRef(null);
  const loopUrlCache  = useRef({});      // loopId -> signed playUrl
  const fetchingUrls  = useRef(false);
  const lastAvatar    = useRef(null);
  const beatsListener = useRef(null);    // unsub for the libraryBeats snapshot
  const loopsListener = useRef(null);    // unsub for the loops snapshot

  const showToast = (t) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3000);
  };

  // Refresh the approved-beats library (callable returns signed playback URLs).
  // Debounced so a burst of libraryBeats writes coalesces into one fetch.
  function refreshBeats() {
    clearTimeout(beatsTimer.current);
    beatsTimer.current = setTimeout(async () => {
      try {
        const res = await listApprovedBeatsFn();
        setBeats(res.data.beats || []);
        setBeatsState("ready");
        setLiveAt(Date.now());
      } catch (e) {
        setErrMsg(e.message);
        setBeatsState("error");
      }
    }, 350);
  }

  // Fetch signed playback URLs for any live loops we don't have cached yet.
  async function hydrateLoopUrls(list) {
    const missing = list.filter((l) => !loopUrlCache.current[l.id]).map((l) => l.id);
    if (missing.length === 0 || fetchingUrls.current) return;
    fetchingUrls.current = true;
    try {
      const res = await getLoopPlayUrlsFn({ loopIds: missing });
      Object.assign(loopUrlCache.current, res.data.urls || {});
      setLoops((prev) => prev.map((l) => ({ ...l, playUrl: loopUrlCache.current[l.id] || l.playUrl })));
    } catch { /* preview is best-effort */ }
    finally { fetchingUrls.current = false; }
  }

  useEffect(() => {
    const unsubs = [];

    const authUnsub = onAuthStateChanged(auth, (user) => {
      if (!user || !user.emailVerified) { navigate("/"); return; }

      // ── Live access gate: the user doc drives verified flags in real time.
      // Library/pool listeners are attached lazily here, AFTER access is
      // confirmed, because their rules require a verified grant. ──
      unsubs.push(onSnapshot(doc(db, "users", user.uid), (snap) => {
        const data = snap.exists() ? snap.data() : {};
        setProfile({ ...data, email: user.email });

        const listener = data.verifiedListener === true;
        const puller   = data.verifiedPuller   === true;
        setIsPuller(puller);

        if (data.avatarPath && data.avatarPath !== lastAvatar.current) {
          lastAvatar.current = data.avatarPath;
          getDownloadURL(ref(storage, data.avatarPath)).then(setAvatarUrl).catch(() => {});
        }

        if (!listener && !puller) { setGate("denied"); return; }
        setGate((g) => (g === "ok" ? g : "ok"));

        // Beats library — any verified user (listener or puller)
        if ((listener || puller) && !beatsListener.current) {
          beatsListener.current = onSnapshot(
            collection(db, "libraryBeats"),
            () => refreshBeats(),
            (err) => { setErrMsg(err.message); setBeatsState("error"); }
          );
          refreshBeats(); // first paint, even if libraryBeats is empty
        }

        // Loop pool — pullers only
        if (puller && !loopsListener.current) {
          loopsListener.current = onSnapshot(
            query(collection(db, "loops"), where("status", "==", "live")),
            (s) => {
              const list = s.docs
                .map((d) => {
                  const l = d.data();
                  return {
                    id: d.id, makerName: l.makerName || "Unknown", title: l.title,
                    bpm: l.bpm || null, key: l.key || null, genre: l.genre || null,
                    tags: l.tags || [], playUrl: loopUrlCache.current[d.id] || null,
                    createdAt: l.createdAt?.toMillis ? l.createdAt.toMillis() : 0
                  };
                })
                .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
              setLoops(list);
              setLoopsState("ready");
              hydrateLoopUrls(list);
            },
            (err) => { setErrMsg(err.message); setLoopsState("error"); }
          );
        }
      }, () => setGate("denied")));
    });

    return () => {
      authUnsub();
      unsubs.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
      if (beatsListener.current) beatsListener.current();
      if (loopsListener.current) loopsListener.current();
      clearTimeout(beatsTimer.current);
      clearTimeout(toastTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchTab = (t) => { setTab(t); setSearch(""); setGenre(""); };

  async function doPull(loopId, btn) {
    btn.disabled = true; btn.textContent = "Pulling…";
    try {
      const res = await pullLoopFn({ loopId });
      const a = document.createElement("a");
      a.href = res.data.url; a.download = ""; a.target = "_blank";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      showToast("Loop pulled — a split-claim has been created with the maker.");
      setLoops((prev) => prev.filter((l) => l.id !== loopId)); // snapshot will also drop it
    } catch (e) {
      showToast(e.message || "Could not pull loop.");
      btn.disabled = false; btn.textContent = "Use this loop";
    }
  }

  const match = (q, fields) => !q || fields.some((f) => (f || "").toLowerCase().includes(q));
  const q = search.toLowerCase();

  const filteredBeats = useMemo(() => beats.filter((b) => {
    if (genre && b.genre !== genre) return false;
    return match(q, [b.title, b.genre, b.producer?.instagram, b.producer?.name]);
  }), [beats, genre, q]);

  const filteredLoops = useMemo(() => loops.filter((l) => {
    if (genre && l.genre !== genre) return false;
    return match(q, [l.title, l.genre, l.makerName]);
  }), [loops, genre, q]);

  if (gate === "loading") {
    return (
      <div id="verified-root">
        <div className="gate-screen">
          <div className="eq" style={{ height: "36px", gap: "3px" }}>
            <i style={{ width: "4px" }} /><i style={{ width: "4px" }} /><i style={{ width: "4px" }} /><i style={{ width: "4px" }} />
          </div>
          <h2 style={{ marginTop: "20px" }}>Checking access…</h2>
        </div>
      </div>
    );
  }

  if (gate === "denied") {
    return (
      <div id="verified-root">
        <div className="gate-screen">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="var(--bad)" strokeWidth="1.4">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <h2>Verified access required</h2>
          <p>PluggUrBeat Verified is invite-only for A&amp;Rs, artists, and verified producers.<br />Contact us to request access.</p>
          <a href="/" className="btn-gold">Back to PluggurBeats</a>
        </div>
      </div>
    );
  }

  const initial = (profile.displayName || profile.email || "?")[0].toUpperCase();

  return (
    <div id="verified-root">
      <header className="site-header">
        <div className="brand">
          <span className="eq"><i /><i /><i /><i /></span>
          PluggUrBeat <span className="v-badge">VERIFIED</span>
        </div>
        <div className="header-right">
          <div className="avatar-sm" style={avatarUrl ? { backgroundImage: `url("${avatarUrl}")` } : undefined}>
            {avatarUrl ? "" : initial}
          </div>
          <button className="btn-ghost-sm" onClick={() => signOut(auth).then(() => navigate("/"))}>Sign out</button>
        </div>
      </header>

      <main>
        <div className="hero">
          <div className="eyebrow">
            Curated · Exclusive · Verified
            {liveAt && <span style={{ color: "var(--ok)", marginLeft: "10px" }}>● Live</span>}
          </div>
          <h1>The library</h1>
          <p>{isPuller
            ? "Browse approved beats and pull live loops from the producer pool."
            : "Browse approved beats and loops from PluggurBeats producers."}</p>
        </div>

        <div className="tab-row">
          <div className="tab-bar">
            <button className={`tab${tab === "beats" ? " active" : ""}`} onClick={() => switchTab("beats")}>
              Beats <span className="tab-badge">{beats.length || ""}</span>
            </button>
            {isPuller && (
              <button className={`tab${tab === "loops" ? " active" : ""}`} onClick={() => switchTab("loops")}>
                Loop Pool <span className="tab-badge">{loops.length || ""}</span>
              </button>
            )}
          </div>
        </div>

        <div className="filter-bar">
          <input className="search-inp" placeholder="Search title, genre, or producer…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="filter-sel" value={genre} onChange={(e) => setGenre(e.target.value)}>
            <option value="">All genres</option>
            <option>Trap</option><option>Drill</option><option>R&amp;B</option>
            <option>Pop</option><option>Afrobeats</option><option>Hip-Hop</option>
            <option>Reggaeton</option><option>Other</option>
          </select>
        </div>

        {tab === "beats" ? (
          <div className="content-grid">
            {beatsState === "loading" && <div className="panel-state">Loading beats…</div>}
            {beatsState === "error" && <div className="panel-state" style={{ color: "var(--bad)" }}>{errMsg}</div>}
            {beatsState === "ready" && filteredBeats.length === 0 && (
              <div className="panel-state">{beats.length ? "No beats match your filter." : "No approved beats in the library yet."}</div>
            )}
            {beatsState === "ready" && filteredBeats.map((b) => {
              const handle = b.producer?.instagram || b.producer?.name || "Unknown producer";
              const chips = [b.genre, b.key, b.bpm && b.bpm + " BPM"].filter(Boolean);
              return (
                <div className="media-card" key={b.id}>
                  <div className="card-art" style={{ background: accent(b.genre) }}>
                    <span className="art-letter">{(b.genre || "B")[0]}</span><BeatIcon />
                  </div>
                  <div className="card-body">
                    <div className="card-title" title={b.title}>{b.title}</div>
                    <div className="card-handle">{handle}</div>
                    <div className="chip-row">{chips.map((c, i) => <span className="chip" key={i}>{c}</span>)}</div>
                    {b.playUrl
                      ? <div className="card-audio"><audio controls preload="none" src={b.playUrl} /></div>
                      : <div style={{ fontSize: "12px", color: "var(--bone-dim)" }}>No audio file</div>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="content-grid">
            {loopsState === "loading" && <div className="panel-state">Loading loops…</div>}
            {loopsState === "error" && <div className="panel-state" style={{ color: "var(--bad)" }}>{errMsg}</div>}
            {loopsState === "ready" && filteredLoops.length === 0 && (
              <div className="panel-state">{loops.length ? "No loops match your filter." : "No live loops in the pool right now."}</div>
            )}
            {loopsState === "ready" && filteredLoops.map((l) => {
              const chips = [l.genre, l.key, l.bpm && l.bpm + " BPM"].filter(Boolean);
              return (
                <div className="media-card" key={l.id}>
                  <div className="card-art" style={{ background: accent(l.genre) }}>
                    <span className="art-letter">{(l.genre || "L")[0]}</span><LoopIcon />
                  </div>
                  <div className="card-body">
                    <div className="card-title" title={l.title}>{l.title}</div>
                    <div className="card-handle">by {l.makerName || "Unknown"}</div>
                    <div className="chip-row">{chips.map((c, i) => <span className="chip" key={i}>{c}</span>)}</div>
                    {l.playUrl
                      ? <div className="card-audio"><audio controls preload="none" src={l.playUrl} /></div>
                      : <div style={{ fontSize: "12px", color: "var(--bone-dim)" }}>Loading preview…</div>}
                    <button className="btn-pull" onClick={(e) => doPull(l.id, e.currentTarget)}>Use this loop</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <div id="vf-toast" className={toast ? "show" : ""}>{toast}</div>
    </div>
  );
}
