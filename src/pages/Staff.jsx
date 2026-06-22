import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "../firebase.js";
import "./Staff.css";

// Backend removed for rebuild. Authenticated shell only — staff moderation
// tooling (campaigns, users, loop claims) will be rebuilt on top of this.
export default function Staff() {
  const navigate = useNavigate();
  const [who, setWho] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u || !u.emailVerified) { navigate("/"); return; }
      setWho(u.email);
      setReady(true);
    });
    return () => unsub();
  }, [navigate]);

  if (!ready) {
    return <div id="staff-root"><div className="state" style={{ paddingTop: "120px" }}>Checking access…</div></div>;
  }

  return (
    <div id="staff-root">
      <main>
        <div className="head">
          <div>
            <div className="eyebrow">Staff</div>
            <h1>Moderation rebuilding</h1>
          </div>
          <div>
            <div className="who">{who}</div>
            <div style={{ textAlign: "right" }}>
              <button className="signout" onClick={() => signOut(auth).then(() => navigate("/"))}>Sign out</button>
            </div>
          </div>
        </div>
        <div className="state" style={{ marginTop: "40px" }}>
          The staff backend was torn down for a full rebuild. Campaign review, user
          management, and loop claims will return here once the new backend is in place.
        </div>
      </main>
    </div>
  );
}
