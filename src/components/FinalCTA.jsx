export default function FinalCTA({ onOpenAuth }) {
  return (
    <section className="final-cta" id="cta">
      <div className="final-cta-bg" />
      <div className="wrap" data-reveal-group style={{ position: "relative", zIndex: 1 }}>
        <span className="eyebrow" style={{ display: "inline-flex", marginBottom: "22px" }}>Ready to plug in</span>
        <h2>Your next placement<br />is a campaign away.</h2>
        <p>
          Join free. Upgrade when you're ready.<br />
          Cancel any time — no contracts, no commitments.
        </p>
        <div style={{ display: "flex", gap: "14px", justifyContent: "center", flexWrap: "wrap" }}>
          <button
            className="btn btn-gold"
            style={{ fontSize: "17px", padding: "15px 36px" }}
            onClick={() => onOpenAuth("signup")}
          >
            Start free
          </button>
          <a
            href="#pricing"
            className="btn btn-ghost"
            style={{ fontSize: "17px", padding: "15px 36px" }}
          >
            See plans
          </a>
        </div>
      </div>
    </section>
  );
}
