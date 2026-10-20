#!/usr/bin/env node
/**
 * build_gis.mjs — rebuilds src/data/recon/gis.json from
 *   src/data/recon/osm_raw.json   (Overpass API dump, `out body geom`)
 *   src/data/recon/elevation.json (USGS EPQS 3DEP samples; optional — nulls if missing)
 *
 * The geodesy here MUST mirror src/geo/geo.ts (same origin, same constants, same rotation).
 * Run:  node tools/geo/build_gis.mjs            (from the project root, plain ESM, no deps)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW_PATH = path.join(ROOT, 'src/data/recon/osm_raw.json');
const ELEV_PATH = path.join(ROOT, 'src/data/recon/elevation.json');
const OUT_PATH = path.join(ROOT, 'src/data/recon/gis.json');
const GEO_TS_PATH = path.join(ROOT, 'src/geo/geo.ts');

// ---------------------------------------------------------------------------
// Constants (mirror of src/geo/geo.ts)
// ---------------------------------------------------------------------------
export const BBOX = { south: 37.785, west: -122.4115, north: 37.791, east: -122.4035 };
const LAT0_DEG = 37.788; // reference latitude for the equirectangular scale factors
const D2R = Math.PI / 180;
// Metres per degree at LAT0 (WGS84 series expansion; see geo.ts for the same formula)
const phi = LAT0_DEG * D2R;
export const M_PER_DEG_LAT = 111132.954 - 559.822 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
export const M_PER_DEG_LON = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi);
const FALLBACK_ORIGIN = { lat: 37.787994, lon: -122.407437 }; // brief's plaza centre, used only if OSM lacks the monument
const DEWEY_MONUMENT_WAY_ID = 616479962;
const UNION_SQUARE_PLAZA_WAY_ID = 25278818;
const LEVEL_HEIGHT_M = 3.6; // fallback storey height when only building:levels is tagged
const CLIP_MARGIN_M = 60; // keep linear features up to this far outside the bbox

// ---------------------------------------------------------------------------
// Load inputs
// ---------------------------------------------------------------------------
const raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
const els = raw.elements;
const byId = new Map(els.map((e) => [`${e.type}/${e.id}`, e]));
let elev = null;
if (fs.existsSync(ELEV_PATH)) elev = JSON.parse(fs.readFileSync(ELEV_PATH, 'utf8'));
else console.warn('WARN: elevation.json missing — elevations will be null');

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
const inBbox = (lat, lon, m = 0) => {
  const dlat = m / M_PER_DEG_LAT, dlon = m / M_PER_DEG_LON;
  return lat >= BBOX.south - dlat && lat <= BBOX.north + dlat && lon >= BBOX.west - dlon && lon <= BBOX.east + dlon;
};
/** Area-weighted centroid of a closed lat/lon ring, computed relative to the first vertex (avoids cancellation). */
function ringCentroid(g) {
  const ox = g[0].lon, oy = g[0].lat;
  let A = 0, cx = 0, cy = 0;
  for (let i = 0; i < g.length - 1; i++) {
    const x0 = g[i].lon - ox, y0 = g[i].lat - oy, x1 = g[i + 1].lon - ox, y1 = g[i + 1].lat - oy;
    const c = x0 * y1 - x1 * y0; A += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
  }
  if (Math.abs(A) < 1e-16) return { lat: g.reduce((s, p) => s + p.lat, 0) / g.length, lon: g.reduce((s, p) => s + p.lon, 0) / g.length };
  A /= 2;
  return { lat: oy + cy / (6 * A), lon: ox + cx / (6 * A) };
}
/** Signed area of a local [[x,z],...] ring as seen from above (+y). Positive = counter-clockwise from above. */
function signedAreaLocal(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, z0] = ring[i], [x1, z1] = ring[i + 1];
    // use (x, north) = (x, -z) so that CCW-from-above is positive
    a += x0 * (-z1) - x1 * (-z0);
  }
  return a / 2;
}
const r2 = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------
// 1. ORIGIN = centroid of the Dewey Monument (OSM way 616479962)
// ---------------------------------------------------------------------------
const dewey = byId.get(`way/${DEWEY_MONUMENT_WAY_ID}`);
let ORIGIN;
let originSource;
if (dewey && dewey.geometry && dewey.geometry.length >= 4) {
  const c = ringCentroid(dewey.geometry);
  ORIGIN = { lat: +c.lat.toFixed(6), lon: +c.lon.toFixed(6) };
  originSource = `centroid of OSM way ${DEWEY_MONUMENT_WAY_ID} (Dewey Monument, historic=monument)`;
} else {
  ORIGIN = { ...FALLBACK_ORIGIN };
  originSource = 'fallback constant from RECON_BRIEF (Dewey Monument not found in OSM dump)';
}

