const ITEMS = [
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel your subscription any time from your dashboard — you keep access until the end of your billing period. Credits you've earned roll over if you resubscribe. No contracts, no commitments."
  },
  {
    q: "How do credits work?",
    a: "Each paid plan grants monthly pitch and loop credits that roll over while you're subscribed. Campaigns spend one pitch credit per beat submitted; submitting a loop to the pool costs one loop credit. Run low? Buy a-la-carte packs any time."
  },
  {
    q: "What's the difference between Plugg and Pro?",
    a: "Both run credit-based campaigns. On Plugg, approved beats are added to the PluggUrBeat Verified library where A&Rs and artists browse them. Pro does that and can also email your campaign directly to up to 5 vetted desk lanes, including A&R / management lanes, with priority review and written feedback."
  },
  {
    q: "Do you guarantee a placement?",
    a: "No, and you should be careful with anyone who does. We deliver your beats to real desks and libraries with per-contact tracking. Whether a record gets cut depends on the song, the timing and the artist."
  },
  {
    q: "What are Loop Drops?",
    a: "A marketplace where you submit loops to a shared pool. Verified producers pull them into their own beats, and a split-claim link is created between you and the puller automatically so credit is tracked from the start."
  },
  {
    q: "What do I need to upload?",
    a: "An untagged, mixed beat or loop (WAV preferred), plus the BPM, key and genre. Cleaner files pitch better."
  },
  {
    q: "Who keeps the publishing?",
    a: "You do. We're a pitching platform, not a publisher — we don't take points on your beat. If a placement happens, you negotiate the split directly with the artist's team."
  }
];

export default function FAQ() {
  return (
    <section className="section" id="faq">
      <div className="wrap">
        <div className="head" data-reveal>
          <span className="eyebrow">Straight answers</span>
          <h2>Before you buy</h2>
        </div>
        <div className="faq" data-reveal-group>
          {ITEMS.map((it) => (
            <details key={it.q}>
              <summary>{it.q}</summary>
              <p>{it.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
