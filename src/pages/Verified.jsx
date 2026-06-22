import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "../firebase.js";
import "./Verified.css";

// Backend removed for rebuild. Authenticated shell only — the Verified library
// (approved beats + loop pool) will be rebuilt on top of this.
export default function Verified() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u || !u.emailVerified) { navigate("/"); return; }
      setReady(true);
    });
    return () => unsub();
  }, [navigate]);

  if (!ready) {
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

  return (
    <div id="verified-root">
      <header className="site-header">
        <div className="brand">
          <span className="eq"><i /><i /><i /><i /></span>
          PluggUrBeat <span className="v-badge">VERIFIED</span>
        </div>
        <div className="header-right">
          <button className="btn-ghost-sm" onClick={() => signOut(auth).then(() => navigate("/"))}>Sign out</button>
        </div>
      </header>
      <main>
        <div className="gate-screen">
          <h2>Library rebuilding</h2>
          <p>The Verified library and loop pool backend was torn down for a full rebuild. Check back soon.</p>
          <a href="/" className="btn-gold">Back to PluggurBeats</a>
        </div>
      </main>
    </div>
  );
}
