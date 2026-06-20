import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, fns } from "../firebase.js";
import "./Staff.css";

const listReviewCampaigns = httpsCallable(fns, "listReviewCampaigns");
const moderateCampaign = httpsCallable(fns, "moderateCampaign");
const listUsers = httpsCallable(fns, "listUsers");
const setVerifiedPullerFn = httpsCallable(fns, "setVerifiedPuller");
const setVerifiedListenerFn = httpsCallable(fns, "setVerifiedListener");
const adjustCreditsFn = httpsCallable(fns, "adjustCredits");
const banUserFn = httpsCallable(fns, "banUser");
const listLoopClaimsFn = httpsCallable(fns, "listLoopClaims");

const STATUS_BY_TAB = {
  pending: ["pending_review"],
  approved: ["approved", "pitched", "no_contacts", "send_failed"],
  rejected: ["rejected"]
};
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

export default function Staff() {
  const navigate = useNavigate();
  const [gate, setGate] = useState("loading"); // loading | ok | error
  const [who, setWho] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const [view, setView] = useState("campaigns");

  const [campaigns, setCampaigns] = useState([]);
  const [tab, setTab] = useState("pending");
  const [search, setSearch] = useState("");
  const [pkg, setPkg] = useState("");

  const [users, setUsers] = useState([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [openIdx, setOpenIdx] = useState(null);

  const [claims, setClaims] = useState([]);
  const [claimsLoaded, setClaimsLoaded] = useState(false);

  const [reject, setReject] = useState(null); // { path, reason, note, busy }
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);

  const showToast = (t) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2800);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user || !user.emailVerified) { navigate("/"); return; }
      setWho(user.email);
      try {
        const res = await listReviewCampaigns();
        setCampaigns(res.data.campaigns || []);
        setGate("ok");
      } catch (e) {
        if (e.code === "functions/permission-denied") { navigate("/dashboard"); return; }
        setLoadErr(e.message || String(e));
        setGate("error");
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function switchView(v) {
    setView(v);
    if (v === "users" && !usersLoaded) {
      try {
        const res = await listUsers();
        setUsers(res.data.users || []);
        setUsersLoaded(true);
      } catch (e) { showToast("Could not load users: " + (e.message || e)); }
    }
    if (v === "loops" && !claimsLoaded) {
      try {
        const res = await listLoopClaimsFn();
        setClaims(res.data.claims || []);
        setClaimsLoaded(true);
      } catch (e) { showToast("Could not load claims: " + (e.message || e)); }
    }
  }

  // ---- campaign moderation ----
  const setCampaignStatus = (path, status) =>
    setCampaigns((prev) => prev.map((c) => (c.path === path ? { ...c, status } : c)));

  async function decide(path) {
    try {
      await moderateCampaign({ path, decision: "approved" });
      setCampaignStatus(path, "approved");
      showToast("Approved — pitching now.");
    } catch (e) { showToast("Failed: " + (e.message || e)); }
  }
  async function repitch(path) {
    try {
      await moderateCampaign({ path, decision: "approved" });
      setCampaignStatus(path, "approved");
      showToast("Re-pitch triggered — pitching now.");
    } catch (e) { showToast("Failed: " + (e.message || e)); }
  }
  async function confirmReject() {
    setReject((r) => ({ ...r, busy: true }));
    try {
      await moderateCampaign({ path: reject.path, decision: "rejected", reason: reject.reason, note: (reject.note || "").trim() });
      setCampaignStatus(reject.path, "rejected");
      setReject(null);
      showToast("Campaign rejected — producer notified by email.");
    } catch (e) {
      showToast("Failed: " + (e.message || e));
      setReject((r) => ({ ...r, busy: false }));
    }
  }

  // ---- user actions ----
  const patchUser = (idx, patch) => setUsers((prev) => prev.map((u, i) => (i === idx ? { ...u, ...patch } : u)));

  async function toggleVP(idx) {
    const u = users[idx]; const next = !u.verifiedPuller;
    try {
      await setVerifiedPullerFn({ uid: u.uid, value: next });
      patchUser(idx, { verifiedPuller: next });
      showToast(`${u.displayName || u.email}: loop pull access ${next ? "granted" : "revoked"}.`);
    } catch (e) { showToast("Failed: " + (e.message || e)); }
  }
  async function toggleVL(idx) {
    const u = users[idx]; const next = !u.verifiedListener;
    try {
      await setVerifiedListenerFn({ uid: u.uid, value: next });
      patchUser(idx, { verifiedListener: next });
      showToast(`${u.displayName || u.email}: verified library access ${next ? "granted" : "revoked"}.`);
    } catch (e) { showToast("Failed: " + (e.message || e)); }
  }
  async function adjustCredits(idx, kind, sign, amount) {
    const u = users[idx];
    const amt = parseInt(amount || "0", 10);
    if (!amt || amt < 1) { showToast("Enter a valid amount."); return; }
    try {
      const res = await adjustCreditsFn({ uid: u.uid, kind, delta: sign * amt });
      patchUser(idx, kind === "pitch" ? { pitchBalance: res.data.newBalance } : { loopBalance: res.data.newBalance });
      showToast(`${kind} credits ${sign > 0 ? "+" + amt : -amt} for ${u.displayName || u.email}. New balance: ${res.data.newBalance}`);
    } catch (e) { showToast("Failed: " + (e.message || e)); }
  }
  async function toggleBan(idx) {
    const u = users[idx]; const next = !u.banned;
    if (next && !confirm(`Ban ${u.displayName || u.email}? This disables their account immediately.`)) return;
    try {
      await banUserFn({ uid: u.uid, banned: next });
      patchUser(idx, { banned: next });
      showToast(`${u.displayName || u.email} ${next ? "banned" : "unbanned"}.`);
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
    return <div id="staff-root"><div className="state" style={{ paddingTop: "120px" }}>Checking access…</div></div>;
  }

  return (
    <div id="staff-root">
      <main>
        <div className="head">
          <div>
            <div className="eyebrow">Staff · Moderation</div>
            <h1>Campaign review</h1>
          </div>
          <div>
            <div className="who">{who}</div>
            <div style={{ textAlign: "right" }}>
              <button className="signout" onClick={() => signOut(auth).then(() => navigate("/"))}>Sign out</button>
            </div>
          </div>
        </div>

        <div className="seg" style={{ marginBottom: "18px" }}>
          <button className={view === "campaigns" ? "active" : ""} onClick={() => switchView("campaigns")}>Campaigns</button>
          <button className={view === "users" ? "active" : ""} onClick={() => switchView("users")}>Users <span className="count">{usersLoaded ? users.length : ""}</span></button>
          <button className={view === "loops" ? "active" : ""} onClick={() => switchView("loops")}>Loop Claims <span className="count">{claimsLoaded ? claims.length : ""}</span></button>
        </div>

        {/* CAMPAIGNS */}
        {view === "campaigns" && (
          <div>
            <div className="stats-bar">
              <div className="stat-chip"><div className="v">{gate === "error" ? "—" : stats.pending}</div><div className="l">Pending review</div></div>
              <div className="stat-chip"><div className="v">{gate === "error" ? "—" : stats.week}</div><div className="l">Approved this week</div></div>
              <div className="stat-chip"><div className="v">{gate === "error" ? "—" : stats.pitched}</div><div className="l">Successfully pitched</div></div>
            </div>

            <div className="filters">
              <input className="search-inp" placeholder="Search by producer name or Instagram…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <select className="filter-sel" value={pkg} onChange={(e) => setPkg(e.target.value)}>
                <option value="">All packages</option>
                <option value="starter">Starter</option>
                <option value="pro">Pro</option>
                <option value="label">Label</option>
              </select>
            </div>

            <div className="seg">
              <button className={tab === "pending" ? "active" : ""} onClick={() => setTab("pending")}>Pending <span className="count">{counts.pending}</span></button>
              <button className={tab === "approved" ? "active" : ""} onClick={() => setTab("approved")}>Approved <span className="count">{counts.approved}</span></button>
              <button className={tab === "rejected" ? "active" : ""} onClick={() => setTab("rejected")}>Rejected <span className="count">{counts.rejected}</span></button>
            </div>

            <div>
              {gate === "error"
                ? <div className="state">Could not load campaigns: {loadErr}</div>
                : filteredCampaigns.length === 0
                  ? <div className="state">No {tab} campaigns{search ? " matching your search" : ""}.</div>
                  : filteredCampaigns.map((c) => <CampaignCard key={c.path} c={c} onApprove={decide} onReject={(path) => setReject({ path, reason: "Low quality mix", note: "" })} onRetry={repitch} />)}
            </div>
          </div>
        )}

        {/* USERS */}
        {view === "users" && (
          <div>
            <input className="search-inp" placeholder="Search users by name, email, location or UID…" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} style={{ marginBottom: "16px", width: "100%" }} />
            <div>
              {!usersLoaded ? <div className="state">Loading users…</div>
                : filteredUsers.length === 0 ? <div className="state">No users found.</div>
                  : filteredUsers.map(({ u, i }) => (
                    <div className="urow" key={u.uid} onClick={() => setOpenIdx(i)}>
                      <div className="uavatar" style={u.avatarUrl ? { backgroundImage: `url('${u.avatarUrl}')` } : undefined}>{u.avatarUrl ? "" : (u.displayName || u.email || "?")[0].toUpperCase()}</div>
                      <div>
                        <div className="un">{u.displayName || "—"}{u.verifiedPuller && <span style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", padding: "2px 8px", borderRadius: "999px", background: "rgba(124,226,164,.14)", color: "var(--ok)", marginLeft: "6px" }}>puller</span>}</div>
                        <div className="ue">{u.email || ""}</div>
                      </div>
                      <div className="uloc">{u.location || ""}</div>
                    </div>
                  ))}
            </div>
          </div>
        )}

        {/* LOOP CLAIMS */}
        {view === "loops" && (
          <div>
            {!claimsLoaded ? <div className="state">Loading loop claims…</div>
              : claims.length === 0 ? <div className="state">No loop claims yet.</div>
                : claims.map((c, i) => {
                  const date = c.createdAt ? new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
                  const statusColor = c.status === "placed" ? "var(--ok)" : "var(--gold)";
                  return (
                    <div className="card" style={{ padding: "16px 20px" }} key={i}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontSize: "13px", marginBottom: "6px" }}><span style={{ color: "var(--bone-dim)" }}>Loop</span> <span className="mono" style={{ fontSize: "11px", background: "var(--ink)", border: "1px solid var(--line)", borderRadius: "6px", padding: "2px 7px", margin: "0 4px" }}>{c.loopId}</span></div>
                          <div style={{ fontSize: "13px" }}><span style={{ color: "var(--bone-dim)" }}>Maker</span> <span className="mono" style={{ fontSize: "11px", marginLeft: "6px" }}>{c.makerUid}</span></div>
                          <div style={{ fontSize: "13px", marginTop: "4px" }}><span style={{ color: "var(--bone-dim)" }}>Puller</span> <span className="mono" style={{ fontSize: "11px", marginLeft: "6px" }}>{c.pullerUid}</span></div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <span className="badge" style={{ background: "rgba(228,193,107,.16)", color: statusColor }}>{c.status || "pending"}</span>
                          <div style={{ fontSize: "11px", color: "var(--bone-dim)", marginTop: "6px" }}>{date}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
          </div>
        )}
      </main>

      {openIdx !== null && users[openIdx] && (
        <UserModal user={users[openIdx]} idx={openIdx} onClose={() => setOpenIdx(null)}
          onToggleVP={toggleVP} onToggleVL={toggleVL} onAdjust={adjustCredits} onToggleBan={toggleBan} />
      )}

      {reject && (
        <div className="overlay show" onClick={(e) => { if (e.target === e.currentTarget) setReject(null); }}>
          <div className="modal">
            <button className="x" onClick={() => setReject(null)} aria-label="Close">✕</button>
            <h3>Reject campaign</h3>
            <label>Reason</label>
            <select value={reject.reason} onChange={(e) => setReject((r) => ({ ...r, reason: e.target.value }))}>
              <option>Low quality mix</option>
              <option>Wrong genre</option>
              <option>Needs revision</option>
              <option>Incomplete submission</option>
              <option>Does not meet quality standards</option>
              <option>Other</option>
            </select>
            <label>Additional note (optional — sent to producer)</label>
            <textarea placeholder="e.g. The mix is too muddy on the low end — resubmit after mastering." value={reject.note} onChange={(e) => setReject((r) => ({ ...r, note: e.target.value }))} />
            <div className="modal-actions">
              <button className="btn btn-reject" disabled={reject.busy} onClick={confirmReject}>{reject.busy ? "Rejecting…" : "Confirm rejection"}</button>
              <button className="btn" style={{ background: "var(--ink-2)", color: "var(--bone-dim)", borderColor: "var(--line-strong)" }} onClick={() => setReject(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div id="staff-toast" className={toast ? "show" : ""}>{toast}</div>
    </div>
  );
}

function CampaignCard({ c, onApprove, onReject, onRetry }) {
  const isPending = c.status === "pending_review";
  const isSendFailed = c.status === "send_failed";
  const showDetail = ["pitched", "approved", "send_failed"].includes(c.status);
  const statusLabel = (c.status || "").replace(/_/g, " ");

  return (
    <div className="card">
      <div className="crow">
        <div>
          <h3 style={{ fontSize: "18px" }}>
            {c.producer.name || "Unknown producer"}
            {c.producer.instagram && <span className="bspec" style={{ fontSize: "13px", fontWeight: 400 }}> {c.producer.instagram}</span>}
          </h3>
          <div className="contact-row">
            {c.producer.email && <span className="contact-chip"><svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m2 7 10 7 10-7" /></svg>{c.producer.email}</span>}
            {c.producer.phone && <span className="contact-chip"><svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.35 2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.6a16 16 0 0 0 6.29 6.29l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></svg>{c.producer.phone}</span>}
          </div>
          <div className="cmeta" style={{ marginTop: "8px" }}>{c.package || "—"} package · {c.pitches} guaranteed pitches · {c.beats.length} beat{c.beats.length !== 1 ? "s" : ""} · {fmtDate(c.createdAt)}</div>
          <div className="cmeta mono" style={{ fontSize: "11px" }}>{c.id}</div>
        </div>
        <span className={`badge ${c.status}`}>{statusLabel}</span>
      </div>

      {c.beats.map((b, i) => {
        const spec = [b.genre, b.key, b.bpm && b.bpm + " BPM"].filter(Boolean).join(" · ");
        return (
          <div className="beat" key={i}>
            <div className="bt"><span className="bname">{b.title}</span><span className="bspec">{spec}</span></div>
            {b.playUrl ? <audio controls preload="none" src={b.playUrl} /> : <div className="bspec" style={{ marginTop: "8px" }}>No file</div>}
            {(b.collabs || []).length > 0 && (
              <div className="collabs">{b.collabs.map((x, j) => <span key={j}>{x.name}{x.instagram ? " " + x.instagram : ""}{x.role ? " · " + x.role : ""}</span>)}</div>
            )}
          </div>
        );
      })}

      <div className="targets">Targets: {c.targets.length ? c.targets.join(", ") : "—"}</div>

      {showDetail && <PitchDetail c={c} />}

      {isPending && (
        <div className="actions">
          <button className="btn btn-approve" onClick={() => onApprove(c.path)}>Approve &amp; pitch</button>
          <button className="btn btn-reject" onClick={() => onReject(c.path)}>Reject</button>
        </div>
      )}
      {isSendFailed && (
        <div className="actions">
          <button className="btn btn-retry" onClick={() => onRetry(c.path)}>↺ Retry pitch</button>
        </div>
      )}
    </div>
  );
}

function PitchDetail({ c }) {
  if (!c.pitchedTo?.length) return null;
  const byContact = new Map();
  c.pitchedTo.forEach((email) => byContact.set(email, { opened: false, downloaded: false, last: null }));
  (c.events || []).forEach((e) => {
    const rec = byContact.get(e.contact);
    if (!rec) return;
    if (e.type === "opened") rec.opened = true;
    if (e.type === "downloaded") rec.downloaded = true;
    if (e.timestamp && (!rec.last || e.timestamp > rec.last)) rec.last = e.timestamp;
  });
  return (
    <div className="pitch-detail">
      <div className="pitch-detail-head">
        Pitch tracking
        <span className="pstat">{c.pitchedTo.length} contacted</span>
        <span className="pstat">{c.opens} opens</span>
        <span className="pstat">{c.downloads} downloads</span>
      </div>
      <table className="pitch-table">
        <thead><tr><th>Contact</th><th>Opened</th><th>Downloaded</th><th>Last activity</th></tr></thead>
        <tbody>
          {[...byContact.entries()].map(([email, rec]) => (
            <tr key={email}>
              <td>{email}</td>
              <td>{rec.opened ? <span className="badge-sm opened">Opened</span> : <span style={{ color: "var(--bone-dim)" }}>—</span>}</td>
              <td>{rec.downloaded ? <span className="badge-sm downloaded">Downloaded</span> : <span style={{ color: "var(--bone-dim)" }}>—</span>}</td>
              <td style={{ color: "var(--bone-dim)" }}>{fmtDate(rec.last)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserModal({ user: u, idx, onClose, onToggleVP, onToggleVL, onAdjust, onToggleBan }) {
  const [pitchAmt, setPitchAmt] = useState("5");
  const [loopAmt, setLoopAmt] = useState("5");
  const initial = (u.displayName || u.email || "?")[0].toUpperCase();
  const tierBg = { free: "rgba(163,157,172,.16)", plugg: "rgba(228,193,107,.16)", pro: "rgba(124,226,164,.14)" }[u.tier] || "rgba(163,157,172,.16)";
  const tierCol = { free: "var(--bone-dim)", plugg: "var(--gold)", pro: "var(--ok)" }[u.tier] || "var(--bone-dim)";

  const metaChips = [];
  if (u.location) metaChips.push(<span key="loc" style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px", color: "var(--bone-dim)" }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>{u.location}</span>);
  if (u.createdAt) metaChips.push(<span key="joined" style={{ fontSize: "12px", color: "var(--bone-dim)" }}>Joined {new Date(u.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>);
  if (u.phone) metaChips.push(<span key="phone" style={{ fontSize: "12px", color: "var(--bone-dim)" }}>{u.phone}</span>);

  const adjBtn = (kind, sign, getAmt) => (
    <button style={{ flex: 1, padding: "6px 0", borderRadius: "7px", border: `1px solid ${sign > 0 ? "var(--ok)" : "var(--bad)"}`, background: sign > 0 ? "rgba(124,226,164,.12)" : "rgba(255,107,107,.10)", color: sign > 0 ? "var(--ok)" : "var(--bad)", fontSize: "12px", fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}
      onClick={() => onAdjust(idx, kind, sign, getAmt())}>{sign > 0 ? "＋" : "－"}</button>
  );

  return (
    <div className="overlay show" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="umodal" role="dialog" aria-modal="true">
        <button className="x" onClick={onClose} aria-label="Close">✕</button>
        <div className="udetail-head">
          <div className="big" style={u.avatarUrl ? { backgroundImage: `url('${u.avatarUrl}')` } : undefined}>{u.avatarUrl ? "" : initial}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <h2 style={{ fontSize: "20px" }}>{u.displayName || "—"}</h2>
              <span style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: ".1em", textTransform: "uppercase", padding: "3px 9px", borderRadius: "999px", background: tierBg, color: tierCol }}>{u.tier || "free"}</span>
              {u.banned && <span style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: ".1em", textTransform: "uppercase", padding: "3px 9px", borderRadius: "999px", background: "rgba(255,107,107,.16)", color: "var(--bad)" }}>banned</span>}
            </div>
            <div style={{ fontSize: "13px", color: "var(--bone-dim)", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email || ""}</div>
            <div style={{ marginTop: "6px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px" }}>{metaChips}</div>
          </div>
        </div>
        {u.bio && <div style={{ fontSize: "13px", color: "var(--bone-dim)", margin: "2px 0 12px", lineHeight: 1.5, padding: "10px 14px", background: "var(--ink)", borderRadius: "10px", border: "1px solid var(--line)" }}>{u.bio}</div>}
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: ".06em", color: "var(--bone-dim)", marginBottom: "12px", wordBreak: "break-all" }}>{u.uid}</div>

        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: ".12em", textTransform: "uppercase", color: "var(--gold)", marginBottom: "8px" }}>Credits</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "14px" }}>
          <div style={{ background: "var(--ink)", border: "1px solid var(--line)", borderRadius: "12px", padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "10px" }}>
              <span style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--bone-dim)" }}>Pitch</span>
              <span style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: "24px" }}>{u.pitchBalance || 0}</span>
            </div>
            <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
              <input type="number" min="1" value={pitchAmt} onChange={(e) => setPitchAmt(e.target.value)} style={{ width: "52px", background: "var(--ink-2)", border: "1px solid var(--line-strong)", color: "var(--bone)", padding: "5px 8px", borderRadius: "7px", fontSize: "13px", fontFamily: "inherit", textAlign: "center" }} />
              {adjBtn("pitch", 1, () => pitchAmt)}
              {adjBtn("pitch", -1, () => pitchAmt)}
            </div>
          </div>
          <div style={{ background: "var(--ink)", border: "1px solid var(--line)", borderRadius: "12px", padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "10px" }}>
              <span style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--bone-dim)" }}>Loop</span>
              <span style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: "24px" }}>{u.loopBalance || 0}</span>
            </div>
            <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
              <input type="number" min="1" value={loopAmt} onChange={(e) => setLoopAmt(e.target.value)} style={{ width: "52px", background: "var(--ink-2)", border: "1px solid var(--line-strong)", color: "var(--bone)", padding: "5px 8px", borderRadius: "7px", fontSize: "13px", fontFamily: "inherit", textAlign: "center" }} />
              {adjBtn("loop", 1, () => loopAmt)}
              {adjBtn("loop", -1, () => loopAmt)}
            </div>
          </div>
        </div>

        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: ".12em", textTransform: "uppercase", color: "var(--gold)", marginBottom: "8px" }}>Access</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--ink)", border: "1px solid var(--line)", borderRadius: "10px", padding: "11px 14px" }}>
            <div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: u.verifiedPuller ? "var(--ok)" : "var(--bone-dim)" }}>{u.verifiedPuller ? "Verified puller" : "Loop pull — not granted"}</div>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: ".06em", color: "var(--bone-dim)", marginTop: "2px" }}>LOOP POOL ACCESS</div>
            </div>
            <button className="btn" style={{ fontSize: "12px", padding: "7px 14px", flexShrink: 0, background: u.verifiedPuller ? "rgba(255,107,107,.12)" : "rgba(124,226,164,.14)", color: u.verifiedPuller ? "var(--bad)" : "var(--ok)", borderColor: u.verifiedPuller ? "var(--bad)" : "var(--ok)" }} onClick={() => onToggleVP(idx)}>{u.verifiedPuller ? "Revoke" : "Grant"}</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--ink)", border: "1px solid var(--line)", borderRadius: "10px", padding: "11px 14px" }}>
            <div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: u.verifiedListener ? "var(--info)" : "var(--bone-dim)" }}>{u.verifiedListener ? "Verified listener" : "Beat library — not granted"}</div>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: ".06em", color: "var(--bone-dim)", marginTop: "2px" }}>A&amp;R / ARTIST LIBRARY</div>
            </div>
            <button className="btn" style={{ fontSize: "12px", padding: "7px 14px", flexShrink: 0, background: u.verifiedListener ? "rgba(255,107,107,.12)" : "rgba(110,193,255,.14)", color: u.verifiedListener ? "var(--bad)" : "var(--info)", borderColor: u.verifiedListener ? "var(--bad)" : "var(--info)" }} onClick={() => onToggleVL(idx)}>{u.verifiedListener ? "Revoke" : "Grant"}</button>
          </div>
        </div>

        <button onClick={() => onToggleBan(idx)} style={{ width: "100%", padding: "11px", borderRadius: "10px", border: `1px solid ${u.banned ? "var(--ok)" : "rgba(255,107,107,.4)"}`, background: u.banned ? "rgba(124,226,164,.08)" : "rgba(255,107,107,.06)", color: u.banned ? "var(--ok)" : "var(--bad)", fontSize: "13px", fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
          {u.banned ? "Unban this user" : "Ban this user"}
        </button>
      </div>
    </div>
  );
}
