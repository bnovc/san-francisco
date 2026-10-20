// Bounded, source-derived additions to the city base. Geometry stays generic;
// this layer retains source distinctions the compact tier-0 tiles discarded.
import * as THREE from 'three';
import market15 from '../data/areas/15th-and-market.generated.json';
import { geoToLocal, localToGeo } from '../geo/geo';
import { addAreaLamps, type LampSpot } from './AreaStreetFurniture';
import { citySurfaceMaterial, groundUvs } from './CitySurfaceMaterials';

type Point = [number, number];
export type AreaBuilding = [string, Point[], number, string, Point[][]?];
interface Feature { id: string; tags: Record<string, string>; segments: [Point, Point][]; polygon: Point[] | null }
const features = market15.features as unknown as Feature[];
const byId = new Map(features.map((feature) => [feature.id, feature]));
const relationMembers = new Set(market15.buildings.flatMap((b) => b.memberWayIds));
const TILE = 420;
const owns = (ix: number, iz: number, x: number, z: number) => Math.floor(x / TILE) === ix && Math.floor(z / TILE) === iz;

function pointSegment(x: number, z: number, a: Point, b: Point) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}

const marketSegments = features.filter((f) => f.tags.name === 'Market Street' && f.tags.highway === 'primary').flatMap((f) => f.segments);
const crossingSegments = features.filter((f) => f.tags.footway === 'crossing').flatMap((f) => f.segments);
const trackSegments = features.filter((f) => f.tags.railway === 'tram').flatMap((f) => f.segments);
const junction = geoToLocal(37.7660246, -122.4307163);
function convexHull(points: Point[]): Point[] {
  const ordered = points.filter((p, i) => points.findIndex((q) => q[0] === p[0] && q[1] === p[1]) === i).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (list: Point[]) => {
    const result: Point[] = [];
    for (const p of list) { while (result.length > 1 && cross(result.at(-2)!, result.at(-1)!, p) <= 0) result.pop(); result.push(p); }
    return result.slice(0, -1);
  };
  return [...half(ordered), ...half([...ordered].reverse())];
}
// An inferred connected asphalt envelope, constrained by mapped crossing
// endpoints. It replaces exposed terrain between disconnected road ribbons;
// curb/bulbout boundaries still require stronger survey evidence.
const junctionRing = convexHull(crossingSegments.filter(([a, b]) => Math.hypot((a[0] + b[0]) / 2 - junction.x, (a[1] + b[1]) / 2 - junction.z) < 70).flat());
const lamps: LampSpot[] = [];
for (const f of features.filter((f) => f.tags.footway === 'sidewalk')) {
  let distance = 14;
  for (const [a, b] of f.segments) {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (distance < length) {
      const x = a[0] + (b[0] - a[0]) * distance / length, z = a[1] + (b[1] - a[1]) * distance / length;
      if (marketSegments.some(([a, b]) => pointSegment(x, z, a, b) < 17) &&
          !trackSegments.some(([a, b]) => pointSegment(x, z, a, b) < 4) &&
          !crossingSegments.some(([a, b]) => pointSegment(x, z, a, b) < 5) &&
          !lamps.some((lamp) => Math.hypot(lamp.x - x, lamp.z - z) < 22) && areaTreeVisible(x, z)) {
        lamps.push({ x, z, angle: -Math.atan2(b[1] - a[1], b[0] - a[0]), sourceId: f.id });
      }
      distance += 30;
    }
    distance -= length;
  }
}

export function areaBuildingInfo(id: string) { return market15.buildings.find((b) => b.id === id); }

export function areaTreeVisible(x: number, z: number): boolean {
  const inside = (ring: number[][]) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
    }
    return hit;
  };
  // Inventory points geocoded inside a recovered building are unresolved
  // planting locations. Keep source records, suppress misleading tree meshes.
  return !market15.buildings.some((b) => inside(b.outer) && !b.holes.some(inside));
}

export function areaBuildings(ix: number, iz: number, base: AreaBuilding[]): AreaBuilding[] {
  const extra = market15.buildings.filter((b) => owns(ix, iz,
    b.outer.reduce((sum, p) => sum + p[0], 0) / b.outer.length,
    b.outer.reduce((sum, p) => sum + p[1], 0) / b.outer.length));
  return [...base.filter((b) => !relationMembers.has(b[0])), ...extra.map((b): AreaBuilding => [b.id, b.outer as Point[], b.height, b.heightSource, b.holes as Point[][]])];
}

export function areaRoadTags(id: string, x: number, z: number): Record<string, string> | undefined {
  const p = localToGeo(x, z), b = market15.bboxWgs84;
  return p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east ? byId.get(id)?.tags : undefined;
}

