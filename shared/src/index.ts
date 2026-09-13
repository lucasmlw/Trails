/**
 * Types shared between the server API and the web / Android client.
 * All coordinates are WGS84. Arrays of positions are [lng, lat, elevation?]
 * to match GeoJSON ordering.
 */

export type LngLat = [number, number];
export type Position = [number, number] | [number, number, number];

export type RoutingMode = "hiking" | "walking" | "driving" | "overland";

export const ROUTING_MODES: { id: RoutingMode; label: string; description: string }[] = [
  { id: "hiking", label: "Hiking", description: "Prefers footpaths, trails and mountain paths" },
  { id: "walking", label: "Walking / trail", description: "Easy paths, tracks and quiet roads" },
  { id: "driving", label: "Driving / road", description: "Public roads" },
  { id: "overland", label: "Overland / off-road", description: "Byways, tracks and unsurfaced roads where routing data exists" },
];

export type Permission = "owner" | "edit" | "view";
export type SharePermission = "edit" | "view";

export interface User {
  id: string;
  username: string;
  displayName: string;
}

export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface RouteSegment {
  /** Routed geometry between two consecutive route points, [lng, lat, ele?] */
  coordinates: Position[];
  /** metres */
  distance: number;
  /** seconds */
  duration: number;
  /** true when the routing engine failed and a straight line was used */
  straight?: boolean;
}

export interface RouteStats {
  distance: number;
  duration: number;
  elevationGain: number;
  elevationLoss: number;
  minElevation: number | null;
  maxElevation: number | null;
}

export interface RouteData {
  routingMode: RoutingMode;
  points: RoutePoint[];
  segments: RouteSegment[];
  stats: RouteStats;
}

export const WAYPOINT_CATEGORIES = [
  "start",
  "finish",
  "parking",
  "camp",
  "water",
  "food",
  "shelter",
  "viewpoint",
  "warning",
  "custom",
] as const;
export type WaypointCategory = (typeof WAYPOINT_CATEGORIES)[number];

export interface Photo {
  id: string;
  waypointId: string;
  url: string;
  thumbnailUrl: string;
  createdAt: string;
}

export interface Waypoint {
  id: string;
  tripId: string;
  name: string;
  description: string;
  category: WaypointCategory;
  lat: number;
  lng: number;
  createdAt: string;
  updatedAt: string;
  photos: Photo[];
}

export interface ChecklistItem {
  id: string;
  tripId: string;
  text: string;
  completed: boolean;
  sortOrder: number;
}

export interface TrackPoint {
  /** ISO timestamp */
  timestamp: string;
  lat: number;
  lng: number;
  altitude: number | null;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
}

export interface Track {
  id: string;
  tripId: string;
  name: string;
  startedAt: string;
  endedAt: string | null;
  distance: number;
  points: TrackPoint[];
}

export interface TripShare {
  tripId: string;
  userId: string;
  username: string;
  displayName: string;
  permission: SharePermission;
}

export interface Trip {
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  description: string;
  notes: string;
  mapCenter: LngLat | null;
  mapZoom: number | null;
  createdAt: string;
  updatedAt: string;
  permission: Permission;
  route: RouteData | null;
  waypoints: Waypoint[];
  checklist: ChecklistItem[];
  tracks: Track[];
  shares: TripShare[];
}

export interface TripSummary {
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  description: string;
  distance: number | null;
  waypointCount: number;
  createdAt: string;
  updatedAt: string;
  permission: Permission;
  shared: boolean;
}

export interface MapLayerConfig {
  id: string;
  name: string;
  kind: "base" | "overlay";
  tiles: string[];
  tileSize: number;
  minZoom: number;
  maxZoom: number;
  attribution: string;
  /** Overlay layer ids that are switched on together with this base layer */
  overlays?: string[];
  /** Whether tiles may be bulk-downloaded for offline use */
  offline: boolean;
  description?: string;
}

export interface AppConfig {
  appName: string;
  mapLayers: MapLayerConfig[];
  defaultLayerId: string;
  defaultCenter: LngLat;
  defaultZoom: number;
  offlineZoom: { min: number; max: number };
}

export interface GeocodeResult {
  name: string;
  displayName: string;
  lat: number;
  lng: number;
  type: string;
  bbox?: [number, number, number, number];
}

export interface RoutingResponse {
  coordinates: Position[];
  distance: number;
  duration: number;
  straight?: boolean;
}

export interface ElevationResponse {
  elevations: (number | null)[];
}
