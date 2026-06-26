import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/db.js";

export async function getSignedInHome(user) {
  if (!user?.emailVerified) return "/";
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    const profile = snap.exists() ? snap.data() : {};
    const tier = profile.subscription?.tier || "free";
    const isClient = ["plugg", "pro"].includes(tier);
    const isVerified = profile.verifiedListener === true || profile.verifiedPuller === true;
    return isVerified && !isClient ? "/verified" : "/dashboard";
  } catch {
    return "/dashboard";
  }
}

export function hasVerifiedAccess(profile) {
  return profile?.verifiedListener === true || profile?.verifiedPuller === true;
}
