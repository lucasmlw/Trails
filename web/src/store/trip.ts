import { create } from "zustand";
import type { RouteData, Trip, WaypointCategory } from "@trails/shared";
import { api, ApiError, OfflineError } from "../api/client";
import { loadTrip, tripRepo } from "../offline/tripRepo";
import { useNetwork } from "./network";
import { toast } from "./toast";

interface TripState {
  trip: Trip | null;
  loading: boolean;
  error: string | null;
  source: "server" | "local" | null;
  load: (id: string, opts?: { silent?: boolean }) => Promise<void>;
  clear: () => void;
  patch: (patch: Partial<Pick<Trip, "name" | "description" | "notes" | "mapCenter" | "mapZoom">>) => Promise<void>;
  saveRoute: (route: RouteData | null, view?: { center: [number, number]; zoom: number }) => Promise<void>;
  upsertWaypoint: (wp: { id?: string; name: string; description: string; category: WaypointCategory; lat: number; lng: number }) => Promise<string>;
  deleteWaypoint: (id: string) => Promise<void>;
  addPhoto: (waypointId: string, blob: Blob, thumb: Blob) => Promise<void>;
  deletePhoto: (waypointId: string, photoId: string) => Promise<void>;
  addChecklistItem: (text: string) => Promise<void>;
  updateChecklistItem: (id: string, patch: { text?: string; completed?: boolean }) => Promise<void>;
  deleteChecklistItem: (id: string) => Promise<void>;
  reorderChecklist: (ids: string[]) => Promise<void>;
  share: (userId: string, permission: "view" | "edit") => Promise<void>;
  unshare: (userId: string) => Promise<void>;
  setTrip: (trip: Trip) => void;
}

function handleQueued(queued: boolean) {
  if (queued) {
    toast("Saved offline – will sync when back online", "info");
    void useNetwork.getState().refreshPending();
  }
}

function describe(err: unknown): string {
  if (err instanceof OfflineError) return "You are offline. This trip has not been downloaded, so changes cannot be saved.";
  if (err instanceof ApiError) return err.message;
  return (err as Error).message || "Something went wrong";
}

export const useTrip = create<TripState>((set, get) => {
  const run = async (fn: (trip: Trip) => Promise<{ trip: Trip; queued: boolean }>) => {
    const trip = get().trip;
    if (!trip) throw new Error("No trip loaded");
    try {
      const { trip: updated, queued } = await fn(trip);
      set({ trip: updated });
      handleQueued(queued);
    } catch (err) {
      toast(describe(err), "error", 6000);
      throw err;
    }
  };

  return {
    trip: null,
    loading: false,
    error: null,
    source: null,

    async load(id, opts) {
      if (!opts?.silent) set({ loading: true, error: null });
      try {
        const { trip, source } = await loadTrip(id);
        set({ trip, source, loading: false });
      } catch (err) {
        set({ loading: false, error: describe(err), trip: null });
      }
    },

    clear() {
      set({ trip: null, error: null, source: null });
    },

    setTrip(trip) {
      set({ trip });
    },

    patch: (patch) => run((trip) => tripRepo.patchTrip(trip, patch)),

    saveRoute: (route, view) =>
      run(async (trip) => {
        const r = await tripRepo.saveRoute(trip, route);
        if (view) {
          const r2 = await tripRepo.patchTrip(r.trip, { mapCenter: view.center, mapZoom: view.zoom });
          return { trip: r2.trip, queued: r.queued || r2.queued };
        }
        return r;
      }),

    async upsertWaypoint(wp) {
      const id = wp.id ?? crypto.randomUUID();
      await run((trip) => tripRepo.upsertWaypoint(trip, { ...wp, id }));
      return id;
    },

    deleteWaypoint: (id) => run((trip) => tripRepo.deleteWaypoint(trip, id)),
    addPhoto: (waypointId, blob, thumb) => run((trip) => tripRepo.addPhoto(trip, waypointId, blob, thumb)),
    deletePhoto: (waypointId, photoId) => run((trip) => tripRepo.deletePhoto(trip, waypointId, photoId)),

    addChecklistItem: (text) =>
      run((trip) => {
        const sortOrder = trip.checklist.reduce((m, c) => Math.max(m, c.sortOrder), -1) + 1;
        return tripRepo.upsertChecklistItem(trip, { id: crypto.randomUUID(), text, completed: false, sortOrder });
      }),

    updateChecklistItem: (id, patch) =>
      run((trip) => {
        const item = trip.checklist.find((c) => c.id === id);
        if (!item) throw new Error("Item not found");
        return tripRepo.upsertChecklistItem(trip, { id, text: patch.text ?? item.text, completed: patch.completed ?? item.completed, sortOrder: item.sortOrder });
      }),

    deleteChecklistItem: (id) => run((trip) => tripRepo.deleteChecklistItem(trip, id)),
    reorderChecklist: (ids) => run((trip) => tripRepo.reorderChecklist(trip, ids)),

    async share(userId, permission) {
      const trip = get().trip;
      if (!trip) return;
      try {
        const res = await api<{ trip: Trip }>(`/api/trips/${trip.id}/shares`, { method: "POST", json: { userId, permission } });
        set({ trip: res.trip });
        toast("Trip shared", "success");
      } catch (err) {
        toast(describe(err), "error");
      }
    },

    async unshare(userId) {
      const trip = get().trip;
      if (!trip) return;
      try {
        const res = await api<{ trip: Trip }>(`/api/trips/${trip.id}/shares/${userId}`, { method: "DELETE" });
        set({ trip: res.trip });
        toast("Sharing removed", "success");
      } catch (err) {
        toast(describe(err), "error");
      }
    },
  };
});
