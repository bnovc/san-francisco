# Coarse San Francisco city base

The game now streams a locally bundled tier-0 layer around the player. It covers the WGS84 rectangle **37.700–37.815 N, 122.525–122.355 W**, which contains the SF mainland and Treasure Island plus a small margin outside the city. This is a rough geometry pass, not a survey or a finished drivable city. The existing Union Square scene remains the detailed core and keeps its original coordinate frame.

## Data and reproduction

- OpenStreetMap data: [BBBike's SanFrancisco OSM XML extract](https://download.bbbike.org/osm/bbbike/SanFrancisco/SanFrancisco.osm.gz), downloaded 2026-10-18. SHA-256 `2a4c97087e7f04bef0a92aec0c702894b7400f2abba8233466e77cecc050cd7a`. The latest retained feature timestamp is 2026-10-09T22:54:17Z; this is **not** the extract's publication timestamp. OSM data is ODbL; retain attribution and observe the database share-alike terms. Named building and business features are also retained for text labels.
- Elevation: [USGS 3DEPElevation ImageServer](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer), exported 2026-10-18 as an uncompressed F32 TIFF with `bbox=-122.525,37.700,-122.355,37.815`, `bboxSR=4326`, `imageSR=4326`, `size=1100,940`, `format=tiff`, `pixelType=F32`, `interpolation=RSP_BilinearInterpolation`, and `f=image`. SHA-256 `391d385137297a17717d4ab861c4b858abbd325892bac7f5366bda4d2ed0c415`. Values are bare-earth metres NAVD88. The raster includes no-data cells and broad water surfaces near 0 m.
- Street trees: [DataSF San Francisco Street Tree Inventory](https://data.sf.gov/City-Infrastructure/San-Francisco-Street-Tree-Inventory/tkzw-k3nq), published by San Francisco Public Works under the Open Data Commons Public Domain Dedication and License. Downloaded 2026-10-18; the dataset page reported a 2026-10-13 update. The CSV query selects `treeid,latitude,longitude,species,mapdbh`, orders by `treeid`, and requests up to 200,000 rows. Snapshot SHA-256 `9c0420c731b700f669d048b59550bdea8b6e386a82d62ba7fac4e24158ce6b6c`. The city cautions that some coordinates are missing or imprecise and individual records may lag actual conditions.
- Traffic signals: [DataSF Traffic Signals](https://data.sf.gov/d/ybh5-27n2), SFMTA inventory ID `MTA-0073`, exported from the [GeoJSON API view](https://data.sf.gov/resource/c8ue-f4py.geojson) on 2026-10-18. The catalog reports quarterly GIS updates, SFMTA attribution, and the Open Data Commons Public Domain Dedication and License. The snapshot SHA-256 is `ef8f5186de88bc3aca82960dbcfb4fa52a014ec2806ccb330d8810e6ac26a64a`; its records report `data_as_of` 2024-05-28. The runtime keeps ordinary signals and Caltrans signals outside the authored Union Square core; pending, flashing, beacon, sign, and other related equipment remains source metadata only until it gets a suitable visual treatment.

The city DEM is elevation data, but it is not a complete road-grade dataset: the current 1100 × 940 export spans roughly 15 × 12.8 km, or about 13.6 m per sample. Roads are draped over that terrain surface, so broad inclines are present, but the importer does not retain OSM `incline=*` tags or emit per-segment grade metadata. Useful open follow-ups are a USGS 3DEP 1-meter/S1M detail overlay for terrain and DataSF/SF Planning contour and steep-slope layers for QA; neither should be treated as a surveyed curb or sidewalk profile without local validation. OSM's `incline=*` tag is directional and may be a useful supplemental signal where mapped, but it is sparse and does not replace DEM-derived grade.

Keep downloaded input files outside the repository. To regenerate with the same snapshots:

```bash
python3 tools/geo/build_city.py \
  --osm /path/to/SanFrancisco.osm.gz \
  --dem /path/to/sf-3dep-dem.tif \
  --snapshot-date 2026-10-18
curl -L --fail -G 'https://data.sfgov.org/resource/tkzw-k3nq.csv' \
  --data-urlencode '$select=treeid,latitude,longitude,species,mapdbh' \
  --data-urlencode '$limit=200000' --data-urlencode '$order=treeid' \
  -o /path/to/sf-street-trees-2026-10-18.csv
python3 tools/geo/build_street_trees.py \
  --csv /path/to/sf-street-trees-2026-10-18.csv \
  --snapshot-date 2026-10-18
curl -L --fail -G 'https://data.sf.gov/resource/c8ue-f4py.geojson' \
  --data-urlencode '$limit=50000' \
  --data-urlencode '$order=objectid' \
  -o /path/to/sf-traffic-signals-2026-10-18.geojson
python3 tools/geo/build_city_signals.py \
  --geojson /path/to/sf-traffic-signals-2026-10-18.geojson \
  --snapshot-date 2026-10-18
npm run audit:areas
npm run audit:city
npm run build
```

The importer uses Python's standard library. It writes `public/data/city/index.json`, a 0.1 m quantized `dem.bin`, and 420 m JSON tiles. The generated tile set is about 62 MB uncompressed; the initial runtime downloads only the index, DEM, and nearby tiles. The 2026-10-18 output contains 831 nonempty tiles, 283,958 clipped road segments, 167,941 OSM way building footprints, and 14,635 sourced text labels. The importer does not yet assemble multipolygon relations or reconcile duplicate building parts.
The separate tree importer writes about 4.9 MB of compact JSON in `public/data/trees/`: 138,021 trees in 608 tiles from 144,519 inventory rows. It excludes 5,755 records without usable coordinates/ID, 739 in the authored Union Square core, and four outside the base bbox. Tree IDs remain in the tiles; species are reduced to broadleaf, conifer, or palm-like shapes and DBH to four approximate visual sizes. Neither DBH nor species proves crown height or current appearance.
The signal importer writes compact JSON in `public/data/signals/`: 1,256 active signal locations in 353 tiles from 1,507 inventory rows. It excludes 47 signal records inside the authored Union Square core and 204 flashing, beacon, pending, future, sign, and other related-equipment records. Each active location renders four coarse corner signal posts using the shared asset and a generic 60-second cycle; the source inventory does not provide the full live controller timing plans used by the City.
`npm run audit:city` checks tile references, coordinates, counts, unique tree IDs, and DEM size; it does not certify roads, elevation, tree locations, or visual likeness.

## Runtime behavior

`src/world/CityBase.ts` loads tiles within roughly 840 m of the camera and releases tiles, geometry, and building collision walls after moving more than roughly 1.26 km away. Roads and footpaths follow OSM polylines; road widths are rough defaults unless an OSM width tag parses. Simple sidewalks and building extrusions are generated locally. Exact OSM heights are distinguished from level-based and default inferences in tile records. Park and water polygons use OSM ways. The full OSM geometry is never requested at runtime; the game makes no billed map or tile-service calls.
Coarse buildings use stable ID-based colors, dark ground-floor bands, roof edges, and a repeating generic window texture to make blocks easier to read. Those details are stylized placeholders, not evidence of actual paint, windows, entrances, addresses, or tenants.
Named OSM buildings and named business POIs are rendered as small batched text panels on nearby façade edges. A POI is matched to a footprint when it falls within 45 m; the label remains a map-data cue when the source does not provide a reliable footprint match. Labels are intentionally text-only—no third-party logos or imagery—and identify what the 2026-10-18 OSM snapshot mapped, not a guarantee that a business or tenancy is current. For example, the snapshot maps the Chase bank at 2112 15th Street (`way/261145414`), so it now appears as a distinctive label near 15th and Market.
Four named building labels in the 15th and Market pilot also show address subtitles from exact OSM way tags: Chase, Cafe du Nord, Century, and Duboce Apartments. Their source records and inferred street-facing panel anchors are in `src/data/market15AddressLabels.ts`; `data/areas/15th-and-market.json` records the pilot source and bounds. OSM way edit dates range from 2020 to 2024, and these panels do not certify current tenants or surveyed sign positions.
Street trees use the same tile lifecycle and local coordinate frame. Simple instanced trunks and canopies stand at DataSF coordinates on the terrain, with trunk collision. The inventory covers recorded street trees, not all park vegetation or every tree currently present. Shapes and sizes are stylized estimates; placement can be inaccurate where source coordinates are imprecise.
Traffic signals use the same lifecycle but do not yet affect city-base cars or pedestrians; those agents remain ambient and are not a citywide traffic simulation. The four-post corner layout is a coarse visual approximation, especially at diagonal intersections, while the detailed Union Square signal system remains authoritative in its legacy core.

The city layer uses the existing `union-square-local-v1` frame for compatibility. Terrain at the legacy `[-420,420]` square uses the authored Union Square heightfield. Outside, 3DEP elevations blend to that edge over 80 m. Four central city tiles are omitted to avoid duplicate geometry. This frame is adequate for the first basic pass but should be compared to a citywide projected metric CRS before fine survey alignment.

## Known limits before neighborhood detail

- The rectangular data extent is not clipped to SF's municipal boundary; the far edge can include nearby places. Coastline masking is approximate: low 3DEP cells without nearby OSM land features show the sea plane. Piers, reclaimed land, and waterfront transitions require local inspection.
- Bridges receive a rough 2.5 m visual lift, without engineered deck profiles or bridge collision floors. Tunnels are omitted from surface road geometry. Road connectivity, lane rules, pedestrian access, and grades are not yet represented as a citywide graph. Downtown traffic and pedestrians still use the legacy Union Square simulation.
- OSM way footprints omit some multipolygon buildings and can differ from current structures. Missing heights use 10 m (6 m for small outbuildings). Text labels cover named OSM features only; unnamed businesses, unmapped businesses, stale names, and exact storefront placement remain unresolved. They are not surveyed façades or a complete business directory. The 15th and Market area is a suitable next detail target, but its present appearance is intentionally generic apart from these map-data cues.
- The browser camera's 3 km far plane and nearby tile loading favor local exploration. The UI offers jumps to several destinations; it does not yet provide a city map, route planner, or continuous vehicle journey across SF.

Next: inspect 15th and Market's road geometry, transit space, and grade against source-backed ground views; then produce a bounded area manifest with dated references and author only the blocks needed for the next game scenario. The bundled OSM extract has shared Market/15th Street nodes at `37.7660246, -122.4307163` and `37.7660108, -122.4309628`; the **Explore…** spawn is on a nearby footway at `37.766121, -122.430968`.
