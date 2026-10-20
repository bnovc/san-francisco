# 15th and Market source geometry supplement

Implemented 2026-10-19 as a first fidelity pass under [15TH_MARKET_REALISM_PLAN.md](15TH_MARKET_REALISM_PLAN.md). Buildings still use the generic city renderer. This does not complete the area's realism or survey gates.

The missing 2175 Market building was an import omission. The dated BBBike OSM extract contains `relation/10963754` (`building=apartments`, `height=21`, name `2175 Market`, relation edit `2025-03-23T23:56:09Z`). Its two closed outer ways are `788467764` and `247088219`; neither carries its own building tag. `tools/geo/build_city.py` ignores relations, so neither wing reached the coarse tiles.

`tools/geo/build_area_detail.py` now creates a bounded supplement from the same source snapshot. It assembles ordered/reversed member chains using exact node IDs, retains separate outer rings and courtyard holes, preserves relation/member identity and source height, and extracts street tags, crossing paths, surface tram rails, and platforms. The current output has four building components from three relations and 323 street/rail features. Two components are 2175 Market; the other recovered relations include Everett Middle School and a courtyard building. Tagged member ways are suppressed when their relation renders to prevent duplicate massing. Roof holes and inner collision walls are supported.

The output is `src/data/areas/15th-and-market.generated.json`, imported by `src/world/AreaGeography.ts`. Vite bundles this small JSON supplement; the existing `public/data/city/` tiles and importer are unchanged. The companion [area record](../data/areas/15th-and-market-geography.json) owns this pass's provenance and leaves the concurrent baseline/address manifest intact.

Regenerate from the dated source outside the checkout:

```sh
python3 tools/geo/build_area_detail.py \
  --osm /private/tmp/sf-streets-SanFrancisco.osm.gz \
  --manifest data/areas/15th-and-market.json \
  --out src/data/areas/15th-and-market.generated.json
python3 -m unittest discover -s tools/geo -p test_area_detail.py
```

Review changes to the input manifest bounds before regeneration. Its current extent is `37.7635–37.7675`, `-122.4345–-122.4285`, encompassing the concurrent P0 walking-loop proposal. The generator fails on incomplete building relation geometry rather than closing an invented ring.

The renderer now distinguishes road crossings from concrete sidewalks and respects mapped `sidewalk=separate/no` tags in the pilot. Crossing stripes, rail grooves and rails follow source polylines, and surface platform polygons render. The junction has a connected asphalt envelope inferred from nearby crossing endpoints, tessellated to follow the current terrain. Stripe width/spacing and platform height remain inferred. Zebra paint is a fallback, pending evidence for the present decorative paving and exact curb layout. Contact wires follow OSM's electrified surface tracks at an inferred 5.8 m height; support/feeder equipment is incomplete.

The [SFPUC lamp article](https://www.sfpuc.gov/about-us/news/iconic-path-gold-streetlights-get-brilliant-update) documents the Path of Gold family along Market. The game uses an original, simplified parametric three-lantern model, placed approximately along mapped sidewalks near Market with clearance from crossings and tracks. These are not surveyed lamp locations or an exact reproduction of historic ornament. Lamp meshes are instanced and their bases collide with the player. No external image/model was imported.

`src/world/TreeGeometry.ts` replaces the floating nine-direction palm triangles with curved, layered feather fronds attached to the trunk. Near tiles use a denser crown and farther tiles a simpler one; trunk/crown dimensions remain inferred. Eleven inventory markers fall inside recovered 2175 building volumes and are suppressed at render time: `14302`, `14304`, and `228278`–`228286`. The nine latter records are Ginkgo entries at the exact same source coordinate (`37.766353, -122.430045`), all DBH 3. Their actual planting positions remain unresolved; the source inventory is preserved.

The sun rig also had an origin-dependent direction bug: `TimeOfDay.update()` normalized its absolute world position after moving the shadow rig with the viewer. At 15th/Market this drove the sun toward the horizon and left horizontal surfaces blue/flat. The preset direction is now stored independently, so moving the viewer or shadow target cannot change the selected sun elevation or azimuth.

Focused runtime validation is reproducible with a running isolated Vite server:

```sh
node tools/qa/market15_detail.mjs \
  --url=http://127.0.0.1:5193 \
  --out=/private/tmp/market15-detail
```

The probe checks the two 2175 wings and tagged heights, collision along their source edges, suppression of the nine co-located tree meshes, the new surface/rail/lamp layers, fixed sun direction across distant viewer positions, one mapped crossing walked with collision enabled, and tile unload/reload collision counts. It records street and aerial views plus runtime counters outside the checkout. Run the required area/city audits and build as well.

Remaining work includes surveyed/current curbs and bulbouts, accurate decorative paving and lane markings, signal orientation and controller integration, wire supports, the correct per-wing roof/height profile, source-backed façade families, misleading legacy POI anchors, and less stylized ordinary tree crowns. Nearby dynamic life and the P0 baseline are being edited concurrently; performance results describe the resulting shared tree and need a settled comparable view before claiming an improvement.
