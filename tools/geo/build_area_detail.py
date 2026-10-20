#!/usr/bin/env python3
"""Extract bounded OSM detail omitted by the coarse city tiles. No network IO.

Keeps multipolygon building rings, street tags, crossing paths, surface tram
tracks and platforms. Inputs remain outside the repository; output is a small
source-derived supplement, not an independently surveyed streetscape.
"""
import argparse
import json
import xml.etree.ElementTree as ET
from pathlib import Path

from build_city import local, open_osm, parse_height, point_in_poly, sha256, clip_segment


def assemble_rings(refs):
    """Join arbitrarily ordered/reversed member ways by exact source node ID."""
    remaining = [list(r) for r in refs if len(r) > 1]
    rings = []
    while remaining:
        chain = remaining.pop(0)
        while chain[0] != chain[-1]:
            for i, other in enumerate(remaining):
                if chain[-1] == other[0]:
                    chain += other[1:]
                elif chain[-1] == other[-1]:
                    chain += other[-2::-1]
                elif chain[0] == other[-1]:
                    chain = other[:-1] + chain
                elif chain[0] == other[0]:
                    chain = other[:0:-1] + chain
                else:
                    continue
                remaining.pop(i)
                break
            else:
                raise ValueError('Unclosed multipolygon member chain')
        if len(set(chain[:-1])) < 3:
            raise ValueError('Degenerate multipolygon ring')
        rings.append(chain[:-1])
    return rings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--osm', required=True)
    ap.add_argument('--manifest', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    manifest = json.loads(Path(args.manifest).read_text())
    bounds = manifest['bboxWgs84']
    inside = lambda p, margin=0: bounds['south'] - margin <= p[0] <= bounds['north'] + margin and bounds['west'] - margin <= p[1] <= bounds['east'] + margin
    nodes, ways, relations = {}, {}, []
    with open_osm(args.osm) as stream:
        for _, e in ET.iterparse(stream, events=('end',)):
            if e.tag == 'node':
                p = float(e.get('lat')), float(e.get('lon'))
                if inside(p, .004):
                    nodes[e.get('id')] = p
                e.clear()
            elif e.tag == 'way':
                refs = [n.get('ref') for n in e.findall('nd')]
                if any(r in nodes for r in refs):
                    ways[e.get('id')] = {'refs': refs, 'tags': {t.get('k'): t.get('v') for t in e.findall('tag')}, 'editedAt': e.get('timestamp')}
                e.clear()
            elif e.tag == 'relation':
                tags = {t.get('k'): t.get('v') for t in e.findall('tag')}
                if tags.get('type') == 'multipolygon' and tags.get('building') not in (None, 'no'):
                    members = [(m.get('ref'), m.get('role') or 'outer') for m in e.findall('member') if m.get('type') == 'way']
                    if any(ref in ways and any(inside(nodes[r]) for r in ways[ref]['refs'] if r in nodes) for ref, _ in members):
                        relations.append((e.get('id'), tags, members, e.get('timestamp')))
                e.clear()
    buildings = []
    for rid, tags, members, timestamp in relations:
        if any(ref not in ways or any(r not in nodes for r in ways[ref]['refs']) for ref, _ in members):
            raise ValueError(f'Incomplete source geometry for relation/{rid}')
        outer = assemble_rings([ways[ref]['refs'] for ref, role in members if role == 'outer'])
        inner = assemble_rings([ways[ref]['refs'] for ref, role in members if role == 'inner'])
        project = lambda ring: [[round(v, 2) for v in local(*nodes[r])] for r in ring]
        outer, inner = [project(r) for r in outer], [project(r) for r in inner]
        height, height_source = parse_height(tags)
        for ring in outer:
            holes = [h for h in inner if point_in_poly(*h[0], ring)]
            buildings.append({'id': f'relation/{rid}', 'outer': ring, 'holes': holes, 'memberWayIds': [f'way/{ref}' for ref, _ in members], 'height': height, 'heightSource': height_source, 'tags': tags, 'editedAt': timestamp})
    corners = [local(lat, lon) for lat in (bounds['south'], bounds['north']) for lon in (bounds['west'], bounds['east'])]
    box = min(p[0] for p in corners), min(p[1] for p in corners), max(p[0] for p in corners), max(p[1] for p in corners)
    features = []
    for wid, w in sorted(ways.items(), key=lambda item: int(item[0])):
        tags = w['tags']
        if tags.get('tunnel') == 'yes' or tags.get('location') == 'underground' or tags.get('indoor') == 'yes':
            continue
        if not (tags.get('highway') or tags.get('railway') in ('tram', 'platform')):
            continue
        if not any(inside(nodes[r]) for r in w['refs'] if r in nodes):
            continue
        points = [local(*nodes[r]) if r in nodes else None for r in w['refs']]
        segments = [segment for a, b in zip(points, points[1:]) if a and b and (segment := clip_segment(a, b, *box))]
        if segments:
            features.append({'id': f'way/{wid}', 'tags': tags, 'segments': segments, 'polygon': [[round(v, 2) for v in p] for p in points[:-1]] if w['refs'][0] == w['refs'][-1] and all(points) else None, 'editedAt': w['editedAt']})
    result = {'schemaVersion': 1, 'id': manifest['id'], 'coordinateFrame': manifest['coordinateFrame'], 'bboxWgs84': bounds,
              'source': {'osmSha256': sha256(args.osm), 'license': 'ODbL-1.0', 'snapshotDate': manifest['sourceRefs'][0]['retrievedAt']},
              'buildings': buildings, 'features': features}
    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, separators=(',', ':')) + '\n')
    print(f'Wrote {len(buildings)} relation building components and {len(features)} street/rail features to {target}')


if __name__ == '__main__':
    main()
