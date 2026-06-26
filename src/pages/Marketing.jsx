import { lazy, Suspense, useEffect, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Check,
  Clock3,
  Disc3,
  Download,
  Eye,
  FileAudio,
  Library,
  MailCheck,
  Music2,
  Play,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  Users
} from "lucide-react";
import { useScrollReveal } from "../hooks/useScrollReveal.js";
import { getSignedInHome } from "../lib/userRouting.js";
import Footer from "../components/Footer.jsx";
import "./MarketingRedesign.css";

const AuthModal = lazy(() => import("../components/AuthModal.jsx"));

async function callFunction(name, data) {
  const [{ httpsCallable }, { fns }] = await Promise.all([
    import("firebase/functions"),
    import("../firebase/functions.js")
  ]);
  return httpsCallable(fns, name)(data).then((r) => r.data);
}

async function startSubscription(plan) {
  const res = await callFunction("createSubscriptionCheckout", { plan });
  if (res?.url) window.location.href = res.url;
}

async function startPack(pack) {
  const res = await callFunction("buyCreditPack", { pack });
  if (res?.url) window.location.href = res.url;
}

async function signOutUser() {
  const [{ signOut }, { auth }] = await Promise.all([
    import("firebase/auth"),
    import("../firebase/auth.js")
  ]);
  return signOut(auth);
}

async function getCurrentUser() {
  const [{ onAuthStateChanged }, { auth }] = await Promise.all([
    import("firebase/auth"),
    import("../firebase/auth.js")
  ]);
  if (auth.currentUser) return auth.currentUser;
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => {
      unsub();
      resolve(u || null);
    });
  });
}

function setMeta(name, content) {
  let tag = document.querySelector(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("name", name);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

const steps = [
  {
    icon: Upload,
    title: "Submit beat files",
    copy: "Upload WAV or MP3 files with title, producer, collaborators, Instagram handles, genre, BPM, and key."
  },
  {
    icon: ShieldCheck,
    title: "Staff review",
    copy: "Every campaign is checked before anything reaches listeners. Rush review is available when timing matters."
  },
  {
    icon: Library,
    title: "Verified delivery",
    copy: "Approved beats enter the Verified library. Pro campaigns can also reach direct inboxes."
  },
  {
    icon: BarChart3,
    title: "Track activity",
    copy: "Follow views, plays, downloads, exports, loop pulls, and campaign status from your dashboard."
  }
];

const libraryRows = [
  ["Poker", "@prodbycash", "Trap", "152 BPM", "C Major", "Downloaded"],
  ["Midnight Run", "@xanderswee", "R&B", "95 BPM", "Eb Minor", "Played"],
  ["Run! 155", "@prodbycash", "Trap", "155 BPM", "F# Minor", "Exported"],
  ["Off Day", "@cash", "Detroit", "145 BPM", "A Minor", "Viewed"]
];

const signals = [
  [Eye, "Verified views", "Know when approved listeners find a beat."],
  [Play, "Playback signals", "See which files get real attention."],
  [Download, "Downloads", "Track when beats leave the browser."],
  [FileAudio, "Exports", "Measure saves from web and iOS flows."],
  [Disc3, "Loop pulls", "Follow loop pool activity separately."],
  [Clock3, "Status timing", "See review, rush, approval, and delivery state."]
];

const plans = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    copy: "Set up your account and preview the campaign workflow.",
    perks: ["Producer profile", "Campaign preview", "Upgrade when ready"]
  },
  {
    id: "plugg",
    name: "Plugg",
    price: "$29",
    copy: "Submit approved beats to the Verified library.",
    perks: ["15 pitch credits monthly", "20 loop credits monthly", "Up to 15 beats per campaign", "Library activity tracking"]
  },
  {
    id: "pro",
    name: "Pro",
    price: "$99",
    copy: "Add direct delivery and stronger campaign volume.",
    perks: ["50 pitch credits monthly", "60 loop credits monthly", "Direct inbox delivery", "Priority visibility in Verified"]
  }
];