// ---------------------------------------------------------------------------
// 2. GRID BEARING — axial (doubled-angle) length-weighted mean of street segments inside the bbox.
//    N–S streets are folded by -90° so that all segments vote for the grid-EAST axis bearing.
// ---------------------------------------------------------------------------
const ROAD_KINDS = ['primary', 'secondary', 'tertiary', 'residential', 'tertiary_link', 'primary_link', 'secondary_link', 'unclassified'];
function streetSegments(names) {
  const out = [];
  for (const w of els) {
    if (w.type !== 'way' || !w.tags?.highway || !names.includes(w.tags.name) || !ROAD_KINDS.includes(w.tags.highway)) continue;
    const g = w.geometry || [];
    for (let i = 1; i < g.length; i++) {
      const a = g[i - 1], b = g[i];
      if (!(inBbox(a.lat, a.lon) && inBbox(b.lat, b.lon))) continue;
      const dx = (b.lon - a.lon) * M_PER_DEG_LON, dy = (b.lat - a.lat) * M_PER_DEG_LAT;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      out.push({ len, br: Math.atan2(dx, dy) / D2R });
    }
  }
  return out;
}
function axialMean(segs, fold = 0) {
  let sx = 0, sy = 0, L = 0;
  for (const s of segs) { const t = 2 * (s.br - fold) * D2R; sx += s.len * Math.cos(t); sy += s.len * Math.sin(t); L += s.len; }
  let ax = Math.atan2(sy, sx) / D2R / 2; if (ax < 0) ax += 180;
  return { axisDeg: +ax.toFixed(3), lengthM: Math.round(L), segments: segs.length };
}
const segPowell = streetSegments(['Powell Street']), segStockton = streetSegments(['Stockton Street']);
const segGeary = streetSegments(['Geary Street']), segPost = streetSegments(['Post Street']);
const nsFit = axialMean([...segPowell, ...segStockton]);
const ewFit = axialMean([...segGeary, ...segPost]);
const folded = [...[...segPowell, ...segStockton].map((s) => ({ len: s.len, br: s.br - 90 })), ...segGeary, ...segPost];
const gridFit = axialMean(folded);
const GRID_BEARING_DEG = gridFit.axisDeg; // bearing of local +x (grid-east) axis, deg CW from true north
const bearingReport = {
  method: 'length-weighted axial mean of OSM way segments inside bbox; N-S streets folded by -90 deg',
  powell: axialMean(segPowell), stockton: axialMean(segStockton), geary: axialMean(segGeary), post: axialMean(segPost),
  powellPlusStockton: nsFit, gearyPlusPost: ewFit, combinedOrthogonalFit: gridFit,
  gridEastBearingDeg: GRID_BEARING_DEG, gridNorthBearingDeg: +(GRID_BEARING_DEG - 90).toFixed(3),
};

