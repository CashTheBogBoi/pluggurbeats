import Equalizer from "./Equalizer.jsx";

const scrollTo = (id) => document.getElementById(id)?.scrollIntoView();

export default function Hero() {
  return (
    <section className="hero" id="top">
      <div className="wrap">
        <span className="eyebrow">Pitching · loops · verified library</span>
        <h1 style={{ marginTop: "22px" }}>
          Your beat.<br /><span className="gold">In the right inbox.</span>
        </h1>
        <p className="lead">
          A platform built for producers. Run credit-based campaigns to get your beats in front of
          artists and A&amp;Rs, drop loops into a verified producer marketplace, and land your catalog
          in a library the industry actually browses.
        </p>
        <div className="hero-cta">
          <button className="btn btn-gold" onClick={() => scrollTo("pricing")}>See plans</button>
          <button className="btn btn-ghost" onClick={() => scrollTo("how")}>How it works</button>
        </div>

        <Equalizer />

        <div className="readouts">
          <div className="readout"><div className="k">Credits</div><div className="l">Pay per campaign</div></div>
          <div className="readout"><div className="k">40+</div><div className="l">Genres covered</div></div>
          <div className="readout"><div className="k">Verified</div><div className="l">A&amp;R / artist library</div></div>
          <div className="readout"><div className="k">Loops</div><div className="l">Producer marketplace</div></div>
        </div>
      </div>
    </section>
  );
}
