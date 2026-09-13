/**
 * Location abstraction so the navigation screen works identically in the
 * browser (PWA) and inside the Capacitor Android shell, where the native
 * plugin gives more reliable GPS fixes and permission handling.
 */
import { Capacitor } from "@capacitor/core";

export interface LocationFix {
  lat: number;
  lng: number;
  /** metres, 95% radius */
  accuracy: number | null;
  altitude: number | null;
  /** metres/second */
  speed: number | null;
  /** degrees from true north */
  heading: number | null;
  timestamp: number;
}

export type LocationError = "denied" | "unavailable" | "timeout";

export interface LocationProvider {
  watch(onFix: (fix: LocationFix) => void, onError: (err: LocationError, message: string) => void): Promise<() => void>;
  current(): Promise<LocationFix>;
}

function fromGeolocationPosition(p: GeolocationPosition): LocationFix {
  return {
    lat: p.coords.latitude,
    lng: p.coords.longitude,
    accuracy: p.coords.accuracy ?? null,
    altitude: p.coords.altitude ?? null,
    speed: p.coords.speed ?? null,
    heading: p.coords.heading != null && !Number.isNaN(p.coords.heading) ? p.coords.heading : null,
    timestamp: p.timestamp,
  };
}

function mapError(code: number): LocationError {
  if (code === 1) return "denied";
  if (code === 3) return "timeout";
  return "unavailable";
}

const browserProvider: LocationProvider = {
  async watch(onFix, onError) {
    if (!("geolocation" in navigator)) {
      onError("unavailable", "GPS signal unavailable.");
      return () => {};
    }
    const id = navigator.geolocation.watchPosition(
      (p) => onFix(fromGeolocationPosition(p)),
      (e) => onError(mapError(e.code), e.code === 1 ? "Location permission denied." : "GPS signal unavailable."),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  },
  current() {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition((p) => resolve(fromGeolocationPosition(p)), (e) => reject(new Error(e.message)), {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 5000,
      });
    });
  },
};

const capacitorProvider: LocationProvider = {
  async watch(onFix, onError) {
    const { Geolocation } = await import("@capacitor/geolocation");
    const perm = await Geolocation.requestPermissions().catch(() => null);
    if (perm && perm.location === "denied") {
      onError("denied", "Location permission denied.");
      return () => {};
    }
    const id = await Geolocation.watchPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 2000 }, (pos, err) => {
      if (err) {
        onError("unavailable", "GPS signal unavailable.");
        return;
      }
      if (pos) onFix(fromGeolocationPosition(pos as unknown as GeolocationPosition));
    });
    return () => {
      void Geolocation.clearWatch({ id });
    };
  },
  async current() {
    const { Geolocation } = await import("@capacitor/geolocation");
    const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
    return fromGeolocationPosition(pos as unknown as GeolocationPosition);
  },
};

export function getLocationProvider(): LocationProvider {
  return Capacitor.isNativePlatform() ? capacitorProvider : browserProvider;
}

/** Keeps the screen awake while navigating where the browser supports it. */
export async function requestWakeLock(): Promise<() => void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
    if (!nav.wakeLock) return () => {};
    const lock = await nav.wakeLock.request("screen");
    return () => {
      void lock.release();
    };
  } catch {
    return () => {};
  }
}
