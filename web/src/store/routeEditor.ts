import { create } from "zustand";
import type { LngLat, Position, RouteData, RouteSegment, RoutingMode, RoutingResponse } from "@trails/shared";
import { api, OfflineError } from "../api/client";
import { applySampledElevation, computeStats, estimateDuration, sampleLine, straightSegment } from "../lib/geo";

interface Snapshot {
  mode: RoutingMode;
  points: LngLat[];
  segments: (RouteSegment | null)[];
}

interface EditorState extends Snapshot {
  past: Snapshot[];
  future: Snapshot[];
  dirty: boolean;
  /** number of in-flight routing requests */
  busy: number;
  error: string | null;
  lastFailed: { a: LngLat; b: LngLat } | null;

  load: (route: RouteData | null) => void;
  addPoint: (p: LngLat) => void;
  insertPoint: (segmentIndex: number, p: LngLat) => number;
  beginMove: () => void;
  movePoint: (index: number, p: LngLat) => void;
  commitMove: (index: number) => void;
  deletePoint: (index: number) => void;
  reverse: () => void;
  clear: () => void;
  setMode: (mode: RoutingMode) => void;
  undo: () => void;
  redo: () => void;
  retryFailed: () => void;
  markSaved: () => void;
  dismissError: () => void;
  toRouteData: () => RouteData | null;
}

const same = (a: LngLat, b: LngLat) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

async function routeBetween(mode: RoutingMode, a: LngLat, b: LngLat): Promise<RouteSegment> {
  const res = await api<RoutingResponse>("/api/route", { method: "POST", json: { mode, points: [a, b] } });
  let coordinates = res.coordinates;
  // Snap the ends to the exact clicked points so segments join up seamlessly.
  coordinates = [[a[0], a[1], coordinates[0]?.[2]] as Position, ...coordinates.slice(1, -1), [b[0], b[1], coordinates[coordinates.length - 1]?.[2]] as Position].map(
    (c) => (c[2] === undefined ? ([c[0], c[1]] as Position) : c),
  );
  return { coordinates, distance: res.distance, duration: res.duration || estimateDuration(mode, res.distance) };
}

async function ensureElevation(seg: RouteSegment): Promise<RouteSegment> {
  if (seg.coordinates.length < 2 || seg.coordinates.every((c) => c.length > 2 && c[2] != null)) return seg;
  try {
    const samples = sampleLine(seg.coordinates, 100);
    const { elevations } = await api<{ elevations: (number | null)[] }>("/api/elevation", { method: "POST", json: { points: samples.map((c) => [c[0], c[1]]) } });
    return { ...seg, coordinates: applySampledElevation(seg.coordinates, samples, elevations) };
  } catch {
    return seg;
  }
}