export function areaLampSpots(ix: number, iz: number) { return lamps.filter((p) => owns(ix, iz, p.x, p.z)); }

export function addAreaSurfaces(group: THREE.Group, ix: number, iz: number, heightAt: (x: number, z: number) => number) {
  const paint: number[] = [], grooves: number[] = [], rails: number[] = [], platforms: number[] = [], asphalt: number[] = [], wires: number[] = [];
  const tri = (out: number[], a: number[], b: number[], c: number[]) => {
    for (const p of [a, b, c]) out.push(p[0] - ix * TILE, p[1], p[2] - iz * TILE);
  };
  const surface = (out: number[], ring: Point[], lift: number) => {
    const split = (a: Point, b: Point, c: Point) => {
      const length = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (Math.max(length(a, b), length(b, c), length(c, a)) > 5) {
        const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
        split(a, ab, ca); split(ab, b, bc); split(ca, bc, c); split(ab, bc, ca);
      } else tri(out, ...[a, b, c].map(([x, z]) => [x, heightAt(x, z) + lift, z]) as [number[], number[], number[]]);
    };
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), [])) split(ring[a], ring[b], ring[c]);
  };
  const ribbon = (out: number[], a: Point, b: Point, offset: number, width: number, lift: number) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    if (length < .01) return;
    const nx = -dz / length, nz = dx / length, steps = Math.ceil(length / 2);
    const p = (t: number, d: number) => {
      const x = a[0] + dx * t + nx * d, z = a[1] + dz * t + nz * d;
      return [x, heightAt(x, z) + lift, z];
    };
    for (let i = 0; i < steps; i++) {
      const a0 = p(i / steps, offset - width / 2), a1 = p((i + 1) / steps, offset - width / 2);
      const b0 = p(i / steps, offset + width / 2), b1 = p((i + 1) / steps, offset + width / 2);
      tri(out, a0, a1, b1); tri(out, a0, b1, b0);
    }
  };
  if (owns(ix, iz, junction.x, junction.z)) {
    surface(asphalt, junctionRing, .045);
  }
  for (const f of features) {
    const t = f.tags;
    if (t.railway === 'platform' && f.polygon) {
      const ring = f.polygon;
      const x = ring.reduce((s, p) => s + p[0], 0) / ring.length, z = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      if (owns(ix, iz, x, z)) {
        surface(platforms, ring, .18);
      }
    }
    for (const [a, b] of f.segments) {
      if (!owns(ix, iz, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) continue;
      if (t.railway === 'tram') {
        const gauge = Number(t.gauge || 1435) / 1000;
        for (const side of [-1, 1]) {
          ribbon(grooves, a, b, side * gauge / 2, .15, .061);
          ribbon(rails, a, b, side * gauge / 2, .055, .066);
        }
        if (t.electrified === 'contact_line') ribbon(wires, a, b, 0, .025, 5.8);
      }
      if (t.footway === 'crossing' && t['crossing:markings'] !== 'no' && t.crossing !== 'unmarked') {
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        // Stripe dimensions are inferred; mapped path endpoints and direction
        // are retained. This is a zebra fallback pending a dated paving survey.
        for (let d = .15; d < length - .2; d += 1.05) {
          const p = (s: number): Point => [a[0] + (b[0] - a[0]) * s / length, a[1] + (b[1] - a[1]) * s / length];
          ribbon(paint, p(d), p(Math.min(d + .55, length - .1)), 0, 3.8, .075);
        }
      }
    }
  }
  for (const [vertices, name, material] of [
    [asphalt, 'inferred-junction-asphalt', citySurfaceMaterial('asphalt')],
    [platforms, 'mapped-transit-platforms', citySurfaceMaterial('concrete')],
    [grooves, 'tram-rail-grooves', new THREE.MeshLambertMaterial({ color: 0x222527, side: THREE.DoubleSide })],
    [rails, 'tram-rails', new THREE.MeshStandardMaterial({ color: 0xb2b7b8, metalness: .75, roughness: .36, side: THREE.DoubleSide })],
    [paint, 'mapped-crosswalks', citySurfaceMaterial('road_marking_white')],
    [wires, 'inferred-tram-contact-wires', new THREE.MeshLambertMaterial({ color: 0x252c2c, side: THREE.DoubleSide })],
  ] as [number[], string, THREE.Material][]) {
    if (!vertices.length) { material.dispose(); continue; }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(groundUvs(vertices, ix * TILE, iz * TILE), 2));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name; mesh.receiveShadow = true; mesh.userData.areaMaterial = true;
    group.add(mesh);
  }
  addAreaLamps(group, areaLampSpots(ix, iz), heightAt);
}
