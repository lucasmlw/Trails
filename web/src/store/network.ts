import { create } from "zustand";
import { pendingCount } from "../offline/db";
import { syncPending } from "../offline/tripRepo";
import { toast } from "./toast";

interface NetworkState {
  online: boolean;
  pending: number;
  syncing: boolean;
  lastSync: string | null;
  refreshPending: () => Promise<void>;
  sync: () => Promise<void>;
}

export const useNetwork = create<NetworkState>((set, get) => ({
  online: navigator.onLine,
  pending: 0,
  syncing: false,
  lastSync: null,
  async refreshPending() {
    set({ pending: await pendingCount() });
  },
  async sync() {
    if (get().syncing || !navigator.onLine) return;
    set({ syncing: true });
    try {
      const result = await syncPending();
      if (result.synced > 0) toast(`Synced ${result.synced} change${result.synced === 1 ? "" : "s"}`, "success");
      if (result.failed > 0) toast(`${result.failed} change${result.failed === 1 ? "" : "s"} could not be applied`, "warning", 8000);
      set({ lastSync: new Date().toISOString() });
    } catch (err) {
      console.warn("Sync failed", err);
    } finally {
      set({ syncing: false, pending: await pendingCount() });
    }
  },
}));

let started = false;
export function startNetworkMonitor() {
  if (started) return;
  started = true;
  const update = () => {
    const online = navigator.onLine;
    const was = useNetwork.getState().online;
    useNetwork.setState({ online });
    if (online && !was) {
      toast("Back online – syncing changes", "info");
      void useNetwork.getState().sync();
    } else if (!online && was) {
      toast("You are offline. Downloaded trips remain available.", "warning", 6000);
    }
  };
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  void useNetwork.getState().refreshPending();
  if (navigator.onLine) void useNetwork.getState().sync();
  // Periodic retry for flaky mobile connections.
  setInterval(() => {
    if (navigator.onLine && useNetwork.getState().pending > 0) void useNetwork.getState().sync();
  }, 60_000);
}
