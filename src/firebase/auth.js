import { getAuth, indexedDBLocalPersistence, initializeAuth } from "firebase/auth";
import { Capacitor } from "@capacitor/core";
import { app } from "./app.js";

// In Capacitor's native WebView, getAuth() loads a hidden OAuth resolver iframe
// from authDomain that stalls and blocks email/password sign-in. initializeAuth
// with explicit IndexedDB persistence (and no popupRedirectResolver) avoids that
// iframe while still persisting login across app launches.
export const auth = Capacitor.isNativePlatform()
  ? initializeAuth(app, { persistence: indexedDBLocalPersistence })
  : getAuth(app);
