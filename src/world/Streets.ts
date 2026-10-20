// Roads, sidewalks, curbs, markings, crosswalks and cable-car rails built from the analytic street grid, draped on terrain.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Materials } from '../materials/Library';
import { StreetSpec, Intersection, intersections } from './StreetGrid';
import type { Terrain } from './Terrain';
import type { CollisionWorld } from '../player/Collision';
import { buildMarkingsTexture, applyMarkingsOverlay } from './RoadMarkings';

const ROAD_Y = 0.02, CURB = 0.15;

export interface RoadSegment { street: StreetSpec; from: number; to: number; }

export class Streets {
  group = new THREE.Group();
  segments: RoadSegment[] = [];
  crossings: Intersection[] = [];
  private roadGeos: THREE.BufferGeometry[] = [];
  private walkGeos: THREE.BufferGeometry[] = [];
  private curbGeos: THREE.BufferGeometry[] = [];
  private whiteGeos: THREE.BufferGeometry[] = [];
  private yellowGeos: THREE.BufferGeometry[] = [];
  private railGeos: THREE.BufferGeometry[] = [];
  private slotGeos: THREE.BufferGeometry[] = [];
  private redGeos: THREE.BufferGeometry[] = [];
  private brickGeos: THREE.BufferGeometry[] = [];
  constructor(public streets: StreetSpec[], public terrain: Terrain, public collision: CollisionWorld) {
    this.group.name = 'streets';
    this.crossings = intersections(streets);
    for (const s of streets) this.buildStreet(s);
    for (const c of this.crossings) this.buildIntersection(c);
    const add = (geos: THREE.BufferGeometry[], mat: string, name: string, shadow = true) => {
      if (!geos.length) return;
      const g = mergeGeometries(geos, false); const m = new THREE.Mesh(g, Materials.get(mat)); m.name = name; m.receiveShadow = shadow; m.castShadow = false; this.group.add(m);
    };
    const marks = buildMarkingsTexture(streets, this.crossings);
    const asphalt = (Materials.get('asphalt') as THREE.MeshStandardMaterial).clone(); applyMarkingsOverlay(asphalt, marks);
    if (this.roadGeos.length || this.brickGeos.length) { const g = mergeGeometries([...this.roadGeos, ...this.brickGeos], false); const m = new THREE.Mesh(g, asphalt); m.name = 'roads'; m.receiveShadow = true; this.group.add(m); }
    add(this.walkGeos, 'concrete', 'sidewalks');
    add(this.curbGeos, 'curb', 'curbs');
    add(this.railGeos, 'steel', 'rails');
    add(this.slotGeos, 'plastic_black', 'rail_slots');
  }
  h(x: number, z: number) { return this.terrain.heightAt(x, z); }

