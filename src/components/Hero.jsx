export default function Hero({ onOpenAuth }) {
  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  return (
    <section className="hero" id="top">
      <div className="wrap">
        <div className="hero-inner" data-reveal-group>
          <div className="hero-left">
            <span className="eyebrow">Pitching · Loops · Verified Library</span>
            <h1 style={{ marginTop: "22px" }}>
              Your beat.<br /><span className="gold">In the right inbox.</span>
            </h1>
            <p className="lead">
              Submit a beat, spend credits, get tracked delivery to real A&amp;R desks and artist
              inboxes. Not a submission form black hole — you see exactly who opened, who downloaded,
              who passed.
            </p>
            <div className="hero-cta">
              <button className="btn btn-gold" onClick={() => onOpenAuth("signup")}>Start free</button>
              <button className="btn btn-ghost" onClick={() => scrollTo("how")}>See how it works</button>
            </div>
          </div>

          <div className="hero-right">
            <div className="mock-card">
              <div className="mock-header">
                <span className="mock-label">Campaign activity</span>
                <span className="badge-live">Live</span>
              </div>

              <div className="mock-beats">
                <div className="mock-beat">
                  <div className="mock-beat-top">
                    <span className="mock-beat-name">Nightfall_Stems.wav</span>
                    <span className="badge badge-ok">Active</span>
                  </div>
                  <div className="mock-beat-lane">Trap A-List · 140 BPM · F#</div>
                  <div className="mock-stats">
                    <div>
                      <span className="mock-stat-n">12</span>
                      <span className="mock-stat-l">Opens</span>
                    </div>
                    <div>
                      <span className="mock-stat-n">4</span>
                      <span className="mock-stat-l">Downloads</span>
                    </div>
                    <div>
                      <span className="mock-stat-n">86</span>
                      <span className="mock-stat-l">Verified views</span>
                    </div>
                  </div>
                </div>

                <div className="mock-beat">
                  <div className="mock-beat-top">
                    <span className="mock-beat-name">DarkKeys_Eb.wav</span>
                    <span className="badge badge-violet">Reviewing</span>
                  </div>
                  <div className="mock-beat-lane">R&amp;B Rising · 95 BPM · Eb</div>
                  <div className="mock-stats">
                    <div>
                      <span className="mock-stat-n">—</span>
                      <span className="mock-stat-l">Opens</span>
                    </div>
                    <div>
                      <span className="mock-stat-n">—</span>
                      <span className="mock-stat-l">Downloads</span>
                    </div>
                    <div>
                      <span className="mock-stat-n">—</span>
                      <span className="mock-stat-l">Verified views</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mock-divider" />

              <div className="mock-activity-label">Latest activity</div>
              <div className="mock-act-row">
                <span className="mock-dot" style={{ background: "var(--ok)" }} />
                Universal Music — 3 new opens
              </div>
              <div className="mock-act-row">
                <span className="mock-dot" style={{ background: "var(--gold)" }} />
                Sony A&amp;R downloaded Nightfall
              </div>
              <div className="mock-act-row">
                <span className="mock-dot" style={{ background: "var(--violet)" }} />
                Loop pulled into active session
              </div>
            </div>
          </div>
        </div>

        <div className="readouts" data-reveal>
          <div className="readout"><div className="k">40+</div><div className="l">Genres covered</div></div>
          <div className="readout"><div className="k">0%</div><div className="l">Publishing cut</div></div>
          <div className="readout"><div className="k">Verified</div><div className="l">A&amp;R + artist library</div></div>
          <div className="readout"><div className="k">Tracked</div><div className="l">Opens + downloads logged</div></div>
        </div>
      </div>
    </section>
  );
}
