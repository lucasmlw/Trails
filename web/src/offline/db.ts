import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Trip, Track } from "@trails/shared";
import type { BBox } from "../lib/geo";

export interface StoredTrip {
  id: string;
  trip: Trip;
  /** when the local copy was last refreshed from the server */
  syncedAt: string;
  /** true when local edits have not been pushed yet */
  dirty: boolean;
}

export interface DownloadMeta {
  tripId: string;
  layerIds: string[];
  bbox: BBox;
  minZoom: number;
  maxZoom: number;
  tileCount: number;
  tilesStored: number;
  bytes: number;
  photoCount: number;
  status: "downloading" | "complete" | "failed" | "cancelled";
  startedAt: string;
  completedAt: string | null;
  error?: string;
}

export interface StoredTile {
  key: string; // `${layerId}/${z}/${x}/${y}`
  layerId: string;
  tripIds: string[];
  blob: Blob;
  bytes: number;
}

export interface StoredPhoto {
  id: string;
  waypointId: string;
  tripId: string;
  blob: Blob;
  thumb: Blob;
  mimeType: string;
  /** set for photos taken offline that still need uploading */
  pendingUpload?: boolean;
}

export type PendingOp =
  | { type: "trip.patch"; payload: Record<string, unknown> }
  | { type: "route.put"; payload: { route: Trip["route"] } }
  | { type: "waypoint.upsert"; payload: { id: string; name: string; description: string; category: string; lat: number; lng: number } }
  | { type: "waypoint.delete"; payload: { id: string } }
  | { type: "photo.upload"; payload: { photoId: string; waypointId: string } }
  | { type: "photo.delete"; payload: { photoId: string; waypointId: string } }
  | { type: "checklist.upsert"; payload: { id: string; text: string; completed: boolean; sortOrder: number } }
  | { type: "checklist.delete"; payload: { id: string } }
  | { type: "checklist.order"; payload: { ids: string[] } }
  | { type: "track.upload"; payload: { trackId: string } };

