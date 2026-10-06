import { deleteDB } from "idb";
import { api } from "../api/client";
import { closeDb } from "./db";

const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<undefined>((r) => setTimeout(r, ms))]);

/**
 * Wipes everything this device stores locally (offline trips, tiles, photos,
 * queued edits, session) and reloads. Server data is untouched. Used by the
 * recovery screen when the app cannot start.
 */
export async function resetLocalData(): Promise<void> {
  // End the server session too (clears the HttpOnly cookie); ignore failures when offline.
  await withTimeout(api("/api/auth/logout", { method: "POST" }).catch(() => undefined), 5000);
  // Deleting is blocked while any connection is open; close ours and don't wait forever on other tabs
  // (they close themselves via the `blocking` handler, but may be frozen in the background).
  await closeDb();
  const steps: Promise<unknown>[] = [withTimeout(deleteDB("trails").catch(() => undefined), 8000)];
  if ("serviceWorker" in navigator) {
    steps.push(navigator.serviceWorker.getRegistrations().then((regs) => Promise.all(regs.map((r) => r.unregister()))).catch(() => undefined));
  }
  if ("caches" in window) {
    steps.push(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).catch(() => undefined));
  }
  await Promise.all(steps);
  localStorage.clear();
  sessionStorage.clear();
  window.location.replace("/");
}
