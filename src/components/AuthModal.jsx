import { useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  sendEmailVerification
} from "firebase/auth";
import { auth, provider } from "../firebase.js";

// Create the account, set the display name, send the verification email, then
// sign back out so the user must verify before signing in. No backend doc is
// written here — the data layer is being rebuilt. (phone is collected for the
// future profile but not persisted yet.)
async function signUp(email, pass, name /* , phone */) {
  if (!email || !pass) throw new Error("Email and password required.");
  if (pass.length < 6) throw new Error("Password must be at least 6 characters.");
  const cred = await createUserWithEmailAndPassword(auth, email, pass);
  if (name) await updateProfile(cred.user, { displayName: name });
  await sendEmailVerification(cred.user);
  await signOut(auth);
}

export default function AuthModal({ open, mode, initialMsg, onClose, onModeChange }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  // Reset the message whenever the modal is (re)opened.
  useEffect(() => {
    if (open) setMsg(initialMsg ? { text: initialMsg, kind: "ok" } : null);
  }, [open, initialMsg]);

  // Escape closes the modal while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const isSignup = mode === "signup";

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      if (isSignup) {
        await signUp(email, pass, name, phone);
        setMsg({ text: "Account created! Check your email for a verification link before signing in.", kind: "ok" });
      } else {
        const cred = await signInWithEmailAndPassword(auth, email, pass);
        if (!cred.user.emailVerified) {
          await signOut(auth);
          setMsg({ text: "Please verify your email before signing in. Check your inbox.", kind: "err" });
          return;
        }
        setMsg({ text: "Signed in — redirecting...", kind: "ok" });
        setTimeout(() => { window.location.href = "/dashboard"; }, 500);
      }
    } catch (e) {
      setMsg({ text: e.message, kind: "err" });
    } finally {
      setBusy(false);
    }
  }

  function google() {
    signInWithPopup(auth, provider)
      .then(() => { window.location.href = "/dashboard"; })
      .catch((e) => setMsg({ text: e.message, kind: "err" }));
  }

  const onKeyDown = (e) => { if (e.key === "Enter") submit(); };

  return (
    <div
      className={`overlay${open ? " show" : ""}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal" role="dialog" aria-modal="true">
        <button className="x" onClick={onClose} aria-label="Close">✕</button>
        <h3>{isSignup ? "Create your account" : "Welcome back"}</h3>
        <div className="tabs">
          <button className={!isSignup ? "active" : ""} onClick={() => onModeChange("signin")}>Sign in</button>
          <button className={isSignup ? "active" : ""} onClick={() => onModeChange("signup")}>Create account</button>
        </div>

        {isSignup && (
          <>
            <div className="field">
              <label>Producer / tag name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} type="text" placeholder="e.g. prodbynova" autoComplete="nickname" onKeyDown={onKeyDown} />
            </div>
            <div className="field">
              <label>Phone number</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="+1 (555) 000-0000" autoComplete="tel" onKeyDown={onKeyDown} />
            </div>
          </>
        )}
        <div className="field">
          <label>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@studio.com" autoComplete="email" onKeyDown={onKeyDown} />
        </div>
        <div className="field">
          <label>Password</label>
          <input value={pass} onChange={(e) => setPass(e.target.value)} type="password" placeholder="••••••••" autoComplete={isSignup ? "new-password" : "current-password"} onKeyDown={onKeyDown} />
        </div>

        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}

        <button className="btn btn-gold btn-block" style={{ marginTop: "18px" }} disabled={busy} onClick={submit}>
          {busy ? "Working…" : isSignup ? "Create account" : "Sign in"}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "14px 0 4px" }}>
          <div style={{ flex: 1, height: "1px", background: "var(--line-strong)" }}></div>
          <span style={{ fontSize: "12px", color: "var(--bone-dim)" }}>or</span>
          <div style={{ flex: 1, height: "1px", background: "var(--line-strong)" }}></div>
        </div>
        <button className="btn btn-ghost btn-block" onClick={google} style={{ gap: "10px" }}>
          <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 29.8 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.5 0 20-7.6 20-21 0-1.4-.1-2.7-.5-4z" /></svg>
          Continue with Google
        </button>
      </div>
    </div>
  );
}
