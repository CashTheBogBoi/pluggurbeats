import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "../firebase.js";
import "./Dashboard.css";

// Backend (Firestore / Cloud Functions / Storage) was removed for a full
// rebuild. This is an authenticated shell: it gates on a verified sign-in and
// otherwise shows a placeholder. Re-wire data + features on top of this.
export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u || !u.emailVerified) { signOut(auth).then(() => navigate("/")); return; }
      setUser(u);
      setReady(true);
    });
    return () => unsub();
  }, [navigate]);

  if (!ready) {
    return <div id="dash-root"><div style={{ padding: "120px 20px", textAlign: "center", color: "var(--bone-dim)" }}>Loading…</div></div>;
  }

  const name = user.displayName || user.email;

  return (
    <div id="dash-root">
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "40px 20px" }}>
        <div className="card" style={{ maxWidth: "520px", textAlign: "center", padding: "44px 32px" }}>
          <div className="brand" style={{ justifyContent: "center", padding: 0, marginBottom: "18px" }}>
            <span className="eqmini"><i /><i /><i /><i /></span> PluggurBeats
          </div>
          <div className="eyebrow" style={{ marginBottom: "10px" }}>Signed in</div>
          <h1 style={{ fontSize: "26px", marginBottom: "10px" }}>Studio is being rebuilt</h1>
          <p className="hint" style={{ lineHeight: 1.6, marginBottom: "26px" }}>
            Welcome back, {name}. The dashboard backend (campaigns, credits, loops, billing)
            is being rebuilt from scratch. Your account is intact — features will return here soon.
          </p>
          <button className="btn btn-ghost" onClick={() => signOut(auth).then(() => navigate("/"))}>Sign out</button>
        </div>
      </div>
    </div>
  );
}
