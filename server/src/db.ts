import Database from "better-sqlite3";
import { dbPath } from "./config.js";

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  map_center_lng REAL,
  map_center_lat REAL,
  map_zoom REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS routes (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL UNIQUE REFERENCES trips(id) ON DELETE CASCADE,
  routing_mode TEXT NOT NULL,
  geometry TEXT NOT NULL,
  distance REAL NOT NULL DEFAULT 0,
  duration REAL NOT NULL DEFAULT 0,
  elevation_gain REAL NOT NULL DEFAULT 0,
  elevation_loss REAL NOT NULL DEFAULT 0,
  min_elevation REAL,
  max_elevation REAL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS route_points (
  id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  sequence INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_route_points_route ON route_points(route_id, sequence);

CREATE TABLE IF NOT EXISTS waypoints (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'custom',
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_waypoints_trip ON waypoints(trip_id);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  waypoint_id TEXT NOT NULL REFERENCES waypoints(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  thumbnail_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_waypoint ON photos(waypoint_id);

CREATE TABLE IF NOT EXISTS checklist_items (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_checklist_trip ON checklist_items(trip_id, sort_order);

CREATE TABLE IF NOT EXISTS gps_tracks (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  distance REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tracks_trip ON gps_tracks(trip_id);

CREATE TABLE IF NOT EXISTS gps_track_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id TEXT NOT NULL REFERENCES gps_tracks(id) ON DELETE CASCADE,
  timestamp TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  altitude REAL,
  accuracy REAL,
  speed REAL,
  heading REAL
);
CREATE INDEX IF NOT EXISTS idx_track_points_track ON gps_track_points(track_id, timestamp);

CREATE TABLE IF NOT EXISTS trip_shares (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL DEFAULT 'edit',
  created_at TEXT NOT NULL,
  PRIMARY KEY (trip_id, user_id)
);

CREATE TABLE IF NOT EXISTS routing_cache (
  key TEXT PRIMARY KEY,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

db.exec(schema);

export const now = () => new Date().toISOString();
