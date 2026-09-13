import crypto from "node:crypto";
import express from "express";
import { z } from "zod";
import { db, now } from "../db.js";
import { requireAuth } from "../auth.js";
import type { AuthedRequest } from "../auth.js";
import { loadTrack, loadTracks, requireTrip, touchTrip } from "../trips.js";
import { haversine } from "../geo.js";

const router = express.Router();
router.use(requireAuth);

const pointSchema = z.object({
  timestamp: z.string().datetime(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  altitude: z.number().nullable().optional(),
  accuracy: z.number().nullable().optional(),
  speed: z.number().nullable().optional(),
  heading: z.number().nullable().optional(),
});

const trackBody = z.object({
  id: z.string().regex(/^[0-9a-f-]{36}$/i).optional(),
  name: z.string().max(200).optional(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable().optional(),
  points: z.array(pointSchema).max(200_000),
});

function recomputeDistance(trackId: string) {
  const pts = db.prepare("SELECT latitude, longitude FROM gps_track_points WHERE track_id = ? ORDER BY timestamp, id").all(trackId) as {
    latitude: number;
    longitude: number;
  }[];
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1].longitude, pts[i - 1].latitude, pts[i].longitude, pts[i].latitude);
  db.prepare("UPDATE gps_tracks SET distance = ? WHERE id = ?").run(d, trackId);
}

router.get("/trips/:tripId/tracks", requireTrip("view"), (req, res) => {
  res.json({ tracks: loadTracks(req.params.tripId) });
});

/**
 * Upload a track. Tracks are append-only: uploading the same track id again only
 * appends points newer than the last stored point, so an offline device can
 * safely re-send its whole buffer after reconnecting.
 */
router.post("/trips/:tripId/tracks", requireTrip("edit"), (req, res) => {
  const parsed = trackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid track", details: parsed.error.flatten() });
    return;
  }
  const user = (req as AuthedRequest).user;
  const b = parsed.data;
  const id = b.id ?? crypto.randomUUID();
  const tx = db.transaction(() => {
    const existing = db.prepare("SELECT id, trip_id FROM gps_tracks WHERE id = ?").get(id) as { id: string; trip_id: string } | undefined;
    if (existing && existing.trip_id !== req.params.tripId) throw new Error("conflict");
    if (!existing) {
      db.prepare("INSERT INTO gps_tracks (id, trip_id, user_id, name, started_at, ended_at, distance) VALUES (?, ?, ?, ?, ?, ?, 0)").run(
        id,
        req.params.tripId,
        user.id,
        b.name ?? `Track ${new Date(b.startedAt).toLocaleString("en-GB")}`,
        b.startedAt,
        b.endedAt ?? null,
      );
    } else {
      db.prepare("UPDATE gps_tracks SET ended_at = COALESCE(?, ended_at), name = COALESCE(?, name) WHERE id = ?").run(b.endedAt ?? null, b.name ?? null, id);
    }
    const last = (db.prepare("SELECT MAX(timestamp) AS t FROM gps_track_points WHERE track_id = ?").get(id) as { t: string | null }).t;
    const ins = db.prepare(
      "INSERT INTO gps_track_points (track_id, timestamp, latitude, longitude, altitude, accuracy, speed, heading) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const p of b.points) {
      if (last && p.timestamp <= last) continue;
      ins.run(id, p.timestamp, p.lat, p.lng, p.altitude ?? null, p.accuracy ?? null, p.speed ?? null, p.heading ?? null);
    }
    recomputeDistance(id);
  });
  try {
    tx();
  } catch {
    res.status(409).json({ error: "Track id belongs to another trip" });
    return;
  }
  touchTrip(req.params.tripId);
  res.status(201).json({ track: loadTrack(id), tracks: loadTracks(req.params.tripId) });
});

router.patch("/trips/:tripId/tracks/:trackId", requireTrip("edit"), (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(200) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid track" });
    return;
  }
  db.prepare("UPDATE gps_tracks SET name = ? WHERE id = ? AND trip_id = ?").run(parsed.data.name, req.params.trackId, req.params.tripId);
  res.json({ tracks: loadTracks(req.params.tripId) });
});

router.delete("/trips/:tripId/tracks/:trackId", requireTrip("edit"), (req, res) => {
  db.prepare("DELETE FROM gps_tracks WHERE id = ? AND trip_id = ?").run(req.params.trackId, req.params.tripId);
  touchTrip(req.params.tripId);
  res.json({ tracks: loadTracks(req.params.tripId) });
});

export default router;
