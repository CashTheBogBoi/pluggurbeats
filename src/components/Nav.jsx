import { useState } from "react";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" }
];

export default function Nav({ user, onOpenAuth, onSignOut }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="nav">
      <div className="wrap nav-row">
        <a href="#top" className="brand"><span className="dot"></span>PluggurBeats</a>
        <nav className="nav-links">
          {LINKS.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
        </nav>
        <div className="nav-actions">
          {user ? (
            <div className="signed-in">
              <div className="avatar">{(user.displayName || user.email || "?")[0].toUpperCase()}</div>
              <a href="/dashboard" className="btn btn-gold">Dashboard</a>
              <button className="btn btn-ghost" onClick={onSignOut}>Sign out</button>
            </div>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={() => onOpenAuth("signin")}>Sign in</button>
              <button className="btn btn-gold" onClick={() => onOpenAuth("signup")}>Get started</button>
            </>
          )}
        </div>
        <button className="nav-toggle" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu">☰</button>
      </div>
      <div className={`wrap mobile-menu${menuOpen ? " show" : ""}`}>
        {LINKS.map((l) => <a key={l.href} href={l.href} onClick={closeMenu}>{l.label}</a>)}
        {user ? (
          <a href="/dashboard" className="btn btn-gold btn-block" style={{ marginTop: "10px" }}>Dashboard</a>
        ) : (
          <button
            className="btn btn-gold btn-block"
            style={{ marginTop: "10px" }}
            onClick={() => { closeMenu(); onOpenAuth("signup"); }}
          >
            Get started
          </button>
        )}
      </div>
    </header>
  );
}
