/* useOptimisticAction — make a button feel instant on mobile.

   The pattern your pages need: apply the visual result NOW (optimistic), fire the
   async Cloud Function, and only roll back if it rejects. No spinner-gating the
   tap; the WebView never feels like it "hung."

   Usage:
     const [views, setViews] = useState(beat.views);
     const recordView = useOptimisticAction({
       apply:    () => setViews(v => v + 1),          // instant
       rollback: () => setViews(v => v - 1),          // only if the call fails
       commit:   () => recordLibraryView({ beatId }), // the real httpsCallable
     });
     <button className="tap-press" onClick={recordView}>…</button>
*/
import { useCallback, useRef } from "react";

export function useOptimisticAction({ apply, commit, rollback, onError }) {
  const inflight = useRef(false);
  return useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    apply?.();                 // 1. paint the optimistic result immediately
    try {
      await commit?.();        // 2. fire the async mutation
    } catch (err) {
      rollback?.();            // 3. revert only on failure
      onError?.(err);
    } finally {
      inflight.current = false;
    }
  }, [apply, commit, rollback, onError]);
}
