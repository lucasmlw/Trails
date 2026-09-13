import crypto from "node:crypto";
import express from "express";
import { z } from "zod";
import { db, now } from "../db.js";
import { requireAuth } from "../auth.js";
import type { AuthedRequest } from "../auth.js";
import {
  listTrips,
  loadTrip,
  requireTrip,
  saveRoute,
  touchTrip,
  loadRoute,
  loadWaypoints,
  loadChecklist,
  type TripRequest,
} from "../trips.js";
import { tripToGpx } from "../gpx.js";
import { ROUTING_MODES } from "@trails/shared";

const router = express.Router();
router.use(requireAuth);

const tripBody = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  notes: z.string().max(50_000).optional(),
  mapCenter: z.tuple([z.number(), z.number()]).nullable().optional(),
  mapZoom: z.number().min(0).max(24).nullable().optional(),
});

const positionSchema = z.union([z.tuple([z.number(), z.number()]), z.tuple([z.number(), z.number(), z.number()])]);

const routeSchema = z
  .object({
    routingMode: z.enum(ROUTING_MODES.map((m) => m.id) as [string, ...string[]]),
    points: z.array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })).max(500),
    segments: z.array(
      z.object({
        coordinates: z.array(positionSchema).max(50_000),
        distance: z.number().min(0),
        duration: z.number().min(0),
        straight: z.boolean().optional(),
      }),
    ),
    stats: z.object({
      distance: z.number().min(0),
      duration: z.number().min(0),
      elevationGain: z.number().min(0),
      elevationLoss: z.number().min(0),
      minElevation: z.number().nullable(),
      maxElevation: z.number().nullable(),
    }),
  })
  .nullable();

router.get("/", (req, res) => {
  res.json({ trips: listTrips((req as AuthedRequest).user.id) });
});

router.post("/", (req, res) => {
  const parsed = tripBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid trip", details: parsed.error.flatten() });
    return;
  }
  const user = (req as AuthedRequest).user;
  const id = crypto.randomUUID();
  const ts = now();
  const b = parsed.data;
  db.prepare(
    `INSERT INTO trips (id, owner_id, name, description, notes, map_center_lng, map_center_lat, map_zoom, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, user.id, b.name, b.description ?? "", b.notes ?? "", b.mapCenter?.[0] ?? null, b.mapCenter?.[1] ?? null, b.mapZoom ?? null, ts, ts);
  res.status(201).json({ trip: loadTrip(id, user.id) });
});

router.get("/:tripId", requireTrip("view"), (req, res) => {
  res.json({ trip: loadTrip(req.params.tripId, (req as AuthedRequest).user.id) });
});

router.patch("/:tripId", requireTrip("edit"), (req, res) => {
  const parsed = tripBody.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid trip", details: parsed.error.flatten() });
    return;
  }
  const b = parsed.data;
  const row = (req as TripRequest).tripRow;
  db.prepare(
    `UPDATE trips SET name = ?, description = ?, notes = ?, map_center_lng = ?, map_center_lat = ?, map_zoom = ?, updated_at = ? WHERE id = ?`,
  ).run(
    b.name ?? row.name,
    b.description ?? row.description,
    b.notes ?? row.notes,
    b.mapCenter === undefined ? row.map_center_lng : b.mapCenter?.[0] ?? null,
    b.mapCenter === undefined ? row.map_center_lat : b.mapCenter?.[1] ?? null,
    b.mapZoom === undefined ? row.map_zoom : b.mapZoom,
    now(),
    row.id,
  );
  res.json({ trip: loadTrip(row.id, (req as AuthedRequest).user.id) });
});

router.delete("/:tripId", requireTrip("owner"), (req, res) => {
  // Soft delete so that offline clients can detect the deletion explicitly on sync.
  db.prepare("UPDATE trips SET deleted_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), req.params.tripId);
  res.json({ ok: true });
});

router.post("/:tripId/duplicate", requireTrip("view"), (req, res) => {
  const user = (req as AuthedRequest).user;
  const src = loadTrip(req.params.tripId, user.id)!;
  const id = crypto.randomUUID();
  const ts = now();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO trips (id, owner_id, name, description, notes, map_center_lng, map_center_lat, map_zoom, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, user.id, `${src.name} (copy)`, src.description, src.notes, src.mapCenter?.[0] ?? null, src.mapCenter?.[1] ?? null, src.mapZoom, ts, ts);
    saveRoute(id, src.route);
    const wp = db.prepare(
      "INSERT INTO waypoints (id, trip_id, name, description, category, latitude, longitude, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const ph = db.prepare("INSERT INTO photos (id, waypoint_id, file_path, thumbnail_path, mime_type, created_at) SELECT ?, ?, file_path, thumbnail_path, mime_type, ? FROM photos WHERE id = ?");
    for (const w of src.waypoints) {
      const wid = crypto.randomUUID();
      wp.run(wid, id, w.name, w.description, w.category, w.lat, w.lng, ts, ts);
      for (const p of w.photos) ph.run(crypto.randomUUID(), wid, ts, p.id);
    }
    const cl = db.prepare("INSERT INTO checklist_items (id, trip_id, text, completed, sort_order) VALUES (?, ?, ?, 0, ?)");
    for (const c of src.checklist) cl.run(crypto.randomUUID(), id, c.text, c.sortOrder);
  });
  tx();
  res.status(201).json({ trip: loadTrip(id, user.id) });
});

router.put("/:tripId/route", requireTrip("edit"), (req, res) => {
  const parsed = routeSchema.safeParse(req.body.route ?? req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid route", details: parsed.error.flatten() });
    return;
  }
  const route = parsed.data;
  if (route && route.points.length > 1 && route.segments.length !== route.points.length - 1) {
    res.status(400).json({ error: "Route must have one segment per pair of consecutive points" });
    return;
  }
  saveRoute(req.params.tripId, route as never);
  touchTrip(req.params.tripId);
  res.json({ route: loadRoute(req.params.tripId) });
});

router.get("/:tripId/export.gpx", requireTrip("view"), (req, res) => {
  const trip = loadTrip(req.params.tripId, (req as AuthedRequest).user.id)!;
  const gpx = tripToGpx(trip);
  const safeName = trip.name.replace(/[^a-z0-9-_ ]/gi, "").trim() || "trip";
  res.setHeader("Content-Type", "application/gpx+xml; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}.gpx"`);
  res.send(gpx);
});