function EqMark() {
  return <span className="mk-eq" aria-hidden="true"><i /><i /><i /><i /></span>;
}

function HeroPipeline() {
  return (
    <div className="mk-pipeline" aria-label="Beat pitching pipeline preview">
      <div className="mk-pipeline-top">
        <div className="mk-mini-brand"><EqMark /> PluggurBeats</div>
        <button aria-label="Preview campaign"><Play size={14} fill="currentColor" /></button>
      </div>

      <div className="mk-dropzone">
        <FileAudio size={18} />
        <div>
          <strong>Poker - @prodbycash.mp3</strong>
          <span>Renamed with producer and collaborator handles</span>
        </div>
        <small>Ready</small>
      </div>

      <div className="mk-pipeline-steps">
        {["Upload", "Review", "Delivered"].map((label, index) => (
          <div className="mk-pipeline-step" key={label}>
            <span>{index + 1}</span>
            <strong>{label}</strong>
            <small>{index === 0 ? "Metadata saved" : index === 1 ? "Staff checked" : "Verified live"}</small>
          </div>
        ))}
      </div>

      <div className="mk-signal-board">
        <div>
          <span>Campaign signals</span>
          <strong>Views, plays, downloads, exports</strong>
        </div>
        <div className="mk-bars" aria-hidden="true"><i /><i /><i /><i /><i /></div>
      </div>

      <div className="mk-pipeline-footer">
        <span><ShieldCheck size={13} /> 72h review guarantee</span>
        <span><Rocket size={13} /> Optional rush priority</span>
      </div>
    </div>
  );
}

