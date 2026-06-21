# 北京城市徒步路线 AI Demo Implementation Checklist

This file records the current P0 implementation split for the first demo loop.

## Current Demo Rule

- Outer UI can be heavily mocked to express the final product direction.
- The most important real interaction is: a user can open one route and successfully start it.
- Route story, share card, and visual polish support the walkthrough, but they are secondary to the start action.

## Dependency Labels

- Route fixtures: `local-data`
- Demo map context layers: `local-data`
- GPX upload preview: `local-file`
- Real-time third-party map/routing API: not used in this demo flow

## P0 Breakdown

- [x] Add a route catalog backed by local GPX fixtures in `beijing_test_gpx_routes/`
- [x] Add a dedicated GPX parser that keeps timestamps and elevation when present
- [x] Add route analysis helpers for distance, duration, loop detection, difficulty, and stop detection
- [x] Add a mock AI route copy generator independent from UI code
- [x] Add a route list page at `/`
- [x] Add a route detail page at `/routes/<route_id>/`
- [x] Make one demo route startable from the detail page
- [x] Make one demo route finishable from the detail page
- [x] Show recent walk records on the route detail page
- [x] Add a share-card section for screenshot-style presentation
- [x] Add a GPX upload preview page at `/upload/`
- [x] Keep the old offline hiking playground available at `/playground/`

## Next Sensible Steps

- [ ] Add helper-function tests for GPX parsing and route analysis
- [ ] Polish route-card layout and copy interactions
- [ ] Add better empty/error states for mobile walkthroughs
