# Elevation Data Architecture

## Goal

Make elevation a real local data layer in the project, not a temporary browser sensor value.

For this product, browser `coords.altitude` is only a live device reading. It is not sufficient for:

- route ascent / descent calculation
- reliable hiking time estimation
- elevation profiles
- slope-aware route scoring
- contour or terrain overlays

## What Should Be Stored Where

### 1. Raw authoritative elevation source

Store raw DEM files outside the frontend bundle:

- `data/elevation/raw/`

Recommended contents:

- original downloaded tiles
- a `README.md` describing source, license, acquisition date, and coverage

Examples:

- `data/elevation/raw/copernicus-glo30/`
- `data/elevation/raw/srtm-1arcsec/`

### 2. Clipped project DEM

Store the Beijing-only clipped raster used by the project:

- `data/elevation/derived/beijing-dem.tif`

This is the working terrain raster that scripts sample from.

### 3. Routing-node elevation artifact

Store elevation sampled onto routing graph nodes:

- `data/elevation/derived/beijing-routing-node-elevation.json.gz`

or merge it directly into:

- `data/routing/beijing-core-routing.json.gz`

Preferred structure for the route graph in the long run:

- `nodes`: `[[lng, lat, elevation_m], ...]`

That is the cleanest place to keep elevation for routing and route summaries.

### 4. Visualization artifacts

Store optional map overlays separately:

- `maps/static/maps/data/beijing-contours.geojson`
- `maps/static/maps/data/beijing-hillshade.mbtiles`

These are for map rendering only. They should not be the source of truth for route computation.

## Where The Data Should Come From

Preferred source order:

1. Copernicus DEM GLO-30 or EEA-10 where licensing and access fit the coverage
2. SRTM 1 arc-second global DEM
3. another official or stable DEM with acceptable licensing

## Recommended Sources

### Copernicus DEM

Why it is attractive:

- modern global coverage
- 30 m product available to registered users
- good default candidate for reusable local ingest

Important caveat:

- the product is a surface model, so vegetation/buildings can affect values in some places

Recommended use here:

- primary candidate for project terrain source if access and licensing are acceptable

### SRTM 1 Arc-Second Global

Why it is attractive:

- well-known
- stable
- 30 m class global DEM
- easy to explain and widely used

Recommended use here:

- strong fallback or baseline source for first implementation

## How To Read Elevation Locally

Do not read elevation from the frontend.

Read it in a backend or build-step script from the DEM raster and then persist sampled values locally.

Preferred workflow:

1. download DEM tiles
2. clip/reproject to project area
3. sample every routing node against the raster
4. write the sampled elevations into a derived local artifact
5. let route APIs read from that local artifact

## Suggested Build Pipeline

### Script 1: prepare DEM

Create a script such as:

- `scripts/build_beijing_elevation_dem.sh`

Responsibility:

- merge source tiles if needed
- clip to Beijing bounds
- ensure one project CRS and resolution

Output:

- `data/elevation/derived/beijing-dem.tif`

### Script 2: sample routing nodes

Create a script such as:

- `scripts/build_beijing_route_elevation.py`

Responsibility:

- load `data/routing/beijing-core-routing.json.gz`
- load `data/elevation/derived/beijing-dem.tif`
- sample each node elevation
- write enriched node data back out

Output options:

- enrich `beijing-core-routing.json.gz`
- or generate `beijing-routing-node-elevation.json.gz`

## How To Stack It Onto The Map

There are two different stacking targets.

### A. Analytical stack for routing and ETA

This is the important one.

Use sampled node elevation in the route graph so the backend can compute:

- total ascent
- total descent
- slope per segment
- DAV time estimate with real vertical data

This stack belongs in:

- routing build artifacts
- Django route API responses

### B. Visual stack for the map

Optional visual layers can be added later:

- contour lines
- hillshade
- terrain tinting

This stack belongs in:

- frontend map layers

But visual terrain is secondary. The route graph must know elevation even if the UI does not show contours yet.

## Algorithms Worth Using

### 1. Point sampling from DEM into route nodes

Use this to get usable height data for hiking logic.

Method:

- for each route node or route vertex, sample DEM elevation at its longitude/latitude
- accumulate positive deltas as ascent
- accumulate negative deltas as descent
- optionally ignore tiny changes such as `1-2 m` to reduce raster noise

This is the algorithm that should drive:

- hiking ETA
- ascent / descent totals
- elevation profile

### 2. Contour generation for optional visual overlays

Use this only if you want the map to *look* topographic.

Good options:

- GDAL contour generation from the local DEM
- marching squares over the clipped DEM raster

Typical output:

- contour GeoJSON
- vector tiles derived from contour lines

This is for display. It is not the best primary source for route analytics because sampling the DEM directly is simpler and more accurate.

### 3. Hillshade from raster DEM

Use this when you want terrain relief while still showing the current map style.

Method:

- keep the current map as the visible base
- add a semi-transparent hillshade layer derived from the DEM above it
- do not replace the map, only blend terrain relief into it

This improves perception, but the route logic should still read heights from the DEM itself.

## What To Do In This Project Next

### Phase 1

- choose one DEM source
- create `data/elevation/raw/`
- document acquisition and license
- clip a Beijing DEM into `data/elevation/derived/beijing-dem.tif`

### Phase 2

- sample route graph nodes
- extend route graph nodes to include elevation
- compute ascent/descent in `maps/routing.py`

### Phase 3

- update `maps/views.py` to return real ascent/descent
- make DAV time estimate use real vertical data
- add route elevation profile output

### Phase 4

- add optional contours or hillshade as frontend map overlays

## Current Product Rule

Elevation should be stored primarily in local routing/build artifacts, not only shown as a transient device reading in the browser.
