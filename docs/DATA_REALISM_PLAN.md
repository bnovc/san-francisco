# Data realism execution plan

Status: P0 preparation implemented 2026-10-19; a fresh headless Chromium capture is recorded, but the aerial view exceeds provisional draw-call and tile caps. The P0 gate remains open for route traversal, file-level licence review, and an aerial performance follow-up. P1–P5 remain planned. Prepared 2026-10-18 from the code/data review and online source research. Recheck the shared tree and source metadata before each phase; this document does not claim completed imports or verified geographic fidelity.

Read [CITYWIDE_PLAN.md](CITYWIDE_PLAN.md), [AREA_WORKFLOW.md](AREA_WORKFLOW.md), [CITY_BASE.md](CITY_BASE.md), [SOURCES_AND_ASSETS.md](SOURCES_AND_ASSETS.md), and the latest [SESSION_HANDOFF.md](SESSION_HANDOFF.md) before starting. Keep Union Square's authored scene and coordinate anchors working throughout.

## Objective and priorities

Improve recognizable streets, hills, building silhouettes, vegetation, and movement using locally bundled open data. Start with a bounded 15th and Market pilot. Preserve more of the existing OSM information, add targeted authoritative sources, and measure the result before expanding coverage. No billed map service or runtime external data dependency is required.

Execute P0 first, then P1. P2 and P3 can be separate bounded tasks once their shared schema is stable; integrate both before P4. P5 is optional follow-up work after the pilot passes its gates. This sequence supplements the broader citywide milestones.

## Reviewed baseline

The bundled city index inspected on 2026-10-18 contained 831 tiles, 167,941 buildings, and 283,958 clipped road/path segments. Separate layers contained 138,021 street trees and 1,256 signal locations. Counts describe imported features, not complete or accurate city coverage.

Counting the actual building records gave:

| Height source | Buildings | Share |
| --- | ---: | ---: |
| OSM `height` tag | 141,414 | 84.20% |
| OSM floor-count inference | 854 | 0.51% |
| Default height inference | 25,673 | 15.29% |

