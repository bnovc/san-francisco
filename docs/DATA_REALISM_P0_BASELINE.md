# 15th and Market P0 baseline

Prepared 2026-10-19 for the bounded pilot in [the data realism plan](DATA_REALISM_PLAN.md). This is a reproducible planning baseline, not a claim that the pilot has passed visual, field, or performance QA. The current area manifest also contains an address-label prototype; these bounds include a larger proposed walking loop, while authored detail remains limited to its documented features.

## Bounds, route, and cameras

The proposed WGS84 bounds are `37.7635–37.7675 N, -122.4345–-122.4285 W`. In `union-square-local-v1`, the four corners span approximately `x=-2784..-2191 m, z=1854..2377 m`. The area overlaps four 420 m tiles (`x=-7/-6`, `z=4/5`) and crosses the seams at `x=-2520 m` and `z=2100 m`.

The following loop is planned but not complete in the running game. Coordinates and the southern turn are navigation anchors to verify against sidewalks and curb access before use as an acceptance route.

| Stop | WGS84 | Local x/z (m) | Purpose |
| --- | --- | --- | --- |
| 15th / Market / Sanchez, start | `37.766121, -122.430968` | `-2430.0, 2055.0` | Existing Explore spawn near the station |
| Market / Noe / 16th | `37.764272, -122.433109` | `-2649.4, 2227.0` | West/south Market turn; crosses both tile seams on the approach |
| 16th / Sanchez, approximate turn | `37.764900, -122.430650` | `-2424.3, 2193.3` | Candidate return turn; current point falls inside building way `way/260491317` |
| Start | `37.766121, -122.430968` | `-2430.0, 2055.0` | Return north on Sanchez |

The initial movement leg from the start to Market / Noe reached within 0.7 m of its anchor and crossed the `x=-2520 m` and `z=2100 m` tile seams. A straight eastbound movement toward the current 16th / Sanchez anchor stopped 135.4 m short after three no-progress steps; the direct line also crosses building footprint `way/558123733`. The proposed endpoint itself is inside `way/260491317`, so it is not a safe walking target. Add a sidewalk/curb waypoint around the intervening building and replace the endpoint with a verified corner before accepting the loop. This probe used the game's collision and movement code at a QA run speed of 12 m/s; the full loop was not completed.

The coarse 3DEP raster gives local ground heights of about `11.81 m` at the start and `21.19 m` at Market / Noe, a rise of roughly `9.4 m` over `279 m` (about 3.4% average). The raster is sampled at about 13.6 m, so this is a broad-slope indicator, not a measured sidewalk or curb profile.

Repeatable game cameras in the same local frame:

| View | Camera x/y/z (m) | Heading / pitch / FOV | Notes |
| --- | --- | --- | --- |
| Street | `-2445, 14.56, 2044` | `35° / 0° / 65°` | `y` is 1.7 m above the coarse DEM ground at this point |
| Aerial | `-2535, 214.23, 2145` | `351° / -32° / 65°` | About 200 m above coarse DEM ground; centered on the west/south tile seam |

The recipes were exercised in the running game. Street and aerial views were visually inspected in headless Chromium; temporary viewport captures are in `/private/tmp` and were not added to the repository. No comparison against a licensed reference has been made.

## Dated ground-level reference candidates

Wikimedia Commons categories list dated photographs at both ends of the proposed Market segment. The source category’s station coordinate is an approximate target location, not a verified camera GPS point. Each file’s own description page must be checked for author, exact capture date, and licence before treating it as an importable source. Nothing was downloaded or bundled; these remain reference-only candidates.

