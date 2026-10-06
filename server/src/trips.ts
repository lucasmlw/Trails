import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { db, now } from "./db.js";
import type {
  ChecklistItem,
  Permission,
  Photo,
  RouteData,
  Track,
  TrackPoint,
  Trip,
  TripShare,
  TripSummary,
  Waypoint,
  WaypointCategory,
} from "@trails/shared";
import type { AuthedRequest } from "./auth.js";

interface TripRow {
  id: string;
  owner_id: string;
  owner_name: string;
  name: string;
  description: string;
  notes: string;
  map_center_lng: number | null;
  map_center_lat: number | null;
  map_zoom: number | null;
  created_at: string;
  updated_at: string;
  share_permission: string | null;
}

const tripSelect = `
  SELECT t.*, u.display_name AS owner_name, s.permission AS share_permission
  FROM trips t
  JOIN users u ON u.id = t.owner_id
  LEFT JOIN trip_shares s ON s.trip_id = t.id AND s.user_id = ?
  WHERE t.deleted_at IS NULL`;

export function permissionFor(row: TripRow, userId: string): Permission | null {
  if (row.owner_id === userId) return "owner";
  if (row.share_permission === "edit") return "edit";
  if (row.share_permission === "view") return "view";
  return null;
}

export function getTripRow(tripId: string, userId: string): TripRow | undefined {
  return db.prepare(`${tripSelect} AND t.id = ?`).get(userId, tripId) as TripRow | undefined;
}

export function loadRoute(tripId: string): RouteData | null {
  const r = db.prepare("SELECT * FROM routes WHERE trip_id = ?").get(tripId) as
    | {
        id: string;
        routing_mode: string;
        geometry: string;
        distance: number;
        duration: number;
        elevation_gain: number;
        elevation_loss: number;
        min_elevation: number | null;
        max_elevation: number | null;
      }
    | undefined;
  if (!r) return null;
  const points = db
    .prepare("SELECT latitude AS lat, longitude AS lng FROM route_points WHERE route_id = ? ORDER BY sequence")
    .all(r.id) as { lat: number; lng: number }[];
  return {
    routingMode: r.routing_mode as RouteData["routingMode"],
    points,
    segments: JSON.parse(r.geometry),
    stats: {
      distance: r.distance,
      duration: r.duration,
      elevationGain: r.elevation_gain,
      elevationLoss: r.elevation_loss,
      minElevation: r.min_elevation,
      maxElevation: r.max_elevation,
    },
  };
}

export function saveRoute(tripId: string, route: RouteData | null) {
  const tx = db.transaction(() => {
    const existing = db.prepare("SELECT id FROM routes WHERE trip_id = ?").get(tripId) as { id: string } | undefined;
    if (existing) db.prepare("DELETE FROM routes WHERE id = ?").run(existing.id);
    if (!route) return;
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO routes (id, trip_id, routing_mode, geometry, distance, duration, elevation_gain, elevation_loss, min_elevation, max_elevation, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      tripId,
      route.routingMode,
      JSON.stringify(route.segments),
      route.stats.distance,
      route.stats.duration,
      route.stats.elevationGain,
      route.stats.elevationLoss,
      route.stats.minElevation,
      route.stats.maxElevation,
      now(),
    );
    const ins = db.prepare("INSERT INTO route_points (id, route_id, latitude, longitude, sequence) VALUES (?, ?, ?, ?, ?)");
    route.points.forEach((p, i) => ins.run(crypto.randomUUID(), id, p.lat, p.lng, i));
  });
  tx();
}

export function photoToApi(row: { id: string; waypoint_id: string; created_at: string }): Photo {
  return {
    id: row.id,
    waypointId: row.waypoint_id,
    url: `/api/photos/${row.id}`,
    thumbnailUrl: `/api/photos/${row.id}/thumb`,
    createdAt: row.created_at,
  };
}