function DashboardPreview() {
  return (
    <div className="mk-console" aria-label="PluggurBeats dashboard preview">
      <aside className="mk-dash-rail">
        <div className="mk-dash-brand"><EqMark /> PluggurBeats</div>
        {[
          [BarChart3, "Overview"],
          [ShieldCheck, "Verified"],
          [Disc3, "Loop Drops"],
          [Rocket, "Start campaign"],
          [MailCheck, "Pitch analytics"]
        ].map(([Icon, label], i) => (
          <div className={i === 3 ? "active" : ""} key={label}><Icon size={15} /> {label}</div>
        ))}
      </aside>

      <div className="mk-dash-main">
        <div className="mk-console-top">
          <div>
            <span>Beat pitching dashboard</span>
            <h3>Campaign control.</h3>
          </div>
          <button aria-label="Preview campaign"><Play size={14} fill="currentColor" /></button>
        </div>

        <div className="mk-stat-row">
          <div><strong>72h</strong><span>Review</span></div>
          <div><strong>1:1</strong><span>Credit / beat</span></div>
          <div><strong>Live</strong><span>Verified</span></div>
        </div>

        <div className="mk-preview-panel">
          <div className="mk-panel-head">
            <span>Submitted beat</span>
            <b>Staff reviewed</b>
          </div>
          <div className="mk-upload-card">
            <FileAudio size={18} />
            <div>
              <strong>POKER(@prodbycash).mp3</strong>
              <span>Renamed · tagged · ready</span>
            </div>
            <small>152 BPM</small>
          </div>
        </div>

        <div className="mk-live-table compact">
          {[
            ["Views", "Verified listeners", "86"],
            ["Downloads", "Direct pulls", "11"],
            ["Exports", "Web + iOS", "7"]
          ].map(([label, meta, value]) => (
            <div className="mk-table-row" key={label}>
              <div><strong>{label}</strong><small>{meta}</small></div>
              <b>{value}</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LibraryPreview() {
  return (
    <div className="mk-library-preview">
      <div className="mk-library-toolbar">
        <div>
          <span>Verified library</span>
          <strong>Searchable approved beats</strong>
        </div>
        <div className="mk-search"><Search size={14} /> genre, BPM, key, producer</div>
      </div>
      <div className="mk-library-head">
        <span>Beat</span><span>Producer</span><span>Metadata</span><span>Signal</span>
      </div>
      {libraryRows.map(([title, producer, genre, bpm, musicKey, signal]) => (
        <div className="mk-library-row" key={title}>
          <div><strong>{title}</strong><small>{genre}</small></div>
          <span>{producer}</span>
          <span>{bpm} / {musicKey}</span>
          <b>{signal}</b>
        </div>
      ))}
    </div>
  );
}

export default function Marketing() {
  useScrollReveal();
  const [user, setUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("signin");
  const [authMsg, setAuthMsg] = useState("");

  useEffect(() => {
    document.title = "PluggurBeats | Beat Pitching Platform for Producers";
    setMeta(
      "description",
      "Submit beats for human review, reach verified artists, producers, and A&R listeners, and track plays, downloads, exports, and campaign activity with PluggurBeats."
    );
    setMeta(
      "keywords",
      "beat pitching platform, submit beats, send beats to A&R, verified beat library, producer campaign analytics, music producer marketing"
    );
  }, []);

  const openAuth = (mode, msg = "") => {
    setAuthMode(mode);
    setAuthMsg(msg);
    setAuthOpen(true);
  };

  const choosePlan = async (id) => {
    const current = user || await getCurrentUser();
    if (current) setUser(current);
    if (id === "free") {
      if (current?.emailVerified) window.location.href = await getSignedInHome(current);
      else openAuth("signup");
      return;
    }
    if (!current) { openAuth("signup", "Create an account, then choose your plan."); return; }
    if (!current.emailVerified) { openAuth("signin", "Verify your email before choosing a paid plan."); return; }
    startSubscription(id).catch((e) => alert(e.message || "Could not start checkout."));
  };

  const buyPack = async (id) => {
    const current = user || await getCurrentUser();
    if (current) setUser(current);
    if (!current) { openAuth("signup", "Create an account to buy credits."); return; }
    if (!current.emailVerified) { openAuth("signin", "Verify your email before buying credits."); return; }
    startPack(id).catch((e) => alert(e.message || "Could not start checkout."));
  };

  const handleSignOut = () => signOutUser().then(() => setUser(null));

  return (
    <div className="mk-page">
      <header className="mk-nav">
        <a className="mk-brand" href="#top"><EqMark /> PluggurBeats</a>
        <nav>
          <a href="#workflow">How it works</a>
          <a href="#verified">Verified</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <div className="mk-actions">
          {user ? (
            <>
              <a className="mk-btn mk-btn-ghost" href="/dashboard">Dashboard</a>
              <button className="mk-btn mk-btn-dark" onClick={handleSignOut}>Sign out</button>
            </>
          ) : (
            <>
              <button className="mk-btn mk-btn-dark" onClick={() => openAuth("signin")}>Sign in</button>
              <button className="mk-btn mk-btn-gold" onClick={() => openAuth("signup")}>Start pitching</button>
            </>
          )}
        </div>
      </header>

      <main id="top">
        <section className="mk-hero">
          <div className="mk-hero-copy" data-reveal-group>
            <h1>Your Beat. Their Inbox.</h1>
            <p>Submit beats for human review, reach verified music industry listeners, and track what happens after every pitch.</p>
            <div className="mk-hero-actions">
              <button className="mk-btn mk-btn-gold" onClick={() => openAuth("signup")}>Start a campaign <ArrowRight size={16} /></button>
              <a className="mk-btn mk-btn-ghost" href="#workflow">See how it works</a>
            </div>
            <div className="mk-readouts">
              <div><strong>72h</strong><span>review guarantee</span></div>
              <div><strong>1</strong><span>pitch credit per beat</span></div>
              <div><strong>Boost</strong><span>Verified reach</span></div>
            </div>
          </div>
          <div data-reveal>
            <DashboardPreview />
          </div>
        </section>

        <section className="mk-section mk-workflow-section" id="workflow">
          <div className="mk-section-head" data-reveal>
            <span>How it works</span>
            <h2>Pitch beats with structure, not blind links.</h2>
            <p>PluggurBeats turns a folder of files into a reviewed, searchable, trackable campaign.</p>
          </div>
          <div className="mk-workflow" data-reveal-group>
            {steps.map(({ icon: Icon, title, copy }, index) => (
              <article key={title}>
                <div className="mk-step-index">0{index + 1}</div>
                <Icon size={20} />
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mk-section mk-verified-section" id="verified">
          <div className="mk-verified-copy" data-reveal>
            <span>Verified library</span>
            <h2>Approved beats stay discoverable.</h2>
            <p>Instead of disappearing in a DM thread, approved beats enter a curated catalog where verified artists, producers, A&amp;Rs, and music teams can search, play, download, and export.</p>
            <div className="mk-proof-list">
              <div><Check size={15} /> Search by genre, BPM, key, producer, and tags</div>
              <div><Check size={15} /> Beat names stay tied to every Instagram handle</div>
              <div><Check size={15} /> Web and iOS export flows keep files useful</div>
            </div>
          </div>
          <div data-reveal>
            <LibraryPreview />
          </div>
        </section>

        <section className="mk-section mk-analytics-section">
          <div className="mk-section-head compact" data-reveal>
            <span>Campaign analytics</span>
            <h2>Know which beats move.</h2>
            <p>Track the signals that help you decide what to send next.</p>
          </div>
          <div className="mk-signal-grid" data-reveal-group>
            {signals.map(([Icon, title, copy]) => (
              <article key={title}>
                <Icon size={18} />
                <div>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mk-section mk-pricing-section" id="pricing">
          <div className="mk-pricing-intro" data-reveal>
            <span>Pricing</span>
            <h2>Simple credits. Clear campaign costs.</h2>
            <p>Each beat uses one pitch credit. Each loop drop uses one loop credit. Rush review is optional and costs two extra pitch credits.</p>
          </div>
          <div className="mk-plans" data-reveal-group>
            {plans.map((plan) => (
              <article className={plan.id === "pro" ? "featured" : ""} key={plan.id}>
                {plan.id === "pro" && <span className="mk-plan-tag"><Sparkles size={12} /> Pro</span>}
                <h3>{plan.name}</h3>
                <div className="mk-price">{plan.price}<small>/mo</small></div>
                <p>{plan.copy}</p>
                <ul>{plan.perks.map((perk) => <li key={perk}><Check size={14} /> {perk}</li>)}</ul>
                <button className={`mk-btn ${plan.id === "pro" ? "mk-btn-gold" : "mk-btn-ghost"}`} onClick={() => choosePlan(plan.id)}>
                  Choose {plan.name}
                </button>
              </article>
            ))}
          </div>
          <div className="mk-credit-packs">
            <button onClick={() => buyPack("pack10")}><Rocket size={15} /> Buy 10 pitch credits</button>
            <button onClick={() => buyPack("pack25")}><Rocket size={15} /> Buy 25 pitch credits</button>
            <button onClick={() => buyPack("loop20")}><Disc3 size={15} /> Buy 20 loop credits</button>
            <button onClick={() => buyPack("loop50")}><Disc3 size={15} /> Buy 50 loop credits</button>
          </div>
        </section>

        <section className="mk-final-cta">
          <div>
            <h2>Ready to pitch with a paper trail?</h2>
            <p>Build your first campaign, send it for review, and see what happens after the beat leaves your laptop.</p>
          </div>
          <button className="mk-btn mk-btn-gold" onClick={() => openAuth("signup")}>Start pitching <ArrowRight size={16} /></button>
        </section>
      </main>

      <Footer />

      {authOpen && (
        <Suspense fallback={null}>
          <AuthModal
            open={authOpen}
            mode={authMode}
            initialMsg={authMsg}
            onClose={() => setAuthOpen(false)}
            onModeChange={setAuthMode}
          />
        </Suspense>
      )}
    </div>
  );
}
