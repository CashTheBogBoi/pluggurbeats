// Shared Firebase init for the React app.
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey:            "AIzaSyATP9LnN8pYEeXUd2TmDUZAPrAx9KNbudM",
  authDomain:        "pluggurbeats.firebaseapp.com",
  projectId:         "pluggurbeats",
  storageBucket:     "pluggurbeats.firebasestorage.app",
  messagingSenderId: "990734368924",
  appId:             "1:990734368924:web:1be6ebfbccab82cb576d59",
  measurementId:     "G-J1M418YLQL"
};

export const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Auto-detect long polling: some networks, browsers, proxies, and ad-block
// extensions kill Firestore's WebChannel stream, which would stop onSnapshot
// listeners from firing. Auto-detect falls back to long-polling when needed.
export const db       = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
export const fns      = getFunctions(app, "us-central1");
export const storage  = getStorage(app);
export const provider = new GoogleAuthProvider();
