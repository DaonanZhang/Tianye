# Map Processing Workflow

## Goal

Build a citywalk product where every saved route is computed from walkable road data instead of being drawn freely on top of the map.

## Working Principle

- Prefer reusable local map data over repeated one-off online lookups.
- When a new overlay or POI layer is needed, first look for a stable source that can be downloaded or persisted locally.
- Every meaningful ingestion step should be recorded so the workflow can be repeated later.
- `AGENTS.md` is the project-level rulebook for this behavior.

## Current Scope

- City: Beijing demo area with west/south expansion to include Fangshan
- Product stage: local development playground
- Data source: `data/osm/beijing-latest.osm.pbf`
- Scenic spot overlay source: local OSM extract imported into project database
- Current route geometry dimension: 2D longitude/latitude
- Current real-time device positioning source: browser Geolocation API

## Current Data Inventory

### Already local and reusable

- Roads, walkways, parks, water, and place labels:
  - source: Geofabrik Beijing OSM extract
  - dependency type: `local-data`
- Scenic spots table:
  - source: local OSM extract imported into Django DB
  - dependency type: `local-service`
- Routing graph:
  - source: derived from local walkway GeoJSON
  - dependency type: `local-data`

### Available for demo and good candidates for the long-term workflow

- Copernicus DEM GLO-30:
  - use: elevation source for ascent/descent, ETA, contour/hillshade derivation
  - dependency type after download: `local-data`
  - note: free and downloadable; appropriate for Beijing demo ingestion
- SRTM 1 arc-second:
  - use: fallback elevation source if Copernicus workflow is blocked
  - dependency type after download: `local-data`

### Still external for now

- Browser geolocation stream:
  - use: live user position
  - dependency type: `external-api`
  - note: acceptable for demo, not a substitute for local terrain data

## Working Flow

### 1. Download raw OSM data

- Source: Beijing extract from Geofabrik
- Output: `data/osm/beijing-latest.osm.pbf`

Reason:
- This is the canonical local source for roads, parks, water, and place data.

### 2. Extract development map layers

- Script: `scripts/build_beijing_dev_layers.py`
- Output:
  - `maps/static/maps/data/beijing-walkways.geojson`
  - `maps/static/maps/data/beijing-parks.geojson`
  - `maps/static/maps/data/beijing-water.geojson`
  - `maps/static/maps/data/beijing-places.geojson`

Reason:
- The frontend needs a local Beijing-only map instead of a world basemap.
- These files are lightweight enough for early UI iteration.
- The current demo bounds are intentionally larger than the original core-city sandbox so real positioning in Fangshan still lands inside the local map.

### 3. Convert walkways into a routing graph

- Script: `scripts/build_beijing_routing_graph.py`
- Output:
  - `data/routing/beijing-core-routing.json.gz`

What happens here:
- Each OSM road coordinate becomes a routing node.
- Consecutive coordinates on a walkable line become graph edges.
- Each edge stores distance in meters.
- Each edge also stores a weighted walking cost based on road class.
- A grid index is built so the API can snap user clicks to nearby road nodes.

Current weighting direction:
- prefer `path`, `footway`, `pedestrian`, `living_street`
- keep `track`, `cycleway` acceptable for demo
- mildly penalize `steps`, `service`, `residential`
- more strongly penalize `tertiary`, `secondary`, `primary`

Reason:
- Visible roads are not enough.
- To guarantee that a route follows roads, the road geometry must be transformed into a searchable network graph.
- For a hiking product, shortest path alone is not enough; route choice should start moving toward more walk-friendly segments.

### 4. Serve routing from Django

- Code: `maps/routing.py`
- API target: route preview endpoint in Django

What happens here:
- The backend loads the prebuilt routing graph once.
- A request sends a start point and an end point.
- The backend snaps both points to the nearest walkable nodes.
- The current demo computes the route by pure geometric shortest distance across the local graph.
- Road-class weight is still exported with each edge for future hiking-quality routing, but it is not currently used to choose the path.
- The API returns GeoJSON that the frontend can draw directly.
- If a user click does not land exactly on a walkable road node, the frontend draws a dashed connector from the click point to the snapped road anchor.
- The API also returns true geometric distance separately from the weighted route cost.

### 5. Validate in the map playground

- Frontend file: `maps/static/maps/playground.js`

Validation target:
- Click two points on the Beijing map.
- The returned preview line should stay on the local road network.
- On a phone or a geolocation-capable browser, start live positioning.
- Use the current location as the route start.
- While moving, the planned route remains visible and the walked portion is recolored separately.
- The raw GPS trace is also drawn as a lighter helper overlay.

Dependency type:
- route preview API: `local-service`
- browser GPS stream: `external-api`

Why `external-api` here:
- The browser Geolocation API is the fastest way to prove the walking experience.
- It depends on device sensors and browser permission, not project-owned local map data.
- The map-matching and route rendering still stay local to the project.

### 5.1 Persist hike sessions

- Backend model: `maps.models.HikeSession`
- API:
  - `POST /api/hike-sessions/start/`
  - `POST /api/hike-sessions/<id>/finish/`
  - `GET /api/hike-sessions/`