// ---------------------------------------------------------------------------
// 3. Elevation lookup
// ---------------------------------------------------------------------------
let ORIGIN_ELEVATION_M = null;
let gridInterp = null; // bilinear interpolation over the regular lat/lon sample grid
const centroidElev = new Map();
const intersectionElev = new Map();
if (elev) {
  ORIGIN_ELEVATION_M = elev.origin?.elev_m ?? null;
  const samples = elev.samples.filter((s) => s.elev_m != null);
  const lats = [...new Set(samples.map((s) => s.lat))].sort((a, b) => a - b);
  const lons = [...new Set(samples.map((s) => s.lon))].sort((a, b) => a - b);
  const cell = new Map(samples.map((s) => [`${s.lat},${s.lon}`, s.elev_m]));
  const get = (i, j) => cell.get(`${lats[i]},${lons[j]}`);
  const bracket = (arr, v) => { let i = 0; while (i < arr.length - 2 && arr[i + 1] <= v) i++; return i; };
  gridInterp = (lat, lon) => {
    const i = bracket(lats, lat), j = bracket(lons, lon);
    const t = Math.min(1, Math.max(0, (lat - lats[i]) / (lats[i + 1] - lats[i])));
    const u = Math.min(1, Math.max(0, (lon - lons[j]) / (lons[j + 1] - lons[j])));
    const q = [get(i, j), get(i, j + 1), get(i + 1, j), get(i + 1, j + 1)];
    if (q.some((v) => v == null)) { const ok = q.filter((v) => v != null); return ok.length ? ok.reduce((a, b) => a + b) / ok.length : null; }
    return (1 - t) * ((1 - u) * q[0] + u * q[1]) + t * ((1 - u) * q[2] + u * q[3]);
  };
  for (const c of elev.buildingCentroids || []) if (c.elev_m != null) centroidElev.set(c.osmId, c.elev_m);
  for (const it of elev.intersections || []) if (it.elev_m != null) intersectionElev.set(it.name, it.elev_m);
}
const elevAt = (lat, lon) => (gridInterp ? gridInterp(lat, lon) : null);
const relY = (absElev) => (absElev == null || ORIGIN_ELEVATION_M == null ? null : r2(absElev - ORIGIN_ELEVATION_M));

