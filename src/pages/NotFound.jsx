import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "40px 20px" }}>
      <div className="eyebrow" style={{ marginBottom: "16px" }}>Error 404</div>
      <h1 style={{ fontSize: "clamp(40px,8vw,72px)" }}>Page not found</h1>
      <p style={{ color: "var(--bone-dim)", margin: "16px 0 28px", maxWidth: "420px" }}>
        The page you are looking for does not exist or has moved.
      </p>
      <Link to="/" className="btn btn-gold" style={{ textDecoration: "none" }}>Back to PluggurBeats</Link>
    </div>
  );
}