| View target | Candidate file and stated date | Source |
| --- | --- | --- |
| Market / Sanchez platform | [Inbound platform, May 2024](https://commons.wikimedia.org/wiki/File:Inbound_platform_at_Market_and_Sanchez,_May_2024.jpg) | [Market and Sanchez Commons category](https://commons.wikimedia.org/wiki/Category:Market_and_Sanchez_station) |
| Market / Sanchez, streetcar | [Muni 1056, April 2026](https://commons.wikimedia.org/wiki/File:Muni_1056_at_Market_and_Sanchez,_April_2026.jpg) | [Market and Sanchez Commons category](https://commons.wikimedia.org/wiki/Category:Market_and_Sanchez_station) |
| Market / Sanchez, streetcar | [Muni 1077, April 2026](https://commons.wikimedia.org/wiki/File:Muni_1077_at_Market_and_Sanchez,_April_2026.jpg) | [Market and Sanchez Commons category](https://commons.wikimedia.org/wiki/Category:Market_and_Sanchez_station) |
| Market / Noe platform | [Inbound platform, May 2024](https://commons.wikimedia.org/wiki/File:Inbound_platform_at_Market_and_Noe,_May_2024.jpg) | [Market and Noe Commons category](https://commons.wikimedia.org/wiki/Category:Market_and_Noe_station) |
| Market / Noe, streetcar | [Muni 1077, April 2026](https://commons.wikimedia.org/wiki/File:Muni_1077_at_Market_and_Noe,_April_2026.jpg) | [Market and Noe Commons category](https://commons.wikimedia.org/wiki/Category:Market_and_Noe_station) |

These images are useful for station, track, and streetscape comparison leads. Their exact file licences were not verified here, and their compositions do not establish a complete block survey. The five candidates therefore do **not** yet satisfy the P0 permissible-reference gate.

## Source and output baseline

The runtime snapshots are the 2026-10-18 inputs already documented in [CITY_BASE.md](CITY_BASE.md). Raw source files are not in this checkout.

| Layer | Input SHA-256 | Current runtime output | Output SHA-256 |
| --- | --- | --- | --- |
| BBBike OSM XML | `2a4c97087e7f04bef0a92aec0c702894b7400f2abba8233466e77cecc050cd7a` | `public/data/city/index.json`, schema 2 | `c5492211bb7b43aa17bf084c4fd0048d4668d2d65da5a82d8493f263135ac3ec` |
| USGS 3DEP F32 DEM | `391d385137297a17717d4ab861c4b858abbd325892bac7f5366bda4d2ed0c415` | `dem.bin`, 1100 × 940, 0.1 m quantization, NAVD88 | `8e6b666d499019e7a93e7128a5563b3e70837e7277251d4557905470757f3950` |
| DataSF street-tree CSV | `9c0420c731b700f669d048b59550bdea8b6e386a82d62ba7fac4e24158ce6b6c` | tree index schema 1 | `380a4263dd16e3efbf5915e764aad7a2a5ec54492a2ddc533fc792320814707e` |
| DataSF / SFMTA signal GeoJSON | `ef8f5186de88bc3aca82960dbcfb4fa52a014ec2806ccb330d8810e6ac26a64a` | signal index schema 1 | `492b0dbe6657c5db01b8d8acb84415ac08adc878e8755a1011cd92d693174f2b` |

Current city output counts are 831 tiles, 283,958 clipped road/path segments from 64,375 unique OSM road ways, 167,941 OSM way buildings, 7,280 park polygons, 116 water polygons, and 14,635 text labels. The separate tree and signal layers place 138,021 trees and 1,256 signals. These are imported-record counts, not completeness claims.

| Building height provenance | Records | Share |
| --- | ---: | ---: |
| OSM `height` | 141,414 | 84.20% |
| OSM `building:levels` converted at 3.1 m/level | 854 | 0.51% |
| Default inferred height | 25,673 | 15.29% |

The tile records keep a numeric road width but not whether an explicit OSM `width=*` equalled the importer default. Of the 64,375 unique road ways, 142 have a stored width different from the class default; the exact number of explicitly tagged widths is unknown. The importer also drops original road-node references and connectivity, one-way/access/turn restrictions, rail ways, building parts, relation membership/holes, and most original tags. Their coverage/counts cannot be recovered from the generated records. Do not infer them from the rendered output.

At the pilot street center, the current 5 × 5 streaming window contains 25 city files, 25 tree files, and 23 signal files. Their uncompressed JSON plus the city/tree/signal indexes and DEM total 5,458,925 bytes (5.21 MiB). This is a deterministic bundled-data payload estimate, not a measured browser wire transfer and not a memory figure.

The city audit expects schema 2 and the `union-square-local-v1` frame. `CityBase` now rejects a city index with another schema, frame, or tile size. The runtime and city validator both expect tree/signal index schema 1. `data/areas/15th-and-market.json` remains metadata only; its `prototype` status refers to the existing four-label address prototype, not verified area coverage.

## Performance and geometry budgets

Earlier handoff entries record software-rendered samples of 484 street / 375 aerial draw calls and 60 / 56 FPS, each with 25 city tiles, plus an older view with about 2.31 million triangles. Their browser, viewport, and device details are incomplete. A fresh measurement was captured on 2026-10-19 against the final rebuilt shared tree, using headless Chromium `151.0.7922.34` on `MacIntel`, 1920 × 1080 at DPR 1, with the reported renderer string `WebKit WebGL`. The profiler warmed each settled view for 1.5 seconds, then sampled for 2 seconds. There were no page errors or failed requests.

| View | Mean / p95 frame time | Draw calls | Visible triangles | City tiles / loading | Signal tiles / heads | Resource entries / transfer bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Street | 16.66 / 18.1 ms | 501 | 2,502,084 | 25 / 0 | 23 / 440 | 92 / 2,980,524 |
| Aerial | 18.19 / 22.6 ms | 584 | 2,909,639 | 34 / 0 | 29 / 500 | 12 / 281,898 added |

Both views meet the provisional frame-time limits. Street draw calls, triangles, and tile count meet their caps. Aerial exceeds the 413 draw-call cap, 2.55-million-triangle cap, and 25-tile cap. The profiler reports transfer bytes added by each view: the initial street load made 92 relevant resource requests (2,980,524 transferred bytes; 2,952,924 encoded), and the aerial view added 12 (281,898 transferred; 278,298 encoded). Cumulative page totals through the aerial view were 104 requests, 3,262,422 transferred bytes, and 3,231,222 encoded bytes. These compressed transfer values should not be compared directly to the 5.5 MiB uncompressed payload cap. Chromium exposed a single `performance.memory` heap reading of 756.3 MiB; this does not measure growth after GC or repeated tile unload/reload cycles. Treat the headless/software-rendered capture as a reproducible baseline, not a hardware performance guarantee.

Use these initial pilot caps, then rebaseline on a named browser/device and the camera recipes above before P1:

- Warm average frame time: at most 20 ms in each view; p95 at most 33.3 ms.
- Draw calls: at most 533 street and 413 aerial (10% above the logged samples).
- Visible triangles: at most 2.55 million per view (10% above the older 2.31 million sample); confirm the same counter and view before treating this cap as a pass.
- Loaded city tiles: at most 25; pilot source-data payload: at most 5.5 MiB uncompressed.
- After five repeat loop traversals and tile unload/reload cycles, Chromium JS heap growth should be at most 10 MiB after GC where available. GPU memory is not exposed consistently and remains separately reported when available.

Geometry budgets for the later terrain/building pilot are: rendered road centerlines within 1 m p95 of the retained OSM path; collision-to-2023 fine DEM residual at most 0.75 m RMS and 1.5 m maximum at non-curb controls; sampled building footprint displacement at most 2 m p95; and selected LiDAR roof-height estimates within 2 m RMSE after ground/vegetation filtering. These are acceptance targets, not current measured errors. OSM, the coarse DEM, and the current building massing do not meet that evidence bar by themselves.

The repeatable profiler is `node tools/qa/area_baseline.mjs --url=http://127.0.0.1:5173`; this capture used `--seconds=2 --headed=0` against the 75-module build. It reports browser/platform, per-view frame percentiles, draw calls, triangles, active tile counts, per-view resource-transfer deltas, and JS heap where exposed. P0 remains open: individual Commons file pages could not be retrieved in this review, so their licences remain unverified; the initial leg was traversed but the proposed loop did not complete; and the aerial caps are exceeded. Re-run the profile after checking the streamed tile radius and aerial scene load, and repeat loop-memory measurement after the route can be traversed end to end.

## P0 status and next step

Implemented here: the area bounds and proposed seam-crossing loop, input/output hashes and counts, a schema/frame guard shared by runtime and audit expectations, candidate dated references, numeric provisional budgets, a repeatable local profiler, and one fresh two-view capture. Still open: verify the five reference files individually or replace them with contributor-owned photos; walk and ground-check the loop; address the measured aerial cap misses; and measure heap growth across repeated unload/reload cycles. Do not start importer or generated-tile changes until those P0 checks pass.
