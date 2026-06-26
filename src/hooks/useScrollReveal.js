import { useEffect } from "react";

// One IntersectionObserver for the whole page. Any element marked with
// [data-reveal] (single element) or [data-reveal-group] (staggered children)
// gets `.is-visible` the first time it scrolls into view, then is unobserved —
// the reveal plays once. CSS owns the transition, so it runs off the main
// thread. Elements above the fold trigger on mount.
export function useScrollReveal() {
  useEffect(() => {
    const els = [...document.querySelectorAll("[data-reveal], [data-reveal-group]")];
    if (!els.length) return;

    const reveal = (el) => el.classList.add("is-visible");

    // No IntersectionObserver: show everything so nothing is ever stuck hidden.
    if (!("IntersectionObserver" in window)) {
      els.forEach(reveal);
      return;
    }

    const io = new IntersectionObserver(
      (entries, obs) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            reveal(entry.target);
            obs.unobserve(entry.target);
          }
        }
      },
      // threshold 0 = trigger as soon as any pixel enters; pull the bottom edge
      // up a little so sections start animating just before fully in view. The
      // observer's callback always runs against settled layout, so observing
      // immediately is correct — only genuinely in-view elements get revealed.
      { threshold: 0, rootMargin: "0px 0px -12% 0px" }
    );

    els.forEach((el) => io.observe(el));

    // Safety net: if the observer never delivers (e.g. it's a background tab
    // where rAF/IO are paused, or some exotic browser), reveal everything so
    // the page can never get stuck invisible. setTimeout still fires when the
    // tab is hidden; rAF does not. In a normal foreground load the observer
    // reveals above-the-fold content in well under this timeout.
    const safety = setTimeout(() => els.forEach(reveal), 2500);

    return () => {
      clearTimeout(safety);
      io.disconnect();
    };
  }, []);
}
