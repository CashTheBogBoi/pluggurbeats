import { getFunctions } from "firebase/functions";
import { app } from "./app.js";

export const fns = getFunctions(app, "us-central1");
