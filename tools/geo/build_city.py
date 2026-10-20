#!/usr/bin/env python3
"""Build small, deterministic runtime tiles from a local BBBike OSM XML extract and USGS F32 TIFF.

Inputs are deliberately kept outside the repository. See docs/CITY_BASE.md for exact URLs.
No network requests are made by this script or by the game.
"""
import argparse
import gzip
import hashlib
import json
import math
import re
import struct
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TILE = 420
ORIGIN_LAT, ORIGIN_LON = 37.787935, -122.40752
METERS_LAT, METERS_LON = 110992.476, 88084.677
BEARING = math.radians(80.686)
SIN_B, COS_B = math.sin(BEARING), math.cos(BEARING)
BBOX = (-122.525, 37.700, -122.355, 37.815)  # west, south, east, north
ROAD_WIDTHS = {
    'motorway': 22, 'trunk': 19, 'primary': 15, 'secondary': 13,
    'tertiary': 11, 'residential': 8, 'unclassified': 8, 'living_street': 6,
    'service': 5, 'pedestrian': 7, 'footway': 3, 'path': 2.5,
    'cycleway': 2.5, 'steps': 2.5, 'track': 4,
}
BUSINESS_KEYS = ('shop', 'amenity', 'office', 'tourism', 'craft', 'healthcare', 'leisure', 'club')


def local(lat, lon):
    east, north = (lon - ORIGIN_LON) * METERS_LON, (lat - ORIGIN_LAT) * METERS_LAT
    return (east * SIN_B + north * COS_B, east * COS_B - north * SIN_B)


def r1(v):
    return round(v, 1)


def core_tile(ix, iz):
    return ix in (-1, 0) and iz in (-1, 0)


def valid_geo(lat, lon):
    return BBOX[1] <= lat <= BBOX[3] and BBOX[0] <= lon <= BBOX[2]


