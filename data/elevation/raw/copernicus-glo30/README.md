# Copernicus DEM GLO-30 Beijing Demo

## Purpose

This folder stores the first local elevation source downloaded for the Beijing routing demo.

## Source

- upstream dataset: Copernicus DEM GLO-30
- delivery method: AWS Open Data public bucket
- helper script: `scripts/download_beijing_copernicus_dem.sh`

## Downloaded Tiles

- `Copernicus_DSM_COG_10_N39_00_E115_00_DEM.tif`
- `Copernicus_DSM_COG_10_N40_00_E115_00_DEM.tif`
- `Copernicus_DSM_COG_10_N39_00_E116_00_DEM.tif`
- `Copernicus_DSM_COG_10_N40_00_E116_00_DEM.tif`

These tiles cover the current Beijing demo bounds, including Fangshan.

## Notes

- `README.upstream.html` is the downloaded upstream readme snapshot.
- The current project environment does not yet have `gdal` or `rasterio`, so these raw tiles are present before the sampling step is implemented.
- This is demo-scoped ingestion that is intended to graduate into the permanent local elevation workflow.
