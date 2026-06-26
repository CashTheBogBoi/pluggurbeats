function IconSend() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2 11 13" /><path d="m22 2-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}

function IconLoop() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="m7 23-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}

const CAMPAIGN_PERKS = [
  "Staff reviews every submission before it ships",
  "Per-contact open and download tracking",
  "Up to 5 vetted A&R and artist desk lanes (Pro)",
  "Credits roll over monthly while subscribed",
];

export default function Features() {
  return (
    <section className="section" id="features">
      <div className="wrap">
        <div className="head" data-reveal>
          <span className="eyebrow">What you get</span>
          <h2>Three ways to move your sound</h2>
          <p>One subscription, one credit balance, three doors into the industry.</p>
        </div>

        <div className="feat-primary" data-reveal>
          <div className="feat-primary-left">
            <div className="feat-icon"><IconSend /></div>
            <div className="n" style={{ fontFamily: "'Space Mono',monospace", color: "var(--gold)", fontSize: "13px", letterSpacing: ".1em", marginBottom: "12px" }}>CAMPAIGNS</div>
            <h3 style={{ fontSize: "clamp(22px,3vw,30px)", marginBottom: "14px" }}>Credit-based pitching</h3>
            <p style={{ color: "var(--bone-dim)", fontSize: "15px", lineHeight: "1.7", marginBottom: "28px" }}>
              Spend pitch credits and submit to the Verified library. Pro unlocks direct
              email delivery to vetted artist, manager and A&amp;R desk lanes — with
              per-contact open and download tracking on every beat.
            </p>
            <ul className="feat-perks">
              {CAMPAIGN_PERKS.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
          <div className="feat-primary-right">
            <div className="feat-mini-card">
              <div className="feat-mini-label">Campaign · Nightfall_Stems</div>
              <div className="feat-mini-stats">
                <div className="feat-mini-stat">
                  <span className="feat-mini-n">12</span>
                  <span className="feat-mini-l">Opens</span>
                </div>
                <div className="feat-mini-stat">
                  <span className="feat-mini-n">4</span>
                  <span className="feat-mini-l">Downloads</span>
                </div>
                <div className="feat-mini-stat">
                  <span className="feat-mini-n">86</span>
                  <span className="feat-mini-l">Verified views</span>
                </div>
              </div>
              <div className="feat-mini-lanes">
                <div className="feat-mini-lane">
                  <span className="feat-mini-lane-dot" style={{ background: "var(--ok)" }} />
                  <span>Trap A-List</span>
                  <span className="badge badge-ok" style={{ marginLeft: "auto" }}>3 opens</span>
                </div>
                <div className="feat-mini-lane">
                  <span className="feat-mini-lane-dot" style={{ background: "var(--gold)" }} />
                  <span>Pop Major</span>
                  <span className="badge badge-gold" style={{ marginLeft: "auto" }}>1 download</span>
                </div>
                <div className="feat-mini-lane">
                  <span className="feat-mini-lane-dot" style={{ background: "var(--violet)" }} />
                  <span>R&amp;B Rising</span>
                  <span className="badge badge-violet" style={{ marginLeft: "auto" }}>Reviewing</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="feat-secondary" data-reveal-group>
          <div className="step">
            <div className="feat-icon"><IconLoop /></div>
            <div className="n">LOOP DROPS</div>
            <h3>Loop marketplace</h3>
            <p>
              Submit loops to a shared pool for one loop credit each. Verified producers pull
              them into their own beats, and a split-claim link is created between maker and
              puller automatically.
            </p>
          </div>
          <div className="step">
            <div className="feat-icon"><IconShield /></div>
            <div className="n">VERIFIED</div>
            <h3>PluggUrBeat Verified</h3>
            <p>
              An invite-only library where A&amp;Rs and artists browse every approved beat, and
              verified producers pull from the live loop pool. Plugg and Pro campaigns land
              here on approval.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
