// Runs after `vite build` (npm's postbuild hook). Boots a static preview
// server over dist/, lets the marketing page ("/") mount and paint in a
// headless browser, then overwrites dist/index.html with that fully
// rendered HTML. main.jsx uses createRoot (not hydrateRoot), so the client
// just re-renders from scratch on load — this only changes what crawlers
// and social-share bots see on the very first response.
//
// Only "/" is prerendered: it's the sole public, indexable route. Every
// other route (/login, /dashboard, /staff, /verified) is either gated or
// not meant to rank, and the SPA rewrite in firebase.json still serves
// this same index.html for all of them — React Router takes over the
// instant the bundle mounts.
import { preview } from "vite";
import puppeteer from "puppeteer";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distIndex = resolve(__dirname, "../dist/index.html");

async function main() {
  const server = await preview({ preview: { port: 4174, strictPort: false } });
  const url = server.resolvedUrls.local[0];

  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    // gtag.js loads statically in <head> for real visitors — block it here so
    // this build-time headless visit to localhost never fires a live GA4 hit.
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const u = req.url();
      if (u.includes("googletagmanager.com") || u.includes("google-analytics.com")) {
        req.abort();
      } else {
        req.continue();
      }
    });
    await page.goto(url, { waitUntil: "load" });
    await page.waitForSelector("h1", { timeout: 15000 });
    const html = await page.content();
    writeFileSync(distIndex, html);
    console.log(`[prerender] wrote rendered "/" markup to ${distIndex}`);
  } finally {
    await browser.close();
    await new Promise((done) => server.httpServer.close(done));
  }
}

main().catch((err) => {
  console.error("[prerender] failed:", err);
  process.exit(1);
});