export const useRouteEditor = create<EditorState>((set, get) => {
  const snapshot = (): Snapshot => {
    const { mode, points, segments } = get();
    return { mode, points: [...points], segments: [...segments] };
  };
  const pushHistory = () => set((s) => ({ past: [...s.past.slice(-49), snapshot()], future: [], dirty: true }));

  /** Route segment i (between points[i] and points[i+1]) asynchronously. */
  const routeSegment = (i: number) => {
    const { mode, points } = get();
    const a = points[i], b = points[i + 1];
    if (!a || !b) return;
    set((s) => {
      const segments = [...s.segments];
      segments[i] = null;
      return { segments, busy: s.busy + 1 };
    });
    routeBetween(mode, a, b)
      .then(ensureElevation)
      .then(
        (seg) => applyResult(i, a, b, mode, seg, null),
        (err) => {
          const message = err instanceof OfflineError ? "You are offline – straight line used." : "Unable to calculate a route between these points.";
          applyResult(i, a, b, mode, straightSegment(mode, a, b), message);
        },
      );
  };

  const applyResult = (i: number, a: LngLat, b: LngLat, mode: RoutingMode, seg: RouteSegment, error: string | null) => {
    set((s) => {
      const busy = Math.max(0, s.busy - 1);
      // Discard stale answers: the endpoints or mode may have changed while routing.
      const idx = s.points.findIndex((p, k) => same(p, a) && s.points[k + 1] && same(s.points[k + 1], b));
      if (idx === -1 || s.mode !== mode) return { busy };
      const segments = [...s.segments];
      segments[idx] = seg;
      return { segments, busy, error: error ?? s.error, lastFailed: error ? { a, b } : s.lastFailed };
    });
  };

  return {
    mode: "hiking",
    points: [],
    segments: [],
    past: [],
    future: [],
    dirty: false,
    busy: 0,
    error: null,
    lastFailed: null,

    load(route) {
      set({
        mode: route?.routingMode ?? get().mode,
        points: route ? route.points.map((p) => [p.lng, p.lat] as LngLat) : [],
        segments: route ? [...route.segments] : [],
        past: [],
        future: [],
        dirty: false,
        error: null,
        lastFailed: null,
      });
    },

    addPoint(p) {
      pushHistory();
      const n = get().points.length;
      set((s) => ({ points: [...s.points, p], segments: n > 0 ? [...s.segments, null] : s.segments }));
      if (n > 0) routeSegment(n - 1);
    },

    insertPoint(segmentIndex, p) {
      pushHistory();
      set((s) => {
        const points = [...s.points];
        points.splice(segmentIndex + 1, 0, p);
        const segments = [...s.segments];
        const a = points[segmentIndex], b = points[segmentIndex + 2];
        segments.splice(segmentIndex, 1, straightSegment(s.mode, a, p), straightSegment(s.mode, p, b));
        return { points, segments };
      });
      return segmentIndex + 1;
    },

    beginMove() {
      pushHistory();
    },

    movePoint(index, p) {
      set((s) => {
        const points = [...s.points];
        points[index] = p;
        const segments = [...s.segments];
        if (index > 0) segments[index - 1] = straightSegment(s.mode, points[index - 1], p);
        if (index < points.length - 1) segments[index] = straightSegment(s.mode, p, points[index + 1]);
        return { points, segments, dirty: true };
      });
    },

    commitMove(index) {
      if (index > 0) routeSegment(index - 1);
      if (index < get().points.length - 1) routeSegment(index);
    },

    deletePoint(index) {
      pushHistory();
      set((s) => {
        const points = s.points.filter((_, i) => i !== index);
        const segments = [...s.segments];
        if (index === 0) segments.splice(0, 1);
        else if (index === s.points.length - 1) segments.splice(index - 1, 1);
        else segments.splice(index - 1, 2, null);
        return { points, segments };
      });
      const { points } = get();
      if (index > 0 && index < points.length) routeSegment(index - 1);
    },

    reverse() {
      pushHistory();
      set((s) => ({
        points: [...s.points].reverse(),
        segments: [...s.segments].reverse().map((seg) => (seg ? { ...seg, coordinates: [...seg.coordinates].reverse() } : seg)),
      }));
    },

    clear() {
      if (get().points.length === 0) return;
      pushHistory();
      set({ points: [], segments: [], error: null, lastFailed: null });
    },

    setMode(mode) {
      if (mode === get().mode) return;
      pushHistory();
      set({ mode, error: null, lastFailed: null });
      const n = get().points.length;
      for (let i = 0; i < n - 1; i++) routeSegment(i);
    },

    undo() {
      const { past } = get();
      if (past.length === 0) return;
      const prev = past[past.length - 1];
      set((s) => ({ ...prev, past: past.slice(0, -1), future: [snapshot(), ...s.future], dirty: true }));
      get()
        .segments.map((seg, i) => (seg === null ? i : -1))
        .filter((i) => i >= 0)
        .forEach(routeSegment);
    },

    redo() {
      const { future } = get();
      if (future.length === 0) return;
      const next = future[0];
      set((s) => ({ ...next, future: future.slice(1), past: [...s.past, snapshot()], dirty: true }));
      get()
        .segments.map((seg, i) => (seg === null ? i : -1))
        .filter((i) => i >= 0)
        .forEach(routeSegment);
    },

    retryFailed() {
      set({ error: null, lastFailed: null });
      get()
        .segments.map((seg, i) => (seg?.straight ? i : -1))
        .filter((i) => i >= 0)
        .forEach(routeSegment);
    },

    markSaved() {
      set({ dirty: false, past: [], future: [] });
    },

    dismissError() {
      set({ error: null });
    },

    toRouteData() {
      const { mode, points, segments } = get();
      if (points.length === 0) return null;
      const complete = segments.map((s, i) => s ?? straightSegment(mode, points[i], points[i + 1]));
      return {
        routingMode: mode,
        points: points.map((p) => ({ lng: p[0], lat: p[1] })),
        segments: complete,
        stats: computeStats(complete),
      };
    },
  };
});