- Frontend:
  - start hiking only after a route already exists
  - save planned route at hike start
  - save actual GPS track and completion summary at hike end

What gets persisted:
- planned route geometry
- actual walked track geometry
- started / ended timestamps
- planned distance and planned DAV timing
- walked distance and walked route completion
- deviation count

Reason:
- Without a durable hike session object, live location and route progress stay only in browser memory and the product does not accumulate usable hiking records.

### 5.2 Detect off-route events more conservatively

- Frontend file: `maps/static/maps/playground.js`

Current behavior:
- The live position is matched against route segments, not only route nodes.
- A single noisy GPS point does not immediately count as a deviation.
- The current demo marks one deviation only after repeated consecutive off-route fixes beyond a distance threshold.

Reason:
- Hiking GPS traces are noisy.
- Immediate single-point deviation logic creates too many false positives.

### 6. Import GPX and build trusted local paths

- API:
  - `POST /api/gpx-import/`
  - `GET /api/saved-paths/`
- Backend model:
  - `maps.models.SavedPath`
- Parser:
  - `maps.gpx.parse_gpx_text`

What happens here:
- The project reads an uploaded GPX track or route and trusts it as a valid walked path candidate.
- The raw GPX points are normalized into a project-owned navigation path.
- The normalized GPX polyline is compared against existing canonical saved paths.
- If the bidirectional maximum deviation stays within `1 m`, the GPX is merged into the existing old path.
- Otherwise a new canonical path is created and rendered on the map as a newly known road/path.
- The original GPX XML is stored so the source file is not lost.
- Canonical saved paths are cached in the browser so they can be reused for basic offline navigation.

Reason:
- GPX is a product-owned path source.
- Imported tracks should become reusable local path assets, not temporary overlays.

Working rule after GPX import:
1. parse the GPX into a trusted path geometry
2. flatten multi-segment input into one navigation polyline
3. remove near-duplicate points within roughly `1 m`
4. sample local DEM to attach ascent / descent metadata
5. compare the normalized path against existing canonical paths
6. merge into an old path if the full-curve max deviation stays within `1 m`
7. otherwise create a new canonical path
8. persist both the normalized geometry and the original GPX text
9. expose canonical paths back to the map via local API
10. cache canonical paths in the browser for offline reuse

Feature breakdown for offline-capable GPX navigation:
1. GPX normalization:
   - imported GPX becomes one stable project path geometry instead of a raw point dump
2. Trusted path persistence:
   - canonical path geometry and original GPX are both saved locally in project storage
3. Local navigation path selection:
   - a saved GPX path can become the current navigation path without recomputing it from the server
4. On-device progress computation:
   - walked distance, remaining distance, completion ratio, and walked segment highlighting are computed in frontend code
5. Offline reuse:
   - saved canonical paths are cached in browser storage so the user can still navigate them without network
6. Deferred sync direction:
   - future online recovery should synchronize newly recorded local hike sessions or locally imported paths back to Django

Current Beijing synthetic GPX regression set:
- source directory: `beijing_test_gpx_routes/`
- purpose: mobile hiking flow regression, not real-world trail truth
- current files:
  - `beijing_chaoyang_park_west_loop.gpx`
  - `beijing_forbidden_city_outer_walk.gpx`
  - `beijing_location_pause_and_wrong_turn_test.gpx`
  - `beijing_olympic_forest_park_loop.gpx`
  - `beijing_shichahai_houhai_walk.gpx`
  - `beijing_temple_of_heaven_loop.gpx`

Current validation result against the workflow:
- all 6 GPX files imported successfully as canonical local paths
- no false merge happened across those 6 distinct routes
- re-importing `beijing_forbidden_city_outer_walk.gpx` correctly produced a `merged` record instead of a duplicate canonical path

Why this matters:
- it confirms that the current GPX parser, path normalization, canonical-path persistence, and `1 m` merge rule are coherent for the present demo workflow
- it does not yet prove map-matching quality against the local road graph; it only proves that project-owned GPX trails can be ingested and reused consistently

### 6. Import scenic spots into the local database

- Data source:
  - local file `data/osm/beijing-latest.osm.pbf`
  - source upstream: Geofabrik Beijing OSM extract
- Dependency type:
  - source ingest: `local-data`
  - map query endpoint `/api/scenic-spots/`: `local-service`
- Import command:
  - `python manage.py migrate`
  - `python manage.py import_beijing_scenic_spots --replace`
- Database model:
  - `maps.models.ScenicSpot`
- Local API:
  - `/api/scenic-spots/`

What happens here:
- Scenic spots are extracted from OSM tags such as `tourism=*`, `historic=*`, and selected `leisure=*`.
- The project stores a normalized local table with name, category, coordinates, source ids, and raw tags.
- The frontend requests only the scenic spots inside the current map viewport.

Reason:
- Scenic spot markers should come from reusable local data, not repeated online POI lookups.

### 7. Add elevation as a first-class map data dimension

Current state:
- The route graph currently stores only `[lng, lat]`.
- Device geolocation may provide current altitude, but this is not a complete terrain model and should not be treated as authoritative route elevation data.
- The project now has local Copernicus DEM tiles for the current Beijing demo scope.