export interface PendingRecord {
  id?: number;
  tripId: string;
  op: PendingOp;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

export interface StoredTrack {
  id: string;
  tripId: string;
  track: Track;
  /** ISO timestamp of the last point the server has confirmed */
  uploadedThrough: string | null;
  finished: boolean;
}

interface TrailsDB extends DBSchema {
  trips: { key: string; value: StoredTrip };
  downloads: { key: string; value: DownloadMeta };
  tiles: { key: string; value: StoredTile; indexes: { byLayer: string } };
  photos: { key: string; value: StoredPhoto; indexes: { byTrip: string } };
  pending: { key: number; value: PendingRecord; indexes: { byTrip: string } };
  tracks: { key: string; value: StoredTrack; indexes: { byTrip: string } };
}

let dbPromise: Promise<IDBPDatabase<TrailsDB>> | null = null;

export function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<TrailsDB>("trails", 1, {
      upgrade(db) {
        db.createObjectStore("trips", { keyPath: "id" });
        db.createObjectStore("downloads", { keyPath: "tripId" });
        const tiles = db.createObjectStore("tiles", { keyPath: "key" });
        tiles.createIndex("byLayer", "layerId");
        const photos = db.createObjectStore("photos", { keyPath: "id" });
        photos.createIndex("byTrip", "tripId");
        const pending = db.createObjectStore("pending", { keyPath: "id", autoIncrement: true });
        pending.createIndex("byTrip", "tripId");
        const tracks = db.createObjectStore("tracks", { keyPath: "id" });
        tracks.createIndex("byTrip", "tripId");
      },
      // Another tab (or the recovery screen) wants to delete/upgrade the database: let go of it.
      blocking(_cur, _blocked, event) {
        (event.target as IDBDatabase).close();
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

/** Closes this page's connection so the database can be deleted or upgraded. */
export async function closeDb() {
  const p = dbPromise;
  dbPromise = null;
  if (p) (await p.catch(() => null))?.close();
}

// ---- trips ----

export async function getStoredTrip(id: string) {
  return (await getDb()).get("trips", id);
}
export async function listStoredTrips() {
  return (await getDb()).getAll("trips");
}
export async function putStoredTrip(trip: Trip, dirty = false) {
  const db = await getDb();
  const existing = await db.get("trips", trip.id);
  await db.put("trips", { id: trip.id, trip, syncedAt: dirty ? existing?.syncedAt ?? new Date(0).toISOString() : new Date().toISOString(), dirty });
}
export async function deleteStoredTrip(id: string) {
  const db = await getDb();
  await db.delete("trips", id);
  await db.delete("downloads", id);
  const photos = await db.getAllKeysFromIndex("photos", "byTrip", id);
  for (const k of photos) await db.delete("photos", k);
  // Remove tiles that no other trip references.
  const tx = db.transaction("tiles", "readwrite");
  let cursor = await tx.store.openCursor();
  while (cursor) {
    const t = cursor.value;
    if (t.tripIds.includes(id)) {
      const rest = t.tripIds.filter((x) => x !== id);
      if (rest.length === 0) await cursor.delete();
      else await cursor.update({ ...t, tripIds: rest });
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}

// ---- downloads ----

export async function getDownload(tripId: string) {
  return (await getDb()).get("downloads", tripId);
}
export async function putDownload(meta: DownloadMeta) {
  return (await getDb()).put("downloads", meta);
}
export async function listDownloads() {
  return (await getDb()).getAll("downloads");
}

// ---- tiles ----

export async function getTile(key: string) {
  return (await getDb()).get("tiles", key);
}
export async function putTile(tile: StoredTile) {
  const db = await getDb();
  const existing = await db.get("tiles", tile.key);
  if (existing) {
    const tripIds = Array.from(new Set([...existing.tripIds, ...tile.tripIds]));
    await db.put("tiles", { ...existing, tripIds });
    return false;
  }
  await db.put("tiles", tile);
  return true;
}
export async function tileStats() {
  const db = await getDb();
  let count = 0, bytes = 0;
  let cursor = await db.transaction("tiles").store.openCursor();
  while (cursor) {
    count++;
    bytes += cursor.value.bytes;
    cursor = await cursor.continue();
  }
  return { count, bytes };
}

// ---- photos ----

export async function getStoredPhoto(id: string) {
  return (await getDb()).get("photos", id);
}
export async function putStoredPhoto(photo: StoredPhoto) {
  return (await getDb()).put("photos", photo);
}
export async function deleteStoredPhoto(id: string) {
  return (await getDb()).delete("photos", id);
}
export async function listStoredPhotos(tripId: string) {
  return (await getDb()).getAllFromIndex("photos", "byTrip", tripId);
}

// ---- pending ops ----

export async function enqueue(tripId: string, op: PendingOp) {
  return (await getDb()).add("pending", { tripId, op, createdAt: new Date().toISOString(), attempts: 0 });
}
export async function listPending() {
  return (await getDb()).getAll("pending");
}
export async function updatePending(rec: PendingRecord) {
  return (await getDb()).put("pending", rec);
}
export async function deletePending(id: number) {
  return (await getDb()).delete("pending", id);
}
export async function pendingCount() {
  return (await getDb()).count("pending");
}

// ---- tracks ----

export async function getStoredTrack(id: string) {
  return (await getDb()).get("tracks", id);
}
export async function putStoredTrack(t: StoredTrack) {
  return (await getDb()).put("tracks", t);
}
export async function listStoredTracks(tripId: string) {
  return (await getDb()).getAllFromIndex("tracks", "byTrip", tripId);
}
export async function listAllStoredTracks() {
  return (await getDb()).getAll("tracks");
}
export async function deleteStoredTrack(id: string) {
  return (await getDb()).delete("tracks", id);
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
}
