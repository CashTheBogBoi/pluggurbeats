// One-off generator for public/og-image.png (1200x630, the standard OG/Twitter
// share-card size). Not part of the build pipeline — run manually with
// `node scripts/generate-og-image.js` whenever the brand card needs updating.
// Reuses the exact brand mark/colors/fonts from Marketing.jsx / MarketingRedesign.css
// (the mk-eq equalizer mark, gold #f2ca50, bg #131313, Bricolage Grotesque + Inter).
import puppeteer from "puppeteer";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "../public/og-image.png");

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Inter:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; overflow: hidden; }
  body {
    background: radial-gradient(circle at 78% 18%, rgba(242,202,80,.16), transparent 55%), #131313;
    font-family: "Inter", system-ui, sans-serif;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 0 90px;
    position: relative;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
    font-family: "Bricolage Grotesque", system-ui, sans-serif;
    font-weight: 800;
    font-size: 30px;
    color: #f5efe2;
    margin-bottom: 56px;
  }
  .eq { display: inline-flex; align-items: flex-end; gap: 3px; height: 26px; color: #f2ca50; }
  .eq i { width: 6px; border-radius: 4px; background: currentColor; display: block; }
  .eq i:nth-child(1) { height: 10px; }
  .eq i:nth-child(2) { height: 23px; }
  .eq i:nth-child(3) { height: 16px; }
  .eq i:nth-child(4) { height: 26px; }
  h1 {
    font-family: "Bricolage Grotesque", system-ui, sans-serif;
    font-weight: 800;
    font-size: 84px;
    line-height: 1.04;
    color: #f5efe2;
    max-width: 900px;
    margin-bottom: 28px;
  }
  h1 span { color: #f2ca50; }
  p.tagline {
    font-size: 26px;
    color: #99907c;
    max-width: 780px;
    line-height: 1.5;
    margin-bottom: 44px;
  }
  .pills { display: flex; gap: 14px; }
  .pill {
    font-family: "Space Mono", monospace;
    font-size: 14px;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: #f2ca50;
    border: 1px solid rgba(242,202,80,.4);
    background: rgba(242,202,80,.06);
    padding: 10px 18px;
  }
</style>
</head>
<body>
  <div class="brand"><span class="eq"><i></i><i></i><i></i><i></i></span> PluggurBeats</div>
  <h1>Your Beat.<br />Their <span>Inbox.</span></h1>
  <p class="tagline">Submit beats for human review, reach verified music industry listeners, and track what happens after every pitch.</p>
  <div class="pills">
    <div class="pill">72h Review</div>
    <div class="pill">1 Credit / Beat</div>
    <div class="pill">Verified Reach</div>
  </div>
</body>
</html>`;

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    const png = await page.screenshot({ type: "png" });
    writeFileSync(outPath, png);
    console.log(`[og-image] wrote ${outPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("[og-image] failed:", err);
  process.exit(1);
});
