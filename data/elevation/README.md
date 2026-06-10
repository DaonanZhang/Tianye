# Elevation Data

This directory stores local terrain data for the hiking product.

## Layout

- `raw/`: upstream DEM or terrain source files as downloaded
- `derived/`: clipped, sampled, or otherwise transformed project artifacts

## Current Status

- The first demo source is Copernicus DEM GLO-30 for Beijing.
- Raw tiles are expected under `raw/copernicus-glo30/`.
- Sampling into the routing graph is not implemented yet.
