/**
 * Offline-first access to trips.
 *
 * Every mutation is expressed as a `PendingOp` plus a pure reducer that applies
 * the change to a Trip object. Online, the op is sent to the API immediately
 * and the reducer keeps the in-memory copy consistent. Offline, the reducer is
 * applied to the locally stored copy and the op is queued for `syncPending()`.
 */
import type { ChecklistItem, Photo, RouteData, Trip, TripSummary, Waypoint, WaypointCategory } from "@trails/shared";
import { api, ApiError, OfflineError } from "../api/client";
import {
  deletePending,
  deleteStoredPhoto,
  deleteStoredTrack,
  deleteStoredTrip,
  enqueue,
  getStoredPhoto,
  getStoredTrack,
  getStoredTrip,
  listAllStoredTracks,
  listPending,
  listStoredTrips,
  putStoredPhoto,
  putStoredTrack,
  putStoredTrip,
  updatePending,
  type PendingOp,
  type PendingRecord,
} from "./db";

const nowIso = () => new Date().toISOString();

export function tripIsOfflineCapable(id: string) {
  return getStoredTrip(id).then((t) => !!t);
}

export async function fetchTrips(): Promise<TripSummary[]> {
  const { trips } = await api<{ trips: TripSummary[] }>("/api/trips");
  return trips;
}

export async function offlineTripSummaries(): Promise<TripSummary[]> {
  const stored = await listStoredTrips();
  return stored.map(({ trip }) => ({
    id: trip.id,
    ownerId: trip.ownerId,
    ownerName: trip.ownerName,
    name: trip.name,
    description: trip.description,
    distance: trip.route?.stats.distance ?? null,
    waypointCount: trip.waypoints.length,
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
    permission: trip.permission,
    shared: trip.shares.length > 0,
  }));
}

export async function loadTrip(id: string): Promise<{ trip: Trip; source: "server" | "local" }> {
  const stored = await getStoredTrip(id);
  try {
    const { trip } = await api<{ trip: Trip }>(`/api/trips/${id}`);
    if (stored) {
      // Keep the offline copy fresh unless there are unsynced local edits (they win until synced).
      if (!stored.dirty) await putStoredTrip(mergeLocalTracks(trip, stored.trip), false);
      else return { trip: stored.trip, source: "local" };
    }
    return { trip, source: "server" };
  } catch (err) {
    if (err instanceof OfflineError && stored) return { trip: stored.trip, source: "local" };
    throw err;
  }
}

function mergeLocalTracks(server: Trip, local: Trip): Trip {
  const ids = new Set(server.tracks.map((t) => t.id));
  const extra = local.tracks.filter((t) => !ids.has(t.id));
  return extra.length ? { ...server, tracks: [...server.tracks, ...extra] } : server;
}

// ---- reducers -------------------------------------------------------------

function touch(trip: Trip): Trip {
  return { ...trip, updatedAt: nowIso() };
}

const reducers = {
  "trip.patch": (trip: Trip, p: Record<string, unknown>): Trip => touch({ ...trip, ...(p as Partial<Trip>) }),
  "route.put": (trip: Trip, p: { route: RouteData | null }): Trip => touch({ ...trip, route: p.route }),
  "waypoint.upsert": (trip: Trip, p: { id: string; name: string; description: string; category: string; lat: number; lng: number }): Trip => {
    const existing = trip.waypoints.find((w) => w.id === p.id);
    const wp: Waypoint = {
      id: p.id,
      tripId: trip.id,
      name: p.name,
      description: p.description,
      category: p.category as WaypointCategory,
      lat: p.lat,
      lng: p.lng,
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
      photos: existing?.photos ?? [],
    };
    return touch({ ...trip, waypoints: existing ? trip.waypoints.map((w) => (w.id === p.id ? wp : w)) : [...trip.waypoints, wp] });
  },
  "waypoint.delete": (trip: Trip, p: { id: string }): Trip => touch({ ...trip, waypoints: trip.waypoints.filter((w) => w.id !== p.id) }),
  "photo.add": (trip: Trip, p: Photo): Trip =>
    touch({ ...trip, waypoints: trip.waypoints.map((w) => (w.id === p.waypointId ? { ...w, photos: [...w.photos.filter((x) => x.id !== p.id), p] } : w)) }),
  "photo.delete": (trip: Trip, p: { photoId: string; waypointId: string }): Trip =>
    touch({ ...trip, waypoints: trip.waypoints.map((w) => (w.id === p.waypointId ? { ...w, photos: w.photos.filter((x) => x.id !== p.photoId) } : w)) }),
  "checklist.upsert": (trip: Trip, p: { id: string; text: string; completed: boolean; sortOrder: number }): Trip => {
    const item: ChecklistItem = { id: p.id, tripId: trip.id, text: p.text, completed: p.completed, sortOrder: p.sortOrder };
    const exists = trip.checklist.some((c) => c.id === p.id);
    const list = exists ? trip.checklist.map((c) => (c.id === p.id ? item : c)) : [...trip.checklist, item];
    return touch({ ...trip, checklist: list.sort((a, b) => a.sortOrder - b.sortOrder) });
  },
  "checklist.delete": (trip: Trip, p: { id: string }): Trip => touch({ ...trip, checklist: trip.checklist.filter((c) => c.id !== p.id) }),
  "checklist.order": (trip: Trip, p: { ids: string[] }): Trip => {
    const order = new Map(p.ids.map((id, i) => [id, i]));
    return touch({ ...trip, checklist: [...trip.checklist].map((c) => ({ ...c, sortOrder: order.get(c.id) ?? c.sortOrder })).sort((a, b) => a.sortOrder - b.sortOrder) });
  },
};

