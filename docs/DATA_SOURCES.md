# Data sources & licensing

Everything the app draws or routes on comes from third parties. None of it is Gaia GPS material. This page lists what is used by default, the licence, and what you must do to stay within each provider's terms. Review it before you deploy; the defaults are chosen to be fine for a private two‑person installation, but they are still someone else's servers.

All sources cover the whole of the UK (England, Scotland, Wales and Northern Ireland) unless noted.

## Base maps (raster tiles)

| Layer in app | Source | Licence | Notes |
| --- | --- | --- | --- |
| **Hike / Trail** | [OpenTopoMap](https://opentopomap.org) | Tiles CC‑BY‑SA 3.0; data © OpenStreetMap contributors (ODbL), contours from SRTM | Topographic style with contours, footpaths, bridleways and tracks. Max zoom 17. Bulk download for personal offline use is tolerated but keep areas modest and don't hammer the servers; the downloader is throttled. |
| **Satellite** | [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) | Free for non‑commercial use with attribution ("Esri, Maxar, Earthstar Geographics, and the GIS User Community") | Offline caching for personal use is allowed under the Esri terms for non‑commercial apps; commercial use requires an ArcGIS subscription. |
| **Overland** | [OpenStreetMap standard tiles](https://www.openstreetmap.org) | Data ODbL; tiles subject to the [OSMF tile usage policy](https://operations.osmfoundation.org/policies/tiles/) | Bulk downloading is *forbidden* by the policy, so this layer is marked `offline: false` and cannot be selected for offline downloads. Use OpenTopoMap or OS Outdoor for offline use. |
| **Private Land** | OpenTopoMap + **Natural England CRoW Act 2000 Access Layer** (WMS) | OGL v3 (Natural England) | Shades *open access land* in England (mountain, moor, heath, down, registered common land, dedicated land). Anything not shaded and not on a public right of way should be treated as private. **England only** — Scotland has a general right of responsible access (Scottish Outdoor Access Code) and Wales/NI have separate datasets you can add as extra overlays. |
| **OS Outdoor** (optional) | [Ordnance Survey Maps API](https://osdatahub.os.uk/docs/wmts/overview) via the server proxy | OS OpenData terms (OGL) for the Outdoor/Road/Light styles; free tier ~ 100k transactions/month | Enabled when `OS_DATAHUB_KEY` is set. The key never reaches the browser: the client requests `/api/tiles/os/...` and the server appends the key. Only available for Great Britain (not NI). Attribution "Contains OS data © Crown copyright and database right <year>" is added automatically. |

### Adding or replacing layers

Drop a `map-layers.json` (an array of `MapLayerConfig`, see `shared/src/index.ts`) into `DATA_DIR`. Useful UK additions:

* **OS Leisure (1:25k/1:50k)** — requires a paid OS Data Hub plan ("Premium"), but the proxy route already handles any `{style}` accepted by the Maps API.
* **Natural Resources Wales open access land** and **Scottish core paths** — both are available as WMS/WMTS under OGL and can be added as `kind: "overlay"` layers using a `{bbox-epsg-3857}` template exactly like the CRoW layer.
* **NI Open Data** — OSNI open base maps via WMTS.

Any layer using a WMS `GetMap` URL works because MapLibre substitutes `{bbox-epsg-3857}`.

## Routing

| Provider | Default | Modes | Licence / limits |
| --- | --- | --- | --- |
| **BRouter** (`ROUTING_PROVIDER=brouter`) | yes, `https://brouter.de/brouter` | hiking (`hiking-mountain`), walking (`shortest`/`trekking`), driving (`car-fast`), overland (`trekking`) | Routing data is OSM (ODbL). The public server is run by volunteers with no SLA; it returns elevation inline. For heavy use run your own instance with the UK `.rd5` segments (see the [BRouter README](https://github.com/abrensch/brouter)); it is a single Java process and the UK is ~12 segment files. |
| **OSRM** (`osrm`) | no | driving only | The public demo server (`router.project-osrm.org`) is for testing, not production. |
| **OpenRouteService** (`ors`) | no | foot‑hiking, foot‑walking, driving‑car, cycling‑mountain (used for overland) | Free key with daily quotas, [terms](https://openrouteservice.org/terms-of-service/). |

BRouter's profiles honour OSM `access=*`, `foot=*` and `highway=*` tags, so routes avoid ways tagged as private or not permitted for the chosen mode where the data records it. OSM coverage of UK public rights of way is good but not perfect; the presence of a path on the map is *not* proof of a legal right to use it. Routing responses are cached server‑side (`routing_cache` table) so re‑dragging over the same segment does not hit the provider twice.

## Elevation

Default: [Open Topo Data](https://www.opentopodata.org/) public API, `eudem25m` dataset (EU‑DEM 25 m, covers the whole UK including NI). Public API limit: 100 locations per request, 1 request/second, 1000 requests/day — the app samples routes to stay within that. For unlimited use self‑host Open Topo Data; **OS Terrain 50** (OGL) is a good UK dataset to load. BRouter already returns elevation with each routed segment, so the elevation service is mostly used for straight‑line fallbacks and manual points.

## Search / geocoding

[Nominatim](https://nominatim.org/) (OSM data, ODbL) via the server proxy, restricted to `countrycodes=gb`. Public instance [usage policy](https://operations.osmfoundation.org/policies/nominatim/): max 1 request/second, a valid `User-Agent` with contact details (set `USER_AGENT` in `.env`), no autocomplete‑style hammering (the search box only queries on submit). Coordinates (decimal, DMS, and **OS grid references** like `NY 2150 0720`) are parsed locally without any network call.

## Fonts / glyphs

MapLibre needs a glyph source even for raster‑only styles: the demo glyph server at `demotiles.maplibre.org` is referenced. No labels are drawn from vector data, so this is only fetched if a symbol layer is added later; replace it with a self‑hosted glyph set if you want zero external dependencies.

## Attribution

Every layer carries its attribution string and MapLibre shows it in the bottom‑right control. Keep it visible. GPX exports include a `<copyright>` note that the route geometry is derived from OpenStreetMap data.

## Offline storage and licensing

Downloaded tiles are stored in the user's browser (IndexedDB) on their own device only — nothing is redistributed and the server never stores tiles. This is the model intended by the "personal use" clauses of the providers above. Keep download areas proportionate (the UI shows an estimate before downloading; a typical day walk at z10–15 is 20–60 MB).
