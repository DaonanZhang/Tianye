# Frontend Architecture

## Purpose

This directory is now the preferred home for the mobile-facing frontend layer.

Current delivery model:

- frontend assets live in `frontend/`
- Django serves them through `STATICFILES_DIRS`
- backend keeps ownership of data APIs under `/api/...`
- the map page template is only a thin HTML shell that mounts frontend assets

There are now two frontend tracks:

- `frontend/mobile`
  - current Django-served mobile frontend
  - still useful as the stable reference implementation
- `frontend/tianye`
  - new React project
  - intended future primary frontend

This is an intermediate step toward a cleaner frontend/backend split without introducing a mandatory Node build chain yet.

## Current Mobile Entry

- CSS: `frontend/mobile/playground.css`
- JS files:
  - `frontend/mobile/playground-core.js`
  - `frontend/mobile/playground-data.js`
  - `frontend/mobile/playground-navigation.js`
  - `frontend/mobile/playground-map.js`
  - `frontend/mobile/playground-bootstrap.js`
- Django template shell: `maps/templates/maps/playground.html`

Current split:

- `playground-core.js`
  - DOM references
  - shared state
  - map bootstrap object
  - formatting and fetch helpers
- `playground-data.js`
  - scenic spot loading
  - saved path loading
  - GPX import
  - recent hike rendering
- `playground-navigation.js`
  - route preview
  - local navigation state
  - live tracking
  - hike session start/finish
- `playground-map.js`
  - MapLibre sources and layers
  - map click handlers
  - scenic spot and saved path interactions
- `playground-bootstrap.js`
  - button events
  - tab switching
  - initial UI setup

## React project

The new React project lives in:

- `frontend/tianye`

It already contains:

- `package.json`
- Vite config
- React component structure
- a migration bridge that reuses the current mobile map logic while the UI shell is now rendered by React

## Backend Contract

The mobile frontend currently depends on these endpoints:

- `GET /api/route-preview/`
- `GET /api/elevation/`
- `POST /api/gpx-import/`
- `GET /api/hike-sessions/`
- `POST /api/hike-sessions/start/`
- `POST /api/hike-sessions/<id>/finish/`
- `GET /api/saved-paths/`
- `GET /api/scenic-spots/`

This means the long-term direction is still valid:

- frontend owns touch flow and state presentation
- backend owns reusable local route, elevation, GPX, scenic-spot, and session APIs

## Next Step if you want real React

When you are ready, the safest migration path is:

1. keep this mobile interaction design
2. create `frontend/package.json`
3. introduce React + a bundler
4. port the current screen into components:
   - map shell
   - bottom tabs
   - navigation panel
   - gear panel
   - saved paths panel
   - history panel
5. keep Django as API provider only
6. document the build and deployment flow in Markdown
