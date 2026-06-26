import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebase/db.js";

export async function ensureUserProfile(user, overrides = {}) {
  if (!user?.uid) return;
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  const publicProfile = {
    displayName: overrides.displayName ?? user.displayName ?? "",
    email: user.email || "",
    phone: "",
    ...(user.photoURL ? { photoURL: user.photoURL } : {})
  };

  if (snap.exists()) {
    await setDoc(ref, publicProfile, { merge: true });
    return;
  }

  await setDoc(ref, {
    ...publicProfile,
    createdAt: serverTimestamp(),
    subscription: { tier: "free", status: "active", stripeCustomerId: null, stripeSubId: null, renewsAt: null },
    pitchCredits: { balance: 0, monthlyGrant: 0, lastGrantAt: null },
    loopCredits: { balance: 5, monthlyGrant: 5, lastGrantAt: serverTimestamp() },
    verifiedPuller: false
  });
}
