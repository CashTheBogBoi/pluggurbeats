import { useEffect, useRef, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { Capacitor } from "@capacitor/core";
import { auth } from "../firebase/auth.js";
import { fns } from "../firebase/functions.js";
import { getSignedInHome } from "../lib/userRouting.js";
import { ensureUserProfile } from "../lib/userProfile.js";
import TOSModal from "./TOSModal.jsx";

export default function AuthModal({ open, mode, initialMsg, onClose, onModeChange }) {
  const [email, setEmail]   = useState("");
  const [pass, setPass]     = useState("");
  const [name, setName]     = useState("");
  const [msg, setMsg]       = useState(null);
  const [busy, setBusy]     = useState(false);
  const [resetMode, setResetMode]   = useState(false);
  const [tosAgreed, setTosAgreed]   = useState(false);
  const [tosViewOpen, setTosViewOpen] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  // pendingVerification: null | { email } — user created and signed in, waiting for email click
  const [pendingVerification, setPendingVerification] = useState(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const pollRef     = useRef(null);
  const cooldownRef = useRef(null);

  // Reset on modal open
  useEffect(() => {
    if (open) {
      setMsg(initialMsg ? { text: initialMsg, kind: "ok" } : null);
      setResetMode(false);
    }
  }, [open, initialMsg]);

  // Escape key — sign out if pending
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") handleClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, pendingVerification]);

  // Poll Firebase every 3s once we're waiting for verification
  useEffect(() => {
    if (!pendingVerification) return;
    pollRef.current = setInterval(async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        await user.reload();
        if (user.emailVerified) {
          clearInterval(pollRef.current);
          await ensureUserProfile(user, { displayName: user.displayName || "" });
          const home = await getSignedInHome(user);
          window.location.href = home;
        }
      } catch {}
    }, 3000);
    return () => clearInterval(pollRef.current);
  }, [pendingVerification]);

  // Resend countdown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    cooldownRef.current = setInterval(() => {
      setResendCooldown((c) => {
        if (c <= 1) { clearInterval(cooldownRef.current); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(cooldownRef.current);
  }, [resendCooldown > 0]);

  async function handleClose() {
    if (pendingVerification) {
      clearInterval(pollRef.current);
      setPendingVerification(null);
      try { await signOut(auth); } catch {}
    }
    onClose();
  }

  async function handleResend() {
    if (resendCooldown > 0 || busy) return;
    setBusy(true);
    try {
      await httpsCallable(fns, "sendVerificationEmail")();
      setResendCooldown(60);
    } catch (err) {
      console.error("Resend error:", err);
    } finally {
      setBusy(false);
    }
  }

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
        if (!email || !pass) throw new Error("Email and password required.");
        if (pass.length < 6) throw new Error("Password must be at least 6 characters.");
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        if (name) await updateProfile(cred.user, { displayName: name });
        // Fire verification email — non-fatal so a Resend domain issue doesn't block signup
        try {
          await httpsCallable(fns, "sendVerificationEmail")();
          setResendCooldown(60);
        } catch (emailErr) {
          console.error("Verification email failed:", emailErr);
        }
        setPendingVerification({ email });
      } else {
        // Apply persistence preference (web only — native uses IndexedDB)
        if (!Capacitor.isNativePlatform()) {
          await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
        }
        const cred = await signInWithEmailAndPassword(auth, email, pass);
        if (!cred.user.emailVerified) {
          await signOut(auth);
          setMsg({ text: "Please verify your email before signing in.", kind: "err", showResend: true, resendEmail: email });
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

  async function resendFromSignIn() {
    if (resendCooldown > 0) return;
    if (!email || !pass) { setMsg({ text: "Enter your email and password to resend.", kind: "err" }); return; }
    setBusy(true);
    try {
      // Must sign in temporarily to call the CF (requires auth)
      const cred = await signInWithEmailAndPassword(auth, email, pass);
      await httpsCallable(fns, "sendVerificationEmail")();
      await signOut(auth);
      setResendCooldown(60);
      setMsg({ text: "Verification email resent — check your inbox.", kind: "ok" });
    } catch (err) {
      setMsg({ text: err.message, kind: "err" });
    } finally {
      setBusy(false);
    }
  }

  const onKeyDown = (e) => { if (e.key === "Enter") submit(); };

  function enterReset() { setResetMode(true); setMsg(null); setPass(""); }
  function exitReset()  { setResetMode(false); setMsg(null); }

  // ── "Check your email" state ──────────────────────────────────────────────
  if (pendingVerification) {
    return (
      <>
        <style>{`
          @keyframes pb-pulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(242,202,80,0.35); }
            50%       { box-shadow: 0 0 0 14px rgba(242,202,80,0); }
          }
          @keyframes pb-dot {
            0%, 80%, 100% { transform: translateY(0); opacity: 0.3; }
            40%           { transform: translateY(-7px); opacity: 1; }
          }
        `}</style>
        <div
          className={`overlay${open ? " show" : ""}`}
          onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
        >
          <div className="modal" role="dialog" aria-modal="true">
            <button className="x" onClick={handleClose} aria-label="Close">✕</button>

            {/* Pulsing envelope ring */}
            <div style={{ textAlign: "center", padding: "28px 0 8px" }}>
              <div style={{
                width: 68, height: 68, margin: "0 auto 22px",
                border: "2px solid #f2ca50", borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                animation: "pb-pulse 2s ease-in-out infinite",
              }}>
                <svg width="28" height="22" viewBox="0 0 28 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="1" y="1" width="26" height="20" rx="2" stroke="#f2ca50" strokeWidth="1.6"/>
                  <path d="M1 4l13 9 13-9" stroke="#f2ca50" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
              </div>

              <h3 style={{ fontSize: "20px", fontWeight: 700, color: "#e8e0d0", margin: "0 0 10px" }}>
                Check your email
              </h3>
              <p style={{ fontSize: "14px", color: "var(--bone-dim)", lineHeight: 1.65, margin: "0 0 6px" }}>
                We sent a verification link to
              </p>
              <p style={{ fontSize: "14px", fontWeight: 600, color: "#e8e0d0", margin: "0 0 20px", wordBreak: "break-all" }}>
                {pendingVerification.email}
              </p>
              <p style={{ fontSize: "12px", color: "#4d4635", margin: "0 0 20px", lineHeight: 1.6 }}>
                This tab will log you in automatically once you click the link.
              </p>

              {/* Waiting dots */}
              <div style={{ display: "flex", justifyContent: "center", gap: "7px", marginBottom: "28px" }}>
                {[0, 1, 2].map((i) => (
                  <div key={i} style={{
                    width: 7, height: 7, borderRadius: "50%", background: "#f2ca50",
                    animation: `pb-dot 1.4s ease-in-out ${i * 0.2}s infinite`,
                  }} />
                ))}
              </div>
            </div>

            <button
              onClick={handleResend}
              disabled={resendCooldown > 0 || busy}
              style={{
                width: "100%", padding: "11px", background: "none",
                border: "1px solid #262626", color: resendCooldown > 0 ? "#4d4635" : "var(--bone-dim)",
                fontSize: "13px", cursor: resendCooldown > 0 ? "default" : "pointer",
                letterSpacing: "0.04em", transition: "border-color 0.2s, color 0.2s",
              }}
            >
              {resendCooldown > 0 ? `Resend available in ${resendCooldown}s` : "Resend verification email"}
            </button>
          </div>
        </div>
      </>
    );
  }

  // ── Password reset mode ───────────────────────────────────────────────────
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
          <button className="btn btn-gold btn-block" style={{ marginTop: "18px" }} disabled={busy} onClick={submit}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </div>
      </div>
    );
  }

  // ── Main sign in / sign up ────────────────────────────────────────────────
  return (
    <>
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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "10px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px", color: "var(--bone-dim)" }}>
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  style={{ accentColor: "#f2ca50", cursor: "pointer" }}
                />
                Remember me
              </label>
              <button
                onClick={enterReset}
                style={{ background: "none", border: 0, color: "var(--bone-dim)", fontSize: "13px", padding: 0, cursor: "pointer" }}
              >
                Forgot password?
              </button>
            </div>
          )}

          {isSignup && (
            <div style={{ marginTop: "16px", display: "flex", alignItems: "flex-start", gap: "10px" }}>
              <input
                id="tos-agree"
                type="checkbox"
                checked={tosAgreed}
                onChange={(e) => setTosAgreed(e.target.checked)}
                style={{ marginTop: "2px", accentColor: "#f2ca50", cursor: "pointer", flexShrink: 0 }}
              />
              <label htmlFor="tos-agree" style={{ fontSize: "12px", color: "var(--bone-dim)", lineHeight: "1.5", cursor: "pointer" }}>
                I agree to the{" "}
                <button
                  type="button"
                  onClick={() => setTosViewOpen(true)}
                  style={{ background: "none", border: 0, padding: 0, color: "#f2ca50", fontSize: "12px", cursor: "pointer", textDecoration: "underline" }}
                >
                  Terms of Service
                </button>
              </label>
            </div>
          )}

          {msg && (
            <div style={{ marginTop: "14px" }}>
              <div className={`msg ${msg.kind}`}>{msg.text}</div>
              {msg.showResend && (
                <button
                  onClick={resendFromSignIn}
                  disabled={resendCooldown > 0 || busy}
                  style={{
                    marginTop: "8px", background: "none", border: 0, padding: 0,
                    color: resendCooldown > 0 ? "#4d4635" : "#f2ca50",
                    fontSize: "12px", cursor: resendCooldown > 0 ? "default" : "pointer",
                    textDecoration: "underline",
                  }}
                >
                  {resendCooldown > 0 ? `Resend available in ${resendCooldown}s` : "Resend verification email"}
                </button>
              )}
            </div>
          )}

          <button
            className="btn btn-gold btn-block"
            style={{ marginTop: "18px" }}
            disabled={busy || (isSignup && !tosAgreed)}
            onClick={submit}
          >
            {busy ? "Working…" : isSignup ? "Create account" : "Sign in"}
          </button>
        </div>
      </div>

      <TOSModal tosKey="base" open={tosViewOpen} onClose={() => setTosViewOpen(false)} />
    </>
  );
}