Target:
- Every route node or sampled route vertex should eventually be enrichable with elevation in meters.
- Hiking-oriented outputs should support ascent, descent, elevation profile, and slope-aware route scoring.

Preferred source discovery order:
1. downloadable DEM or contour dataset covering Beijing and later wider regions
2. locally persisted derived elevation tiles or sampled node tables
3. online elevation API only as a temporary fallback

Recommended dependency labels:
- source DEM ingest: `local-data`
- elevation sampling/build step: `local-service`
- emergency fallback elevation lookup: `external-api`

Planned local workflow:
- Download a reusable elevation source such as SRTM, Copernicus DEM, ASTER, or an official terrain dataset with acceptable licensing.
- Store the raw elevation asset outside the frontend bundle under `data/elevation/`.
- Add a build script that samples elevation onto routing nodes or route polylines and produces a derived artifact beside `data/routing/beijing-core-routing.json.gz`.
- Extend the route payload to expose per-route elevation statistics after the local sampling artifact exists.
- Detailed architecture note: `docs/elevation-data-architecture.md`
- Demo download helper: `scripts/download_beijing_copernicus_dem.sh`
- Current DEM sampling code: `maps/elevation.py`

Reason:
- For a hiking product, elevation is not optional metadata. It affects effort, safety, route ranking, and user expectations.

### 8. Estimate route time with the DAV rule

Source references:
- DAV tour planning guidance
- Bergfreunde walking time calculator article describing the DAV / DIN-style rule

Current implementation:
- Code: `maps/hiking_time.py`
- API integration: `maps/views.py`
- Frontend display: `maps/static/maps/playground.js`

Current formula:
1. compute uphill time using `300 hm/h`
2. compute downhill time using `500 hm/h`
3. compute horizontal time using `4 km/h`
4. halve the smaller of uphill/downhill time and add it to the larger one
5. add horizontal time

Current limitation:
- The project still does not persist elevation directly into routing nodes.
- However, the current route preview now samples local Copernicus DEM values along the returned route geometry and uses those values for ascent, descent, point elevation lookup, and DAV estimation.
- The next upgrade is to move this from route-time sampling to build-time node enrichment.

Planning guidance:
- Show both pure moving time and a safer recommended planning time with break buffer.
- Do not market the current value as a full alpine-grade ETA until local elevation data is wired in.

### 9. Bring in Beijing demo elevation tiles

- Source:
  - Copernicus DEM GLO-30 public tiles
  - discovery pages:
    - AWS Open Data registry
    - Copernicus Data Space DEM documentation
- Dependency type:
  - downloaded tiles: `local-data`
- Local paths:
  - raw folder: `data/elevation/raw/copernicus-glo30/`
  - helper script: `scripts/download_beijing_copernicus_dem.sh`

Current demo scope:
- Only the raw tiles covering the current Beijing development bounds are needed.
- This keeps the demo small while staying compatible with a future full workflow.
- Downloaded demo tiles:
  - `data/elevation/raw/copernicus-glo30/Copernicus_DSM_COG_10_N39_00_E115_00_DEM.tif`
  - `data/elevation/raw/copernicus-glo30/Copernicus_DSM_COG_10_N40_00_E115_00_DEM.tif`
  - `data/elevation/raw/copernicus-glo30/Copernicus_DSM_COG_10_N39_00_E116_00_DEM.tif`
  - `data/elevation/raw/copernicus-glo30/Copernicus_DSM_COG_10_N40_00_E116_00_DEM.tif`
- Local metadata note:
  - `data/elevation/raw/copernicus-glo30/README.md`
- Demo spot checks from the local DEM:
  - Tiananmen area: about `46.8 m`
  - Summer Palace area: about `56.7 m`
  - Fragrant Hills area: about `150.5 m`
  - Olympic Forest Park area: about `42.8 m`

Why it is worth recording now:
- Even before node sampling is implemented, downloading the source tiles proves the terrain pipeline is practical.
- This is demo-first work that can move directly into the permanent ingestion workflow later.

Current blocker:
- The local environment currently lacks `gdal`, `rasterio`, and `pyproj`.
- The project can already sample the downloaded GeoTIFF tiles with `tifffile` for Beijing demo logic.
- More advanced clipping, contour extraction, hillshade generation, and CRS-heavy workflows still need one fuller geospatial processing dependency path.

## Why This Workflow Matters

- The map layer is for visualization.
- The routing graph is for path computation.
- These are related but not the same artifact.

This is the key product rule for citywalk:

> the route line must be derived from the road network, not painted independently of it

## Current Decisions

- Backend stays on Django
- Early frontend stays simple, but should remain easy to migrate to React
- Beijing core area is the first routing sandbox
- Local files are acceptable for development
- PostGIS and dedicated routing services can come later

## Next Likely Upgrades

1. Replace the current shortest-path prototype with richer walkability weighting
2. Add penalties for main roads and prefer pedestrian streets and park edges
3. Store curated routes in the database
4. Move the playground UI to React
5. Replace GeoJSON basemap layers with proper local vector tiles
