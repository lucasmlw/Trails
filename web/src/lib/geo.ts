import type { LngLat, Position, RouteData, RouteSegment, RouteStats, RoutingMode } from "@trails/shared";

const R = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversine(a: Position | LngLat, b: Position | LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearing(a: LngLat | Position, b: LngLat | Position): number {
  const φ1 = toRad(a[1]), φ2 = toRad(b[1]), Δλ = toRad(b[0] - a[0]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function lineLength(coords: Position[]): number {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversine(coords[i - 1], coords[i]);
  return d;
}

export type BBox = [number, number, number, number]; // west, south, east, north

export function bboxOf(coords: (Position | LngLat)[]): BBox | null {
  if (coords.length === 0) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const c of coords) {
    if (c[0] < w) w = c[0];
    if (c[0] > e) e = c[0];
    if (c[1] < s) s = c[1];
    if (c[1] > n) n = c[1];
  }
  return [w, s, e, n];
}

/** Expand a bbox by `metres` on every side. */
export function padBBox(b: BBox, metres: number): BBox {
  const dLat = metres / 111_320;
  const midLat = (b[1] + b[3]) / 2;
  const dLng = metres / (111_320 * Math.max(0.1, Math.cos(toRad(midLat))));
  return [b[0] - dLng, b[1] - dLat, b[2] + dLng, b[3] + dLat];
}

export interface NearestPoint {
  point: LngLat;
  /** distance from the query point to the line, metres */
  distance: number;
  /** distance along the line from its start, metres */
  along: number;
  /** index of the segment start vertex */
  index: number;
}

/**
 * Nearest point on a polyline using a local equirectangular projection around
 * the query point. Accurate to well under a metre at UK route scales.
 */
export function nearestPointOnLine(coords: Position[], p: LngLat | Position): NearestPoint | null {
  if (coords.length === 0) return null;
  if (coords.length === 1) return { point: [coords[0][0], coords[0][1]], distance: haversine(coords[0], p), along: 0, index: 0 };
  const kx = 111_320 * Math.cos(toRad(p[1]));
  const ky = 111_320;
  const px = p[0] * kx, py = p[1] * ky;
  let best: NearestPoint | null = null;
  let along = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i], b = coords[i + 1];
    const ax = a[0] * kx, ay = a[1] * ky, bx = b[0] * kx, by = b[1] * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx, qy = ay + t * dy;
    const dist = Math.hypot(px - qx, py - qy);
    const segLen = Math.sqrt(len2);
    if (!best || dist < best.distance) {
      best = { point: [qx / kx, qy / ky], distance: dist, along: along + t * segLen, index: i };
    }
    along += segLen;
  }
  return best;
}

/** Position `metres` along a line, or the end if beyond. */
export function pointAlong(coords: Position[], metres: number): LngLat {
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = haversine(coords[i - 1], coords[i]);
    if (acc + d >= metres) {
      const t = d === 0 ? 0 : (metres - acc) / d;
      return [coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t];
    }
    acc += d;
  }
  const last = coords[coords.length - 1];
  return [last[0], last[1]];
}

/** Concatenate segment geometries, dropping duplicate shared vertices. */
export function routeCoordinates(route: Pick<RouteData, "segments"> | null | undefined): Position[] {
  if (!route) return [];
  const out: Position[] = [];
  route.segments.forEach((seg, i) => {
    seg.coordinates.forEach((c, j) => {
      if (i > 0 && j === 0) return;
      out.push(c);
    });
  });
  return out;
}

/**
 * Elevation gain/loss with a small hysteresis threshold so that DEM noise on
 * flat ground does not inflate the totals.
 */
export function elevationStats(coords: Position[], threshold = 3): Pick<RouteStats, "elevationGain" | "elevationLoss" | "minElevation" | "maxElevation"> {
  let gain = 0, loss = 0, min: number | null = null, max: number | null = null;
  let ref: number | null = null;
  for (const c of coords) {
    const e = c[2];
    if (e == null || Number.isNaN(e)) continue;
    if (min === null || e < min) min = e;
    if (max === null || e > max) max = e;
    if (ref === null) {
      ref = e;
      continue;
    }
    const diff = e - ref;
    if (diff >= threshold) {
      gain += diff;
      ref = e;
    } else if (diff <= -threshold) {
      loss += -diff;
      ref = e;
    }
  }
  return { elevationGain: Math.round(gain), elevationLoss: Math.round(loss), minElevation: min, maxElevation: max };
}

export function computeStats(segments: RouteSegment[]): RouteStats {
  const coords = routeCoordinates({ segments });
  return {
    distance: segments.reduce((s, x) => s + x.distance, 0),
    duration: segments.reduce((s, x) => s + x.duration, 0),
    ...elevationStats(coords),
  };
}

export function estimateDuration(mode: RoutingMode, distance: number, gain = 0): number {
  // Naismith's rule for foot travel; flat speeds for vehicles.
  if (mode === "hiking" || mode === "walking") return (distance / 1000 / (mode === "hiking" ? 4 : 4.5)) * 3600 + (gain / 600) * 3600;
  const kmh = mode === "driving" ? 50 : 15;
  return (distance / 1000 / kmh) * 3600;
}

export function straightSegment(mode: RoutingMode, a: LngLat, b: LngLat): RouteSegment {
  const distance = haversine(a, b);
  return { coordinates: [a, b], distance, duration: estimateDuration(mode, distance), straight: true };
}

/** Densify a coordinate list to at most `max` evenly spaced samples (by distance). */
export function sampleLine(coords: Position[], max: number): Position[] {
  if (coords.length <= max) return coords;
  const total = lineLength(coords);
  const out: Position[] = [];
  for (let i = 0; i < max; i++) {
    const p = pointAlong(coords, (total * i) / (max - 1));
    out.push(p);
  }
  return out;
}

/** Interpolate elevations from sampled points back onto full coordinates. */
export function applySampledElevation(coords: Position[], samples: Position[], elevations: (number | null)[]): Position[] {
  const total = lineLength(coords);
  const sampleDist = samples.map((_, i) => (total * i) / (samples.length - 1));
  let acc = 0;
  return coords.map((c, i) => {
    if (i > 0) acc += haversine(coords[i - 1], c);
    let j = 0;
    while (j < sampleDist.length - 2 && sampleDist[j + 1] < acc) j++;
    const e0 = elevations[j], e1 = elevations[j + 1] ?? e0;
    if (e0 == null) return c;
    const span = sampleDist[j + 1] - sampleDist[j] || 1;
    const t = Math.max(0, Math.min(1, (acc - sampleDist[j]) / span));
    const e = e1 == null ? e0 : e0 + (e1 - e0) * t;
    return [c[0], c[1], Math.round(e * 10) / 10];
  });
}
