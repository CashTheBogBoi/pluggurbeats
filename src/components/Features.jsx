const FEATURES = [
  {
    n: "CAMPAIGNS", h: "Credit-based pitching",
    p: "Pick your lanes, spend pitch credits, and submit. Pro plans email your beats directly to vetted artist, manager and A&R inboxes — with per-contact open and download tracking."
  },
  {
    n: "LOOP DROPS", h: "Loop marketplace",
    p: "Submit loops to a shared pool for one loop credit each. Verified producers pull them into their own beats, and a split-claim link is created between maker and puller automatically."
  },
  {
    n: "VERIFIED", h: "PluggUrBeat Verified",
    p: "An invite-only library where A&Rs and artists browse every approved beat, and verified producers pull from the live loop pool. Plugg and Pro campaigns land here on approval."
  }
];

export default function Features() {
  return (
    <section className="section" id="features">
      <div className="wrap">
        <div className="head">
          <span className="eyebrow">What you get</span>
          <h2>Three ways to move your sound</h2>
          <p>One subscription, one credit balance, three doors into the industry.</p>
        </div>
        <div className="steps" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
          {FEATURES.map((f) => (
            <div className="step" key={f.n}>
              <div className="n">{f.n}</div>
              <h3>{f.h}</h3>
              <p>{f.p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