// ---- API mapping ----------------------------------------------------------

async function sendOp(tripId: string, op: PendingOp): Promise<void> {
  switch (op.type) {
    case "trip.patch":
      await api(`/api/trips/${tripId}`, { method: "PATCH", json: op.payload });
      return;
    case "route.put":
      await api(`/api/trips/${tripId}/route`, { method: "PUT", json: { route: op.payload.route } });
      return;
    case "waypoint.upsert":
      await api(`/api/trips/${tripId}/waypoints`, { method: "POST", json: op.payload });
      return;
    case "waypoint.delete":
      await api(`/api/trips/${tripId}/waypoints/${op.payload.id}`, { method: "DELETE" });
      return;
    case "photo.upload": {
      const stored = await getStoredPhoto(op.payload.photoId);
      if (!stored) return;
      const form = new FormData();
      form.append("id", op.payload.photoId);
      form.append("photo", stored.blob, "photo.jpg");
      form.append("thumbnail", stored.thumb, "thumb.jpg");
      await api(`/api/trips/${tripId}/waypoints/${op.payload.waypointId}/photos`, { method: "POST", body: form });
      await putStoredPhoto({ ...stored, pendingUpload: false });
      return;
    }
    case "photo.delete":
      await api(`/api/trips/${tripId}/waypoints/${op.payload.waypointId}/photos/${op.payload.photoId}`, { method: "DELETE" });
      return;
    case "checklist.upsert":
      await api(`/api/trips/${tripId}/checklist`, { method: "POST", json: op.payload });
      return;
    case "checklist.delete":
      await api(`/api/trips/${tripId}/checklist/${op.payload.id}`, { method: "DELETE" });
      return;
    case "checklist.order":
      await api(`/api/trips/${tripId}/checklist/order`, { method: "PUT", json: op.payload });
      return;
    case "track.upload": {
      const stored = await getStoredTrack(op.payload.trackId);
      if (!stored) return;
      const t = stored.track;
      const newPoints = stored.uploadedThrough ? t.points.filter((p) => p.timestamp > stored.uploadedThrough!) : t.points;
      await api(`/api/trips/${tripId}/tracks`, {
        method: "POST",
        json: { id: t.id, name: t.name, startedAt: t.startedAt, endedAt: t.endedAt, points: newPoints },
      });
      const last = t.points[t.points.length - 1]?.timestamp ?? stored.uploadedThrough;
      await putStoredTrack({ ...stored, uploadedThrough: last });
      return;
    }
  }
}

/**
 * Runs a mutation online-first. `current` is the trip currently shown in the UI;
 * the returned trip is what the UI should display afterwards.
 */
async function mutate(current: Trip, op: PendingOp, applied: Trip): Promise<{ trip: Trip; queued: boolean }> {
  const stored = await getStoredTrip(current.id);
  try {
    await sendOp(current.id, op);
    if (stored) await putStoredTrip(applied, stored.dirty);
    return { trip: applied, queued: false };
  } catch (err) {
    if (err instanceof OfflineError) {
      if (!stored) throw err;
      await putStoredTrip(applied, true);
      await enqueue(current.id, op);
      return { trip: applied, queued: true };
    }
    throw err;
  }
}

