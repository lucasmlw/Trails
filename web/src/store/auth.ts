import { create } from "zustand";
import type { User } from "@trails/shared";
import { api, OfflineError, setToken, setUnauthorizedHandler } from "../api/client";

const USER_KEY = "trails_user";

interface AuthState {
  user: User | null;
  status: "loading" | "authenticated" | "anonymous";
  /** true when the last check could not reach the server and a cached user is being used */
  offlineSession: boolean;
  init: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

function cachedUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export const useAuth = create<AuthState>((set) => ({
  user: cachedUser(),
  status: "loading",
  offlineSession: false,
  async init() {
    setUnauthorizedHandler(() => {
      localStorage.removeItem(USER_KEY);
      setToken(null);
      set({ user: null, status: "anonymous", offlineSession: false });
    });
    try {
      const { user } = await api<{ user: User }>("/api/auth/me");
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      set({ user, status: "authenticated", offlineSession: false });
    } catch (err) {
      if (err instanceof OfflineError) {
        // Offline: trust the cached session so downloaded trips stay usable.
        const user = cachedUser();
        set({ user, status: user ? "authenticated" : "anonymous", offlineSession: true });
      } else {
        localStorage.removeItem(USER_KEY);
        set({ user: null, status: "anonymous", offlineSession: false });
      }
    }
  },
  async login(username, password) {
    const { user, token } = await api<{ user: User; token: string }>("/api/auth/login", { method: "POST", json: { username, password } });
    setToken(token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ user, status: "authenticated", offlineSession: false });
  },
  async logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* offline logout still clears local session */
    }
    setToken(null);
    localStorage.removeItem(USER_KEY);
    set({ user: null, status: "anonymous", offlineSession: false });
  },
}));
