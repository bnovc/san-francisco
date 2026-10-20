# SF Streets — San Francisco city base and open building atlas

A locally served, walkable 3D San Francisco prototype and the foundation for an open building atlas. Union Square is the detailed core; the surrounding city has a streamed rough pass of terrain, roads, paths, parks, water, and simple buildings. The long-term goal is for contributors to claim, research, model, validate, and improve every building, with interiors for selected public, commercial, or explicitly consented places. It does not yet provide a citywide contribution registry, 311 integration, or multiplayer.

## Run

```bash
npm install
npm run dev
```

Open the printed local URL (normally `http://127.0.0.1:5173/`) in a WebGL-capable desktop browser. `npm run build` produces a static build in `dist/`.

Click the scene for mouse look. Press **I** or choose **Inspect**, then click a building or object to see its name, type, location, and available source details. The inspector includes a **Report a bug on GitHub** button that opens a draft for this project with the selected object and location filled in. Turn Inspect off to resume mouse look. Use **WASD** to walk, **Space** to jump, **Shift** to run, **V** to switch between third- and first-person cameras, **E** to interact, and **Esc** to release the mouse. The top controls provide an orbit view, a guided tour, lighting presets, saved viewpoints, and **Settings**. In Settings, **Show FPS** displays a frame-rate counter and remembers the choice in this browser. In orbit mode, click a scene object to inspect it; **WASD** pans across the map relative to the camera, **Up/Down** raises or lowers the view, and **Shift** pans faster. **Tab** switches between walk and orbit. **1**, **2**, and **3** also change the lighting.

Your grounded player position and look direction save in this browser and restore when you reload. An explicit `?pos=` or `?view=` URL still chooses its requested starting point.

The detailed area is about 800 × 720 meters around Union Square. It includes detailed façades and storefronts, animated pedestrians, vehicles, cable cars, and two enterable interiors. **Explore…** also jumps to 15th and Market, the Mission, Golden Gate Park, Fisherman's Wharf, the Ferry Building, and Ocean Beach in the coarse city base. You can walk beyond Union Square through the streamed local tiles. The city base has generic buildings, roads, SFMTA-sourced signal locations, and text labels for named OSM business/building features, with lightweight walkers and cars spawned near the viewer on local road polylines. These ambient agents do not yet follow citywide traffic signals or transit routes; labels are source-snapshot cues rather than a complete or current business directory, and detailed storefronts/interiors have not been expanded citywide. All runtime models and data are stored in `public/`; the game makes no requests to a billed map API.

## Source and reuse

The 3D scene, research data, and model kit were adapted from [PhiloLabs' Fable51 Union Square world](https://github.com/PhiloLabs/fable51-worlds), commit `d24028466530a15d58d3d94537e6317b84101589`. Its code and generated assets are MIT licensed; the original license is retained in [LICENSE.upstream](LICENSE.upstream). This project adds a local animated player character, third-person movement and camera, moving-body collisions, and a game-oriented interface.

The player uses a rigged Grab3D Casual Man character with a contemporary bomber jacket, jeans, and sneakers. One nearby adult pedestrian uses a detailed male or female rigged character; background pedestrians remain instanced, with added facial features, to keep the crowd cost manageable. These bundled models come from Grab3D's [CC0 character library](https://grab3d.com/tools/character-mixer/); see [the asset ledger](docs/SOURCES_AND_ASSETS.md) for file hashes and provenance. The former Bake3D “Old Man” model remains archived locally but is no longer used by the game.

Geographic geometry is derived from OpenStreetMap and remains subject to the [Open Database License](https://www.openstreetmap.org/copyright). Elevation derives from USGS 3DEP public-domain data. The city base uses a dated [BBBike OSM extract and USGS raster](docs/CITY_BASE.md). Real storefront names and logos identify their respective businesses; they are not game assets owned by this project.

The city base does not use external 3D building meshes or runtime map tiles. Coarse building masses are generated from OSM footprints and height tags, with a documented default where heights are missing. Approximate street tree positions come from the [San Francisco Public Works inventory on DataSF](https://data.sf.gov/City-Infrastructure/San-Francisco-Street-Tree-Inventory/tkzw-k3nq); tree forms and sizes are stylized estimates. See [CITY_BASE.md](docs/CITY_BASE.md) for the snapshot, filtering, and limits.

Public and contributor sources may improve the city base, but “publicly viewable” does not mean “redistributable.” Prefer open datasets, per-file open image licences, and photographs or scans contributed with an explicit project licence. Google Street View and real-estate listing imagery are reference-only unless separate permission is obtained; do not scrape, cache, ship, or train on them. See the [building contribution guide](docs/BUILDING_CONTRIBUTION_GUIDE.md) for the source lanes, asset contract, interior policy, and review checklist.

## Expanding the world

Start with [the city base implementation and limits](docs/CITY_BASE.md), [the citywide plan](docs/CITYWIDE_PLAN.md), [the building contribution guide](docs/BUILDING_CONTRIBUTION_GUIDE.md), [the repeatable area workflow](docs/AREA_WORKFLOW.md), and [the current handoff](docs/SESSION_HANDOFF.md). [Source and character provenance](docs/SOURCES_AND_ASSETS.md) records licences. Area manifests live in `data/areas/`; run `npm run audit:areas` to check them. The manifests are provenance metadata; the runtime tile loader reads `public/data/city/index.json` instead.