export const tripRepo = {
  patchTrip(trip: Trip, patch: Partial<Pick<Trip, "name" | "description" | "notes" | "mapCenter" | "mapZoom">>) {
    return mutate(trip, { type: "trip.patch", payload: patch }, reducers["trip.patch"](trip, patch));
  },
  saveRoute(trip: Trip, route: RouteData | null) {
    return mutate(trip, { type: "route.put", payload: { route } }, reducers["route.put"](trip, { route }));
  },
  upsertWaypoint(trip: Trip, wp: { id: string; name: string; description: string; category: WaypointCategory; lat: number; lng: number }) {
    return mutate(trip, { type: "waypoint.upsert", payload: wp }, reducers["waypoint.upsert"](trip, wp));
  },
  deleteWaypoint(trip: Trip, id: string) {
    return mutate(trip, { type: "waypoint.delete", payload: { id } }, reducers["waypoint.delete"](trip, { id }));
  },
  async addPhoto(trip: Trip, waypointId: string, blob: Blob, thumb: Blob): Promise<{ trip: Trip; queued: boolean }> {
    const photoId = crypto.randomUUID();
    const photo: Photo = { id: photoId, waypointId, url: `/api/photos/${photoId}`, thumbnailUrl: `/api/photos/${photoId}/thumb`, createdAt: nowIso() };
    const applied = reducers["photo.add"](trip, photo);
    const stored = await getStoredTrip(trip.id);
    // Always keep a local copy when the trip is downloaded so the photo is viewable offline.
    if (stored) await putStoredPhoto({ id: photoId, waypointId, tripId: trip.id, blob, thumb, mimeType: blob.type || "image/jpeg", pendingUpload: true });
    try {
      const form = new FormData();
      form.append("id", photoId);
      form.append("photo", blob, "photo.jpg");
      form.append("thumbnail", thumb, "thumb.jpg");
      await api(`/api/trips/${trip.id}/waypoints/${waypointId}/photos`, { method: "POST", body: form });
      if (stored) {
        await putStoredTrip(applied, stored.dirty);
        const sp = await getStoredPhoto(photoId);
        if (sp) await putStoredPhoto({ ...sp, pendingUpload: false });
      }
      return { trip: applied, queued: false };
    } catch (err) {
      if (err instanceof OfflineError && stored) {
        await putStoredTrip(applied, true);
        await enqueue(trip.id, { type: "photo.upload", payload: { photoId, waypointId } });
        return { trip: applied, queued: true };
      }
      if (stored) await deleteStoredPhoto(photoId);
      throw err;
    }
  },
  async deletePhoto(trip: Trip, waypointId: string, photoId: string) {
    const r = await mutate(trip, { type: "photo.delete", payload: { photoId, waypointId } }, reducers["photo.delete"](trip, { photoId, waypointId }));
    await deleteStoredPhoto(photoId).catch(() => {});
    return r;
  },
  upsertChecklistItem(trip: Trip, item: { id: string; text: string; completed: boolean; sortOrder: number }) {
    return mutate(trip, { type: "checklist.upsert", payload: item }, reducers["checklist.upsert"](trip, item));
  },
  deleteChecklistItem(trip: Trip, id: string) {
    return mutate(trip, { type: "checklist.delete", payload: { id } }, reducers["checklist.delete"](trip, { id }));
  },
  reorderChecklist(trip: Trip, ids: string[]) {
    return mutate(trip, { type: "checklist.order", payload: { ids } }, reducers["checklist.order"](trip, { ids }));
  },
};

// ---- Sync -----------------------------------------------------------------

export interface SyncResult {
  synced: number;
  failed: number;
  remaining: number;
  refreshedTrips: string[];
}

let syncing: Promise<SyncResult> | null = null;

export function syncPending(): Promise<SyncResult> {
  if (syncing) return syncing;
  syncing = doSync().finally(() => (syncing = null));
  return syncing;
}

async function doSync(): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, failed: 0, remaining: 0, refreshedTrips: [] };
  const pending = (await listPending()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  const touchedTrips = new Set<string>();
  const blockedTrips = new Set<string>();
  for (const rec of pending) {
    if (blockedTrips.has(rec.tripId)) {
      result.remaining++;
      continue;
    }
    try {
      await sendOp(rec.tripId, rec.op);
      await deletePending(rec.id!);
      result.synced++;
      touchedTrips.add(rec.tripId);
    } catch (err) {
      if (err instanceof OfflineError) {
        result.remaining += 1;
        blockedTrips.add(rec.tripId);
        continue;
      }
      // 4xx: the server rejected the change (e.g. trip deleted or permission removed).
      // Drop it rather than block the queue forever; the trip refresh below shows the truth.
      const status = err instanceof ApiError ? err.status : 0;
      if (status >= 400 && status < 500) {
        await deletePending(rec.id!);
        result.failed++;
        touchedTrips.add(rec.tripId);
      } else {
        const updated: PendingRecord = { ...rec, attempts: rec.attempts + 1, lastError: (err as Error).message };
        await updatePending(updated);
        result.remaining++;
        blockedTrips.add(rec.tripId);
      }
    }
  }
  // Also push any recorded tracks that still have unsent points (append-only on the server).
  for (const t of await listAllStoredTracks()) {
    const last = t.track.points[t.track.points.length - 1]?.timestamp;
    if (!t.track.points.length || (t.uploadedThrough && last && last <= t.uploadedThrough)) {
      // Fully uploaded and finished: the server copy is authoritative now.
      if (t.finished && t.uploadedThrough) await deleteStoredTrack(t.id);
      continue;
    }
    try {
      await sendOp(t.tripId, { type: "track.upload", payload: { trackId: t.id } });
      touchedTrips.add(t.tripId);
      result.synced++;
      if (t.finished) await deleteStoredTrack(t.id);
    } catch (err) {
      if (err instanceof OfflineError) return result;
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        result.failed++;
        if (err.status === 404 || err.status === 403) await deleteStoredTrack(t.id);
      }
    }
  }
  const storedIds = new Set((await listStoredTrips()).map((s) => s.id));
  for (const tripId of touchedTrips) {
    if (!storedIds.has(tripId)) continue;
    try {
      const { trip } = await api<{ trip: Trip }>(`/api/trips/${tripId}`);
      await putStoredTrip(trip, false);
      result.refreshedTrips.push(tripId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        await deleteStoredTrip(tripId);
        result.refreshedTrips.push(tripId);
      }
    }
  }
  return result;
}
