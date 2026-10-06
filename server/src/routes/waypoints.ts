import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import { z } from "zod";
import { db, now } from "../db.js";
import { requireAuth } from "../auth.js";
import type { AuthedRequest } from "../auth.js";
import { getTripRow, loadWaypoint, loadWaypoints, permissionFor, requireTrip, touchTrip } from "../trips.js";
import { photosDir } from "../config.js";
import { WAYPOINT_CATEGORIES } from "@trails/shared";

const router = express.Router();
router.use(requireAuth);

const waypointBody = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  category: z.enum(WAYPOINT_CATEGORIES).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const uuidLike = /^[0-9a-f-]{36}$/i;

router.post("/trips/:tripId/waypoints", requireTrip("edit"), (req, res) => {
  const parsed = waypointBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid waypoint", details: parsed.error.flatten() });
    return;
  }
  // Clients created offline may supply their own id so photos can be attached before syncing.
  const id = typeof req.body.id === "string" && uuidLike.test(req.body.id) ? req.body.id : crypto.randomUUID();
  const ts = now();
  const b = parsed.data;
  db.prepare(
    `INSERT INTO waypoints (id, trip_id, name, description, category, latitude, longitude, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, category = excluded.category,
       latitude = excluded.latitude, longitude = excluded.longitude, updated_at = excluded.updated_at`,
  ).run(id, req.params.tripId, b.name, b.description ?? "", b.category ?? "custom", b.lat, b.lng, ts, ts);
  touchTrip(req.params.tripId);
  res.status(201).json({ waypoint: loadWaypoint(id), waypoints: loadWaypoints(req.params.tripId) });
});

router.patch("/trips/:tripId/waypoints/:waypointId", requireTrip("edit"), (req, res) => {
  const parsed = waypointBody.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid waypoint" });
    return;
  }
  const existing = loadWaypoint(req.params.waypointId);
  if (!existing || existing.tripId !== req.params.tripId) {
    res.status(404).json({ error: "Waypoint not found" });
    return;
  }
  const b = parsed.data;
  db.prepare("UPDATE waypoints SET name = ?, description = ?, category = ?, latitude = ?, longitude = ?, updated_at = ? WHERE id = ?").run(
    b.name ?? existing.name,
    b.description ?? existing.description,
    b.category ?? existing.category,
    b.lat ?? existing.lat,
    b.lng ?? existing.lng,
    now(),
    existing.id,
  );
  touchTrip(req.params.tripId);
  res.json({ waypoint: loadWaypoint(existing.id), waypoints: loadWaypoints(req.params.tripId) });
});

router.delete("/trips/:tripId/waypoints/:waypointId", requireTrip("edit"), (req, res) => {
  const existing = loadWaypoint(req.params.waypointId);
  if (existing && existing.tripId === req.params.tripId) {
    const files = db.prepare("SELECT file_path, thumbnail_path FROM photos WHERE waypoint_id = ?").all(existing.id) as { file_path: string; thumbnail_path: string }[];
    db.prepare("DELETE FROM waypoints WHERE id = ?").run(existing.id);
    removeUnreferencedFiles(files);
    touchTrip(req.params.tripId);
  }
  res.json({ waypoints: loadWaypoints(req.params.tripId) });
});

// ---------- Photos ----------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    cb(null, /^image\/(jpeg|png|webp|heic|heif|gif)$/.test(file.mimetype));
  },
});

function extFor(mime: string) {
  return { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/heic": ".heic", "image/heif": ".heif" }[mime] ?? ".bin";
}

function removeUnreferencedFiles(files: { file_path: string; thumbnail_path: string }[]) {
  const stillUsed = db.prepare("SELECT COUNT(*) AS c FROM photos WHERE file_path = ? OR thumbnail_path = ?");
  for (const f of files) {
    for (const p of new Set([f.file_path, f.thumbnail_path])) {
      if ((stillUsed.get(p, p) as { c: number }).c === 0) {
        fs.rm(path.join(photosDir, p), { force: true }, () => {});
      }
    }
  }
}

router.post(
  "/trips/:tripId/waypoints/:waypointId/photos",
  requireTrip("edit"),
  upload.fields([
    { name: "photo", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 },
  ]),
  (req, res) => {
    const wp = loadWaypoint(req.params.waypointId);
    if (!wp || wp.tripId !== req.params.tripId) {
      res.status(404).json({ error: "Waypoint not found" });
      return;
    }
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const photo = files?.photo?.[0];
    if (!photo) {
      res.status(400).json({ error: "A photo file is required (jpeg, png or webp)" });
      return;
    }
    const thumb = files?.thumbnail?.[0];
    // Photos never overwrite one another: every upload gets a fresh id and file name.
    const id = typeof req.body.id === "string" && uuidLike.test(req.body.id) ? req.body.id : crypto.randomUUID();
    if (db.prepare("SELECT 1 FROM photos WHERE id = ?").get(id)) {
      res.json({ waypoint: wp, photo: wp.photos.find((p) => p.id === id) });
      return;
    }
    const fileName = `${id}${extFor(photo.mimetype)}`;
    const thumbName = thumb ? `${id}.thumb${extFor(thumb.mimetype)}` : fileName;
    fs.writeFileSync(path.join(photosDir, fileName), photo.buffer);
    if (thumb) fs.writeFileSync(path.join(photosDir, thumbName), thumb.buffer);
    db.prepare("INSERT INTO photos (id, waypoint_id, file_path, thumbnail_path, mime_type, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      id,
      wp.id,
      fileName,
      thumbName,
      photo.mimetype,
      now(),
    );
    touchTrip(req.params.tripId);
    const updated = loadWaypoint(wp.id)!;
    res.status(201).json({ waypoint: updated, photo: updated.photos.find((p) => p.id === id) });
  },
);

router.delete("/trips/:tripId/waypoints/:waypointId/photos/:photoId", requireTrip("edit"), (req, res) => {
  const row = db
    .prepare("SELECT p.* FROM photos p JOIN waypoints w ON w.id = p.waypoint_id WHERE p.id = ? AND w.id = ? AND w.trip_id = ?")
    .get(req.params.photoId, req.params.waypointId, req.params.tripId) as { file_path: string; thumbnail_path: string } | undefined;
  if (row) {
    db.prepare("DELETE FROM photos WHERE id = ?").run(req.params.photoId);
    removeUnreferencedFiles([row]);
    touchTrip(req.params.tripId);
  }
  res.json({ waypoint: loadWaypoint(req.params.waypointId) });
});

function servePhoto(thumb: boolean) {
  return (req: express.Request, res: express.Response) => {
    const user = (req as AuthedRequest).user;
    const row = db
      .prepare("SELECT p.*, w.trip_id FROM photos p JOIN waypoints w ON w.id = p.waypoint_id WHERE p.id = ?")
      .get(req.params.photoId) as { file_path: string; thumbnail_path: string; mime_type: string; trip_id: string } | undefined;
    if (!row) {
      res.status(404).end();
      return;
    }
    const tripRow = getTripRow(row.trip_id, user.id);
    if (!tripRow || !permissionFor(tripRow, user.id)) {
      res.status(404).end();
      return;
    }
    const file = path.join(photosDir, thumb ? row.thumbnail_path : row.file_path);
    if (!fs.existsSync(file)) {
      res.status(404).end();
      return;
    }
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.type(row.mime_type);
    fs.createReadStream(file).pipe(res);
  };
}

router.get("/photos/:photoId", servePhoto(false));
router.get("/photos/:photoId/thumb", servePhoto(true));

export default router;