  /** Draped quad strip along an axis. a..b along the axis, [c0,c1] across; y offset added to terrain. */
  private strip(axis: 'ns' | 'ew', a: number, b: number, c0: number, c1: number, yOff: number, step = 3, uvScale = 1): THREE.BufferGeometry {
    const len = Math.abs(b - a); const n = Math.max(1, Math.ceil(len / step));
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = a + ((b - a) * i) / n;
      for (const c of [c0, c1]) {
        const x = axis === 'ns' ? c : t, z = axis === 'ns' ? t : c;
        pos.push(x, this.h(x, z) + yOff, z); uv.push(x * uvScale, z * uvScale);
      }
    }
    for (let i = 0; i < n; i++) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    g.computeVertexNormals();
    // ensure upward normals
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute; if (nrm.getY(0) < 0) { const ix = g.getIndex()!; for (let i = 0; i < ix.count; i += 3) { const t = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, t); } g.computeVertexNormals(); }
    return g;
  }
  /** Vertical curb face along an axis from a..b at across-position c, rising from road to sidewalk level. */
  private curbFace(axis: 'ns' | 'ew', a: number, b: number, c: number, outward: number): THREE.BufferGeometry {
    const n = Math.max(1, Math.ceil(Math.abs(b - a) / 3));
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = a + ((b - a) * i) / n; const x = axis === 'ns' ? c : t, z = axis === 'ns' ? t : c; const y = this.h(x, z);
      pos.push(x, y + ROAD_Y, z, x, y + CURB, z); uv.push(t, 0, t, 0.15);
    }
    for (let i = 0; i < n; i++) { const k = i * 2; if (outward > 0) idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); else idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  private flatQuad(x0: number, x1: number, z0: number, z1: number, yOff: number): THREE.BufferGeometry {
    // small flat quad draped at its centre height (used for markings); subdivide if large
    return this.strip('ew', x0, x1, z0, z1, yOff, 3);
  }
  private buildStreet(s: StreetSpec) {
    const hw = s.width / 2;
    // find intersections along this street, sorted
    const lo = Math.min(s.from, s.to), hi = Math.max(s.from, s.to);
    const xs = this.crossings.filter((c) => (c.a.name === s.name && Math.abs(c.a.c - s.c) < 0.5) || (c.b.name === s.name && Math.abs(c.b.c - s.c) < 0.5))
      .map((c) => ({ t: s.axis === 'ns' ? c.z : c.x, other: c.a.name === s.name ? c.b : c.a })).filter((p) => p.t > lo - 1 && p.t < hi + 1).sort((p, q) => p.t - q.t);
    let cur = lo;
    const segs: RoadSegment[] = [];
    for (const x of xs) { const a = cur, b = x.t - x.other.width / 2 - (x.other.pedestrian ? 0 : 0); if (b > a + 0.5) segs.push({ street: s, from: a, to: b }); cur = x.t + x.other.width / 2; }
    if (hi > cur + 0.5) segs.push({ street: s, from: cur, to: hi });
    for (const seg of segs) {
      this.segments.push(seg);
      // road
      (s.surface === 'brick' ? this.brickGeos : this.roadGeos).push(this.strip(s.axis, seg.from, seg.to, s.c - hw, s.c + hw, ROAD_Y, 3));
      // sidewalks + curbs (both sides)
      for (const side of [-1, 1]) {
        const c0 = s.c + side * hw, c1 = s.c + side * (hw + s.sidewalk);
        this.walkGeos.push(this.strip(s.axis, seg.from, seg.to, Math.min(c0, c1), Math.max(c0, c1), CURB, 3));
        this.curbGeos.push(this.curbFace(s.axis, seg.from, seg.to, c0, side));
      }
      // cable car: two tracks centred at ±1.55 m
      if (s.cableCar) for (const tc of [-1.55, 1.55]) this.rails(s.axis, seg.from - 0.0, seg.to + 0.0, s.c + tc);
      continue;
      // (lane markings, transit lanes and crosswalks are painted by RoadMarkings.ts)
      // lane markings
      const len = seg.to - seg.from;
      const lanesTotal = s.lanes;
      const park = (s.parking.left ? 1 : 0) + (s.parking.right ? 1 : 0);
      const drive = s.width - park * 2.4;
      const laneW = drive / Math.max(1, lanesTotal);
      const leftEdge = s.c - hw + (s.parking.left ? 2.4 : 0);
      // dashed lines between lanes (same direction) and centre line
      for (let l = 1; l < lanesTotal; l++) {
        const c = leftEdge + l * laneW;
        const isCentre = s.oneway === null && l === Math.floor(lanesTotal / 2) && lanesTotal % 2 === 0;
        if (isCentre && s.centerLine !== 'none') {
          for (const off of [-0.12, 0.12]) this.yellowGeos.push(s.axis === 'ns' ? this.strip('ns', seg.from + 1, seg.to - 1, c + off - 0.06, c + off + 0.06, ROAD_Y + 0.006, 3) : this.strip('ew', seg.from + 1, seg.to - 1, c + off - 0.06, c + off + 0.06, ROAD_Y + 0.006, 3));
        } else if (!s.cableCar || Math.abs(c - s.c) > 3.0) {
          for (let d = seg.from + 1; d < seg.to - 3; d += 6) this.whiteGeos.push(this.strip(s.axis, d, d + 3, c - 0.06, c + 0.06, ROAD_Y + 0.006, 3));
        }
      }
      // parking lane edge line (solid white)
      if (s.parking.left) this.whiteGeos.push(this.strip(s.axis, seg.from + 1, seg.to - 1, leftEdge - 0.06, leftEdge + 0.06, ROAD_Y + 0.006, 3));
      if (s.parking.right) { const c = s.c + hw - 2.4; this.whiteGeos.push(this.strip(s.axis, seg.from + 1, seg.to - 1, c - 0.06, c + 0.06, ROAD_Y + 0.006, 3)); }
      // transit-only red lane(s)
      if (s.transitLane === 'max') { const c = s.c + hw - (s.parking.right ? 2.4 : 0) - laneW; this.redGeos.push(this.strip(s.axis, seg.from + 0.5, seg.to - 0.5, c + 0.1, c + laneW - 0.1, ROAD_Y + 0.004, 3)); }
      else if (s.transitLane === 'min') { const c = leftEdge; this.redGeos.push(this.strip(s.axis, seg.from + 0.5, seg.to - 0.5, c + 0.1, c + laneW - 0.1, ROAD_Y + 0.004, 3)); }
      else if (s.transitLane === 'center') { const lw = Math.min(laneW, 3.3); for (const side of [-1, 1]) { const c0 = side < 0 ? s.c - lw : s.c; this.redGeos.push(this.strip(s.axis, seg.from + 0.5, seg.to - 0.5, c0 + 0.1, c0 + lw - 0.1, ROAD_Y + 0.004, 3)); } }
      // cable car: two tracks centred at ±1.75 m
      if (s.cableCar) for (const tc of [-1.75, 1.75]) this.rails(s.axis, seg.from - 0.0, seg.to + 0.0, s.c + tc);
      void len;
    }
  }
  private rails(axis: 'ns' | 'ew', a: number, b: number, c: number) {
    const g = 1.067 / 2;
    for (const off of [-g, g]) this.railGeos.push(this.strip(axis, a, b, c + off - 0.035, c + off + 0.035, ROAD_Y + 0.012, 3));
    this.slotGeos.push(this.strip(axis, a, b, c - 0.02, c + 0.02, ROAD_Y + 0.013, 3));
  }
  private buildIntersection(c: Intersection) {
    const a = c.a, b = c.b; // a = ns, b = ew
    const hwA = a.width / 2, hwB = b.width / 2;
    // asphalt box
    this.roadGeos.push(this.strip('ew', c.x - hwA, c.x + hwA, c.z - hwB, c.z + hwB, ROAD_Y, 3));
    // corner sidewalk squares
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x0 = c.x + sx * hwA, x1 = c.x + sx * (hwA + a.sidewalk), z0 = c.z + sz * hwB, z1 = c.z + sz * (hwB + b.sidewalk);
      this.walkGeos.push(this.strip('ew', Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1), CURB, 3));
      // curb faces on the two exposed edges
      this.curbGeos.push(this.curbFace('ns', Math.min(z0, z1), Math.max(z0, z1), x0, sx));
      this.curbGeos.push(this.curbFace('ew', Math.min(x0, x1), Math.max(x0, x1), z0, sz));
    }
    // cable car rails continue through the intersection
    if (a.cableCar) for (const tc of [-1.55, 1.55]) this.rails('ns', c.z - hwB, c.z + hwB, a.c + tc);
    if (b.cableCar) for (const tc of [-1.55, 1.55]) this.rails('ew', c.x - hwA, c.x + hwA, b.c + tc);
    return;   // crosswalks + stop bars are painted by RoadMarkings.ts
    // crosswalks (continental): across a (ns street) at north & south edges; across b at east & west edges
    const barW = 0.6, gap = 0.6, cwDepth = 3.0;
    for (const sz of [-1, 1]) { // crossing the ns street (bars run along z)
      const zc = c.z + sz * (hwB + cwDepth / 2);
      for (let x = c.x - hwA + 0.6; x < c.x + hwA - 0.3; x += barW + gap) this.whiteGeos.push(this.strip('ns', zc - cwDepth / 2, zc + cwDepth / 2, x, x + barW, ROAD_Y + 0.006, 3));
      // stop bar
      const stopZ = c.z + sz * (hwB + cwDepth + 0.6);
      const half = a.oneway ? [c.x - hwA + 0.3, c.x + hwA - 0.3] : sz < 0 ? [c.x, c.x + hwA - 0.3] : [c.x - hwA + 0.3, c.x];
      this.whiteGeos.push(this.strip('ew', half[0], half[1], stopZ - 0.25, stopZ + 0.25, ROAD_Y + 0.006, 3));
    }
    for (const sx of [-1, 1]) {
      const xc = c.x + sx * (hwA + cwDepth / 2);
      for (let z = c.z - hwB + 0.6; z < c.z + hwB - 0.3; z += barW + gap) this.whiteGeos.push(this.strip('ew', xc - cwDepth / 2, xc + cwDepth / 2, z, z + barW, ROAD_Y + 0.006, 3));
      const stopX = c.x + sx * (hwA + cwDepth + 0.6);
      const half = b.oneway ? [c.z - hwB + 0.3, c.z + hwB - 0.3] : sx < 0 ? [c.z - hwB + 0.3, c.z] : [c.z, c.z + hwB - 0.3];
      this.whiteGeos.push(this.strip('ns', half[0], half[1], stopX - 0.25, stopX + 0.25, ROAD_Y + 0.006, 3));
    }
  }
  /** Sidewalk surface height (for walking) at a point: terrain + curb. */
  static SIDEWALK_Y = CURB;
  static ROAD_Y = ROAD_Y;
}
