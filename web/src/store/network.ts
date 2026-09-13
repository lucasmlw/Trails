import { create } from "zustand";
import { pendingCount } from "../offline/db";
import { setReachabilityHandler } from "../api/client";
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
    if (get().syncing) return;
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
  const setOnline = (online: boolean) => {
    const was = useNetwork.getState().online;
    if (online === was) return;
    useNetwork.setState({ online });
    if (online) {
      if (useNetwork.getState().pending > 0) toast("Back online – syncing changes", "info");
      void useNetwork.getState().sync();
    } else {
      toast("You are offline. Downloaded trips remain available.", "warning", 6000);
    }
  };
  // Browser events are a hint; actual API reachability (below) is authoritative.
  window.addEventListener("online", () => {
    setOnline(true);
    void useNetwork.getState().sync();
  });
  window.addEventListener("offline", () => setOnline(false));
  setReachabilityHandler(setOnline);
  void useNetwork.getState().refreshPending();
  if (navigator.onLine) void useNetwork.getState().sync();
  // Periodic retry for flaky mobile connections.
  setInterval(() => {
    if (useNetwork.getState().pending > 0) void useNetwork.getState().sync();
  }, 60_000);
}
