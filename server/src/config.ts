import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import type { AppConfig, MapLayerConfig } from "@trails/shared";

const root = path.resolve(import.meta.dirname, "..");
// .env may live in the repository root (preferred) or next to the server package.
dotenv.config({ path: [path.join(root, ".env"), path.join(root, "..", ".env")] });

export const env = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  // Relative paths are resolved against the repository root, absolute paths are used as-is.
  dataDir: path.resolve(root, "..", process.env.DATA_DIR ?? "server/data"),
  webDist: path.resolve(root, "..", process.env.WEB_DIST ?? "web/dist"),
  /** Set to "true" when running behind an HTTPS terminating proxy */
  secureCookies: (process.env.SECURE_COOKIES ?? (process.env.NODE_ENV === "production" ? "true" : "false")) === "true",
  trustProxy: process.env.TRUST_PROXY === "true",
  sessionDays: Number(process.env.SESSION_DAYS ?? 30),
  /** Extra origin allowed to call the API with credentials (e.g. Capacitor app: https://localhost) */
  corsOrigins: (process.env.CORS_ORIGINS ?? "https://localhost,http://localhost,capacitor://localhost")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  users: {
    owner: { username: process.env.OWNER_USERNAME ?? "", password: process.env.OWNER_PASSWORD ?? "", displayName: process.env.OWNER_DISPLAY_NAME ?? "Owner" },
    friend: { username: process.env.FRIEND_USERNAME ?? "", password: process.env.FRIEND_PASSWORD ?? "", displayName: process.env.FRIEND_DISPLAY_NAME ?? "Friend" },
  },
  routing: {
    provider: process.env.ROUTING_PROVIDER ?? "brouter",
    brouterUrl: process.env.BROUTER_URL ?? "https://brouter.de/brouter",
    osrmUrl: process.env.OSRM_URL ?? "https://router.project-osrm.org",
    orsUrl: process.env.ORS_URL ?? "https://api.openrouteservice.org",
    orsKey: process.env.ORS_API_KEY ?? "",
  },
  elevationUrl: process.env.ELEVATION_URL ?? "https://api.opentopodata.org/v1/eudem25m",
  nominatimUrl: process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org",
  osDataHubKey: process.env.OS_DATAHUB_KEY ?? "",
  userAgent: process.env.USER_AGENT ?? "TrailsPrivateRoutePlanner/0.1 (self-hosted; two users)",
  appName: process.env.APP_NAME ?? "Trails",
};

export const photosDir = path.join(env.dataDir, "photos");
export const dbPath = path.join(env.dataDir, "trails.sqlite");

fs.mkdirSync(photosDir, { recursive: true });

/**
 * Map layers. Everything below is UK-oriented and uses openly licensed public sources.
 * The list can be replaced entirely by dropping a `map-layers.json` file in DATA_DIR.
 *
 * Licensing notes are in docs/DATA_SOURCES.md. In particular:
 *  - OpenStreetMap standard tiles: ODbL data, tile usage policy forbids heavy bulk download.
 *    Offline downloads default to OpenTopoMap and OS Maps (when a key is configured).
 *  - OpenTopoMap: CC-BY-SA, contours + trails, ideal for hiking.
 *  - Esri World Imagery: free to use with attribution for non-commercial apps.
 *  - Natural England CRoW Act 2000 Access Layer (Open Government Licence): open access land in England.
 */
function defaultLayers(): MapLayerConfig[] {
  const layers: MapLayerConfig[] = [
    {
      id: "hike",
      name: "Hike / Trail",
      kind: "base",
      tiles: [
        "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      minZoom: 0,
      maxZoom: 17,
      attribution:
        'Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
      offline: true,
      description: "Topographic map with contours, footpaths, bridleways and tracks",
    },
    {
      id: "satellite",
      name: "Satellite",
      kind: "base",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      minZoom: 0,
      maxZoom: 18,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      offline: true,
      description: "Aerial imagery",
    },
    {
      id: "overland",
      name: "Overland",
      kind: "base",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      minZoom: 0,
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      offline: false,
      description: "Roads, byways and tracks (OpenStreetMap). Bulk download disabled by tile policy.",
    },
    {
      id: "private-land",
      name: "Private Land",
      kind: "base",
      tiles: [
        "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      minZoom: 0,
      maxZoom: 17,
      attribution:
        'Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) | Contains Natural England data © Natural England, <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/">OGL v3</a>',
      overlays: ["crow-access"],
      offline: true,
      description: "Open access land (CRoW Act 2000, England) shaded green. Unshaded land away from rights of way should be treated as private.",
    },
    {
      id: "crow-access",
      name: "Open Access Land (England)",
      kind: "overlay",
      tiles: [
        "https://environment.data.gov.uk/spatialdata/crow-act-2000-access-layer/wms?service=WMS&version=1.3.0&request=GetMap&layers=Countryside_and_Rights_of_Way_Act_2000_Access_Layer_England&styles=&format=image/png&transparent=true&crs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}",
      ],
      tileSize: 256,
      minZoom: 8,
      maxZoom: 18,
      attribution: "© Natural England, OGL v3",
      offline: true,
    },
  ];

  if (env.osDataHubKey) {
    layers.unshift({
      id: "os-outdoor",
      name: "OS Outdoor",
      kind: "base",
      tiles: ["/api/tiles/os/Outdoor_3857/{z}/{x}/{y}.png"],
      tileSize: 256,
      minZoom: 7,
      maxZoom: 16,
      attribution: `Contains OS data © Crown copyright and database right ${new Date().getFullYear()}`,
      offline: true,
      description: "Ordnance Survey Outdoor style (OS Data Hub, free tier)",
    });
  }
  return layers;
}

export function loadAppConfig(): AppConfig {
  const override = path.join(env.dataDir, "map-layers.json");
  let mapLayers = defaultLayers();
  if (fs.existsSync(override)) {
    try {
      mapLayers = JSON.parse(fs.readFileSync(override, "utf8")) as MapLayerConfig[];
    } catch (err) {
      console.error("Failed to parse map-layers.json, using defaults", err);
    }
  }
  return {
    appName: env.appName,
    mapLayers,
    defaultLayerId: process.env.DEFAULT_LAYER_ID ?? (env.osDataHubKey ? "os-outdoor" : "hike"),
    // Centre of Great Britain-ish (Lake District) so the first map view is useful.
    defaultCenter: [-3.05, 54.45],
    defaultZoom: 9,
    offlineZoom: { min: 10, max: 15 },
  };
}
