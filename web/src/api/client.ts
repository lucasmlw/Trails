import { Capacitor } from "@capacitor/core";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}

export class OfflineError extends Error {
  constructor() {
    super("You are offline. Downloaded trips remain available.");
  }
}

const TOKEN_KEY = "trails_token";
const BASE_KEY = "trails_api_base";

/**
 * In the browser the session is a HttpOnly cookie. Inside the Capacitor Android
 * shell the web view runs on a different origin, so we fall back to a bearer
 * token kept in local storage.
 */
export const isNative = () => Capacitor.isNativePlatform();

export function apiBase(): string {
  return localStorage.getItem(BASE_KEY) ?? (isNative() ? (import.meta.env.VITE_API_BASE as string | undefined) ?? "" : "");
}

export function setApiBase(url: string) {
  if (url) localStorage.setItem(BASE_KEY, url.replace(/\/$/, ""));
  else localStorage.removeItem(BASE_KEY);
}

export function setToken(token: string | null) {
  if (token && isNative()) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

/** Reachability callback: true after any successful request, false after a network failure. */
let onReachability: ((online: boolean) => void) | null = null;
export function setReachabilityHandler(fn: (online: boolean) => void) {
  onReachability = fn;
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { ...authHeaders(), ...((init.headers as Record<string, string>) ?? {}) };
  let body = init.body;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(apiBase() + path, { ...init, headers, body, credentials: "include" });
  } catch {
    onReachability?.(false);
    throw new OfflineError();
  }
  onReachability?.(true);
  if (res.status === 401 && !path.startsWith("/api/auth/login")) {
    onUnauthorized?.();
  }
  if (!res.ok) {
    let message = res.statusText || "Request failed";
    let detail: unknown;
    try {
      const j = (await res.json()) as { error?: string; detail?: unknown };
      message = j.error ?? message;
      detail = j.detail;
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, message, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Fetch a protected binary resource (photo, tile) with credentials. */
export async function fetchBlob(path: string): Promise<Blob> {
  const res = await fetch(path.startsWith("http") ? path : apiBase() + path, { headers: authHeaders(), credentials: "include" });
  if (!res.ok) throw new ApiError(res.status, "Download failed");
  return res.blob();
}
