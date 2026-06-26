import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  sendEmailVerification,
  sendPasswordResetEmail,
  onAuthStateChanged
} from "firebase/auth";
import { auth } from "../firebase/auth.js";
import { getSignedInHome } from "../lib/userRouting.js";
import { ensureUserProfile } from "../lib/userProfile.js";

// Create the account, write the user doc (credit/subscription fields start at
// defaults and can only change via Cloud Functions per firestore.rules), send
// the verification email, then sign back out so the user must verify first.
async function signUp(email, pass, name) {
  if (!email || !pass) throw new Error("Email and password required.");
  if (pass.length < 6) throw new Error("Password must be at least 6 characters.");
  const cred = await createUserWithEmailAndPassword(auth, email, pass);
  if (name) await updateProfile(cred.user, { displayName: name });
  await ensureUserProfile(cred.user, { displayName: name || "" });
  await sendEmailVerification(cred.user);
  await signOut(auth);
}

export default function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState("signin"); // signin | signup
  const [resetMode, setResetMode] = useState(false);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const isSignup = mode === "signup";

  // If a verified user is already signed in (app relaunch), skip straight in.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u && u.emailVerified) navigate(await getSignedInHome(u));
    });
    return () => unsub();
  }, [navigate]);

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      if (resetMode) {
        if (!email) throw new Error("Enter your email address.");
        await sendPasswordResetEmail(auth, email);
        setMsg({ text: "Reset link sent — check your inbox.", kind: "ok" });
        return;
      }
      if (isSignup) {
        await signUp(email, pass, name);
        setMsg({ text: "Account created! Check your email for a verification link, then sign in.", kind: "ok" });
        setMode("signin");
      } else {
        const cred = await signInWithEmailAndPassword(auth, email, pass);
        if (!cred.user.emailVerified) {
          await signOut(auth);
          setMsg({ text: "Please verify your email before signing in. Check your inbox.", kind: "err" });
          return;
        }
        setMsg({ text: "Signed in — taking you in…", kind: "ok" });
        const home = await getSignedInHome(cred.user);
        setTimeout(() => navigate(home), 400);
      }
    } catch (e) {
      setMsg({ text: e.message, kind: "err" });
    } finally {
      setBusy(false);
    }
  }

  const onKeyDown = (e) => { if (e.key === "Enter") submit(); };

  return (
    <div className="auth-page">
      <div className="auth-glow" aria-hidden="true"></div>
      <div className="auth-card">
        <div className="auth-brand"><span className="dot"></span>PluggurBeats</div>

        {resetMode ? (
          <>
            <button className="auth-back" onClick={() => { setResetMode(false); setMsg(null); }}>
              ← Back to sign in
            </button>
            <h1 className="auth-title">Reset your password</h1>
            <p className="auth-sub">Enter your email and we'll send you a link to set a new password.</p>
            <div className="field">
              <label>Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@studio.com" autoComplete="email" autoFocus onKeyDown={onKeyDown} />
            </div>
            {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
            <button className="btn btn-gold btn-block" style={{ marginTop: "18px" }} disabled={busy} onClick={submit}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </>
        ) : (
          <>
            <h1 className="auth-title">{isSignup ? "Create your account" : "Welcome back"}</h1>
            <p className="auth-sub">{isSignup ? "Start pitching beats to verified contacts." : "Sign in to your producer dashboard."}</p>

            <div className="tabs">
              <button className={!isSignup ? "active" : ""} onClick={() => { setMode("signin"); setMsg(null); }}>Sign in</button>
              <button className={isSignup ? "active" : ""} onClick={() => { setMode("signup"); setMsg(null); }}>Create account</button>
            </div>

            {isSignup && (
              <div className="field">
                <label>Producer / tag name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} type="text" placeholder="e.g. prodbynova" autoComplete="nickname" onKeyDown={onKeyDown} />
              </div>
            )}
            <div className="field">
              <label>Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@studio.com" autoComplete="email" onKeyDown={onKeyDown} />
            </div>
            <div className="field">
              <label>Password</label>
              <input value={pass} onChange={(e) => setPass(e.target.value)} type="password" placeholder="••••••••" autoComplete={isSignup ? "new-password" : "current-password"} onKeyDown={onKeyDown} />
            </div>

            {!isSignup && (
              <button className="auth-forgot" onClick={() => { setResetMode(true); setMsg(null); setPass(""); }}>
                Forgot your password?
              </button>
            )}

            {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}

            <button className="btn btn-gold btn-block" style={{ marginTop: "18px" }} disabled={busy} onClick={submit}>
              {busy ? "Working…" : isSignup ? "Create account" : "Sign in"}
            </button>

          </>
        )}
      </div>
    </div>
  );
}
