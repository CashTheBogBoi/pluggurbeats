// ====================================================================
// React Query  <->  Firestore live bridge
//
// React Query is NOT a realtime transport. The pattern here keeps Firestore
// onSnapshot as the live source of truth and pushes every snapshot into the
// React Query cache via queryClient.setQueryData. Components read the data
// through useQuery and re-render the instant a snapshot arrives — no refetch,
// no page refresh.
//
// Loading convention: `data === undefined` => still loading the first
// snapshot. `data === null` => loaded, but the doc doesn't exist. An array
// (possibly empty) => a loaded collection. Errors land in `data.__error` for
// docs, or surface via the onError console log + empty array for collections.
// ====================================================================
import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { fns } from "../firebase/functions.js";

const ts = (v) => (v?.toMillis ? v.toMillis() : (typeof v === "number" ? v : null));
export const millis = ts;

// ---- Live single document ----------------------------------------------
export function useLiveDoc(key, makeRef, { enabled = true, map } = {}) {
  const qc = useQueryClient();
  const resolver = useRef(null);
  const keyStr = JSON.stringify(key);

  useEffect(() => {
    if (!enabled) return undefined;
    const ref = makeRef();
    if (!ref) return undefined;
    const settle = (val) => {
      qc.setQueryData(key, val);
      if (resolver.current) { resolver.current(val); resolver.current = null; }
    };
    const unsub = onSnapshot(
      ref,
      (snap) => settle(snap.exists() ? (map ? map(snap) : { id: snap.id, ...snap.data() }) : null),
      (err) => { console.error("[live doc]", keyStr, err.code || err.message); settle({ __error: err.code || err.message }); }
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, keyStr]);

  return useQuery({
    queryKey: key,
    enabled,
    queryFn: () => {
      const cached = qc.getQueryData(key);
      if (cached !== undefined) return cached;
      return new Promise((resolve) => { resolver.current = resolve; });
    }
  });
}

// ---- Live collection / query -------------------------------------------
export function useLiveCollection(key, makeRef, { enabled = true, map } = {}) {
  const qc = useQueryClient();
  const resolver = useRef(null);
  const keyStr = JSON.stringify(key);

  useEffect(() => {
    if (!enabled) return undefined;
    const ref = makeRef();
    if (!ref) return undefined;
    const settle = (val) => {
      qc.setQueryData(key, val);
      if (resolver.current) { resolver.current(val); resolver.current = null; }
    };
    const unsub = onSnapshot(
      ref,
      (snap) => settle(snap.docs.map((d) => (map ? map(d) : { id: d.id, ...d.data() }))),
      (err) => { console.error("[live collection]", keyStr, err.code || err.message); settle([]); }
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, keyStr]);

  return useQuery({
    queryKey: key,
    enabled,
    queryFn: () => {
      const cached = qc.getQueryData(key);
      if (cached !== undefined) return cached;
      return new Promise((resolve) => { resolver.current = resolve; });
    }
  });
}

// ---- Cloud Function callables ------------------------------------------
// Imperative one-shot call (e.g. inside an event handler that needs the result).
export function call(name, data) {
  return httpsCallable(fns, name)(data).then((r) => r.data);
}

// Mutation hook with built-in pending/error state for buttons & forms.
export function useCallable(name, options = {}) {
  return useMutation({
    mutationFn: (data) => call(name, data),
    ...options
  });
}
