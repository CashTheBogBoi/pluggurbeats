import { useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "../firebase.js";
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

export default function Marketing() {
  const user = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("signin");
  const [authMsg, setAuthMsg] = useState("");

  const openAuth = (mode, msg = "") => {
    setAuthMode(mode);
    setAuthMsg(msg);
    setAuthOpen(true);
  };

  // Checkout/billing backend was removed for the rebuild. Plan + pack buttons
  // now just route signed-in users to the dashboard or prompt sign-up.
  const choosePlan = () => {
    if (user) window.location.href = "/dashboard";
    else openAuth("signup");
  };

  const buyPack = () => {
    if (user) window.location.href = "/dashboard";
    else openAuth("signup", "Create an account to get started.");
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
