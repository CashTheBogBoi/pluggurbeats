import { initializeFirestore } from "firebase/firestore";
import { app } from "./app.js";

// Auto-detect long polling: some networks, browsers, proxies, and ad-block
// extensions kill Firestore's WebChannel stream, which would stop onSnapshot
// listeners from firing. Auto-detect falls back to long-polling when needed.
export const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
