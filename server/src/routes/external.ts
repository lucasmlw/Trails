/**
 * Proxies to third-party services (routing, geocoding, elevation, OS tiles).
 * Going through the server keeps API keys off the client, lets us set a
 * proper User-Agent (required by Nominatim / OSM tile policy) and lets us
 * cache routing results.
 */
import crypto from "node:crypto";
import express from "express";
import { z } from "zod";
import { env } from "../config.js";
import { db, now } from "../db.js";
import { requireAuth } from "../auth.js";
import { lineLength } from "../geo.js";
import type { GeocodeResult, Position, RoutingMode, RoutingResponse } from "@trails/shared";

const router = express.Router();
router.use(requireAuth);

const headers = { "User-Agent": env.userAgent, Accept: "application/json" };

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 25_000): Promise<unknown> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) }, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`Upstream ${res.status}: ${text.slice(0, 200)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Upstream returned non-JSON: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(t);
  }
}

// ---------- Routing ----------

const BROUTER_PROFILES: Record<RoutingMode, string> = {
  hiking: "hiking-mountain",
  walking: "shortest",
  driving: "car-fast",
  // BRouter has no dedicated 4x4 profile; "trekking" follows tracks, byways and
  // unsurfaced roads while avoiding motorways, which is the closest public option.
  overland: "trekking",
};

const OSRM_PROFILES: Record<RoutingMode, string> = { hiking: "foot", walking: "foot", driving: "driving", overland: "driving" };
const ORS_PROFILES: Record<RoutingMode, string> = { hiking: "foot-hiking", walking: "foot-walking", driving: "driving-car", overland: "cycling-mountain" };

const routeQuery = z.object({
  mode: z.enum(["hiking", "walking", "driving", "overland"]),
  points: z.array(z.tuple([z.number(), z.number()])).min(2).max(2),
});

async function routeBRouter(mode: RoutingMode, points: Position[]): Promise<RoutingResponse> {
  const lonlats = points.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join("|");
  const url = `${env.routing.brouterUrl}?lonlats=${lonlats}&profile=${BROUTER_PROFILES[mode]}&alternativeidx=0&format=geojson`;
  const json = (await fetchJson(url)) as { features?: { geometry: { coordinates: number[][] }; properties: Record<string, string> }[] };
  const f = json.features?.[0];
  if (!f) throw new Error("No route");
  const coordinates = f.geometry.coordinates.map((c) => [c[0], c[1], c[2] ?? undefined].filter((v) => v !== undefined) as Position);
  const distance = Number(f.properties["track-length"]) || lineLength(coordinates);
  const duration = Number(f.properties["total-time"]) || estimateDuration(mode, distance);
  return { coordinates, distance, duration };
}

async function routeOsrm(mode: RoutingMode, points: Position[]): Promise<RoutingResponse> {
  const coords = points.map((p) => `${p[0]},${p[1]}`).join(";");
  const url = `${env.routing.osrmUrl}/route/v1/${OSRM_PROFILES[mode]}/${coords}?overview=full&geometries=geojson`;
  const json = (await fetchJson(url)) as { routes?: { geometry: { coordinates: number[][] }; distance: number; duration: number }[] };
  const r = json.routes?.[0];
  if (!r) throw new Error("No route");
  return { coordinates: r.geometry.coordinates as Position[], distance: r.distance, duration: r.duration };
}

async function routeOrs(mode: RoutingMode, points: Position[]): Promise<RoutingResponse> {
  if (!env.routing.orsKey) throw new Error("ORS_API_KEY not configured");
  const url = `${env.routing.orsUrl}/v2/directions/${ORS_PROFILES[mode]}/geojson`;
  const json = (await fetchJson(url, {
    method: "POST",
    headers: { Authorization: env.routing.orsKey, "Content-Type": "application/json" },
    body: JSON.stringify({ coordinates: points.map((p) => [p[0], p[1]]), elevation: true }),
  })) as { features?: { geometry: { coordinates: number[][] }; properties: { summary: { distance: number; duration: number } } }[] };
  const f = json.features?.[0];
  if (!f) throw new Error("No route");
  return { coordinates: f.geometry.coordinates as Position[], distance: f.properties.summary.distance, duration: f.properties.summary.duration };
}

/** Rough travel time when the engine does not supply one (m -> s). */
export function estimateDuration(mode: RoutingMode, distance: number): number {
  const speedKmh = { hiking: 4, walking: 4.5, driving: 50, overland: 15 }[mode];
  return (distance / 1000 / speedKmh) * 3600;
}

const providers: Record<string, (mode: RoutingMode, points: Position[]) => Promise<RoutingResponse>> = {
  brouter: routeBRouter,
  osrm: routeOsrm,
  ors: routeOrs,
};

router.post("/route", async (req, res) => {
  const parsed = routeQuery.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Expected mode and two [lng, lat] points" });
    return;
  }
  const { mode, points } = parsed.data;
  const key = crypto.createHash("sha1").update(`${env.routing.provider}|${mode}|${points.map((p) => p.map((n) => n.toFixed(5)).join(",")).join("|")}`).digest("hex");
  const cached = db.prepare("SELECT response FROM routing_cache WHERE key = ?").get(key) as { response: string } | undefined;
  if (cached) {
    res.json(JSON.parse(cached.response));
    return;
  }
  const provider = providers[env.routing.provider] ?? routeBRouter;
  try {
    const result = await provider(mode, points as Position[]);
    if (result.coordinates.length < 2) throw new Error("Empty geometry");
    db.prepare("INSERT OR REPLACE INTO routing_cache (key, response, created_at) VALUES (?, ?, ?)").run(key, JSON.stringify(result), now());
    res.json(result);
  } catch (err) {
    console.warn("Routing failed:", (err as Error).message);
    res.status(502).json({ error: "Unable to calculate a route between these points", detail: (err as Error).message });
  }
});

// ---------- Elevation ----------

router.post("/elevation", async (req, res) => {
  const parsed = z.object({ points: z.array(z.tuple([z.number(), z.number()])).min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Expected up to 100 [lng, lat] points" });
    return;
  }
  try {
    const locations = parsed.data.points.map((p) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join("|");
    const json = (await fetchJson(`${env.elevationUrl}?locations=${encodeURIComponent(locations)}`)) as { results?: { elevation: number | null }[] };
    res.json({ elevations: (json.results ?? []).map((r) => r.elevation) });
  } catch (err) {
    res.status(502).json({ error: "Elevation service unavailable", detail: (err as Error).message });
  }
});

// ---------- Geocoding (UK only) ----------

router.get("/geocode", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) {
    res.json({ results: [] });
    return;
  }
  try {
    const url = `${env.nominatimUrl}/search?format=jsonv2&limit=8&countrycodes=gb&addressdetails=0&q=${encodeURIComponent(q)}`;
    const json = (await fetchJson(url)) as { name?: string; display_name: string; lat: string; lon: string; type: string; boundingbox?: string[] }[];
    const results: GeocodeResult[] = json.map((r) => ({
      name: r.name || r.display_name.split(",")[0],
      displayName: r.display_name,
      lat: Number(r.lat),
      lng: Number(r.lon),
      type: r.type,
      bbox: r.boundingbox ? [Number(r.boundingbox[2]), Number(r.boundingbox[0]), Number(r.boundingbox[3]), Number(r.boundingbox[1])] : undefined,
    }));
    res.json({ results });
  } catch (err) {
    res.status(502).json({ error: "Search unavailable", detail: (err as Error).message });
  }
});

// ---------- Ordnance Survey tiles (key kept server side) ----------

router.get("/tiles/os/:style/:z/:x/:y.png", async (req, res) => {
  if (!env.osDataHubKey) {
    res.status(404).end();
    return;
  }
  const { style, z, x, y } = req.params;
  if (!/^[A-Za-z0-9_]+$/.test(style) || ![z, x, y].every((v) => /^\d+$/.test(v))) {
    res.status(400).end();
    return;
  }
  try {
    const upstream = await fetch(`https://api.os.uk/maps/raster/v1/zxy/${style}/${z}/${x}/${y}.png?key=${env.osDataHubKey}`);
    if (!upstream.ok) {
      res.status(upstream.status).end();
      return;
    }
    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "image/png");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    res.status(502).end();
  }
});

export default router;
