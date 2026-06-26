const TESTIMONIALS = [
  {
    quote: "First campaign I ran, I had a beat pulled into an active session within two weeks. The tracking shows you exactly who listened — no more sending beats into a black hole.",
    name: "PRODUCER NAME",
    handle: "Plugg subscriber — placeholder",
    initial: "P"
  },
  {
    quote: "The Verified library actually gets browsed. Had three downloads on a beat I uploaded six months ago. Wouldn't have known without the activity feed.",
    name: "PRODUCER NAME",
    handle: "Pro subscriber — placeholder",
    initial: "P"
  },
  {
    quote: "I was paying $200 for one-time pitches that went nowhere. This is $29 a month and I know exactly what's happening with every beat I submit.",
    name: "PRODUCER NAME",
    handle: "Plugg subscriber — placeholder",
    initial: "P"
  }
];

export default function SocialProof() {
  return (
    <section
      className="section"
      id="proof"
      style={{ borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}
    >
      <div className="wrap">
        <div className="head" data-reveal style={{ margin: "0 auto 48px", textAlign: "center", maxWidth: "100%" }}>
          <span className="eyebrow" style={{ display: "inline-flex" }}>From the studio</span>
          <h2>Producers already in the pipeline</h2>
          <p style={{ marginLeft: "auto", marginRight: "auto", maxWidth: "500px" }}>
            Real feedback from producers using PluggurBeats to move their catalog.
          </p>
        </div>
        <div className="testimonials" data-reveal-group>
          {TESTIMONIALS.map((t, i) => (
            <div className="testimonial" key={i}>
              <div className="t-quote">"{t.quote}"</div>
              <div className="t-source">
                <div className="t-avi">{t.initial}</div>
                <div>
                  <div className="t-name">{t.name}</div>
                  <div className="t-handle">{t.handle}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
