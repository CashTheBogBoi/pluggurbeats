import { TIERS, PACKS } from "../data.js";

export default function Pricing({ onChoosePlan, onBuyPack }) {
  return (
    <section
      className="section"
      id="pricing"
      style={{ background: "var(--ink-2)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}
    >
      <div className="wrap">
        <div className="head" style={{ margin: "0 auto 48px", textAlign: "center" }}>
          <span className="eyebrow" style={{ display: "inline-flex" }}>Membership</span>
          <h2>Subscribe. Earn credits. Pitch.</h2>
          <p style={{ marginLeft: "auto", marginRight: "auto" }}>
            Campaigns are credit-based on every paid plan. Plugg lands your beats in the Verified
            library; Pro also emails them straight to inboxes. Monthly credits roll over while you're
            subscribed.
          </p>
        </div>

        <div className="tiers">
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
            One-time top-ups — pitch credits power campaigns (Plugg / Pro), loop credits work on any
            plan, including Free.
          </p>
        </div>
      </div>
    </section>
  );
}
