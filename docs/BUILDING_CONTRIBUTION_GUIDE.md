# Open building atlas contribution guide

SF Streets is becoming an open San Francisco building atlas: a shared, walkable 3D record in which every building can be claimed, researched, modeled, reviewed, and improved. The current game is still a prototype. This guide defines the contribution contract before we build a citywide asset registry or upload workflow.

## What contributors can contribute

Contributions may include:

- a corrected footprint, height, roof mass, or building-part relationship;
- a reusable façade specification or a building-specific façade model;
- licensed photographs, measurements, scans, or architectural drawings;
- a storefront, sign, landmark, or streetscape package;
- a public, commercial, or consented interior with an explicit evidence trail;
- corrections to names, dates, tenants, materials, or confidence labels.

Every contribution must be keyed to a stable geographic feature ID, preferably an OSM ID or a future canonical SF Streets building ID. A street address alone is not stable enough for geometry or versioning.

## Source lanes

Publicly reachable does not mean freely reusable. Each input belongs to one of these lanes:

| Lane | Examples | How it may be used |
| --- | --- | --- |
| Packaged open data | OSM, DataSF, USGS, Open City Model, public-domain or explicitly open records | Import or transform after recording revision, licence, retrieval date, and attribution. Keep each source's licence separate. |
| Open imagery | Mapillary CC BY-SA, Wikimedia Commons, contributor photos under CC BY/CC0/another explicit licence | Package only when the exact file licence and attribution are recorded. Check privacy, people, plates, trademarks, and share-alike consequences. |
| Contributor-owned material | A contributor's photographs, scans, measurements, or models | Accept with a written project licence and confirmation that the contributor owns or controls the rights. |
| Reference-only material | Google Street View, Apple Maps imagery, real-estate listing photos, screenshots, search previews, or unlicensed web images | Use only as a lead for separately authored work after source review. Do not scrape, cache, ship, train on, or quietly trace these materials. |

Google Maps terms prohibit bulk downloading, caching, and creating content from Maps content, including 3D building models from certain imagery. Real-estate platforms may display listing photos without granting downstream rights to those photos. A contributor must not add either class of material to the repository merely because it is visible online. See [Google Maps Platform terms](https://cloud.google.com/maps-platform/terms?hl=en-EN) and [Zillow's terms](https://www.zillow.com/corporate/terms-of-use/).

Mapillary is a useful open street-level source, but it still requires compliance with its terms and attribution. Its help centre describes contributed imagery as CC BY-SA and points larger-area users to its API/SDK. See [Mapillary licensing](https://help.mapillary.com/hc/en-us/articles/115001770409-CC-BY-SA-license-for-open-data) and [Mapillary downloads/API](https://help.mapillary.com/hc/en-us/articles/4407521157138-Downloading-map-data-via-the-Mapillary-web-app).

## Building package contract

A reviewed building package should contain, or link to, the following:

1. `buildingId`: stable source ID and any address/parcel crosswalk;
2. `geometry`: footprint, height, levels, roof or building parts, with units and coordinate frame;
3. `asset`: GLB/SVG/texture/procedural spec and intended LODs;
4. `evidence`: source URL or file ID, author, capture/observation date, view direction, licence, and the exact claim supported;
5. `confidence`: observed, measured, source-reported, inferred, unresolved, or fictional;
6. `review`: screenshots or comparison viewpoints, known mismatches, reviewer, and review date;
7. `credits`: machine-readable attribution and any share-alike or notice requirements;
8. `interiorConsent` when an interior is included: public-access basis, owner/operator permission, or other documented authority.

Do not present an inferred façade, tenant, floor plan, or interior as surveyed fact. Preserve uncertainty in the metadata and keep unresolved parts neutral in the game.

## Fidelity levels

- **Massing:** footprint, terrain anchor, approximate height, roof silhouette, collision, and LODs.
- **Façade:** street-facing openings, materials, setbacks, storefront bays, signs, fire escapes, and rooftop elements backed by evidence.
- **Verified landmark:** multi-view review, measured proportions where available, dated tenant/sign information, and explicit source/confidence notes.
- **Interior:** only for public, commercial, or consented spaces with enough evidence to justify the modeled scope. Hidden rooms and private residences remain closed or generic by default.

The goal is complete coverage at massing level and steadily increasing community coverage at façade and landmark levels. “Every building” does not mean every building receives an invented interior.

## Licensing policy

Keep code, geographic databases, photographs, textures, and authored models as separate licence layers. The current project code and upstream kit are MIT; OSM-derived databases remain subject to ODbL; DataSF datasets may have their own terms; Mapillary imagery is CC BY-SA; and each Commons file has its own licence. A model package must not combine incompatible inputs without recording the decision.

The default target for new authored models is CC BY 4.0 or CC0 when the contributor can grant it cleanly. If a source requires share-alike or another condition, retain that condition rather than relabeling the result. Ask for a rights review when a model is materially traced from a third-party image, scan, plan, or mesh.

## Pull-request checklist

- Does the package identify the correct building and coordinate frame?
- Are all source URLs/file IDs, dates, licences, and claims recorded?
- Are observations separated from inference and unresolved details?
- Are people, private information, license plates, and sensitive interiors removed or authorized?
- Does the asset include an appropriate LOD, collision behavior, and attribution entry?
- Does a reviewer compare at least one street-level view and one elevated or opposite-side view when available?
- Does the package avoid Google/Apple/proprietary imagery, meshes, or listing photos in the shipped files?
- Does the build still pass `npm run audit:areas` and `npm run build`?
