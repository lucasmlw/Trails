# Android

There are two ways to run Trails on an Android phone. Start with the PWA; move to the Capacitor build only if you need tracking to keep running with the screen off.

## Option 1 — Installable PWA (no build tools needed)

Requirements: the server must be reachable over **HTTPS** (Chrome refuses geolocation, service workers and the install prompt on plain HTTP, except for `localhost`).

1. Open the site in Chrome on the phone and log in.
2. Chrome menu → **Add to Home screen** (or accept the install banner). The app opens full‑screen with its own icon.
3. Open a trip → **Download** tab → choose the area and zoom range → **Download**. Trip data, photos and tiles are stored in the browser's IndexedDB.
4. Open the trip → **Navigate**. Grant the location permission when asked.

What works: everything in the planner, offline maps and trip data, live GPS with heading/accuracy, track recording, upload when back online. The screen is kept on while navigating using the Wake Lock API.

Limitations of the PWA route:

* Android suspends web pages when the screen is off or the app is in the background, so **track recording pauses** until you return to the app. For a walk where you glance at the phone regularly this is fine; for an all‑day recording it is not.
* Chrome may evict site data under storage pressure. The app requests *persistent storage* (`navigator.storage.persist()`), which Chrome grants automatically to installed PWAs, and the Download tab shows the current usage/quota.

## Option 2 — Native app with Capacitor

The same web build is packaged into an APK. Capacitor's `@capacitor/geolocation` plugin uses Android's fused location provider, and the app can be extended with a foreground service for continuous background tracking.

### Prerequisites

* Android Studio (Ladybug or newer) with an SDK ≥ 34 and a JDK 17.
* A phone with developer mode / USB debugging, or an emulator.

### Build

```bash
# from the repository root
npm install
npm run build -w web                 # produces web/dist
cd web
npx cap add android                  # first time only; creates web/android (git‑ignored)
npm run cap:sync                     # copies dist + plugins into the Android project
npm run cap:open                     # opens Android Studio → Run ▶ on your device
```

On first launch the login screen shows a **Server address** field (only in the native shell). Enter the public HTTPS URL of your server, e.g. `https://trails.example.com`. It is stored on the device, and the session uses a bearer token instead of a cookie because the web view's origin (`https://localhost`) differs from the API's. Add that origin to `CORS_ORIGINS` in the server `.env` (it is included in the default).

To bake the server address in at build time instead, set `VITE_API_BASE=https://trails.example.com` when running `npm run build -w web`.

### Permissions

`npx cap add android` generates `AndroidManifest.xml`. Make sure it contains:

```xml
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.INTERNET" />
<!-- only if you add background tracking (see below) -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
```

Runtime permission prompts are handled by the geolocation plugin the first time the Navigate screen starts.

### Background tracking (screen off)

Out of the box the Capacitor build behaves like the PWA: location updates flow while the app is in the foreground and the screen is kept awake. For recording with the screen off:

1. Add a background geolocation plugin that runs a foreground service with a persistent notification (for example `@capacitor-community/background-geolocation`).
2. Implement a third `LocationProvider` in `web/src/location/provider.ts` that wraps it — the rest of the app only depends on the `watch()` / `current()` interface, so `NavigationPage` and the recorder do not change.
3. Select it in `getLocationProvider()` when `Capacitor.isNativePlatform()` and the plugin is available.

The recorder already writes the in‑progress track to IndexedDB every 15 s and on pause/stop, so an abrupt app kill loses at most a few fixes.

### Updating the app

Rebuild the web app, run `npm run cap:sync -w web`, and reinstall from Android Studio (or `./gradlew assembleRelease` in `web/android` for a signed release APK). The native shell rarely needs to change; most updates are web‑only.

## Photos on Android

The waypoint photo picker uses `<input type="file" accept="image/*" capture="environment">`, which Android renders as *Camera / Gallery* in both the PWA and the Capacitor shell. Images are downscaled client‑side to ≤ 1600 px (plus a 240 px thumbnail) and re‑encoded as JPEG before upload to keep uploads small on mobile data. Photos taken while offline are stored locally and uploaded with the next sync.

## Battery and accuracy tips

* GPS fixes with reported accuracy worse than 60 m are ignored by the recorder, and movements smaller than the accuracy are treated as standing still, so a track does not fill with jitter when you stop.
* The accuracy circle around the position dot is drawn at the reported 68 % radius. Under trees or in valleys expect 10–30 m.
* Turn off battery optimisation for the app (Settings → Apps → Trails → Battery → Unrestricted) if Android throttles location updates on your device.