// ---------------------------------------------------------------------------
// 4. Coordinate transform (mirror of geo.ts)
//    x = grid-east (along Geary/Post toward Stockton), y = up, z = grid-south (toward Geary)
// ---------------------------------------------------------------------------
const SIN_B = Math.sin(GRID_BEARING_DEG * D2R), COS_B = Math.cos(GRID_BEARING_DEG * D2R);
export function geoToLocal(lat, lon, elevM) {
  const dE = (lon - ORIGIN.lon) * M_PER_DEG_LON; // metres true-east of origin
  const dN = (lat - ORIGIN.lat) * M_PER_DEG_LAT; // metres true-north of origin
  const x = dE * SIN_B + dN * COS_B;            // projection on grid-east unit vector (sinB, cosB)
  const gridNorth = -dE * COS_B + dN * SIN_B;   // projection on grid-north unit vector (-cosB, sinB)
  return { x, y: relY(elevM) ?? 0, z: -gridNorth };
}
export function localToGeo(x, z) {
  const gridNorth = -z;
  const dE = x * SIN_B - gridNorth * COS_B;
  const dN = x * COS_B + gridNorth * SIN_B;
  return { lat: ORIGIN.lat + dN / M_PER_DEG_LAT, lon: ORIGIN.lon + dE / M_PER_DEG_LON };
}
const toXZ = (p) => { const l = geoToLocal(p.lat, p.lon); return [r2(l.x), r2(l.z)]; };
const ringToLocal = (g) => {
  const ring = g.map(toXZ);
  const first = ring[0], last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
  if (signedAreaLocal(ring) < 0) ring.reverse(); // enforce CCW as seen from above
  return ring;
};
/** Clip a lat/lon polyline to bbox+margin, returning runs of consecutive in-range points. */
function clipRuns(g) {
  const runs = []; let cur = [];
  for (const p of g) {
    if (inBbox(p.lat, p.lon, CLIP_MARGIN_M)) cur.push(p);
    else if (cur.length) { runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  return runs.filter((r) => r.length >= 2);
}
const polylineLength = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return r2(L); };

// ---------------------------------------------------------------------------
// 5. Tag parsing helpers
// ---------------------------------------------------------------------------
function parseLengthM(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  let m = s.match(/^(-?\d+(?:\.\d+)?)\s*(m|meters?|metres?)?$/); if (m) return +m[1];
  m = s.match(/^(-?\d+(?:\.\d+)?)\s*(ft|feet|')$/); if (m) return +m[1] * 0.3048;
  m = s.match(/^(\d+)'\s*(\d+)"?$/); if (m) return +m[1] * 0.3048 + +m[2] * 0.0254;
  return null;
}
const parseInt0 = (v) => { if (v == null) return null; const n = parseInt(String(v), 10); return Number.isFinite(n) ? n : null; };
const address = (t) => {
  if (!t) return null;
  const parts = [t['addr:housenumber'], t['addr:street']].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
};
/** Representative point of an element: node → itself; way → ring centroid or midpoint; relation → largest outer ring centroid. */
function repPoint(e) {
  if (e.type === 'node') return { lat: e.lat, lon: e.lon };
  const ring = outerRing(e);
  if (ring && ring.length >= 4 && ring[0].lat === ring[ring.length - 1].lat && ring[0].lon === ring[ring.length - 1].lon) return ringCentroid(ring);
  const g = e.geometry || ring;
  if (!g || !g.length) return null;
  return { lat: g.reduce((s, p) => s + p.lat, 0) / g.length, lon: g.reduce((s, p) => s + p.lon, 0) / g.length };
}
function outerRing(e) {
  if (e.type === 'way') return e.geometry || null;
  if (e.type === 'relation') {
    const outers = (e.members || []).filter((m) => (m.role === 'outer' || m.role === 'outline') && m.geometry);
    if (!outers.length) return null;
    // choose largest by |area| in degrees² (relative shoelace)
    let best = null, bestA = -1;
    for (const m of outers) {
      const g = m.geometry; const ox = g[0].lon, oy = g[0].lat; let a = 0;
      for (let i = 0; i < g.length - 1; i++) a += (g[i].lon - ox) * (g[i + 1].lat - oy) - (g[i + 1].lon - ox) * (g[i].lat - oy);
      if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = g; }
    }
    return best;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 6. Buildings and building:parts
// ---------------------------------------------------------------------------
function buildingRecord(e, partMode = false) {
  const t = e.tags || {};
  const ring = outerRing(e);
  if (!ring || ring.length < 4) return null;
  const footprint = ringToLocal(ring);
  const c = ringCentroid(ring);
  const centroidLocal = toXZ(c);
  const h = parseLengthM(t.height);
  const levels = parseInt0(t['building:levels']);
  const minH = parseLengthM(t.min_height);
  const minLevels = parseInt0(t['building:min_level']);
  let heightM = null, heightSource = null;
  if (h != null) { heightM = r2(h); heightSource = 'osm:height'; }
  else if (levels != null) { heightM = r2(levels * LEVEL_HEIGHT_M); heightSource = `osm:building:levels*${LEVEL_HEIGHT_M}`; }
  const osmId = `${e.type}/${e.id}`;
  const absElev = centroidElev.get(osmId) ?? elevAt(c.lat, c.lon);
  const holes = e.type === 'relation' ? (e.members || []).filter((m) => m.role === 'inner' && m.geometry).map((m) => ringToLocal(m.geometry)) : [];
  return {
    osmId, name: t.name || null, address: address(t), footprint, holes: holes.length ? holes : undefined,
    heightM, heightSource, levels, minHeightM: minH != null ? r2(minH) : null, minLevels,
    centroid: centroidLocal, centroidGeo: { lat: +c.lat.toFixed(6), lon: +c.lon.toFixed(6) },
    groundElevM: relY(absElev), groundElevAbsM: absElev == null ? null : r2(absElev),
    groundElevSource: centroidElev.has(osmId) ? 'usgs_epqs_3dep_1m@centroid' : (absElev == null ? null : 'bilinear_from_25m_grid'),
    areaM2: r2(Math.abs(signedAreaLocal(footprint))), insideBbox: inBbox(c.lat, c.lon),
    kind: partMode ? 'building:part' : 'building', tags: t,
  };
}
const buildings = [], buildingParts = [];
const buildingWayIds = new Set(els.filter((e) => e.type === 'way' && e.tags?.building).map((e) => e.id));
for (const e of els) {
  if (e.type !== 'way' && e.type !== 'relation') continue;
  // A type=building relation whose outline way is itself tagged building=* duplicates that way — keep the way only.
  if (e.type === 'relation' && e.tags?.type === 'building' && (e.members || []).some((m) => m.role === 'outline' && buildingWayIds.has(m.ref))) continue;
  if (e.tags?.building) { const b = buildingRecord(e); if (b) buildings.push(b); }
  else if (e.tags?.['building:part']) { const b = buildingRecord(e, true); if (b) buildingParts.push(b); }
}
buildings.sort((a, b) => b.areaM2 - a.areaM2);

// ---------------------------------------------------------------------------
// 7. Streets (all highway ways) and tram tracks (railway=tram|light_rail, surface only)
// ---------------------------------------------------------------------------
const routeNamesByWay = new Map();
for (const r of els) {
  if (r.type !== 'relation' || !r.tags?.route) continue;
  for (const m of r.members || []) if (m.type === 'way') { const k = m.ref; if (!routeNamesByWay.has(k)) routeNamesByWay.set(k, new Set()); routeNamesByWay.get(k).add(`${r.tags.route}:${r.tags.name || r.tags.ref || r.id}`); }
}
function linearRecords(e, extra) {
  const t = e.tags || {};
  const runs = clipRuns(e.geometry || []);
  return runs.map((run, i) => {
    const points = run.map(toXZ);
    const elevProfile = run.map((p) => relY(elevAt(p.lat, p.lon)));
    return { osmId: `${e.type}/${e.id}${runs.length > 1 ? `#${i}` : ''}`, name: t.name || null, ...extra(t), points, elevProfile, lengthM: polylineLength(points), tags: t };
  });
}
const streets = [];
for (const e of els) {
  if (e.type !== 'way' || !e.tags?.highway) continue;
  streets.push(...linearRecords(e, (t) => ({
    kind: t.highway, lanes: parseInt0(t.lanes), oneway: t.oneway ?? null, width: parseLengthM(t.width),
    sidewalk: t.sidewalk ?? null, surface: t.surface ?? null, footwayRole: t.footway ?? null,
    layer: parseInt0(t.layer), tunnel: t.tunnel ?? null, bridge: t.bridge ?? null, area: t.area === 'yes',
    routes: routeNamesByWay.has(e.id) ? [...routeNamesByWay.get(e.id)] : undefined,
  })));
}
const tramTracks = [];
for (const e of els) {
  if (e.type !== 'way' || !['tram', 'light_rail'].includes(e.tags?.railway)) continue;
  if (e.tags.tunnel === 'yes' || (parseInt0(e.tags.layer) ?? 0) < 0) continue; // underground (Central Subway etc.)
  const routes = routeNamesByWay.has(e.id) ? [...routeNamesByWay.get(e.id)] : [];
  const gauge = e.tags.gauge ?? null;
  const inferred = e.tags.name || (routes.length ? routes.map((r) => r.split(':')[1]).join(' / ') : null) || (gauge === '1067' ? 'Powell St cable car track (unnamed in OSM; 1067 mm = SF cable car gauge)' : 'unnamed track');
  tramTracks.push(...linearRecords(e, (t) => ({ kind: t.railway, gauge, routes, name: inferred, oneway: t.oneway ?? null })));
}

// ---------------------------------------------------------------------------
// 8. Point features and POIs
// ---------------------------------------------------------------------------
const POI_KEYS = ['shop', 'amenity', 'tourism', 'office', 'leisure', 'historic', 'craft', 'healthcare', 'public_transport', 'railway', 'man_made', 'emergency', 'barrier', 'advertising', 'entrance', 'place', 'natural'];
const DEDICATED = (t) =>
  t.natural === 'tree' ? 'trees' : t.highway === 'street_lamp' ? 'lamps' : t.highway === 'traffic_signals' ? 'signals' : t.highway === 'crossing' ? 'crossings'
  : t.emergency === 'fire_hydrant' ? 'hydrants' : t.amenity === 'bench' ? 'benches' : t.barrier === 'bollard' ? 'bollards' : null;
const trees = [], lamps = [], signals = [], crossings = [], hydrants = [], benches = [], bollards = [], pois = [];
const bins = { trees, lamps, signals, crossings, hydrants, benches, bollards };
for (const e of els) {
  const t = e.tags; if (!t) continue;
  if (e.type === 'node' && !inBbox(e.lat, e.lon, CLIP_MARGIN_M)) continue;
  const bin = DEDICATED(t);
  if (bin) {
    if (e.type !== 'node') continue;
    const [x, z] = toXZ(e);
    const rec = { osmId: `node/${e.id}`, x, z };
    if (bin === 'crossings') Object.assign(rec, { crossing: t.crossing ?? null, markings: t['crossing:markings'] ?? null, signals: t['crossing:signals'] ?? null, tactile: t.tactile_paving ?? null, rail: t.railway ?? null });
    if (bin === 'trees') Object.assign(rec, { species: t.species ?? t.genus ?? null, leafType: t.leaf_type ?? null });
    if (bin === 'signals') Object.assign(rec, { sound: t['traffic_signals:sound'] ?? null });
    bins[bin].push(rec);
    continue;
  }
  const key = POI_KEYS.find((k) => t[k] != null);
  if (!key) continue;
  if (e.type === 'way' && (t.highway || (t.railway && t.railway !== 'platform'))) continue; // linear features handled above
  if (e.type === 'relation' && t.type === 'route') continue;
  const p = repPoint(e); if (!p || !inBbox(p.lat, p.lon, CLIP_MARGIN_M)) continue;
  const [x, z] = toXZ(p);
  pois.push({
    osmId: `${e.type}/${e.id}`, name: t.name || null, kind: `${key}=${t[key]}`, primaryKey: key,
    address: address(t), level: t.level ?? null, brand: t.brand ?? null, opening_hours: t.opening_hours ?? null, website: t.website ?? null,
    geometry: e.type === 'node' ? 'point' : 'area-centroid', isBuilding: !!t.building, x, z,
    lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), tags: t,
  });
}

// ---------------------------------------------------------------------------
// 9. Plaza + monument
// ---------------------------------------------------------------------------
const plazaWay = byId.get(`way/${UNION_SQUARE_PLAZA_WAY_ID}`) || els.find((e) => e.type === 'way' && e.tags?.name === 'Union Square' && (e.tags.leisure === 'park' || e.tags.place === 'square'));
const plaza = plazaWay ? {
  osmId: `way/${plazaWay.id}`, name: plazaWay.tags.name, footprint: ringToLocal(plazaWay.geometry),
  areaM2: r2(Math.abs(signedAreaLocal(ringToLocal(plazaWay.geometry)))), tags: plazaWay.tags,
  monument: dewey ? { osmId: `way/${dewey.id}`, name: dewey.tags.name, footprint: ringToLocal(dewey.geometry), heightM: parseLengthM(dewey.tags.height), tags: dewey.tags } : null,
} : null;

// ---------------------------------------------------------------------------
// 10. Intersections in local coords (from elevation.json, else recomputed)
// ---------------------------------------------------------------------------
const intersections = (elev?.intersections || []).map((it) => { const [x, z] = toXZ(it); return { name: it.name, x, z, lat: it.lat, lon: it.lon, elevAbsM: it.elev_m, y: relY(it.elev_m) }; });

// ---------------------------------------------------------------------------
// 11. Assemble + write
// ---------------------------------------------------------------------------
const corners = [[BBOX.south, BBOX.west], [BBOX.south, BBOX.east], [BBOX.north, BBOX.west], [BBOX.north, BBOX.east]].map(([la, lo]) => geoToLocal(la, lo));
const bbox_local = { minX: r2(Math.min(...corners.map((c) => c.x))), maxX: r2(Math.max(...corners.map((c) => c.x))), minZ: r2(Math.min(...corners.map((c) => c.z))), maxZ: r2(Math.max(...corners.map((c) => c.z))) };
const gis = {
  meta: {
    generatedAt: new Date().toISOString(), generator: 'tools/geo/build_gis.mjs', osmTimestamp: raw.osm3s?.timestamp_osm_base, osmCopyright: raw.osm3s?.copyright,
    elevationSource: elev?.source ?? null, bboxWgs84: BBOX, units: 'metres; x=grid-east, y=up (relative to origin elevation), z=grid-south',
    footprintWinding: 'closed ring, counter-clockwise when viewed from above (+y), i.e. shoelace on (x,-z) > 0',
    constants: { LAT0_DEG, M_PER_DEG_LAT: +M_PER_DEG_LAT.toFixed(3), M_PER_DEG_LON: +M_PER_DEG_LON.toFixed(3), LEVEL_HEIGHT_M, CLIP_MARGIN_M },
    bearingFit: bearingReport, originSource,
    counts: { buildings: buildings.length, buildingsInsideBbox: buildings.filter((b) => b.insideBbox).length, buildingParts: buildingParts.length, streets: streets.length, tramTracks: tramTracks.length, pois: pois.length, trees: trees.length, lamps: lamps.length, signals: signals.length, crossings: crossings.length, hydrants: hydrants.length, benches: benches.length, bollards: bollards.length },
  },
  origin: { lat: ORIGIN.lat, lon: ORIGIN.lon, elev_m: ORIGIN_ELEVATION_M },
  gridBearingDeg: GRID_BEARING_DEG,
  bbox_local,
  intersections,
  buildings, buildingParts, streets, pois, trees, lamps, signals, crossings, hydrants, benches, bollards, tramTracks, plaza,
};
fs.writeFileSync(OUT_PATH, JSON.stringify(gis));

// Consistency check against geo.ts constants
if (fs.existsSync(GEO_TS_PATH)) {
  const ts = fs.readFileSync(GEO_TS_PATH, 'utf8');
  const num = (name) => { const m = ts.match(new RegExp(`export const ${name}\\s*=\\s*(-?[\\d.]+)`)); return m ? +m[1] : null; };
  const checks = [['ORIGIN_LAT', ORIGIN.lat], ['ORIGIN_LON', ORIGIN.lon], ['GRID_BEARING_DEG', GRID_BEARING_DEG], ['ORIGIN_ELEVATION_M', ORIGIN_ELEVATION_M]];
  for (const [n, v] of checks) { const tv = num(n); if (tv == null || v == null || Math.abs(tv - v) > 1e-6) console.warn(`WARN geo.ts ${n}=${tv} differs from computed ${v}`); }
}
console.log(JSON.stringify({ origin: gis.origin, originSource, GRID_BEARING_DEG, M_PER_DEG_LAT: +M_PER_DEG_LAT.toFixed(3), M_PER_DEG_LON: +M_PER_DEG_LON.toFixed(3), bbox_local, counts: gis.meta.counts, bearingFit: bearingReport }, null, 1));
console.log(`wrote ${OUT_PATH} (${(fs.statSync(OUT_PATH).size / 1e6).toFixed(2)} MB)`);
