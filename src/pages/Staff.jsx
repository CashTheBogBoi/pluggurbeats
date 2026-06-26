import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { auth } from "../firebase/auth.js";
import { call } from "../lib/live.js";
import { isArRole, VERIFIED_ROLES, verifiedRoleLabel } from "../lib/roles.js";
import "./Staff.css";

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

export default function Staff() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [who, setWho] = useState("");
  const [ready, setReady] = useState(false);
  const [view, setView] = useState("campaigns");
  const [staffNavOpen, setStaffNavOpen] = useState(false);
  const [tab, setTab] = useState("pending");
  const [search, setSearch] = useState("");
  const [pkg, setPkg] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [openIdx, setOpenIdx] = useState(null);
  const [reject, setReject] = useState(null); // { path, reason, note, busy }
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);

  const showToast = (t) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2800);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user || !user.emailVerified) { navigate("/"); return; }
      setWho(user.email);
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

  // Non-staff users hit permission-denied → send them to their dashboard.
  useEffect(() => {
    const m = campaignsQ.error?.message || "";
    if (campaignsQ.error && /permission|denied|not authorized/i.test(m)) navigate("/dashboard");
  }, [campaignsQ.error, navigate]);

  const campaigns = campaignsQ.data || [];
  const users = usersQ.data || [];
  const claims = claimsQ.data || [];
  const gate = (!ready || campaignsQ.isLoading) ? "loading" : (campaignsQ.isError ? "error" : "ok");
  const loadErr = campaignsQ.error?.message || "";

  const switchView = (v) => {
    setView(v);
    setStaffNavOpen(false);
    window.scrollTo(0, 0);
  };
  const refreshCampaigns = () => qc.invalidateQueries({ queryKey: ["staff", "campaigns"] });
  const refreshUsers = () => qc.invalidateQueries({ queryKey: ["staff", "users"] });

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
      await call("moderateCampaign", { path: reject.path, decision: "rejected", reason: reject.reason, note: (reject.note || "").trim() });
      refreshCampaigns();
      setReject(null);
      showToast("Campaign rejected — producer notified by email.");
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
    return <div id="staff-root"><div className="state" style={{ paddingTop: "120px" }}>Checking access…</div></div>;
  }

  const activeMeta = {
    campaigns: {
      eyebrow: "Staff / Campaigns",
      title: "Campaign queue",
      desc: "Review submissions, inspect beats, and push approved campaigns into the pitch flow."
    },
    users: {
      eyebrow: "Staff / Users",
      title: "User control",
      desc: "Find accounts, manage credits, grant access, and handle user status."
    },
    loops: {
      eyebrow: "Staff / Loops",
      title: "Loop claims",
      desc: "Track loop pull activity and placements across the verified pool."
    }
  }[view];

  return (
    <div id="staff-root">
      {staffNavOpen && <div className="staff-scrim" onClick={() => setStaffNavOpen(false)} />}
      <div className="staff-app">
        <aside className={`staff-rail ${staffNavOpen ? "open" : ""}`}>
          <div className="brand">
            <span className="eqmini"><i /><i /><i /><i /></span>
            <span>PLUGGUR Staff</span>
            <button className="rail-close" onClick={() => setStaffNavOpen(false)} aria-label="Close staff navigation">x</button>
          </div>

          <div className="rail-label">Workspace</div>
          <button className={`navitem ${view === "campaigns" ? "active" : ""}`} onClick={() => switchView("campaigns")}>
            <span className="nav-dot pending" /> Campaigns <span>{campaigns.length || ""}</span>
          </button>
          <button className={`navitem ${view === "users" ? "active" : ""}`} onClick={() => switchView("users")}>
            <span className="nav-dot users" /> Users <span>{users.length || ""}</span>
          </button>
          <button className={`navitem ${view === "loops" ? "active" : ""}`} onClick={() => switchView("loops")}>
            <span className="nav-dot loops" /> Loop Claims <span>{claims.length || ""}</span>
          </button>

          <div className="rail-label">Live Queue</div>
          <div className="rail-stat urgent"><span>Time sensitive</span><strong>{gate === "error" ? "--" : stats.sensitive}</strong></div>
          <div className="rail-stat"><span>Pending</span><strong>{gate === "error" ? "--" : stats.pending}</strong></div>
          <div className="rail-stat"><span>Pitched</span><strong>{gate === "error" ? "--" : stats.pitched}</strong></div>
          <div className="rail-stat"><span>This week</span><strong>{gate === "error" ? "--" : stats.week}</strong></div>

          <div className="rail-footer">
            <div className="rail-links">
              <button onClick={() => navigate("/verified")}>Verified</button>
              <button onClick={() => navigate("/dashboard")}>Dashboard</button>
            </div>
            <div className="who">{who}</div>
            <button className="signout" onClick={() => signOut(auth).then(() => navigate("/"))}>Sign out</button>
          </div>
        </aside>

        <main>
          <div className="head">
            <div>
              <div className="eyebrow">{activeMeta.eyebrow}</div>
              <h1>{activeMeta.title}</h1>
              <p>{activeMeta.desc}</p>
            </div>
            <div className="head-actions">
              <button onClick={() => navigate("/verified")}>Verified</button>
              <button onClick={() => navigate("/dashboard")}>Dashboard</button>
              <div className="head-card">
                <span>Refresh</span>
                <strong>{view === "campaigns" ? "15s" : "20s"}</strong>
              </div>
            </div>
            <button className="staff-menu" onClick={() => setStaffNavOpen(true)} aria-label="Open staff navigation">Menu</button>
          </div>

        {/* CAMPAIGNS */}
        {view === "campaigns" && (
          <section className="workspace">
            <div className="stats-bar">
              <div className="stat-chip urgent"><div className="v">{gate === "error" ? "—" : stats.sensitive}</div><div className="l">Time sensitive</div></div>
              <div className="stat-chip"><div className="v">{gate === "error" ? "—" : stats.pending}</div><div className="l">Pending review</div></div>
              <div className="stat-chip"><div className="v">{gate === "error" ? "—" : stats.week}</div><div className="l">Approved this week</div></div>
              <div className="stat-chip"><div className="v">{gate === "error" ? "—" : stats.pitched}</div><div className="l">Successfully pitched</div></div>
            </div>

            <div className="queue-panel">
              <div className="queue-tools">
                <div className="seg">
                  <button className={tab === "pending" ? "active" : ""} onClick={() => setTab("pending")}>Pending <span className="count">{counts.pending}</span></button>
                  <button className={tab === "approved" ? "active" : ""} onClick={() => setTab("approved")}>Approved <span className="count">{counts.approved}</span></button>
                  <button className={tab === "rejected" ? "active" : ""} onClick={() => setTab("rejected")}>Rejected <span className="count">{counts.rejected}</span></button>
                </div>
                <div className="filters">
                  <input className="search-inp" placeholder="Search producer or Instagram" value={search} onChange={(e) => setSearch(e.target.value)} />
                  <select className="filter-sel" value={pkg} onChange={(e) => setPkg(e.target.value)}>
                    <option value="">All packages</option>
                    <option value="starter">Starter</option>
                    <option value="pro">Pro</option>
                    <option value="label">Label</option>
                  </select>
                  <button className="btn" disabled={backfillBusy} onClick={runVerifiedBackfill}>
                    {backfillBusy ? "Indexing..." : "Backfill beat index"}
                  </button>
                </div>
              </div>

              <div className="queue-head">
                <span>#</span>
                <span>Producer</span>
                <span>Package</span>
                <span>Beats</span>
                <span>Status</span>
              </div>

              <div className="queue-list">
                {gate === "error"
                  ? <div className="state">Could not load campaigns: {loadErr}</div>
                  : filteredCampaigns.length === 0
                    ? <div className="state">No {tab} campaigns{search ? " matching your search" : ""}.</div>
                    : filteredCampaigns.map((c, i) => (
                      <CampaignCard
                        key={c.path}
                        c={c}
                        index={i + 1}
                        onApprove={decide}
                        onReject={(path) => setReject({ path, reason: "Low quality mix", note: "" })}
                        onRetry={repitch}
                      />
                    ))}
              </div>
            </div>
          </section>
        )}

        {/* USERS */}
        {view === "users" && (
          <section className="workspace">
            <div className="queue-panel">
              <div className="queue-tools solo">
                <input className="search-inp" placeholder="Search users by name, email, location, or UID" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
              </div>
              <div className="user-head">
                <span>User</span>
                <span>Tier</span>
                <span>Credits</span>
                <span>Access</span>
              </div>
              <div className="queue-list">
              {usersQ.isLoading ? <div className="state">Loading users…</div>
                : filteredUsers.length === 0 ? <div className="state">No users found.</div>
                  : filteredUsers.map(({ u, i }) => (
                    <div className="urow" key={u.uid} onClick={() => setOpenIdx(i)}>
                      <div className="uavatar" style={u.avatarUrl ? { backgroundImage: `url('${u.avatarUrl}')` } : undefined}>{u.avatarUrl ? "" : (u.displayName || u.email || "?")[0].toUpperCase()}</div>
                      <div className="uidentity">
                        <div className="un">{u.displayName || "—"}{u.banned && <span className="mini-badge bad">banned</span>}</div>
                        <div className="ue">{u.email || ""}</div>
                        {u.verifiedRole && <div className="urole-line">{verifiedRoleLabel(u.verifiedRole)}{u.labelName ? ` · ${u.labelName}` : ""}</div>}
                      </div>
                      <div className="tier-pill">{u.tier || "free"}</div>
                      <div className="credit-stack"><span>{u.pitchBalance || 0} pitch</span><span>{u.loopBalance || 0} loop</span></div>
                      <div className="access-stack">
                        {u.verifiedPuller && <span className="mini-badge ok">puller</span>}
                        {u.verifiedListener && <span className="mini-badge info">listener</span>}
                        {u.verifiedRole && <span className="mini-badge role">{verifiedRoleLabel(u.verifiedRole)}</span>}
                        {u.staff && <span className="mini-badge staff">staff</span>}
                        {!u.verifiedPuller && !u.verifiedListener && !u.staff && <span className="muted">standard</span>}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </section>
        )}

        {/* LOOP CLAIMS */}
        {view === "loops" && (
          <section className="workspace">
            <div className="queue-panel">
              <div className="loop-head">
                <span>Loop</span>
                <span>Maker</span>
                <span>Puller</span>
                <span>Status</span>
              </div>
              <div className="queue-list">
                {claimsQ.isLoading ? <div className="state">Loading loop claims…</div>
                  : claims.length === 0 ? <div className="state">No loop claims yet.</div>
                    : claims.map((c, i) => <LoopClaimRow key={`${c.loopId || "loop"}-${i}`} claim={c} />)}
              </div>
            </div>
          </section>
        )}
      </main>
      </div>

      <nav className="staff-bottom-nav">
        <button className={view === "campaigns" ? "active" : ""} onClick={() => switchView("campaigns")}>
          <span>Queue</span>
          <strong>{counts.pending}</strong>
        </button>
        <button className={view === "users" ? "active" : ""} onClick={() => switchView("users")}>
          <span>Users</span>
          <strong>{users.length || 0}</strong>
        </button>
        <button className={view === "loops" ? "active" : ""} onClick={() => switchView("loops")}>
          <span>Loops</span>
          <strong>{claims.length || 0}</strong>
        </button>
      </nav>

      {openIdx !== null && users[openIdx] && (
        <UserModal user={users[openIdx]} idx={openIdx} onClose={() => setOpenIdx(null)}
          onToggleVP={toggleVP} onToggleVL={toggleVL} onToggleStaff={toggleStaff} onSaveRole={saveVerifiedRole} onAdjust={adjustCredits} onToggleBan={toggleBan} />
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

function CampaignCard({ c, index, onApprove, onReject, onRetry }) {
  const isPending = c.status === "pending_review";
  const isSendFailed = c.status === "send_failed";
  const showDetail = ["pitched", "approved", "send_failed"].includes(c.status);
  const statusLabel = (c.status || "").replace(/_/g, " ");
  const producer = c.producer || {};
  const beats = c.beats || [];
  const targets = c.targets || [];

  return (
    <article className="campaign-row">
      <div className="campaign-summary">
        <div className="row-index">{index}</div>
        <div className="producer-block">
          <h3>{producer.name || "Unknown producer"}</h3>
          <div className="producer-meta">
            {producer.instagram && <span>{producer.instagram}</span>}
            {producer.email && <span>{producer.email}</span>}
            {producer.phone && <span>{producer.phone}</span>}
          </div>
        </div>
        <div className="package-cell">
          <span>{c.package || "—"}</span>
          <div className="priority-tags">
            {c.timeSensitive && <span className="priority-pill urgent">{c.priorityLabel || "Time sensitive"}</span>}
            {c.rush && <span className="priority-pill rush">Rush</span>}
            {c.tier === "pro" && <span className="priority-pill pro">Pro</span>}
          </div>
        </div>
        <div className="beat-count">{beats.length}<span>{c.pitches} pitches</span></div>
        <span className={`badge ${c.status}`}>{statusLabel}</span>
      </div>

      <div className="campaign-detail">
        <div className="detail-strip">
          <span>{fmtDate(c.createdAt)}</span>
          <span className="mono">{c.id}</span>
          <span>Targets: {targets.length ? targets.join(", ") : "—"}</span>
        </div>

        {beats.map((b, i) => {
          const spec = [b.genre, b.key, b.bpm && b.bpm + " BPM"].filter(Boolean).join(" · ");
          return (
            <div className="beat" key={i}>
              <div className="bt"><span className="bname">{b.title}</span><span className="bspec">{spec}</span></div>
              {b.playUrl ? <audio controls preload="none" src={b.playUrl} /> : <div className="bspec">No file</div>}
              {(b.collabs || []).length > 0 && (
                <div className="collabs">{b.collabs.map((x, j) => <span key={j}>{x.name}{x.instagram ? " " + x.instagram : ""}{x.role ? " · " + x.role : ""}</span>)}</div>
              )}
            </div>
          );
        })}

        {showDetail && <PitchDetail c={c} />}

        {isPending && (
          <div className="actions">
            <button className="btn btn-approve" onClick={() => onApprove(c.path)}>Approve &amp; pitch</button>
            <button className="btn btn-reject" onClick={() => onReject(c.path)}>Reject</button>
          </div>
        )}
        {isSendFailed && (
          <div className="actions">
            <button className="btn btn-retry" onClick={() => onRetry(c.path)}>Retry pitch</button>
          </div>
        )}
      </div>
    </article>
  );
}

function LoopClaimRow({ claim: c }) {
  const date = c.createdAt ? new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
  return (
    <article className="loop-row">
      <div>
        <span className="mono chip">{c.loopId || "—"}</span>
        <small>{date}</small>
      </div>
      <div className="mono">{c.makerUid || "—"}</div>
      <div className="mono">{c.pullerUid || "—"}</div>
      <span className={`badge ${c.status === "placed" ? "approved" : "pending_review"}`}>{c.status || "pending"}</span>
    </article>
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
          {[...byContact.entries()].map(([key, rec]) => (
            <tr key={key}>
              <td>{rec.label}</td>
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

function UserModal({ user: u, idx, onClose, onToggleVP, onToggleVL, onToggleStaff, onSaveRole, onAdjust, onToggleBan }) {
  const [pitchAmt, setPitchAmt] = useState("5");
  const [loopAmt, setLoopAmt] = useState("5");
  const [role, setRole] = useState(u.verifiedRole || "");
  const [labelName, setLabelName] = useState(u.labelName || "");
  const [roleBusy, setRoleBusy] = useState(false);
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
  const roleIsAr = isArRole(role);
  const roleDirty = role !== (u.verifiedRole || "") || labelName.trim() !== (u.labelName || "");

  async function submitRole() {
    if (roleBusy) return;
    setRoleBusy(true);
    try {
      await onSaveRole(idx, role, roleIsAr ? labelName.trim() : "");
    } finally {
      setRoleBusy(false);
    }
  }

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
              {u.verifiedRole && <span style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: ".1em", textTransform: "uppercase", padding: "3px 9px", borderRadius: "999px", background: "rgba(124,92,255,.16)", color: "var(--violet-soft)" }}>{verifiedRoleLabel(u.verifiedRole)}</span>}
              {u.staff && <span style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: ".1em", textTransform: "uppercase", padding: "3px 9px", borderRadius: "999px", background: "rgba(228,193,107,.16)", color: "var(--gold)" }}>{u.staffLocked ? "owner staff" : "staff"}</span>}
              {u.banned && <span style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: ".1em", textTransform: "uppercase", padding: "3px 9px", borderRadius: "999px", background: "rgba(255,107,107,.16)", color: "var(--bad)" }}>banned</span>}
            </div>
            <div style={{ fontSize: "13px", color: "var(--bone-dim)", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email || ""}</div>
            <div style={{ marginTop: "6px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px" }}>{metaChips}</div>
          </div>
        </div>
        {u.bio && <div style={{ fontSize: "13px", color: "var(--bone-dim)", margin: "2px 0 12px", lineHeight: 1.5, padding: "10px 14px", background: "var(--ink)", borderRadius: "10px", border: "1px solid var(--line)" }}>{u.bio}</div>}
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: ".06em", color: "var(--bone-dim)", marginBottom: "12px", wordBreak: "break-all" }}>{u.uid}</div>

        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: ".12em", textTransform: "uppercase", color: "var(--gold)", marginBottom: "8px" }}>Verified role</div>
        <div style={{ display: "grid", gap: "8px", marginBottom: "14px", background: "var(--ink)", border: "1px solid var(--line)", borderRadius: "12px", padding: "12px" }}>
          <select
            value={role}
            onChange={(e) => {
              const next = e.target.value;
              setRole(next);
              if (!isArRole(next)) setLabelName("");
            }}
            style={{ width: "100%", background: "var(--ink-2)", border: "1px solid var(--line-strong)", color: "var(--bone)", padding: "9px 10px", borderRadius: "9px", fontSize: "13px", fontFamily: "inherit" }}
          >
            {VERIFIED_ROLES.map((opt) => <option key={opt.value || "none"} value={opt.value}>{opt.label}</option>)}
          </select>
          {roleIsAr && (
            <input
              value={labelName}
              onChange={(e) => setLabelName(e.target.value)}
              placeholder="Label name, e.g. Atlantic Records"
              maxLength={80}
              style={{ width: "100%", background: "var(--ink-2)", border: "1px solid var(--line-strong)", color: "var(--bone)", padding: "9px 10px", borderRadius: "9px", fontSize: "13px", fontFamily: "inherit" }}
            />
          )}
          <button className="btn" disabled={!roleDirty || roleBusy} style={{ width: "100%", padding: "9px 14px", fontSize: "12px", background: "rgba(228,193,107,.14)", color: "var(--gold)", borderColor: "rgba(228,193,107,.35)" }} onClick={submitRole}>
            {roleBusy ? "Saving..." : "Save verified role"}
          </button>
        </div>

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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--ink)", border: "1px solid var(--line)", borderRadius: "10px", padding: "11px 14px" }}>
            <div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: u.staff ? "var(--gold)" : "var(--bone-dim)" }}>{u.staff ? (u.staffLocked ? "Owner staff" : "Staff access") : "Staff access — not granted"}</div>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: ".06em", color: "var(--bone-dim)", marginTop: "2px" }}>STAFF BOARD + USER MANAGEMENT</div>
            </div>
            <button className="btn" disabled={u.staffLocked} style={{ fontSize: "12px", padding: "7px 14px", flexShrink: 0, background: u.staff ? "rgba(255,107,107,.12)" : "rgba(228,193,107,.14)", color: u.staff ? "var(--bad)" : "var(--gold)", borderColor: u.staff ? "var(--bad)" : "var(--gold)", opacity: u.staffLocked ? .45 : 1 }} onClick={() => onToggleStaff(idx)}>{u.staff ? "Revoke" : "Grant"}</button>
          </div>
        </div>

        <button onClick={() => onToggleBan(idx)} style={{ width: "100%", padding: "11px", borderRadius: "10px", border: `1px solid ${u.banned ? "var(--ok)" : "rgba(255,107,107,.4)"}`, background: u.banned ? "rgba(124,226,164,.08)" : "rgba(255,107,107,.06)", color: u.banned ? "var(--ok)" : "var(--bad)", fontSize: "13px", fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
          {u.banned ? "Unban this user" : "Ban this user"}
        </button>
      </div>
    </div>
  );
}
