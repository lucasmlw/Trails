import { create } from "zustand";
import type { Track, TrackPoint } from "@trails/shared";
import type { LocationFix } from "../location/provider";
import { haversine } from "../lib/geo";
import { deleteStoredTrack, getStoredTrack, getStoredTrip, putStoredTrack, putStoredTrip, type StoredTrack } from "../offline/db";
import { syncPending } from "../offline/tripRepo";
import { useNetwork } from "./network";
import { toast } from "./toast";

type Status = "idle" | "recording" | "paused";

interface RecorderState {
  status: Status;
  tripId: string | null;
  track: Track | null;
  distance: number;
  /** ms actively recording (excludes pauses) */
  movingMs: number;
  lastResumeAt: number | null;
  start: (tripId: string) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => void;
  stop: () => Promise<Track | null>;
  discard: () => Promise<void>;
  addFix: (fix: LocationFix) => void;
}

const MAX_ACCURACY_M = 60; // ignore very poor fixes so the track is not full of spikes

let flushTimer: number | undefined;

async function persist(state: Pick<RecorderState, "track" | "tripId" | "status">, finished: boolean) {
  if (!state.track || !state.tripId) return;
  const stored: StoredTrack = {
    id: state.track.id,
    tripId: state.tripId,
    track: state.track,
    uploadedThrough: (await getStoredTrack(state.track.id))?.uploadedThrough ?? null,
    finished,
  };
  await putStoredTrack(stored);
}

export const useRecorder = create<RecorderState>((set, get) => ({
  status: "idle",
  tripId: null,
  track: null,
  distance: 0,
  movingMs: 0,
  lastResumeAt: null,

  async start(tripId) {
    const now = new Date();
    const track: Track = {
      id: crypto.randomUUID(),
      tripId,
      name: `Track ${now.toLocaleDateString("en-GB")} ${now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`,
      startedAt: now.toISOString(),
      endedAt: null,
      distance: 0,
      points: [],
    };
    set({ status: "recording", tripId, track, distance: 0, movingMs: 0, lastResumeAt: Date.now() });
    await persist(get(), false);
    flushTimer = window.setInterval(() => void persist(get(), false), 15_000);
  },

  async pause() {
    const s = get();
    if (s.status !== "recording") return;
    set({ status: "paused", movingMs: s.movingMs + (s.lastResumeAt ? Date.now() - s.lastResumeAt : 0), lastResumeAt: null });
    await persist(get(), false);
  },

  resume() {
    if (get().status !== "paused") return;
    set({ status: "recording", lastResumeAt: Date.now() });
  },

  async stop() {
    const s = get();
    if (!s.track || !s.tripId) return null;
    window.clearInterval(flushTimer);
    const movingMs = s.movingMs + (s.lastResumeAt && s.status === "recording" ? Date.now() - s.lastResumeAt : 0);
    const track: Track = { ...s.track, endedAt: new Date().toISOString(), distance: s.distance };
    set({ status: "idle", track: null, tripId: null, distance: 0, movingMs, lastResumeAt: null });
    if (track.points.length < 2) {
      toast("Track too short to save", "warning");
      return null;
    }
    await persist({ track, tripId: s.tripId, status: "idle" }, true);
    // Keep the local trip copy in sync so the track shows immediately, even offline.
    const stored = await getStoredTrip(s.tripId);
    if (stored) await putStoredTrip({ ...stored.trip, tracks: [...stored.trip.tracks.filter((t) => t.id !== track.id), track] }, stored.dirty);
    if (navigator.onLine) {
      try {
        await syncPending();
        toast("Track saved and uploaded", "success");
      } catch {
        toast("Track saved on this device – will upload when online", "info");
      }
    } else {
      toast("Track saved on this device – will upload when online", "info");
    }
    void useNetwork.getState().refreshPending();
    return track;
  },

  async discard() {
    window.clearInterval(flushTimer);
    const s = get();
    if (s.track) await deleteStoredTrack(s.track.id);
    set({ status: "idle", track: null, tripId: null, distance: 0, movingMs: 0, lastResumeAt: null });
  },

  addFix(fix) {
    const s = get();
    if (s.status !== "recording" || !s.track) return;
    if (fix.accuracy != null && fix.accuracy > MAX_ACCURACY_M) return;
    const last = s.track.points[s.track.points.length - 1];
    const point: TrackPoint = {
      timestamp: new Date(fix.timestamp).toISOString(),
      lat: fix.lat,
      lng: fix.lng,
      altitude: fix.altitude,
      accuracy: fix.accuracy,
      speed: fix.speed,
      heading: fix.heading,
    };
    if (last && point.timestamp <= last.timestamp) return;
    let step = 0;
    if (last) {
      step = haversine([last.lng, last.lat], [fix.lng, fix.lat]);
      // Skip jitter while standing still: movement smaller than the fix accuracy.
      if (step < Math.min(5, (fix.accuracy ?? 5) / 2)) return;
    }
    set({ track: { ...s.track, points: [...s.track.points, point], distance: s.distance + step }, distance: s.distance + step });
  },
}));
