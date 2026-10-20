#!/usr/bin/env python3
"""Convert a downloaded DataSF street tree CSV into deterministic local city tiles.

Fetch instructions and source terms are in docs/CITY_BASE.md. No network at build or runtime.
"""
import argparse
import csv
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path

from build_city import BBOX, TILE, core_tile, local

ROOT = Path(__file__).resolve().parents[2]


def kind(species):
    name = species.lower().split(' :: ')[0]
    if name.startswith(('phoenix', 'washingtonia', 'syagrus', 'trachycarpus',
                        'chamaerops', 'brahea', 'archontophoenix', 'howea',
                        'dypsis', 'jubaea', 'rhopalostylis', 'arecastrum')) or 'palm' in name:
        return 2
    if name.startswith(('pinus', 'cupressus', 'cupressocyparis', 'sequoia',
                        'sequoiadendron', 'cedrus', 'calocedrus', 'metasequoia')):
        return 1
    return 0


def size_class(dbh):
    # DBH is an inventory measurement, not height; these are visual estimates.
    try:
        diameter = float(dbh)
    except (TypeError, ValueError):
        diameter = 6
    if not math.isfinite(diameter) or diameter <= 0:
        diameter = 6
    return 0 if diameter < 5 else 1 if diameter < 12 else 2 if diameter < 22 else 3


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--csv', required=True, help='DataSF tkzw-k3nq CSV snapshot')
    ap.add_argument('--snapshot-date', required=True, help='download date YYYY-MM-DD')
    ap.add_argument('--out', default=str(ROOT / 'public/data/trees'))
    args = ap.parse_args()
    source = Path(args.csv)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    tiles = defaultdict(list)
    counts = defaultdict(int)
    seen_ids = set()
    with source.open(newline='', encoding='utf-8-sig') as stream:
        reader = csv.DictReader(stream)
        required = {'treeid', 'latitude', 'longitude', 'species', 'mapdbh'}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError(f'Expected columns {sorted(required)}')
        for row in reader:
            counts['rows'] += 1
            try:
                tree_id = int(row['treeid'])
                lat, lon = float(row['latitude']), float(row['longitude'])
            except (TypeError, ValueError):
                counts['missingCoordinatesOrId'] += 1
                continue
            if tree_id in seen_ids:
                counts['duplicateIds'] += 1
                continue
            seen_ids.add(tree_id)
            if not (BBOX[1] <= lat <= BBOX[3] and BBOX[0] <= lon <= BBOX[2]):
                counts['outsideCityBase'] += 1
                continue
            x, z = local(lat, lon)
            ix, iz = math.floor(x / TILE), math.floor(z / TILE)
            if core_tile(ix, iz):
                counts['legacyCore'] += 1
                continue
            # Rounding must not move a point into its neighbour's tile.
            tx = min(max(round(x, 1), ix * TILE), (ix + 1) * TILE - .1)
            tz = min(max(round(z, 1), iz * TILE), (iz + 1) * TILE - .1)
            tiles[(ix, iz)].append([tree_id, tx, tz,
                                    kind(row['species'] or ''), size_class(row['mapdbh'])])
            counts['placed'] += 1
    listing = []
    for (ix, iz), trees in sorted(tiles.items()):
        trees.sort(key=lambda row: row[0])
        filename = f'{ix}_{iz}.json'
        (out / filename).write_text(json.dumps(trees, separators=(',', ':')))
        listing.append([ix, iz, filename, len(trees)])
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    index = {
        'schemaVersion': 1, 'coordinateFrame': 'union-square-local-v1', 'tileSizeM': TILE,
        'source': {'dataset': 'DataSF San Francisco Street Tree Inventory', 'id': 'tkzw-k3nq',
                   'snapshotDate': args.snapshot_date, 'csvSha256': digest,
                   'license': 'Open Data Commons Public Domain Dedication and License'},
        'counts': dict(counts), 'tiles': listing,
    }
    (out / 'index.json').write_text(json.dumps(index, separators=(',', ':')))
    print(f"Wrote {len(listing)} tree tiles; {dict(counts)}")


if __name__ == '__main__':
    main()
