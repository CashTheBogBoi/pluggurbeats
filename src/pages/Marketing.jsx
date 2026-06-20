import { useEffect, useState } from "react";
import { signOut } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, fns } from "../firebase.js";
import { useAuth } from "../hooks/useAuth.js";

import Nav from "../components/Nav.jsx";
import Hero from "../components/Hero.jsx";
import HowItWorks from "../components/HowItWorks.jsx";
import Features from "../components/Features.jsx";
import Genres from "../components/Genres.jsx";
import Pricing from "../components/Pricing.jsx";
import FAQ from "../components/FAQ.jsx";
import Footer from "../components/Footer.jsx";
import AuthModal from "../components/AuthModal.jsx";

// Stripe Checkout via Cloud Functions callables → redirect to hosted Checkout.
const createSubscriptionCheckout = httpsCallable(fns, "createSubscriptionCheckout");
const buyCreditPack = httpsCallable(fns, "buyCreditPack");

async function startSubscription(plan) {
  const res = await createSubscriptionCheckout({ plan });
  if (res.data?.url) window.location.href = res.data.url;
}
async function startPack(pack) {
  const res = await buyCreditPack({ pack });
  if (res.data?.url) window.location.href = res.data.url;
}

export default function Marketing() {
  const user = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("signin");
  const [authMsg, setAuthMsg] = useState("");
  const [pendingPlan, setPendingPlan] = useState(null);

  const openAuth = (mode, msg = "") => {
    setAuthMode(mode);
    setAuthMsg(msg);
    setAuthOpen(true);
  };

  useEffect(() => {
    if (user && user.emailVerified && pendingPlan) {
      const plan = pendingPlan;
      setPendingPlan(null);
      startSubscription(plan).catch((e) => alert(e.message || "Could not start checkout."));
    }
  }, [user, pendingPlan]);

  const choosePlan = (id) => {
    if (id === "free") {
      if (user) window.location.href = "/dashboard";
      else openAuth("signup");
      return;
    }
    if (!user) {
      setPendingPlan(id);
      openAuth("signup", "Create an account, then choose your plan.");
      return;
    }
    startSubscription(id).catch((e) => alert(e.message || "Could not start checkout."));
  };

  const buyPack = (id) => {
    if (!user) {
      openAuth("signup", "Create an account to buy credits.");
      return;
    }
    startPack(id).catch((e) => alert(e.message || "Could not start checkout."));
  };

  return (
    <>
      <Nav user={user} onOpenAuth={openAuth} onSignOut={() => signOut(auth)} />
      <Hero />
      <HowItWorks />
      <Features />
      <Genres />
      <Pricing onChoosePlan={choosePlan} onBuyPack={buyPack} />
      <FAQ />
      <Footer />
      <AuthModal
        open={authOpen}
        mode={authMode}
        initialMsg={authMsg}
        onClose={() => setAuthOpen(false)}
        onModeChange={setAuthMode}
      />
    </>
  );
}
