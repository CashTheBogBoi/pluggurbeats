// Backwards-compatible aggregate exports. Prefer importing from the smaller
// service modules in src/firebase/ so routes only load the SDKs they use.
export { app } from "./firebase/app.js";
export { auth } from "./firebase/auth.js";
export { db } from "./firebase/db.js";
export { fns } from "./firebase/functions.js";
export { storage } from "./firebase/storage.js";
