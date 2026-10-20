# Adding a San Francisco area

This is a repeatable production workflow, not a one-command detailed neighborhood generator. Read [CITYWIDE_PLAN.md](CITYWIDE_PLAN.md) for the architecture, [CITY_BASE.md](CITY_BASE.md) for the existing coarse tiles, [BUILDING_CONTRIBUTION_GUIDE.md](BUILDING_CONTRIBUTION_GUIDE.md) for the asset/evidence/licence contract, and [SESSION_HANDOFF.md](SESSION_HANDOFF.md) for the current milestone. Area manifests in `data/areas/` are **metadata only**; the game loads city tiles through `public/data/city/index.json`.

## 1. Choose a bounded pilot

For the next detail pass, start with a bounded 15th and Market area. Draw a WGS84 bounding box and write the expected walking route and 3–5 reference viewpoints. Include overlap with adjacent base tiles so seams can be tested. Keep authored detail small enough to inspect building-by-building. Do not equate a neighborhood name with a precise data boundary.

Copy `docs/templates/area-manifest.example.json` to `data/areas/<kebab-case-id>.json`, fill its required fields, and run `npm run audit:areas`. Use `status: "planned"` until source files actually exist. The validator checks provenance metadata and file references; it does not generate geometry or certify visual accuracy.

## 2. Record and acquire sources

For each source, record the exact dataset/revision URL, publisher, retrieval date, licence, coverage, and what fields are used. Keep a source snapshot or reproducible download instruction outside the shipped game. Prefer open sources such as OSM for roads/footprints, USGS 3DEP for terrain, DataSF building permits and surveys for cross-checks, Open City Model for LoD1 massing, Mapillary imagery where its CC BY-SA licence and terms are followed, and per-file open images from Wikimedia Commons. Check each dataset's current terms before use. Do not import Google/Apple/Mapbox street imagery or proprietary 3D mesh exports. Do not bundle real-estate listing photos or floor plans without an explicit licence from the rights holder. “Free to view” is not necessarily reusable.

Keep geographic features' source IDs and WGS84 coordinates. Label measured/surveyed facts separately from inference. The coarse tiles distinguish an OSM `height` tag, inferred `building:levels` height, and default-height guess; preserve that distinction in detail work. Date-sensitive storefront names need their own observation date; if uncertain, use a neutral façade.

When street-level imagery is needed, prefer a contributor's own photographs or an explicitly licensed source. Record the view direction, capture date, photographer, licence, and the exact claim supported. Reference-only imagery may help a contributor find a detail, but it must not be scraped, cached, shipped, or silently traced into a model. See [BUILDING_CONTRIBUTION_GUIDE.md](BUILDING_CONTRIBUTION_GUIDE.md) for the source lanes.

## 3. Build a coarse, traversable layer first

The coarse city base currently uses the legacy `union-square-local-v1` frame and tile-local render offsets; see `src/geo/geo.ts` and `src/world/CityBase.ts`. Do not silently reinterpret its local `x/z` coordinates. Compare this frame against a projected citywide metric CRS before survey-level alignment.

Clip roads and terrain with overlap at area edges, construct road/sidewalk graphs from polylines, and place coarse building masses using footprints and defensible heights. Keep elevation datum and units explicit. Stable source IDs must survive clipping so cross-border segments and buildings are not duplicated. The present `tools/geo/build_gis.mjs` is tied to one bbox and a raw OSM file that is not checked into this repo; it is a reference, not yet a citywide importer.

Test continuous walking across the old/new boundary before adding façades. Check seams, slopes, collision, road connectivity, navigation, missing ground, and duplicate objects. Profile load time, frame time, draw calls, and memory. A successful TypeScript build is not enough.

## 4. Add detail where it pays off

Reuse the architectural kit in `tools/bpl/` and the façade system in `src/world/facade/`. First assign broad SF building families, then improve a few documented street-level sightlines. Create distinct hero assets only for places worth a separate QA pass. Capture reference location, camera direction, date, author/licence, and the specific claims it supports; avoid redistributing photos without rights.

An agent such as Astra can help with a **bounded block package**, but should not be asked to hallucinate a whole neighborhood. Give it the area bbox, stable source feature IDs, available elevation/footprint data, permitted reference URLs, existing façade schema, and a triangle/texture budget. Ask for (1) proposed façade/asset specs keyed to those IDs, (2) an evidence table distinguishing observed details from inference, (3) unresolved questions, and (4) reproducible scripts or edit files. Have another pass check coordinates, source rights, visible likeness, and in-game screenshots before accepting the package. Keep uncertain features generic. Agent output is authored content, not an authoritative geographic or interior survey, and model use may have its own cost outside the no-billed-map-service requirement.

For a community contribution, package each building by stable feature ID with its geometry, intended LODs, evidence links, confidence labels, review screenshots, credits, and asset licence. Publish unclaimed buildings and current coverage states so contributors can choose a next building. Accept a package only after the source and rights review is complete; a technically attractive model without provenance is not ready for the shared atlas.

Interiors are individual authored projects. The present Apple and Nintendo spaces do not imply a source of citywide interior scans. A publicly visible entrance or real-estate listing is not evidence of an accurate or reusable floor plan. Prioritize public, commercial, institutional, or owner-approved spaces; require an explicit access/consent basis and interior evidence; and leave private or uncertain buildings closed or clearly generic.

## 5. Validate and hand off

Run `npm run audit:areas` and `npm run build`. For visual changes, inspect a ground-level and an elevated view, plus the old/new seam. Record mismatches and known uncertainty rather than marking them complete. Keep credits and required attributions in the UI/export plan; see [SOURCES_AND_ASSETS.md](SOURCES_AND_ASSETS.md).

Update the area manifest's `status`, `dataFiles`, and `sourceRefs`, then update [SESSION_HANDOFF.md](SESSION_HANDOFF.md) with exact commands, observed results, unfinished work, and the next bounded step. Do not mark `verified` until traversal, source review, and visual QA actually pass.
