// Display data for the marketing page. Credit grants and enforcement
// live server-side in Cloud Functions; these are presentation only.

export const GENRES = [
  "Trap", "Drill", "R&B", "Pop", "Afrobeats", "Hip-Hop", "Jersey Club",
  "Reggaeton", "Amapiano", "Hyperpop", "Boom Bap", "Plugg", "Soul", "Dancehall",
  "Alt R&B", "Latin Trap", "Country Trap", "UK Garage", "Lo-fi", "House"
];

export const TIERS = [
  {
    id: "free", name: "Free", price: 0, cadence: "forever",
    blurb: "Make an account, submit loops, and browse the platform.",
    feature: false, cta: "Get started",
    perks: [
      "5 loop credits / mo",
      "Submit loops to the pool",
      "Loop Drops marketplace access",
      "Profile + dashboard",
      "Upgrade any time to run campaigns"
    ]
  },
  {
    id: "plugg", name: "Plugg", price: 29, cadence: "/mo",
    blurb: "Run credit-based campaigns and land in the Verified library.",
    feature: true, cta: "Subscribe",
    perks: [
      "15 pitch + 20 loop credits / mo (roll over)",
      "1 pitch credit per beat submitted",
      "Up to 15 beats per campaign",
      "Approved beats join the Verified library",
      "A&Rs + artists browse your catalog",
      "Pull loops once verified",
      "Everything in Free"
    ]
  },
  {
    id: "pro", name: "Plugg Pro", price: 99, cadence: "/mo",
    blurb: "Everything in Plugg, plus direct-to-inbox email pitching.",
    feature: false, cta: "Subscribe",
    perks: [
      "50 pitch + 60 loop credits / mo (roll over)",
      "1 pitch credit per beat submitted",
      "Up to 25 beats, 5 Pro desk lanes",
      "Approved campaigns can email straight to inboxes",
      "A&R / management lanes unlocked",
      "Priority queue (<48h) + written feedback",
      "Everything in Plugg"
    ]
  }
];

// One-time credit packs. kind drives which balance is topped up.
export const PACKS = [
  { id: "pack10", kind: "pitch", credits: 10, price: 25 },
  { id: "pack25", kind: "pitch", credits: 25, price: 50 },
  { id: "loop20", kind: "loop",  credits: 20, price: 10 },
  { id: "loop50", kind: "loop",  credits: 50, price: 20 }
];
