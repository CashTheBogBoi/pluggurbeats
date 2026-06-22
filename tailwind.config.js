/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  // Preflight off: the marketing/staff/verified pages rely on global.css and
  // their own stylesheets. We only want Tailwind's utilities, not its reset.
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        ink:  { DEFAULT: "#0B0A0F", 2: "#131119", 3: "#1B1822" },
        bone: { DEFAULT: "#F3EFE6", dim: "#A29DAC" },
        gold: { DEFAULT: "#E4C16B", deep: "#C9A24B" },
        violet: "#7C5CFF",
        bad: "#FF6B6B",
        ok: "#7CE2A4",
        info: "#6EC1FF"
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Bricolage Grotesque"', 'sans-serif'],
        mono: ['"Space Mono"', 'monospace']
      },
      borderColor: {
        line: "rgba(255,255,255,.09)",
        strong: "rgba(255,255,255,.16)"
      },
      boxShadow: {
        glow: "0 0 24px rgba(228,193,107,.25)",
        card: "0 1px 0 rgba(255,255,255,.04) inset, 0 12px 40px -12px rgba(0,0,0,.6)"
      },
      keyframes: {
        "fade-up": { "0%": { opacity: 0, transform: "translateY(6px)" }, "100%": { opacity: 1, transform: "translateY(0)" } },
        shimmer: { "100%": { transform: "translateX(100%)" } }
      },
      animation: {
        "fade-up": "fade-up .3s ease both"
      }
    }
  },
  plugins: []
};
