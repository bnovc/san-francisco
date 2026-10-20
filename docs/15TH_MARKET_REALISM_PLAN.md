# 15th, Sanchez, and Market realism plan

Status: planned, 2026-10-19. This is a bounded visual and navigation plan for the junction and its immediately visible blocks. It supplements [DATA_REALISM_PLAN.md](DATA_REALISM_PLAN.md); none of the changes below are implemented by this document. The user-provided comparison photo is reference-only, has no supplied capture date or reuse licence, and is not stored in the repository.

## Target and evidence rule

Build a recognizable, walkable **present-day** 15th/Sanchez/Market junction, with 2175 Market as its focal building. Match the reference photo's camera position and major silhouettes for visual QA, but verify current geometry independently. [SFMTA's Upper Market Street Safety Project](https://www.sfmta.com/projects/upper-market-street-safety-project) reports 2021–23 work at 15th/Sanchez, including bulbouts, signal changes, palm maintenance, and decorative crosswalks. The photo may show an earlier layout. Record capture or observation dates for every detailed claim. Use locally bundled, licensed data and assets; no billed map service or runtime imagery.

Pilot planning bounds are recorded in `data/areas/15th-and-market.json` (`37.7635–37.7675`, `-122.4345–-122.4285`). They include the proposed 15th/Sanchez/Market–16th/Noe loop and overlap the `x=-2520 m` and `z=2100 m` tile seams; they are not a surveyed detail footprint. See [the P0 data baseline](DATA_REALISM_P0_BASELINE.md) for route and camera recipes. The manifest is metadata; the runtime does not consume it. Preserve the existing Union Square coordinate frame and tile seam.

## Verified baseline and open questions

| Feature | Current evidence | Consequence / question |
| --- | --- | --- |
| 2175 Market | The mapped OSM point at approximately `37.76633, -122.43007` projects to local `(-2348.2, 2044.9)` in city tile `-6_4`. No bundled building polygon contains that point; the nearest polygon edge is about 30 m away. The architect describes a six-level, stepped mixed-use building with a courtyard and roof deck. [Architect sheet](https://www.vmwp.com/wpress/wp-content/uploads/221004-1113-2175_Market-1Page.pdf); [Planning Commission drawings](https://sfplanning.s3.amazonaws.com/commissions/cpcpackets/2012.0110CEVc2.pdf). | Determine whether the footprint is absent from the dated OSM extract, encoded as a relation dropped by `tools/geo/build_city.py`, or mismatched to the address. Do not assume the cause from the rendered gap alone. |
| Road and sidewalk | `src/world/CityBase.ts` renders road polylines as constant-width ribbons and adds 1.8 m strips along both sides. It does not author the multi-leg junction or markings. | Overlaps and generic strips cannot express the curb, crossings, median, transit space, and painted guidance visible at this site. |
| Trees | `tools/geo/build_street_trees.py` reduces species to three forms and DBH to four inferred size classes. `src/world/CityBase.ts` gives palms a nine-direction triangle crown. Tree IDs `228278`–`228286` share the exact bundled coordinate `(-2345.6, 2042.7)`. | Inspect the source records before deduplication or relocation; they may represent multiple plants recorded at a shared address. Replace nearby palm silhouettes with a measured, budgeted local asset/LOD. |
| Signals and lighting | `src/world/CitySignals.ts` places four posts at fixed ±6.3 m offsets and a cardinal orientation. The coarse city has no matching streetlight pass. | Survey actual approach directions, mast positions, pedestrian heads, and ornamental lamp positions. Existing generic signals must be replaced or suppressed within the detail footprint to avoid duplicates. |
| Transit | `tools/geo/build_city.py` retains selected `highway` ways but not rail geometry. SFMTA lists the [F Market & Wharves stop at Market and Sanchez](https://www.sfmta.com/stops/market-st-sanchez-st-15691). | Import or author the short rail alignment, boarding area, and overhead support layout before adding a moving streetcar. |
| Neighbors and appearance | City buildings use OSM massing with a repeating window texture and ID-based palette. The reference photo shows distinctive stepped façades, material changes, local lamps, and dense street detail. | Improve only the visible blocks after the focal building and junction are correct. Existing OSM address labels are source-snapshot cues, not façade or tenant verification. |

## Execution sequence

### 0. Reproducible comparison and source package

1. Record a game street camera matching the user's photo as closely as possible: WGS84 and local position, eye height, heading, pitch, FOV, light preset, and viewport. Also record one aerial camera and a short walking loop across the junction and a tile edge.
2. Build a compact evidence table for each claimed feature: source URL/ID, capture or publication date, retrieval date, licence/reuse lane, what it proves, and confidence. Treat the supplied photo, architect imagery, and planning drawings as visual references unless reuse rights are established; do not ship them as textures or meshes.
3. Inspect the original 2026-10-18 OSM snapshot for 2175's way/relation and tags. Compare a small DataSF footprint extract and the published site plan; identify one stable feature/package ID and the exact polygon to render. Record current road, tree, and signal IDs within the pilot, including the nine co-located tree records.
4. Establish warmed-up street/aerial FPS or frame time, draw calls, triangles, loaded tiles, and memory where available on a named browser/device. Set budgets before new assets are added.

**Gate:** a reproducible pair of views, dated evidence, a resolved footprint diagnosis, and baseline measurements. Update the area manifest's source refs only when a new source is actually used.

### 1. 2175 Market building package

1. Restore the missing building footprint through a narrow, source-backed correction or an importer fix, based on the P0 diagnosis. Keep the city-base massing and detailed package keyed to the same stable geographic identity so they cannot render twice.
2. Model the site's triangular/stepped silhouette and grade-dependent entries first. Add the corner metal-clad mass, white adjacent volumes, glazing, balcony/window rhythm, ground-floor openings, and roof/courtyard form only to the level supported by dated evidence. Use authored materials and textures; do not copy restricted photos.
3. Add collision and inspection metadata; keep uncertain current retail labels neutral. Validate from the matched street camera and the aerial camera before polishing neighboring façades.

**Gate:** the empty site is filled, the primary silhouette reads correctly from both cameras, collision follows the building, and source/confidence fields distinguish observed from inferred details.

### 2. Junction, road surfaces, and markings

1. Author a bounded intersection surface and grade profile for Market, 15th, Sanchez, and the adjacent approaches. Define curb edges, ramps, 2021–23 bulbouts, refuge/boarding space, and sidewalk connections explicitly; use the SFMTA project as a lead and verify positions against dated plans or permissible ground views.
2. Place crosswalks, stop bars, lane guidance, bike markings, and decorative treatment in world space, aligned to the actual crossing endpoints. Keep road paint just above the road surface without z-fighting or floating on slopes.
3. Connect visual surfaces to walking/collision and local path data. Suppress overlapping generic road and sidewalk ribbons only inside the owned detail footprint, with a clean transition to adjacent base tiles.

**Gate:** crossings and curb shapes are plausible from street and aerial views; walking and tile-edge traversal show no holes, invisible barriers, duplicate surfaces, or ground/collision seams.

### 3. Palms, lamps, signals, and rail identity

1. Review the co-located tree IDs in the original Public Works inventory. Apply an explicit, ID-based placement/suppression correction only where evidence supports it. Retain provenance and avoid changing the citywide source blindly.
2. Replace nearby palm crowns with a recognizable trunk and drooping fronds at measured LODs. Use species information where available; keep inferred height/canopy size labeled as such. Add ordinary street trees and planters only at supported positions.
3. Place the characteristic ornamental streetlights and actual signal heads by approach; remove the generic four-corner instances in the detail footprint. Use a local, clearly simulated controller until timing evidence exists.
4. Add the short F-line rail section, stop/boarding cues, and sparse overhead wire/support geometry. A streetcar can follow once the rails and intersection conflict rules are sound.

**Gate:** the palms, lamps, signals, and rail corridor read correctly from the matched street camera; poles and trees leave pedestrian clearance; no duplicates appear at tile load/unload.

### 4. Adjacent façades, lighting, and life

1. Improve only neighboring buildings that frame the reference view, using stable IDs and evidence-backed façade families. Keep unverified storefronts and interiors neutral.
2. Tune road/concrete materials, sky, sun/exposure, shadows, and camera FOV against the matched view without hiding geometry errors with post-processing.
3. Route local pedestrians, cars, and an occasional F-line car through the corrected geometry. Add one-way, crossing, and signal behavior only after the physical path graph is coherent.

**Gate:** a reviewer can identify the junction and 2175 from the matched street view without relying on a label; aerial geometry, walking, crossing behavior, and repeated tile loads pass. Record before/after performance against P0 budgets.

## Implementation boundaries and handoff

Likely owned paths are a new 15th/Market detail package, its provenance record, and narrowly scoped city-layer hooks. `tools/geo/build_city.py`, `src/world/CityBase.ts`, `src/world/CitySignals.ts`, `public/data/`, and `docs/SESSION_HANDOFF.md` are shared/high-contention paths: coordinate and inspect their current content immediately before each edit. Regenerate data from its source and generator; never hand-edit generated city tiles or `dist/`.

For each implemented phase, run targeted checks plus `npm run audit:areas`, `npm run audit:city`, and `npm run build`. Any visual/navigation change also needs a real street-level and aerial check in this area, plus a walking seam check where relevant. Update the area manifest, source ledger, and session handoff with exact results and remaining uncertainty. A successful build alone is not a fidelity claim.

**Next bounded task:** execute phase 0 only, beginning with the 2175 footprint diagnosis and saved reference cameras. That result determines whether phase 1 needs an importer correction, a source-data addition, or a local building override.