An OSM height tag is not a surveyed/current-height guarantee. The [documented SF OSM height import](https://wiki.openstreetmap.org/wiki/San_Francisco_Building_Height_Import) used 2010 LiDAR-derived data. Prefer targeted height corrections and better roof/building-part geometry over replacing every footprint.

Code findings to recheck before implementation:

- `tools/geo/build_city.py` drops relations, does not explicitly assemble building parts, and discards most road rules and original node connectivity. Its road whitelist omits `*_link` classes. Surface categories collapse beaches, woodland, and other land uses into `park`.
- `src/world/CityBase.ts` renders flat building roofs, a 21 m terrain grid, road subdivisions around 12 m, default 1.8 m sidewalks, and a fixed 2.5 m visual bridge lift. Waterfront masking is heuristic.
- `src/life/CityLife.ts` derives local connectivity from rounded endpoints and creates both travel directions. It does not consume one-way/turn restrictions or the city signal controller.
- Street-tree species/DBH are reduced to three shapes/four sizes. The inventory does not cover all park vegetation.
- Nearby tile streaming and the camera's 3 km far plane constrain skyline visibility.
- At review time, the importer/validator expected schema 2 but `public/data/city/index.json` was schema 1; `npm run audit:city` failed. Label-related code was present, while the inspected tiles had no labels. Treat this as a coordination issue to recheck, not authorization to overwrite another task's generated output.

Later validation while saving this plan passed `npm run audit:city`: the shared tree had advanced to the expected schema and contained 14,635 sourced labels. That concurrent implementation was not reviewed by this documentation task. The earlier mismatch is historical context, not a currently reproduced blocker.

## Candidate sources

Links and metadata were reviewed on 2026-10-18. These sources have not been imported by this plan. Record exact files, source observation dates, retrieval dates, checksums, coverage, units, CRS/datum, and applicable terms when acquiring them. Catalog update dates are not observation dates.

| Source | Proposed use | Limits and integration decision |
| --- | --- | --- |
| [2023 USGS SF DEM](https://www.fisheries.noaa.gov/inport/item/73506) | Terrain detail and grade profiles for the pilot | 0.25 m bare-earth DEM; collected 2023-04-20. Original files use SF CS13 / NAD83(2011), metres, and NAVD88/Geoid18 heights. Confirm actual tile coverage and download-specific CRS; retain coarse fallback outside coverage. Produce runtime LODs instead of shipping full-resolution citywide rasters. |
| [2023 USGS SF LiDAR](https://www.fisheries.noaa.gov/inport/item/73386/full-list) | Roof-height/shape estimates, vegetation structure, bridge-deck evidence | Free downloads/EPT subsets; process offline. Listed classes do not provide ready-separated building and vegetation classes. Roof reconstruction needs segmentation and vegetation rejection; a point cloud is not a textured city model. |
| [SF street centerlines and nodes](https://sfdigitalservices.gitbook.io/data-standards-guide/standard-reference-data/basemap/street-centerlines-nodes) | Intersection connectivity and CNN identifiers for joining municipal records | Match to OSM using geometry and explicit crosswalks; municipal segments and OSM ways are not one-to-one. Keep source IDs and match confidence. |
| [Curb ramps](https://catalog.data.gov/dataset/curb-ramps) and [parking meters](https://catalog.data.gov/dataset/parking-meters) | Pilot intersection detail and street furniture | Catalogs list PDDL. Ramp data is a planning inventory with accuracy caveats; meter data needs active-record filtering. Validate placement and avoid obstructing walking paths. |
| [SFMTA GTFS](https://www.sfmta.com/reports/gtfs-transit-data) | Stops, route shapes where available, and scheduled local transit activity | Scheduled, not real-time service. Review the specific SFMTA agreement, required notices, and logo restrictions. Validate feed service dates; bundle a dated offline subset. |
| [Assessor property records](https://catalog.data.gov/dataset/assessor-historical-secured-property-tax-rolls) | Available building characteristics to guide architectural families | Join parcels to buildings carefully; retain relevant physical characteristics only. Parcel age/use is evidence for a plausible family, not proof of exact façade appearance. Catalog lists PDDL. |
| [Urban tree canopy](https://catalog.data.gov/dataset/urban-tree-canopy) | Baseline for vegetation beyond street-tree locations | Older analysis despite newer catalog metadata. Compare with 2023 LiDAR and inspect coverage before accepting; avoid duplicate canopy around inventory trees. Catalog lists PDDL. |
| [DataSF footprints](https://catalog.data.gov/dataset/building-footprints-05482) | Gap checks and selective height/geometry comparison | Based on 2010 geometry; not independent confirmation of OSM heights derived from the same source. Catalog lists PDDL. Do not replace newer geometry blindly. |
| [Overture buildings](https://docs.overturemaps.org/guides/buildings/) and [Open City Model](https://github.com/opencitymodel/opencitymodel) | Small-area completeness/attribute benchmarks | Compare actual coverage and lineage first. Overture prioritizes OSM and its building parts come from OSM. These products do not establish detailed façades; preserve their applicable ODbL/source obligations. |

For façade references, use the contributor/licensed-image lanes in [BUILDING_CONTRIBUTION_GUIDE.md](BUILDING_CONTRIBUTION_GUIDE.md). Keep uncertain tenants neutral. Public records do not establish reusable interior layouts; interiors remain separate scoped contributions.

## P0 — Establish a reproducible pilot baseline

- [x] Re-read the shared state and verify importer output, validator, and runtime schema expectations. `CityBase` now rejects an unexpected city-index schema, frame, or tile size; no validator check was weakened.
- [x] Define a 15th and Market WGS84 planning bbox with 420 m tile overlap and record the proposed loop and its tile-edge crossings in [the P0 baseline](DATA_REALISM_P0_BASELINE.md). The existing manifest remains `prototype` for its already-present address-label data file.
- [ ] Record 3–5 permissible dated reference viewpoints and a repeatable aerial view. Dated Commons photo candidates and game camera recipes are listed, but the individual photo licences and exact camera positions still need review; the loop has not been walked.
- [x] Record available input hashes, output schema versions, citywide feature/height-source counts, road-width limitations, and geometry already lost by the importer in [the P0 baseline](DATA_REALISM_P0_BASELINE.md).
- [x] Capture warmed-up frame time, draw calls, triangles, loaded tiles, browser resource-transfer bytes, and available JS heap on a stated browser/platform. Results and the aerial cap misses are recorded in [the P0 baseline](DATA_REALISM_P0_BASELINE.md); repeated-loop heap growth and a hardware-accelerated comparison remain open.

Gate: baseline and schema ownership are explicit; required checks have recorded results; pilot bounds, route, references, and budgets are reproducible. Do not start a citywide regeneration to establish this baseline.

P0 status: schema expectations, planning bounds, proposed route, source accounting, provisional budgets, and a fresh headless capture are recorded. Do not begin P1 until the route is traversed, references pass file-level rights review, and the aerial tile/draw-call budget is resolved or explicitly revised from comparable measurements.

## P1 — Retain useful information in the offline pipeline

Likely scope: `tools/geo/`, a documented intermediate schema, targeted fixtures, and coordinated runtime types/validation. Treat these as proposed paths until ownership is established.

- [ ] Add a richer intermediate representation between source snapshots and compact runtime tiles. Preserve stable source IDs, original geographic coordinates/node references, source versions, observation dates where known, licences, and per-field inference/confidence.
- [ ] Preserve road class/link classes, names, widths/lanes, one-way direction including reverse direction, access/mode restrictions, sidewalks/crossings, bridge/tunnel/layer, incline where present, rail features, and relevant route/turn-restriction relations. Report missing-tag coverage; do not assume every field is populated.
- [ ] Assemble polygon relations with holes; preserve building parts, minimum heights, roof attributes, and parent/part relationships. Avoid double-rendering parent volumes and their parts.
- [ ] Keep beaches, woodland, grass, paved plazas, recreation surfaces, water, and coastline distinct. Preserve relevant landmark/POI features with dated provenance.
- [ ] Define deterministic clipping and cross-tile identities. Keep original nodes plus explicit synthetic boundary nodes; never join grade-separated crossings solely because their x/z coordinates coincide.
- [ ] Version importer, intermediate schema, runtime schema, and input checksums together. Generate candidate outputs into an isolated directory, compare manifests/counts, then deliberately promote the owned outputs. Keep raw downloads outside the repository.

Gate: focused fixtures cover holes/building parts, one-way and restricted turns, road links, and tile-boundary continuity; repeated generation is deterministic. Runtime and validator agree on the schema, and the existing Union Square scene still loads.

## P2 — Improve pilot terrain and road surfaces

Depends on P0 and the P1 coordinate/schema contract. Likely scope: a bounded DEM preprocessing tool, pilot elevation tiles, and a coordinated `CityBase.ts` surface change.

- [ ] Acquire only the needed 2023 DEM tiles. Verify geotransform, pixel-center interpretation, no-data, horizontal units, vertical datum, and coverage. Compare control locations against the current local frame; use an explicit transform instead of silently changing `geoToLocal` or legacy anchors.
- [ ] Generate several terrain resolutions with a coarse fallback and fine near-viewer detail. Blend boundaries and ensure the collision surface follows rendered ground within the recorded tolerance.
- [ ] Refine road/sidewalk tessellation according to slope and curvature, not only fixed segment length. Generate longitudinal grade profiles and record inferred versus source-supported values.
- [ ] Model the pilot intersection and sidewalk connections explicitly. Preserve separately mapped footways without adding duplicate sidewalks. Treat DEM data as terrain evidence, not a complete curb survey.
- [ ] Keep bridges/tunnels separate from bare-earth draping. Where encountered, provide a supported deck/profile and walkable surface or clearly record the remaining limitation; a fixed visual lift is insufficient.

Gate: the chosen slope and intersection match recorded evidence within the agreed tolerance; continuous walking and tile-edge probes pass; no ground/collision seams appear in street/aerial inspection; performance stays within the P0 budget.

## P3 — Improve pilot building silhouettes and appearance

Depends on P1; final placement uses P2 elevations. Likely scope: building geometry generation, selected façade specs, and building-package records.

- [ ] Select a small documented set covering a default-height building, a multipart/courtyard case if available, a roof-shape case, and a building on a slope.
- [ ] Render available roof, part, and minimum-height information. Keep evidence-backed OSM heights unless stronger, appropriately dated evidence supports a correction.
- [ ] Subset 2023 LiDAR for selected buildings only. Estimate roof surfaces above local ground, reject vegetation/outliers, inspect results, and record uncertainty. Do not use raw maximum point height as a universal building-height rule.
- [ ] Benchmark DataSF/Overture/Open City Model only for actual pilot gaps. Resolve conflicting or duplicate footprints with explicit matching rules and retain lineage; do not count shared source ancestry as corroboration.
- [ ] Use physical characteristics and permitted references to select reusable SF architectural families. Author a few distinctive façades with evidence records; label procedural appearance as inferred.

Gate: reviewed buildings have source/field provenance, sensible roof and foundation geometry, no overlapping parent/part meshes, working collision, and street/aerial comparisons. Height-source coverage and known date conflicts are reported.

## P4 — Connect streetscape data to believable movement

Depends on P1–P3 integration for the pilot.

- [ ] Match relevant municipal CNN nodes/segments, curb ramps, and active meters to pilot geometry. Orient props from actual street/curb geometry and verify walkable clearance.
- [ ] Build local lane and pedestrian connectivity from preserved nodes and restrictions. Apply one-way/access rules and turn restrictions; keep paths continuous across tile boundaries.
- [ ] Align signal layouts to the intersection and connect a consistent intersection controller to car stopping and pedestrian yielding. Use clearly simulated timing unless timing-plan evidence is available.
- [ ] Test one-way travel, restricted turns, red-light stops, crossing behavior, and repeated tile loading/unloading with targeted runtime probes.

Gate: the walking loop and sampled traffic paths work without wrong-way travel, disconnected crossings, duplicated agents, or growing collision/geometry counts. Visual checks and performance measurements cover the same baseline views.

## P5 — Expand selected identity layers after the pilot passes

Choose one bounded follow-up at a time:

- [ ] Transit: review terms and feed dates, import a local GTFS subset, place sourced stops, and simulate one relevant surface route. Confirm route geometry against tracks/roads; schedules alone do not define a drivable path.
- [ ] Vegetation: retain richer species categories where useful, then evaluate canopy/LiDAR for one park area. Distinguish estimated canopy/height from inventory measurements and prevent duplicate trees.
- [ ] Coast and land cover: test proper coastline masking and distinct surfaces in one Ocean Beach or waterfront tile, including low-lying land and piers.
- [ ] Skyline: add sourced Sutro Tower/Ferry Building proxies in a separate low-detail distant layer. Budget visibility, geometry, and depth precision explicitly; validate a relevant street view and aerial view before raising distance limits broadly.
- [ ] Expansion: apply the proven pipeline to an adjacent bounded area, preserving the pilot and Union Square as regression fixtures.

## Acceptance and handoff for every implementation task

Run targeted checks, then `npm run audit:areas`, `npm run audit:city`, and `npm run build`. Report exact failures and concurrent unreviewed changes. Builds run the legacy data sync; inspect generated outputs and never hand-edit `dist/` or generated city tiles.

For visual/navigation changes, inspect the real game at one relevant street view and one aerial view, plus a boundary traversal where affected. Compare with dated, permissible references before claiming fidelity. Measure the P0 performance counters at the same views and check repeated load/unload behavior. Documentation-only changes need no browser session.

Update the area manifest, relevant source ledger, and a minimal additive session-handoff entry with changed paths, exact checks/results, unresolved uncertainty, and the next bounded task. Keep unsupported tenant, façade, roof, and interior claims explicitly inferred or absent.

## Next task when this plan is resumed

Finish P0 only: check individual photo licences or replace those candidates with contributor-owned views, walk the proposed loop, investigate the aerial tile/draw-call cap misses, and repeat the profiler after those shared runtime edits settle. Then begin P1's bounded importer/schema work. No new geographic dataset was downloaded for this P0 preparation.