def tiff_f32(path):
    data = Path(path).read_bytes()
    assert data[:2] == b'II' and struct.unpack_from('<H', data, 2)[0] == 42, 'Expected little endian TIFF'
    off = struct.unpack_from('<I', data, 4)[0]
    count = struct.unpack_from('<H', data, off)[0]
    entries = {}
    for i in range(count):
        tag, typ, n, val = struct.unpack_from('<HHII', data, off + 2 + 12 * i)
        unit = {3: 2, 4: 4}.get(typ)
        if unit is None:
            continue
        raw = data[off + 2 + 12 * i + 8:off + 2 + 12 * i + 12] if n * unit <= 4 else data[val:val + n * unit]
        entries[tag] = struct.unpack('<' + ('H' if typ == 3 else 'I') * n, raw[:n * unit])
    width, height = entries[256][0], entries[257][0]
    assert entries[258][0] == 32 and entries[259][0] == 1 and entries[339][0] == 3, 'Expected uncompressed float32 TIFF'
    if 273 in entries:
        offsets, sizes = entries[273], entries[279]
        pixels = b''.join(data[o:o + s] for o, s in zip(offsets, sizes))
        values = struct.unpack('<' + 'f' * (width * height), pixels[:width * height * 4])
    else:
        tw, th = entries[322][0], entries[323][0]
        offsets, sizes = entries[324], entries[325]
        columns = math.ceil(width / tw)
        image = bytearray(struct.pack('<f', -3.402823e38) * (width * height))
        for k, (offset, size) in enumerate(zip(offsets, sizes)):
            if size == 0:
                continue
            tx, ty = (k % columns) * tw, (k // columns) * th
            tile = data[offset:offset + size]
            for row in range(min(th, height - ty)):
                n = min(tw, width - tx) * 4
                if len(tile) < row * tw * 4 + n:
                    break
                image[((ty + row) * width + tx) * 4:((ty + row) * width + tx) * 4 + n] = tile[row * tw * 4:row * tw * 4 + n]
        values = struct.unpack('<' + 'f' * (width * height), image)
    return width, height, values


def parse_height(tags):
    raw = tags.get('height', '')
    if raw:
        try:
            h = float(raw.lower().replace(' m', '').replace('m', ''))
            if 2 <= h <= 400:
                return r1(h), 'osm:height'
        except ValueError:
            pass
    try:
        levels = float(tags.get('building:levels', ''))
        if 1 <= levels <= 120:
            return r1(levels * 3.1), 'osm:building:levels'
    except ValueError:
        pass
    return (6 if tags.get('building') in ('garage', 'garages', 'shed', 'roof') else 10), 'inferred:default'


def clip_segment(a, b, left, bottom, right, top):
    dx, dz = b[0] - a[0], b[1] - a[1]
    lo, hi = 0.0, 1.0
    for p, q in ((-dx, a[0] - left), (dx, right - a[0]), (-dz, a[1] - bottom), (dz, top - a[1])):
        if abs(p) < 1e-12:
            if q < 0:
                return None
        else:
            t = q / p
            if p < 0:
                lo = max(lo, t)
            else:
                hi = min(hi, t)
    if lo >= hi - 1e-8:
        return None
    return [[r1(a[0] + dx * t), r1(a[1] + dz * t)] for t in (lo, hi)]


def clip_poly(poly, left, bottom, right, top):
    out = poly
    for axis, value, positive in ((0, left, True), (0, right, False), (1, bottom, True), (1, top, False)):
        if not out:
            break
        previous = out[-1]
        inside = lambda p: p[axis] >= value if positive else p[axis] <= value
        clipped = []
        for current in out:
            a, b = inside(previous), inside(current)
            if a != b:
                denom = current[axis] - previous[axis]
                t = (value - previous[axis]) / denom if denom else 0
                clipped.append([r1(previous[0] + t * (current[0] - previous[0])), r1(previous[1] + t * (current[1] - previous[1]))])
            if b:
                clipped.append(current)
            previous = current
        out = clipped
    dedup = []
    for p in out:
        if not dedup or p != dedup[-1]:
            dedup.append(p)
    if len(dedup) > 1 and dedup[0] == dedup[-1]:
        dedup.pop()
    return dedup if len(dedup) >= 3 else []


def area_kind(tags):
    if tags.get('natural') == 'water' or tags.get('landuse') in ('reservoir', 'basin') or tags.get('waterway') == 'riverbank':
        return 'water'
    if tags.get('leisure') in ('park', 'garden', 'recreation_ground', 'playground', 'pitch', 'golf_course'):
        return 'park'
    if tags.get('landuse') in ('grass', 'forest', 'meadow', 'cemetery') or tags.get('natural') in ('wood', 'scrub', 'grassland', 'beach'):
        return 'park'
    return None


def generic_building_name(name):
    """Avoid putting labels such as 'Building 2' on ordinary massing."""
    return bool(re.match(r'^(building|lot|shed|garage|hangar|terminal|gate|pier|block|unit|house)\s+[a-z0-9-]+$', name.strip(), re.I))


def label_candidate(tags):
    """Return (display name, kind, is_named_building) for a sourced OSM label."""
    name = (tags.get('name') or tags.get('brand') or '').strip()
    if not name:
        return None
    for key in BUSINESS_KEYS:
        value = tags.get(key)
        if value and value not in ('no', 'yes'):
            return name, f'{key}={value}', False
    if tags.get('building') not in (None, 'no') and not generic_building_name(name):
        return name, 'building', True
    return None


def point_in_poly(x, z, ring):
    inside = False
    j = len(ring) - 1
    for i, (xi, zi) in enumerate(ring):
        xj, zj = ring[j]
        if ((zi > z) != (zj > z)) and x < (xj - xi) * (z - zi) / ((zj - zi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def segment_distance(x, z, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    length2 = dx * dx + dz * dz
    t = max(0, min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / length2)) if length2 else 0
    px, pz = a[0] + dx * t, a[1] + dz * t
    return math.hypot(x - px, z - pz), px, pz, math.atan2(dz, dx), math.sqrt(length2)


def closest_edge(x, z, ring):
    best = None
    for i, a in enumerate(ring):
        candidate = segment_distance(x, z, a, ring[(i + 1) % len(ring)])
        if best is None or candidate[0] < best[0]:
            best = candidate
    distance, px, pz, angle, length = best
    area = sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring)))
    # For a counter-clockwise x/z ring, the exterior is the right-hand side of
    # each edge; reverse that choice for clockwise rings.
    side = 1 if area >= 0 else -1
    return distance, px, pz, angle, length, side


