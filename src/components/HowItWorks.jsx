const STEPS = [
  {
    n: "01",
    h: "Build your campaign",
    p: "Load your beats, tag genre, BPM and key. Plugg goes to the Verified library; Pro can add up to 5 desk lanes."
  },
  {
    n: "02",
    h: "Spend credits",
    p: "Each beat costs one pitch credit. Submit your campaign and our staff reviews it before anything ships — nothing goes out unvetted."
  },
  {
    n: "03",
    h: "Land where it counts",
    p: "Approved Plugg campaigns join the Verified library. Pro campaigns can also email straight to vetted artist and A&R inboxes."
  },
  {
    n: "04",
    h: "Watch it move",
    p: "See opens, downloads and status per contact in your dashboard. When a deal closes, split sheets auto-generate via DocuSign."
  }
];

export default function HowItWorks() {
  return (
    <section
      className="section"
      id="how"
      style={{ background: "var(--ink-2)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}
    >
      <div className="wrap">
        <div className="head" data-reveal>
          <span className="eyebrow">The pipeline</span>
          <h2>From your hard drive to their session</h2>
          <p>A real, trackable process — not a wall you throw beats over.</p>
        </div>
        <div className="steps steps-connected" data-reveal-group>
          {STEPS.map((s) => (
            <div className="step" key={s.n}>
              <div className="step-num">{s.n}</div>
              <h3>{s.h}</h3>
              <p>{s.p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
