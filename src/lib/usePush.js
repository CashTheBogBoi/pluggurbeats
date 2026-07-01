/* React hooks for push: one to silently refresh the token when already granted
   (safe on mount), one to drive the user-gesture "Enable notifications" toggle. */
import { useCallback, useEffect, useState } from "react";
import {
  pushSupported, registerPush, attachPushHandlers
} from "./notifications.js";

/* Mount-safe: NEVER prompts. If the user previously granted, this refreshes the
   device token (APNs tokens rotate) and wires tap-routing. No-op on web. */
export function usePushAutoRegister(uid, { onTap } = {}) {
  useEffect(() => {
    if (!uid || !pushSupported()) return;
    let alive = true;
    (async () => {
      const { PushNotifications } = await import("@capacitor/push-notifications").catch(() => ({}));
      if (!PushNotifications || !alive) return;
      const perm = await PushNotifications.checkPermissions();
      if (perm.receive === "granted") {
        await registerPush(uid);                 // refresh token (no prompt fires)
        await attachPushHandlers({ onTap });     // route taps into the app
      }
    })();
    return () => { alive = false; };
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps
}

/* Tap-driven: returns [enabled, enable, busy]. Call enable() from onClick. */
export function useNotificationToggle(uid) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  const enable = useCallback(async () => {
    if (!uid || !pushSupported() || busy) return;
    setBusy(true);
    const { granted } = await registerPush(uid);
    setEnabled(granted);
    setBusy(false);
  }, [uid, busy]);

  return [enabled, enable, busy, pushSupported()];
}