def open_osm(path):
    return gzip.open(path, 'rb') if str(path).endswith('.gz') else open(path, 'rb')


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--osm', required=True, help='BBBike SanFrancisco.osm.gz')
    ap.add_argument('--dem', required=True, help='USGS 3DEP F32 TIFF exported for the documented bbox')
    ap.add_argument('--snapshot-date', required=True, help='UTC date the two inputs were downloaded (YYYY-MM-DD)')
    ap.add_argument('--out', default=str(ROOT / 'public/data/city'))
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    width, height, values = tiff_f32(args.dem)
    dem = bytearray()
    missing = 0
    valid = []
    for value in values:
        if not math.isfinite(value) or value < -1000 or value > 1000:
            q = -32768
            missing += 1
        else:
            q = max(-32767, min(32767, round(value * 10)))
            valid.append(value)
        dem += struct.pack('<h', q)
    (out / 'dem.bin').write_bytes(dem)
    print(f'DEM {width}x{height}, missing={missing}, range={min(valid):.1f}..{max(valid):.1f}m')

    # XML is ordered nodes, ways, relations. Keep only nodes in the city bbox plus a small clip margin.
    nodes = {}
    pois = []
    ways = []
    latest = ''
    with open_osm(args.osm) as source:
        for _, elem in ET.iterparse(source, events=('end',)):
            if elem.tag == 'node':
                lat, lon = float(elem.get('lat')), float(elem.get('lon'))
                if BBOX[1] - .003 <= lat <= BBOX[3] + .003 and BBOX[0] - .003 <= lon <= BBOX[2] + .003:
                    nodes[elem.get('id')] = (lat, lon)
                    candidate = label_candidate({t.get('k'): t.get('v') for t in elem.findall('tag')})
                    if candidate and valid_geo(lat, lon):
                        x, z = local(lat, lon)
                        pois.append((f"node/{elem.get('id')}", candidate[0], candidate[1], x, z))
                elem.clear()
            elif elem.tag == 'way':
                tags = {t.get('k'): t.get('v') for t in elem.findall('tag')}
                if tags.get('highway') in ROAD_WIDTHS or tags.get('building') not in (None, 'no') or area_kind(tags) or label_candidate(tags):
                    refs = [n.get('ref') for n in elem.findall('nd')]
                    ways.append((elem.get('id'), refs, tags))
                    timestamp = elem.get('timestamp', '')
                    latest = max(latest, timestamp)
                elem.clear()
            elif elem.tag == 'relation':
                elem.clear()
    print(f'OSM retained nodes={len(nodes)}, candidate ways={len(ways)}, latest feature={latest}')

    tiles = defaultdict(lambda: {'roads': [], 'buildings': [], 'areas': [], 'labels': []})
    counts = defaultdict(int)
    building_records = []
    way_pois = []
    for osm_id, refs, tags in ways:
        coords = [nodes.get(ref) for ref in refs]
        if len(coords) < 2 or not any(p and valid_geo(*p) for p in coords):
            continue
        points = [local(*p) if p else None for p in coords]
        highway = tags.get('highway')
        if highway in ROAD_WIDTHS and tags.get('area') != 'yes' and tags.get('tunnel') != 'yes' and tags.get('construction') is None:
            road_width = ROAD_WIDTHS[highway]
            try:
                road_width = max(1.5, min(35, float(tags.get('width', road_width))))
            except ValueError:
                pass
            for a, b in zip(points, points[1:]):
                if a is None or b is None:
                    continue
                min_ix, max_ix = math.floor(min(a[0], b[0]) / TILE), math.floor(max(a[0], b[0]) / TILE)
                min_iz, max_iz = math.floor(min(a[1], b[1]) / TILE), math.floor(max(a[1], b[1]) / TILE)
                for ix in range(min_ix, max_ix + 1):
                    for iz in range(min_iz, max_iz + 1):
                        if core_tile(ix, iz):
                            continue
                        clipped = clip_segment(a, b, ix * TILE, iz * TILE, (ix + 1) * TILE, (iz + 1) * TILE)
                        if clipped:
                            tiles[(ix, iz)]['roads'].append([f'way/{osm_id}', highway, r1(road_width), clipped, 1 if tags.get('bridge') == 'yes' else 0])
                            counts['roadSegments'] += 1
        if len(points) < 4 or refs[0] != refs[-1] or any(p is None for p in points):
            continue
        ring = [[r1(p[0]), r1(p[1])] for p in points[:-1]]
        if len(set(map(tuple, ring))) < 3:
            continue
        minx, minz = min(p[0] for p in ring), min(p[1] for p in ring)
        maxx, maxz = max(p[0] for p in ring), max(p[1] for p in ring)
        if tags.get('building') not in (None, 'no'):
            cx, cz = sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)
            ix, iz = math.floor(cx / TILE), math.floor(cz / TILE)
            if not core_tile(ix, iz) and (maxx < -420 or minx > 420 or maxz < -420 or minz > 420):
                h, source = parse_height(tags)
                record = {'id': f'way/{osm_id}', 'ring': ring, 'height': h, 'tile': (ix, iz), 'label': label_candidate(tags)}
                building_records.append(record)
                tiles[(ix, iz)]['buildings'].append([record['id'], ring, h, source])
                counts['buildings'] += 1
        candidate = label_candidate(tags)
        if candidate and tags.get('building') in (None, 'no'):
            cx, cz = sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)
            way_pois.append((f'way/{osm_id}', candidate[0], candidate[1], cx, cz))
        kind = area_kind(tags)
        if kind:
            for ix in range(math.floor(minx / TILE), math.floor(maxx / TILE) + 1):
                for iz in range(math.floor(minz / TILE), math.floor(maxz / TILE) + 1):
                    if core_tile(ix, iz):
                        continue
                    clipped = clip_poly(ring, ix * TILE, iz * TILE, (ix + 1) * TILE, (iz + 1) * TILE)
                    if clipped:
                        tiles[(ix, iz)]['areas'].append([f'way/{osm_id}', kind, clipped])
                        counts[kind] += 1

    # Attach business POIs to the nearest OSM building so the runtime can put a
    # text panel on an actual façade instead of floating every point in space.
    building_grid = defaultdict(list)
    grid_size = 80
    for record in building_records:
        ring = record['ring']
        for gx in range(math.floor(min(p[0] for p in ring) / grid_size), math.floor(max(p[0] for p in ring) / grid_size) + 1):
            for gz in range(math.floor(min(p[1] for p in ring) / grid_size), math.floor(max(p[1] for p in ring) / grid_size) + 1):
                building_grid[(gx, gz)].append(record)

    def find_building(x, z):
        best = None
        gx, gz = math.floor(x / grid_size), math.floor(z / grid_size)
        for dx in range(-1, 2):
            for dz in range(-1, 2):
                for record in building_grid.get((gx + dx, gz + dz), ()):
                    ring = record['ring']
                    distance = closest_edge(x, z, ring)[0]
                    if point_in_poly(x, z, ring): distance = 0
                    if best is None or distance < best[0]: best = (distance, record)
        return best[1] if best and best[0] <= 45 else None

    labels_seen = set()

    def add_label(feature_id, name, kind, x, z, record=None):
        if record:
            distance, anchor_x, anchor_z, angle, edge_length, side = closest_edge(x, z, record['ring'])
            label_type = 1 if kind == 'building' else 0
        else:
            anchor_x, anchor_z, edge_length, angle, side = x, z, 12, 0, 1
            label_type = 0
        # Labels follow the façade edge they are drawn on. A large footprint
        # can span a tile boundary even though its massing belongs to the
        # centroid tile, so classify the label by its final anchor instead.
        ix, iz = math.floor(anchor_x / TILE), math.floor(anchor_z / TILE)
        if core_tile(ix, iz):
            return
        dedupe = (ix, iz, name.casefold(), round(anchor_x / 8), round(anchor_z / 8))
        if dedupe in labels_seen: return
        labels_seen.add(dedupe)
        tiles[(ix, iz)]['labels'].append([
            feature_id, name[:96], r1(anchor_x), r1(anchor_z), r1(max(2, edge_length)), round(angle, 4), label_type, side,
        ])
        counts['labels'] += 1

    for record in building_records:
        if record['label']:
            add_label(record['id'], record['label'][0], record['label'][1],
                      sum(p[0] for p in record['ring']) / len(record['ring']),
                      sum(p[1] for p in record['ring']) / len(record['ring']), record)
    for feature_id, name, kind, x, z in way_pois + pois:
        add_label(feature_id, name, kind, x, z, find_building(x, z))

    listing = []
    for (ix, iz), tile in sorted(tiles.items()):
        tile['labels'].sort(key=lambda label: (label[1].casefold(), label[0]))
        path = f'{ix}_{iz}.json'
        (out / path).write_text(json.dumps(tile, separators=(',', ':')))
        listing.append([ix, iz, path, len(tile['roads']), len(tile['buildings']), len(tile['areas']), len(tile['labels'])])
    index = {
        'schemaVersion': 2, 'coordinateFrame': 'union-square-local-v1', 'tileSizeM': TILE,
        'bboxWgs84': {'west': BBOX[0], 'south': BBOX[1], 'east': BBOX[2], 'north': BBOX[3]},
        'dem': {'file': 'dem.bin', 'width': width, 'height': height, 'scaleM': .1, 'nodata': -32768, 'datum': 'NAVD88'},
        'source': {'osm': 'BBBike SanFrancisco.osm.gz', 'osmSha256': sha256(args.osm),
                   'osmLatestFeatureTimestamp': latest, 'dem': 'USGS 3DEPElevation ImageServer F32 export',
                   'demSha256': sha256(args.dem), 'sourceSnapshotDate': args.snapshot_date},
        'counts': dict(counts), 'tiles': listing,
    }
    (out / 'index.json').write_text(json.dumps(index, separators=(',', ':')))
    print(f'Wrote {len(listing)} tiles; counts={dict(counts)}')


if __name__ == '__main__':
    main()
