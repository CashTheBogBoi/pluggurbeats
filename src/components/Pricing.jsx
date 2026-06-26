import { TIERS, PACKS } from "../data.js";

export default function Pricing({ onChoosePlan, onBuyPack }) {
  return (
    <section
      className="section"
      id="pricing"
      style={{ background: "var(--ink-2)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}
    >
      <div className="wrap">
        <div className="head" data-reveal style={{ margin: "0 auto 48px", textAlign: "center" }}>
          <span className="eyebrow" style={{ display: "inline-flex" }}>Membership</span>
          <h2>Subscribe. Earn credits. Pitch.</h2>
          <p style={{ marginLeft: "auto", marginRight: "auto" }}>
            Campaigns cost one pitch credit per beat. Plugg lands your beats in the Verified
            library; Pro can also add up to 5 desk lanes for direct inbox delivery. Credits roll
            over every month while you're subscribed.
          </p>
          <div className="trust-row">
            <span className="trust-dot">Join free</span>
            <span className="trust-dot">Upgrade any time</span>
            <span className="trust-dot">Cancel any month</span>
          </div>
        </div>

        <div className="tiers" data-reveal-group>
          {TIERS.map((p) => (
            <div className={`tier${p.feature ? " feature" : ""}`} key={p.id}>
              {p.feature && <span className="tag">Most picked</span>}
              <div className="name">{p.name}</div>
              <div className="price">${p.price}<small> {p.cadence}</small></div>
              <div className="blurb">{p.blurb}</div>
              <ul>{p.perks.map((x) => <li key={x}>{x}</li>)}</ul>
              <button
                className={`btn ${p.feature ? "btn-gold" : "btn-ghost"} btn-block`}
                onClick={() => onChoosePlan(p.id)}
              >
                {p.cta}
              </button>
              {p.id !== "free" && (
                <p className="cancel-note">Cancel anytime · No contracts</p>
              )}
            </div>
          ))}
        </div>

        <div style={{ textAlign: "center", marginTop: "40px" }}>
          <div className="eyebrow" style={{ display: "inline-flex", marginBottom: "14px" }}>Need more credits?</div>
          <div id="packs" style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            {PACKS.map((p) => (
              <button className="btn btn-ghost" key={p.id} onClick={() => onBuyPack(p.id)}>
                {p.credits} {p.kind} credits — ${p.price}
              </button>
            ))}
          </div>
          <p className="hint" style={{ marginTop: "12px", color: "var(--bone-dim)", fontSize: "13px" }}>
            One-time top-ups — pitch credits submit beats to campaigns, loop credits work on any
            plan including Free.
          </p>
        </div>
      </div>
    </section>
  );
}
