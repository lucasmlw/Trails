# Trails

A private route‑planning and offline GPS navigation web app for two people, built for the UK.

> Map → draw route → drag route → automatic re‑route → add waypoints → save → download → navigate offline.

- **Planning on desktop**: click to build a route that follows footpaths, bridleways, tracks and roads (BRouter/OpenStreetMap); drag any part of the line to reshape it and it re‑routes automatically; undo/redo, reverse, clear; distance, time, ascent/descent and an elevation profile.
- **Trip content**: waypoints with categories and photos, notes, a packing checklist, sharing between the two accounts with edit/view permission, GPX export.
- **Offline**: choose an area and zoom range, download map tiles + trip data + photos to the device (IndexedDB). The app itself is an installable PWA, so it opens with no signal.
- **Navigation on Android**: live GPS position with heading and accuracy, planned route vs recorded track, distance remaining/travelled, ETA, speed, elevation, progress; start/pause/resume/stop track recording; tracks upload automatically when back online. Can be wrapped as a native Android app with Capacitor.

Everything uses openly licensed UK‑friendly data sources; see [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

## Repository layout

```
shared/   TypeScript types shared by server and client
server/   Express + SQLite API (auth, trips, routes, waypoints, photos, checklist, tracks, sharing,
          GPX export, proxies for routing / geocoding / elevation / OS tiles)
web/      React + MapLibre GL client (planner, navigation, PWA, offline store, Capacitor config)
docs/     Data sources & licensing, deployment, Android packaging
```

## Quick start

Requirements: Node.js 20+ (22 recommended).

```bash
npm install
cp .env.example .env          # set the two accounts' usernames and passwords
npm run dev                   # API on :3000, web on :5173 (proxying /api)
```

Open http://localhost:5173 and log in with the owner or friend account from `.env`.

### Production

```bash
npm run build                 # builds the PWA into web/dist
NODE_ENV=production SECURE_COOKIES=true npm start
```

The server serves the built app and the API from one origin on `PORT` (default 3000). Put it behind an HTTPS reverse proxy (Caddy, nginx, Traefik) — **HTTPS is required** for the service worker, geolocation and install prompt to work on Android, and for the session cookie to be sent with `SECURE_COOKIES=true`. Set `TRUST_PROXY=true` when behind a proxy.

Data lives in `DATA_DIR` (default `server/data`): `trails.sqlite` plus a `photos/` folder. Back up that directory.

To use the app on a phone the server has to be reachable from it. [docs/DEPLOY.md](docs/DEPLOY.md) walks through cheap options that need no domain name: Tailscale on the machine you already have (free, HTTPS included), a small VPS with a raw IP and a free sslip.io certificate, or plain HTTP with the Android APK.

### Users

Exactly two accounts are created/updated from `.env` on start (`OWNER_*`, `FRIEND_*`). Passwords are bcrypt‑hashed and never sent to clients. To rotate a password, change it in `.env` and restart, or run:

```bash
npm run seed-users -- <username> <password> "<Display name>"
```

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable | Purpose |
| --- | --- |
| `ROUTING_PROVIDER` | `brouter` (default, free, hiking profiles + elevation), `osrm`, or `ors` (OpenRouteService, needs `ORS_API_KEY`) |
| `BROUTER_URL` | Point at your own BRouter instance with UK segments for unlimited routing |
| `ELEVATION_URL` | Open Topo Data style endpoint (default EU‑DEM 25 m, covers all of the UK) |
| `NOMINATIM_URL` | Geocoder (search is restricted to `countrycodes=gb`) |
| `OS_DATAHUB_KEY` | Optional. Adds an **OS Outdoor** base map from the Ordnance Survey Maps API (free tier); the key stays server‑side |
| `USER_AGENT` | Identify your deployment to OSM services (please include a contact) |

Map layers can be replaced entirely by dropping a `map-layers.json` (array of `MapLayerConfig`, see `shared/src/index.ts`) into `DATA_DIR`. Default layers: **Hike / Trail** (OpenTopoMap), **Satellite** (Esri World Imagery), **Overland** (OpenStreetMap standard), **Private Land** (OpenTopoMap + Natural England CRoW open‑access land overlay), and **OS Outdoor** when a key is configured.

## How the important parts work

**Route editing** (`web/src/store/routeEditor.ts`, `web/src/components/map/RouteLayer.tsx`)
The route is a list of user *routing points*; each consecutive pair has a routed *segment*. Clicking adds a point, dragging the line inserts a point at that spot and drags it, dragging a point moves it; only the affected segments are re‑requested, so the UI stays responsive. Stale responses are discarded, failures fall back to a dashed straight line with a retry prompt, and every change is recorded for undo/redo. Elevation comes from the router (BRouter returns it inline) or is sampled from the elevation service.

**Offline** (`web/src/offline/*`)
Trips, photos and tiles are stored in IndexedDB. MapLibre loads all tiles through a custom `offline://` protocol that serves from the local store first, then the network, and upscales a downloaded parent tile when zoomed past the stored levels. Edits made offline are applied to the local copy and queued as operations; when the API becomes reachable they are replayed (last write wins), GPS tracks are appended (never overwritten), and the trip is refreshed from the server. Deleted trips are soft‑deleted server‑side so a client can detect them explicitly.

**Security**
bcrypt password hashing; opaque session tokens stored hashed with expiry; HttpOnly `SameSite=Lax` cookie (or bearer token inside the Android shell); login rate limiting; every trip/photo/track endpoint checks ownership or a share row; unknown or unauthorised trip ids return 404 so ids can't be probed; photos require authentication; third‑party API keys never reach the browser.

## Android

The client is an installable PWA (Chrome → *Add to Home screen*) and this is enough for planning, offline maps and foreground GPS navigation. For reliable background tracking with the screen off, package it with Capacitor: see [docs/ANDROID.md](docs/ANDROID.md). The location layer (`web/src/location/provider.ts`) already switches to the native plugin when running inside Capacitor.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Server (tsx watch) + Vite dev server |
| `npm run build` | Type‑check everything and build the web app |
| `npm start` | Run the server (serves API + built web app) |
| `npm run typecheck` | Type‑check all workspaces |
| `npm run seed-users` | Create/update accounts from `.env` or arguments |

## Licensing

The application code is yours. Map data, imagery and routing data come from third parties with their own licences and usage policies; read [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) before deploying, and keep the attributions shown on the map.
