import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The React app lives at the repo root so the existing GitHub Action
// (`npm run build`) and Firebase Hosting (`public: dist`) line up.
// Still-static pages (dashboard/staff/verified/404.html) sit in public/
// and are copied verbatim into dist/ during the migration.
export default defineConfig({
  plugins: [react()],
  // Quiet dev server: only surface warnings/errors (no per-request info spam)
  // and don't clear the screen on restart. Keeps log output minimal.
  logLevel: "warn",
  clearScreen: false,
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
