// Front-end Firebase init — AUTH ONLY. The backend (Firestore, Cloud
// Functions, Storage) was torn down for a full rebuild; this file
// intentionally exposes nothing but Authentication + the Google provider.
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey:            "AIzaSyATP9LnN8pYEeXUd2TmDUZAPrAx9KNbudM",
  authDomain:        "pluggurbeats.firebaseapp.com",
  projectId:         "pluggurbeats",
  storageBucket:     "pluggurbeats.firebasestorage.app",
  messagingSenderId: "990734368924",
  appId:             "1:990734368924:web:1be6ebfbccab82cb576d59",
  measurementId:     "G-J1M418YLQL"
};

export const app      = initializeApp(firebaseConfig);
export const auth     = getAuth(app);
export const provider = new GoogleAuthProvider();
