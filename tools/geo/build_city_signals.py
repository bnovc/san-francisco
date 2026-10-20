#!/usr/bin/env python3
"""Build compact city tiles from a downloaded DataSF traffic-signal GeoJSON.

The source snapshot is intentionally kept outside the repository. This script
does not make network requests; fetch instructions and provenance live in
docs/CITY_BASE.md. Runtime signal records are separate from the city geometry
tiles so the existing tile schema remains compatible.
"""
import argparse
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path

from build_city import BBOX, TILE, core_tile, local

ROOT = Path(__file__).resolve().parents[2]


def truthy(value):
    return value is not None and str(value).strip().upper() not in ('', '0', 'NO', 'NONE', 'N/A', 'N.A.')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--geojson', required=True, help='DataSF Traffic Signals GeoJSON snapshot')
    ap.add_argument('--snapshot-date', required=True, help='download date YYYY-MM-DD')
    ap.add_argument('--city-index', default=str(ROOT / 'public/data/city/index.json'))
    ap.add_argument('--out', default=str(ROOT / 'public/data/signals'))
    args = ap.parse_args()

    source = Path(args.geojson)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    city_index = json.loads(Path(args.city_index).read_text())
    city_tiles = {(row[0], row[1]) for row in city_index['tiles']}
    data = json.loads(source.read_text())
    features = data.get('features', [])
    tiles = defaultdict(list)
    counts = defaultdict(int)
    seen_ids = set()
    seen_points = set()
    data_as_of = set()

    for feature in features:
        counts['sourceRows'] += 1
        props = feature.get('properties') or {}
        geometry = feature.get('geometry') or {}
        coords = geometry.get('coordinates')
        kind = str(props.get('type') or '').strip().upper()
        if props.get('data_as_of'):
            data_as_of.add(str(props['data_as_of']))
        # The regular inventory is what the signal-post model represents. Keep
        # Caltrans signals too, but omit pending/future/flashing equipment until
        # those receive their own visual treatment.
        if kind == 'SIGNAL':
            signal_kind = 0  # SFMTA-maintained signal
        elif kind == 'SIGNAL (CONTRACTOR MAINTAINED)':
            signal_kind = 0
        elif kind == 'CALTRANS':
            signal_kind = 1
        else:
            counts['omittedNonSignalEquipment'] += 1
            continue
        if not isinstance(coords, list) or len(coords) < 2:
            counts['missingGeometry'] += 1
            continue
        try:
            lon, lat = float(coords[0]), float(coords[1])
            signal_id = int(props['objectid'])
        except (KeyError, TypeError, ValueError):
            counts['missingCoordinatesOrId'] += 1
            continue
        if not (BBOX[1] <= lat <= BBOX[3] and BBOX[0] <= lon <= BBOX[2]):
            counts['outsideCityBase'] += 1
            continue
        if signal_id in seen_ids:
            counts['duplicateIds'] += 1
            continue
        seen_ids.add(signal_id)
        x, z = local(lat, lon)
        ix, iz = math.floor(x / TILE), math.floor(z / TILE)
        if core_tile(ix, iz):
            counts['legacyCore'] += 1
            continue
        if (ix, iz) not in city_tiles:
            counts['noCityTile'] += 1
            continue
        point_key = (round(x, 1), round(z, 1))
        if point_key in seen_points:
            counts['duplicatePoints'] += 1
            continue
        seen_points.add(point_key)
        # Keep points inside their owning tile after quantization.
        tx = min(max(round(x, 1), ix * TILE), (ix + 1) * TILE - .1)
        tz = min(max(round(z, 1), iz * TILE), (iz + 1) * TILE - .1)
        ped = 1 if str(props.get('ped_signal') or '').strip().upper() not in ('', 'NONE', 'N.A.', 'N/A') else 0
        aps = 1 if truthy(props.get('aps')) and str(props.get('aps')).strip().upper() not in ('FUTURE', 'PENDING') else 0
        rlcam = 1 if truthy(props.get('rlcam')) else 0
        tiles[(ix, iz)].append([signal_id, tx, tz, signal_kind, ped, aps, rlcam])
        counts['placed'] += 1
        counts['caltrans'] += signal_kind

    listing = []
    for (ix, iz), signals in sorted(tiles.items()):
        signals.sort(key=lambda row: row[0])
        filename = f'{ix}_{iz}.json'
        (out / filename).write_text(json.dumps(signals, separators=(',', ':')))
        listing.append([ix, iz, filename, len(signals)])

    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    index = {
        'schemaVersion': 1,
        'coordinateFrame': 'union-square-local-v1',
        'tileSizeM': TILE,
        'source': {
            'dataset': 'Traffic Signals',
            'catalogId': 'ybh5-27n2',
            'apiExportId': 'c8ue-f4py',
            'datasetUrl': 'https://data.sf.gov/d/ybh5-27n2',
            'downloadUrl': 'https://data.sf.gov/resource/c8ue-f4py.geojson',
            'publisher': 'SFMTA',
            'snapshotDate': args.snapshot_date,
            'dataAsOf': sorted(data_as_of),
            'geojsonSha256': digest,
            'license': 'Open Data Commons Public Domain Dedication and License',
            'termsUrl': 'http://opendatacommons.org/licenses/pddl/1.0/',
        },
        'counts': dict(counts),
        'tiles': listing,
    }
    (out / 'index.json').write_text(json.dumps(index, separators=(',', ':')))
    print(f'Wrote {len(listing)} signal tiles; {dict(counts)}')


if __name__ == '__main__':
    main()
