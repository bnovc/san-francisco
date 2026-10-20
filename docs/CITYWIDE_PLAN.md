# Citywide SF expansion plan

This document is the engineering plan. A coarse SF runtime base now exists; [CITY_BASE.md](CITY_BASE.md) records its source snapshot, implementation, and limits. Union Square remains the only detailed gameplay slice. The goal is a continuous, walkable/drivable San Francisco and an open building atlas: every building should have a source-backed massing record, while contributors can progressively add accurate façades and interiors for selected public, commercial, or explicitly consented places. The project uses no billed map or 3D-tile service at runtime.

## What we inherited and what is repeatable

The base scene comes from [PhiloLabs' Union Square world](https://github.com/PhiloLabs/fable51-worlds/tree/main/union-square-sf) (MIT code/generated assets). Their [README](https://github.com/PhiloLabs/fable51-worlds/blob/main/union-square-sf/README.md), [original brief](https://github.com/PhiloLabs/fable51-worlds/blob/main/union-square-sf/PROMPT.md), and [QA report](https://github.com/PhiloLabs/fable51-worlds/blob/main/union-square-sf/FINAL_QA_REPORT.md) describe the process: OSM geometry, USGS elevation, agent-assisted research, Blender-generated asset kits, hand-authored façade specs, code-built hero interiors, and photo-matched QA. The reusable parts are the asset kit, façade engine, data conventions, and validation technique. The two interiors are bespoke, not generated from a public inventory of SF interiors.

The detailed Union Square scene is approximately 800 × 720 m, with 453 OSM building footprints in its source data. The coarse runtime city base contains 167,941 OSM way footprints in 831 nonempty tiles. DataSF publishes an older citywide [building-footprint dataset](https://data.sfgov.org/d/ynuv-fyni) with about 177,000 footprints and Z-related attributes; it has **not** been imported. Loading all city geometry, collisions, crowds, and detail at once is still not viable.

The citywide effort is also a contribution program, not only an importer. [Open City Model](https://github.com/opencitymodel/opencitymodel) can provide open LoD1-style massing; [DataSF building footprints](https://data.sf.gov/Geographic-Locations-and-Boundaries/Building-Footprints/ynuv-fyni) and [building permits](https://data.sf.gov/Housing-and-Buildings/Building-Permits/i98e-djp9) provide public geographic and change evidence; [SF Survey](https://sfplanning.org/project/sf-survey-citywide-cultural-resources-survey) provides historic and cultural research; and contributor-owned or explicitly licensed imagery can support façade work. None of these sources alone proves a detailed façade or interior. The contribution contract is in [BUILDING_CONTRIBUTION_GUIDE.md](BUILDING_CONTRIBUTION_GUIDE.md).

## Fidelity tiers

| Tier | Coverage | Contents | Evidence bar |
| --- | --- | --- | --- |
| 0: city base | All accessible SF | Terrain, roads, parks/water, building footprints and approximate heights, coarse façades | Correct geography and navigability; uncertainty in height/appearance recorded |
| 1: neighborhood | Selected traversable corridors | Better façade families, streetscape, traffic rules, vegetation, named landmarks | Several ground-level reference views and source-backed street identity |
| 2: hero block | Small, chosen sites | Individually authored façades, signs/storefronts, interaction, perhaps an interior | Multi-view review; explicit source/confidence for tenants and layout |
| 3: consented interior | Public, commercial, institutional, or owner-approved spaces | Evidence-backed interior shell, public rooms, interactions, and privacy controls | Explicit access/consent basis, interior evidence, collision/navigation QA, and source review |

Do not hand-model every building from scratch. Use tier 0 for complete coverage, reusable façade families for neighborhood progress, and tier 2/3 contributions where missions, 311 tasks, cultural value, public access, or recognizable destinations justify the evidence and review effort. No interior becomes “accurate” merely because the exterior footprint is known. Most private interiors should remain closed or generic unless reliable evidence and permission support more.

## Open building atlas model

The canonical unit of collaboration is a building package keyed to a stable geographic feature ID. A package may improve geometry, façade, storefronts, landmark details, or an interior without replacing the underlying city base. It must carry evidence, dates, confidence, review status, and licence/credit metadata with the asset.

Use three source classes in the pipeline:

1. **Importable sources:** open geographic datasets, public-domain records, and explicitly licensed assets that can be stored or transformed after a licence review.
2. **Contributor sources:** photographs, measurements, scans, drawings, or models supplied by a contributor with a written project licence and rights confirmation.
3. **Reference-only sources:** Google Street View, Apple Maps imagery, real-estate listing photos, screenshots, and other proprietary or unclear material. These may identify research leads only; they are not to be scraped, cached, shipped, used for model training, or quietly traced into project assets without separate permission and review.

The project should publish a coverage map and an asset registry showing which buildings are massing-only, façade-detailed, verified, or interior-enabled. This makes partial progress useful and gives contributors a concrete next building to claim.

## Target architecture

1. **Canonical geography.** Keep WGS84 IDs/coordinates in source records. Choose and document one citywide projected metric frame (prefer a suitable SF projected CRS, with tile-local origins for GPU precision). Migrate the current Union Square local frame with fixture tests; do not silently change `geoToLocal` values.
2. **Offline importer.** Version downloaded source snapshots and transformation scripts. Convert OSM/DataSF roads, footprints, elevations, and selected POIs into deterministic, clipped area/tile outputs. Preserve source IDs, timestamps, licences, and confidence. Never query a metered service on player load.
3. **Tiles and LOD.** Partition the city into measured cells (initial experiment: 250–500 m across, tune by profiling). Stream nearby terrain/roads/coarse buildings; load detailed façades/props only in an inner ring; keep distant skyline as very low-detail silhouettes. Define load/unload ownership for meshes, textures, collisions, nav, traffic, and interactions. Add cache and memory budgets based on measured browser performance.
4. **Road graph, not a rectangular grid.** Streets in `World.makeStreetSpecs()` are hand-written axis-aligned segments; that cannot represent the Mission, waterfront, Golden Gate Park roads, diagonals, or hills. Generate street geometry and lane/sidewalk graphs from real polylines, with authored overrides for tricky intersections, transit, and pedestrian spaces.
5. **Reusable styles and contributor packages.** Extend the existing building/facade kit by architectural family. Keep specific landmarks/interiors as modular overrides keyed to stable geographic feature IDs, not hardcoded into the city base importer. Publish a package schema, coverage registry, review queue, and attribution export.
6. **Evidence and rights.** Keep source observations separate from inference. Store source URLs/file IDs, retrieval or observation dates, licences, supported claims, confidence, and reviewer status. Never treat a public URL as a licence grant.
7. **Simulation scope.** Simulate pedestrians, traffic, and 311 gameplay only near active players. Store state in geographic coordinates so crossing a tile boundary does not teleport or duplicate entities. Multiplayer is a separate network design; this plan does not implement it.

## Current code boundaries to refactor

- `src/world/Terrain.ts` and `src/world/World.ts` retain the fixed Union Square legacy scene. `src/world/CityBase.ts` now streams coarse city tiles around it, but does not refactor the legacy `World.build()` ownership.
- `World.makeStreetSpecs()` and `src/world/StreetGrid.ts` assume locally axis-aligned downtown streets. `src/life/NavGraph.ts` has a bounded graph. `src/life/LaneGraph.ts` depends on those street specs.
- `tools/geo/build_gis.mjs` still builds only the legacy bbox and expects an unbundled `osm_raw.json`; `tools/geo/build_city.py` separately emits coarse city tiles from a dated OSM extract and USGS raster.
- `src/interiors/Apple.ts`, `src/interiors/Nintendo.ts`, and `src/world/DragonGate.ts` use exact local coordinates. They need stable anchor/transform interfaces before changing the global frame.
- `World.stream()` hides façade meshes by distance but does **not** unload their geometry, materials, or collision. It is not a citywide streaming implementation.

## Recommended sequence and gates

**M0 — Baseline and contribution contract.** Preserve Union Square as a golden test area. Add area manifests/source ledgers, the building package schema, licence lanes, coverage states, and repeatable checks. Capture current build and measured performance. This documentation/manifest validation is the beginning of M0, not completion of all QA.

**M1 — One adjacent pilot.** Use the corridor from Union Square through Chinatown toward North Beach to expose hills and streets that do not fit the existing grid. Acquire a small, bounded open-data snapshot; record licences and provenance; render coarse terrain/roads/buildings first. Do not start with storefronts or interiors. Gate: continuous walking across the old/new boundary, sensible road slope and building placement, no seam or invisible collision.

**M2 — Tile ownership.** Replace monolithic `World.build()` with a loader that can load and unload one pilot tile while preserving the existing scene. Gate: stable frame time/memory after repeated border crossings; no duplicate colliders or NPCs.

**M3 — Neighborhood detail and contributions.** Add a sourced Chinatown/North Beach streetscape and a small number of hero landmarks. Reuse/extend façade and BPL kits, then publish bounded building packages for outside contributors to review and improve. Gate: recognizable views from documented photo positions, measured draw calls, no false/dated storefront labels, and every accepted asset has provenance and licence metadata.

**M4 — City base.** A first batch and runtime loader are implemented. The 2026-10-18 snapshot covers a rectangle containing the SF mainland and Treasure Island. Parks and rough water are present; coast, bridges, and tunnels need correction. Basic seam walking was checked on five northbound streets and ground/aerial views were captured at 15th and Market. Gate remains open: traverse more distant routes, repeat tile load/unload profiling, and sample geographic correctness and licensing before calling the base verified.

**M5 — Community coverage and selective polish.** Publish a citywide coverage map, accept façade packages, and choose more tier-1/2/3 areas by gameplay value, public access, cultural value, and contributor interest. Add interiors only case by case; do not promise every building is enterable. Add 311 and multiplayer after stable geographic IDs, streaming, and review workflows exist.

## Budget and risk policy

- No runtime billed maps or hosted 3D tiles. Static local/own-hosted assets are the default. Hosting/bandwidth may still cost money if published at scale; this document does not authorize a paid service.
- Agent/model calls can help research and code authoring, but are not themselves geographic data and may be metered depending on the user's access. Use agents for bounded sectors with independent review, not one prompt per neighborhood with no source audit.
- Respect [OSM attribution and ODbL](https://www.openstreetmap.org/copyright), individual DataSF dataset terms, USGS terms, upstream MIT, and any CC BY asset credit. Keep an attribution screen and machine-readable source records.
- [Mapillary imagery](https://help.mapillary.com/hc/en-us/articles/115001770409-CC-BY-SA-license-for-open-data) may be considered when the exact imagery, attribution, privacy handling, and terms are recorded. Do not assume that a derivative texture or mesh has no share-alike or other obligations.
- Do not ship Google Earth/Street View imagery or meshes. Google Maps terms prohibit bulk download, caching, and creating content from Maps content; do not make those services an input or runtime dependency. Treat real-estate listing images and floor plans as rights-restricted unless the photographer, owner, agent, or other rights holder grants permission.
- Code, geographic databases, photographs, textures, and authored models must retain separate licence records. New models default to CC BY 4.0 or CC0 only when the contributor can grant those rights cleanly.

## Next implementation task

The [data realism execution plan](DATA_REALISM_PLAN.md) records the 2026-10-18 data review and phased work for the 15th and Market pilot. Its [P0 baseline](DATA_REALISM_P0_BASELINE.md) records bounds, a partial route attempt, schemas, source counts, provisional budgets, and a fresh headless browser profile. The route still needs a verified sidewalk waypoint, file-level reference licences remain unchecked, and the aerial view exceeds provisional draw-call and tile caps before importer, terrain, building, or traffic changes.

See [SESSION_HANDOFF.md](SESSION_HANDOFF.md). The next bounded production task is to close the P0 baseline gates, then start P1's isolated importer/schema work. The separate 15th and Market detail plan remains a later, evidence-led task; do not treat the existing address-label prototype as surveyed façades or route data.
