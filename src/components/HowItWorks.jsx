const STEPS = [
  { n: "01 / UPLOAD", h: "Build a campaign", p: "Load your beats, tag genre, BPM and key, and pick the target lanes you want to hit." },
  { n: "02 / SUBMIT", h: "Spend credits", p: "Each lane costs pitch credits. Submit your campaign and our team reviews it before anything ships." },
  { n: "03 / REACH", h: "Land where it counts", p: "Approved Plugg campaigns join the Verified library; Pro campaigns also email straight to artist and A&R inboxes." },
  { n: "04 / TRACK", h: "Watch it move", p: "See opens, downloads and status per contact in your dashboard, then close the split yourself." }
];

export default function HowItWorks() {
  return (
    <section
      className="section"
      id="how"
      style={{ background: "var(--ink-2)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}
    >
      <div className="wrap">
        <div className="head">
          <span className="eyebrow">The pipeline</span>
          <h2>From your hard drive to their session</h2>
          <p>A real, trackable process — not a wall you throw beats over.</p>
        </div>
        <div className="steps">
          {STEPS.map((s) => (
            <div className="step" key={s.n}>
              <div className="n">{s.n}</div>
              <h3>{s.h}</h3>
              <p>{s.p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
