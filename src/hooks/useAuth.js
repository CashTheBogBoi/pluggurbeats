import { useEffect, useState } from "react";

// undefined = still resolving, null = signed out, object = signed in
export function useAuth() {
  const [user, setUser] = useState(undefined);
  useEffect(() => {
    let unsub = null;
    let cancelled = false;

    Promise.all([
      import("firebase/auth"),
      import("../firebase/auth.js")
    ]).then(([{ onAuthStateChanged }, { auth }]) => {
      if (cancelled) return;
      unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    }).catch(() => {
      if (!cancelled) setUser(null);
    });

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, []);
  return user;
}