export function loadWaypoint(id: string): Waypoint | undefined {
  const w = db.prepare("SELECT * FROM waypoints WHERE id = ?").get(id) as
    | {
        id: string;
        trip_id: string;
        name: string;
        description: string;
        category: string;
        latitude: number;
        longitude: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  if (!w) return undefined;
  const photos = db.prepare("SELECT id, waypoint_id, created_at FROM photos WHERE waypoint_id = ? ORDER BY created_at").all(w.id) as {
    id: string;
    waypoint_id: string;
    created_at: string;
  }[];
  return {
    id: w.id,
    tripId: w.trip_id,
    name: w.name,
    description: w.description,
    category: w.category as WaypointCategory,
    lat: w.latitude,
    lng: w.longitude,
    createdAt: w.created_at,
    updatedAt: w.updated_at,
    photos: photos.map(photoToApi),
  };
}

export function loadWaypoints(tripId: string): Waypoint[] {
  const ids = db.prepare("SELECT id FROM waypoints WHERE trip_id = ? ORDER BY created_at").all(tripId) as { id: string }[];
  return ids.map((r) => loadWaypoint(r.id)!).filter(Boolean);
}

export function loadChecklist(tripId: string): ChecklistItem[] {
  const rows = db.prepare("SELECT * FROM checklist_items WHERE trip_id = ? ORDER BY sort_order, rowid").all(tripId) as {
    id: string;
    trip_id: string;
    text: string;
    completed: number;
    sort_order: number;
  }[];
  return rows.map((r) => ({ id: r.id, tripId: r.trip_id, text: r.text, completed: r.completed === 1, sortOrder: r.sort_order }));
}

export function loadTrack(trackId: string): Track | undefined {
  const t = db.prepare("SELECT * FROM gps_tracks WHERE id = ?").get(trackId) as
    | { id: string; trip_id: string; name: string; started_at: string; ended_at: string | null; distance: number }
    | undefined;
  if (!t) return undefined;
  const pts = db
    .prepare(
      "SELECT timestamp, latitude, longitude, altitude, accuracy, speed, heading FROM gps_track_points WHERE track_id = ? ORDER BY timestamp, id",
    )
    .all(t.id) as { timestamp: string; latitude: number; longitude: number; altitude: number | null; accuracy: number | null; speed: number | null; heading: number | null }[];
  const points: TrackPoint[] = pts.map((p) => ({
    timestamp: p.timestamp,
    lat: p.latitude,
    lng: p.longitude,
    altitude: p.altitude,
    accuracy: p.accuracy,
    speed: p.speed,
    heading: p.heading,
  }));
  return { id: t.id, tripId: t.trip_id, name: t.name, startedAt: t.started_at, endedAt: t.ended_at, distance: t.distance, points };
}

export function loadTracks(tripId: string): Track[] {
  const ids = db.prepare("SELECT id FROM gps_tracks WHERE trip_id = ? ORDER BY started_at").all(tripId) as { id: string }[];
  return ids.map((r) => loadTrack(r.id)!).filter(Boolean);
}

export function loadShares(tripId: string): TripShare[] {
  return db
    .prepare(
      `SELECT s.trip_id AS tripId, s.user_id AS userId, s.permission, u.username, u.display_name AS displayName
       FROM trip_shares s JOIN users u ON u.id = s.user_id WHERE s.trip_id = ?`,
    )
    .all(tripId) as TripShare[];
}

export function loadTrip(tripId: string, userId: string): Trip | null {
  const row = getTripRow(tripId, userId);
  if (!row) return null;
  const permission = permissionFor(row, userId);
  if (!permission) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    name: row.name,
    description: row.description,
    notes: row.notes,
    mapCenter: row.map_center_lng != null && row.map_center_lat != null ? [row.map_center_lng, row.map_center_lat] : null,
    mapZoom: row.map_zoom,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    permission,
    route: loadRoute(row.id),
    waypoints: loadWaypoints(row.id),
    checklist: loadChecklist(row.id),
    tracks: loadTracks(row.id),
    shares: loadShares(row.id),
  };
}

export function listTrips(userId: string): TripSummary[] {
  const rows = db
    .prepare(
      `${tripSelect} AND (t.owner_id = ? OR s.user_id IS NOT NULL)
       ORDER BY t.updated_at DESC`,
    )
    .all(userId, userId) as TripRow[];
  const distStmt = db.prepare("SELECT distance FROM routes WHERE trip_id = ?");
  const wpStmt = db.prepare("SELECT COUNT(*) AS c FROM waypoints WHERE trip_id = ?");
  const shareStmt = db.prepare("SELECT COUNT(*) AS c FROM trip_shares WHERE trip_id = ?");
  return rows.map((r) => ({
    id: r.id,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    name: r.name,
    description: r.description,
    distance: (distStmt.get(r.id) as { distance: number } | undefined)?.distance ?? null,
    waypointCount: (wpStmt.get(r.id) as { c: number }).c,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    permission: permissionFor(r, userId)!,
    shared: (shareStmt.get(r.id) as { c: number }).c > 0,
  }));
}

export function touchTrip(tripId: string) {
  db.prepare("UPDATE trips SET updated_at = ? WHERE id = ?").run(now(), tripId);
}

/** Express middleware factory: loads the trip row and checks the caller has the required permission. */
export function requireTrip(minimum: "view" | "edit" | "owner") {
  const rank: Record<Permission, number> = { view: 0, edit: 1, owner: 2 };
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as AuthedRequest).user;
    const tripId = req.params.tripId ?? req.params.id;
    const row = getTripRow(tripId, user.id);
    const perm = row ? permissionFor(row, user.id) : null;
    if (!row || !perm) {
      // 404 rather than 403 so that trip ids cannot be probed.
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    if (rank[perm] < rank[minimum]) {
      res.status(403).json({ error: "You do not have permission to do that" });
      return;
    }
    (req as TripRequest).tripRow = row;
    (req as TripRequest).permission = perm;
    next();
  };
}

export interface TripRequest extends AuthedRequest {
  tripRow: TripRow;
  permission: Permission;
}