// ---------- Sharing ----------

const shareBody = z.object({
  userId: z.string().min(1),
  permission: z.enum(["view", "edit"]).default("edit"),
});

router.post("/:tripId/shares", requireTrip("owner"), (req, res) => {
  const parsed = shareBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid share request" });
    return;
  }
  const { userId, permission } = parsed.data;
  const row = (req as TripRequest).tripRow;
  if (userId === row.owner_id) {
    res.status(400).json({ error: "You already own this trip" });
    return;
  }
  const target = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  db.prepare(
    `INSERT INTO trip_shares (trip_id, user_id, permission, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(trip_id, user_id) DO UPDATE SET permission = excluded.permission`,
  ).run(row.id, userId, permission, now());
  touchTrip(row.id);
  res.json({ trip: loadTrip(row.id, (req as AuthedRequest).user.id) });
});

router.delete("/:tripId/shares/:userId", requireTrip("owner"), (req, res) => {
  db.prepare("DELETE FROM trip_shares WHERE trip_id = ? AND user_id = ?").run(req.params.tripId, req.params.userId);
  touchTrip(req.params.tripId);
  res.json({ trip: loadTrip(req.params.tripId, (req as AuthedRequest).user.id) });
});

// ---------- Checklist ----------

const checklistItemBody = z.object({
  text: z.string().trim().min(1).max(500),
  completed: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

router.get("/:tripId/checklist", requireTrip("view"), (req, res) => {
  res.json({ checklist: loadChecklist(req.params.tripId) });
});

router.post("/:tripId/checklist", requireTrip("edit"), (req, res) => {
  const parsed = checklistItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid checklist item" });
    return;
  }
  const id = req.body.id && typeof req.body.id === "string" && /^[0-9a-f-]{36}$/i.test(req.body.id) ? req.body.id : crypto.randomUUID();
  const maxOrder = (db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM checklist_items WHERE trip_id = ?").get(req.params.tripId) as { m: number }).m;
  db.prepare("INSERT OR REPLACE INTO checklist_items (id, trip_id, text, completed, sort_order) VALUES (?, ?, ?, ?, ?)").run(
    id,
    req.params.tripId,
    parsed.data.text,
    parsed.data.completed ? 1 : 0,
    parsed.data.sortOrder ?? maxOrder + 1,
  );
  touchTrip(req.params.tripId);
  res.status(201).json({ checklist: loadChecklist(req.params.tripId) });
});

router.patch("/:tripId/checklist/:itemId", requireTrip("edit"), (req, res) => {
  const parsed = checklistItemBody.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid checklist item" });
    return;
  }
  const existing = db.prepare("SELECT * FROM checklist_items WHERE id = ? AND trip_id = ?").get(req.params.itemId, req.params.tripId) as
    | { text: string; completed: number; sort_order: number }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  db.prepare("UPDATE checklist_items SET text = ?, completed = ?, sort_order = ? WHERE id = ?").run(
    parsed.data.text ?? existing.text,
    parsed.data.completed === undefined ? existing.completed : parsed.data.completed ? 1 : 0,
    parsed.data.sortOrder ?? existing.sort_order,
    req.params.itemId,
  );
  touchTrip(req.params.tripId);
  res.json({ checklist: loadChecklist(req.params.tripId) });
});

router.put("/:tripId/checklist/order", requireTrip("edit"), (req, res) => {
  const parsed = z.object({ ids: z.array(z.string()).max(1000) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid order" });
    return;
  }
  const stmt = db.prepare("UPDATE checklist_items SET sort_order = ? WHERE id = ? AND trip_id = ?");
  db.transaction(() => parsed.data.ids.forEach((id, i) => stmt.run(i, id, req.params.tripId)))();
  touchTrip(req.params.tripId);
  res.json({ checklist: loadChecklist(req.params.tripId) });
});

router.delete("/:tripId/checklist/:itemId", requireTrip("edit"), (req, res) => {
  db.prepare("DELETE FROM checklist_items WHERE id = ? AND trip_id = ?").run(req.params.itemId, req.params.tripId);
  touchTrip(req.params.tripId);
  res.json({ checklist: loadChecklist(req.params.tripId) });
});

// ---------- Waypoint list convenience ----------
router.get("/:tripId/waypoints", requireTrip("view"), (req, res) => {
  res.json({ waypoints: loadWaypoints(req.params.tripId) });
});

export default router;
