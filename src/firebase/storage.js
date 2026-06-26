import { getStorage } from "firebase/storage";
import { app } from "./app.js";

export const storage = getStorage(app);
