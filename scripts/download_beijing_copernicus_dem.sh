#!/usr/bin/env bash

set -euo pipefail

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="$BASE_DIR/data/elevation/raw/copernicus-glo30"
BASE_URL="https://copernicus-dem-30m.s3.amazonaws.com"

mkdir -p "$OUTPUT_DIR"

tiles=(
  "Copernicus_DSM_COG_10_N39_00_E115_00_DEM"
  "Copernicus_DSM_COG_10_N40_00_E115_00_DEM"
  "Copernicus_DSM_COG_10_N39_00_E116_00_DEM"
  "Copernicus_DSM_COG_10_N40_00_E116_00_DEM"
)

for tile in "${tiles[@]}"; do
  echo "Downloading $tile"
  curl -L --fail --silent --show-error \
    "$BASE_URL/$tile/$tile.tif" \
    -o "$OUTPUT_DIR/$tile.tif"
done

curl -L --fail --silent --show-error \
  "$BASE_URL/readme.html" \
  -o "$OUTPUT_DIR/README.upstream.html"

echo "Downloaded Copernicus DEM tiles into $OUTPUT_DIR"
