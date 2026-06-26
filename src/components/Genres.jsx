import { GENRES } from "../data.js";

export default function Genres() {
  return (
    <section className="section" id="genres">
      <div className="wrap">
        <div className="head" data-reveal>
          <span className="eyebrow">Where we have ears</span>
          <h2>Built for more than one lane</h2>
          <p>
            Active pitching relationships across the genres moving right now. We route to
            genre-specific contacts — your trap beat doesn't go to a pop A&amp;R.
          </p>
        </div>
        <div className="genres" data-reveal>
          {GENRES.map((g) => (
            <span className="chip" key={g}>{g}</span>
          ))}
        </div>
      </div>
    </section>
  );
}
