/**
 * geo.ts — local coordinate frame for the Union Square (San Francisco) digital twin.
 *
 * No dependencies. Mirrors the math in tools/geo/build_gis.mjs (which generates src/data/recon/gis.json);
 * keep the two in sync — build_gis.mjs warns if the exported constants below drift from what it computes.
 *
 * FRAME (right-handed, Three.js convention, metres):
 *   x = "grid-east"  : along Geary / Post St, positive toward Stockton St (true bearing GRID_BEARING_DEG)
 *   y = up           : metres above the plaza-centre ground elevation (ORIGIN_ELEVATION_M), so y = 0 at the origin
 *   z = "grid-south" : along Powell / Stockton St, positive toward Geary St (true bearing GRID_BEARING_DEG + 90)
 *   Grid-north (toward Post St / Nob Hill) is therefore -z.
 *
 * ORIGIN: centroid of the Dewey Monument footprint, OSM way 616479962 (historic=monument, height=25.9),
 *   computed from the 2026-09-01 Overpass dump. (The brief's fallback 37.787994,-122.407437 is ~6 m NE of it.)
 *
 * GRID BEARING: length-weighted axial (doubled-angle) mean of every Powell St, Stockton St, Geary St and Post St
 *   roadway segment inside the bbox, with the N-S streets folded by -90 deg so all four vote for the grid-east axis.
 *   Individual fits (deg CW from true north, axial 0-180): Powell 170.889, Stockton 169.792, Geary 80.932, Post 80.860;
 *   Powell+Stockton 170.460; Geary+Post 80.897; combined orthogonal fit 80.686 (= GRID_BEARING_DEG).
 *   So the downtown grid is rotated ~9.3 deg counter-clockwise from true north (grid-north bearing = -9.314 deg).
 *
 * PROJECTION: equirectangular about LAT0 = 37.788 deg. Metres per degree from the standard WGS84 series
 *   (Snyder / NGS): M_PER_DEG_LAT = 111132.954 - 559.822 cos(2 phi) + 1.175 cos(4 phi) = 110992.476
 *                   M_PER_DEG_LON = 111412.84 cos(phi) - 93.5 cos(3 phi) + 0.118 cos(5 phi) = 88084.677
 *   Scale error over the +-400 m working area is < 1 cm; adequate for a walkable twin.
 *
 * ELEVATION: ORIGIN_ELEVATION_M is the USGS 3DEP 1 m bare-earth DEM value at the origin (EPQS, NAVD88 metres).
 */

export const ORIGIN_LAT = 37.787935;
export const ORIGIN_LON = -122.40752;
/** Ground elevation at ORIGIN, metres NAVD88 (USGS EPQS, 3DEP 1 m, fetched 2026-09-01). y = 0 here. */
export const ORIGIN_ELEVATION_M = 23.94;
/** True bearing (deg clockwise from north) of the local +x axis (grid-east, along Geary/Post toward Stockton). */
export const GRID_BEARING_DEG = 80.686;
/** True bearing of grid-north (local -z). */
export const GRID_NORTH_BEARING_DEG = GRID_BEARING_DEG - 90;

export const LAT0_DEG = 37.788;
export const M_PER_DEG_LAT = 110992.476;
export const M_PER_DEG_LON = 88084.677;

/** WGS84 bounding box of the reconnaissance dataset. */
export const BBOX_WGS84 = { south: 37.785, west: -122.4115, north: 37.791, east: -122.4035 } as const;

const D2R = Math.PI / 180;
const SIN_B = Math.sin(GRID_BEARING_DEG * D2R);
const COS_B = Math.cos(GRID_BEARING_DEG * D2R);

export interface LocalXYZ { x: number; y: number; z: number }
export interface GeoLatLon { lat: number; lon: number }

/**
 * WGS84 (lat, lon[, elevation m NAVD88]) -> local frame.
 * If `elev` is omitted, y = 0.
 */
export function geoToLocal(lat: number, lon: number, elev?: number): LocalXYZ {
  const dE = (lon - ORIGIN_LON) * M_PER_DEG_LON; // metres true-east of origin
  const dN = (lat - ORIGIN_LAT) * M_PER_DEG_LAT; // metres true-north of origin
  // grid-east unit vector in (E, N) is (sin B, cos B); grid-north unit vector is (-cos B, sin B)
  const x = dE * SIN_B + dN * COS_B;
  const gridNorth = -dE * COS_B + dN * SIN_B;
  const y = elev === undefined ? 0 : elev - ORIGIN_ELEVATION_M;
  return { x, y, z: -gridNorth };
}

/** Local (x, z) -> WGS84 (lat, lon). Inverse of geoToLocal (ignores y). */
export function localToGeo(x: number, z: number): GeoLatLon {
  const gridNorth = -z;
  const dE = x * SIN_B - gridNorth * COS_B;
  const dN = x * COS_B + gridNorth * SIN_B;
  return { lat: ORIGIN_LAT + dN / M_PER_DEG_LAT, lon: ORIGIN_LON + dE / M_PER_DEG_LON };
}

/** Absolute elevation (m NAVD88) -> local y. */
export const elevToY = (elevM: number): number => elevM - ORIGIN_ELEVATION_M;
/** Local y -> absolute elevation (m NAVD88). */
export const yToElev = (y: number): number => y + ORIGIN_ELEVATION_M;

/**
 * Rotate a true-north bearing (deg CW from north) into a local heading:
 * returns the angle in radians measured from +x toward +z (i.e. clockwise when viewed from above).
 * Useful for orienting objects whose OSM `direction` tag is a compass bearing.
 */
export function bearingToLocalRad(bearingDeg: number): number {
  return (bearingDeg - GRID_BEARING_DEG) * D2R;
}

/** Local bounding box of BBOX_WGS84 (axis-aligned in the local frame, so slightly larger than the rotated bbox). */
export function localBbox(): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const c = [
    geoToLocal(BBOX_WGS84.south, BBOX_WGS84.west), geoToLocal(BBOX_WGS84.south, BBOX_WGS84.east),
    geoToLocal(BBOX_WGS84.north, BBOX_WGS84.west), geoToLocal(BBOX_WGS84.north, BBOX_WGS84.east),
  ];
  return {
    minX: Math.min(...c.map((p) => p.x)), maxX: Math.max(...c.map((p) => p.x)),
    minZ: Math.min(...c.map((p) => p.z)), maxZ: Math.max(...c.map((p) => p.z)),
  };
}
