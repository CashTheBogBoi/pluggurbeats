import { useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  sendEmailVerification,
  sendPasswordResetEmail
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

export default function AuthModal({ open, mode, initialMsg, onClose, onModeChange }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resetMode, setResetMode] = useState(false);

  // Reset state whenever the modal opens.
  useEffect(() => {
    if (open) {
      setMsg(initialMsg ? { text: initialMsg, kind: "ok" } : null);
      setResetMode(false);
    }
  }, [open, initialMsg]);

  // Escape closes the modal.
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
      if (resetMode) {
        if (!email) throw new Error("Enter your email address.");
        await sendPasswordResetEmail(auth, email);
        setMsg({ text: "Reset link sent — check your inbox.", kind: "ok" });
        return;
      }
      if (isSignup) {
        await signUp(email, pass, name);
        setMsg({ text: "Account created! Check your email for a verification link before signing in.", kind: "ok" });
      } else {
        const cred = await signInWithEmailAndPassword(auth, email, pass);
        if (!cred.user.emailVerified) {
          await signOut(auth);
          setMsg({ text: "Please verify your email before signing in. Check your inbox.", kind: "err" });
          return;
        }
        setMsg({ text: "Signed in — redirecting...", kind: "ok" });
        const home = await getSignedInHome(cred.user);
        setTimeout(() => { window.location.href = home; }, 500);
      }
    } catch (e) {
      setMsg({ text: e.message, kind: "err" });
    } finally {
      setBusy(false);
    }
  }

  const onKeyDown = (e) => { if (e.key === "Enter") submit(); };

  function enterReset() {
    setResetMode(true);
    setMsg(null);
    setPass("");
  }

  function exitReset() {
    setResetMode(false);
    setMsg(null);
  }

  if (resetMode) {
    return (
      <div
        className={`overlay${open ? " show" : ""}`}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="modal" role="dialog" aria-modal="true">
          <button className="x" onClick={onClose} aria-label="Close">✕</button>
          <button
            onClick={exitReset}
            style={{ background: "none", border: 0, color: "var(--bone-dim)", fontSize: "13px", padding: 0, marginBottom: "16px", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}
          >
            ← Back to sign in
          </button>
          <h3>Reset your password</h3>
          <p style={{ fontSize: "14px", color: "var(--bone-dim)", marginTop: "8px", marginBottom: "4px" }}>
            Enter your email and we'll send you a link to set a new password.
          </p>
          <div className="field">
            <label>Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="you@studio.com"
              autoComplete="email"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            />
          </div>
          {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
          <button
            className="btn btn-gold btn-block"
            style={{ marginTop: "18px" }}
            disabled={busy}
            onClick={submit}
          >
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </div>
      </div>
    );
  }

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
          <button
            onClick={enterReset}
            style={{ background: "none", border: 0, color: "var(--bone-dim)", fontSize: "13px", padding: "8px 0 0", cursor: "pointer", textAlign: "left" }}
          >
            Forgot your password?
          </button>
        )}

        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}

        <button className="btn btn-gold btn-block" style={{ marginTop: "18px" }} disabled={busy} onClick={submit}>
          {busy ? "Working…" : isSignup ? "Create account" : "Sign in"}
        </button>

      </div>
    </div>
  );
}
