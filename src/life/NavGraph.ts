// Walkable navigation graph for pedestrians: sidewalk centrelines, intersection corners + crosswalks,
// plaza terraces (grid) joined through the stairs and plaza entrances. A* pathfinding + spatial queries.
import * as THREE from 'three';
import type { World } from '../world/World';
import type { StreetSpec } from '../world/StreetGrid';
import type { Wall, FloorPatch } from '../player/Collision';
import { P2, pointInPolygon } from '../util/Geometry2D';
import type { Rng } from '../util/Rng';

export type NodeKind = 'sidewalk' | 'corner' | 'curb' | 'plaza' | 'stairs' | 'entrance' | 'boundary';
export type EdgeKind = 'sidewalk' | 'crosswalk' | 'plaza' | 'stairs';

export interface NavNode {
  id: number; x: number; y: number; z: number; kind: NodeKind;
  edges: number[];                 // edge ids
  halfW: number;                   // usable half width for lateral offsets (m)
  storefront: boolean;             // a building façade lies on the outward side
  facing: number;                  // yaw (rad) that faces the building / point of interest
  street?: StreetSpec; side?: number; region?: string;
  dead?: boolean;                  // not in the main connected component (excluded from queries)
}
export interface NavEdge { id: number; a: number; b: number; len: number; kind: EdgeKind; crossing: boolean; intersection: number; walkDir: 'ns' | 'ew' | null }
export interface NavIntersection { id: number; x: number; z: number; offset: number; signal: boolean }

const BOUNDS = 350;            // include the Chinatown, theater, and Powell-south blocks
const SPACING = 8;             // sidewalk node spacing (m)
const CYCLE = 60, NS_WALK: [number, number] = [0, 25], EW_WALK: [number, number] = [30, 55], CLEAR = 5;
const WCELL = 8;

export class NavGraph {
  nodes: NavNode[] = [];
  edges: NavEdge[] = [];
  intersections: NavIntersection[] = [];
  entrances = new Map<string, number>();
  private grid = new Map<number, number[]>(); // node spatial hash (16 m cells)
  private wallGrid = new Map<number, Wall[]>();
  private corners: number[] = [];
  private plazaPatches: FloorPatch[] = [];
  deadCount = 0;
  // A* scratch
  private gScore!: Float32Array; private cameFrom!: Int32Array; private closedStamp!: Int32Array; private openStamp!: Int32Array; private stamp = 0;

  constructor(public world: World) {
    this.plazaPatches = world.collision.patches.filter((p) => p.tag === 'plaza');
    this.buildWallGrid();
    this.buildStreets();
    this.buildPlaza();
    this.finalize();
  }

  // ---------------------------------------------------------------- helpers
  inPlaza(x: number, z: number) { return x >= -60 && x <= 60.5 && z >= -39 && z <= 39.5; }
  /** Floor inside the plaza from its terrace/stair/lawn patches only — the raw terrain pokes through the slabs in places. */
  plazaFloor(x: number, z: number, footY = Infinity, stepUp = 1.6): number | null {
    let best = -Infinity, any = -Infinity;
    for (const p of this.plazaPatches) {
      if (!pointInPolygon(x, z, p.poly)) continue;
      const h = p.height(x, z); if (h > any) any = h; if (h <= footY + stepUp && h > best) best = h;
    }
    return best > -Infinity ? best : any > -Infinity ? any : null;
  }
  floorY(x: number, z: number) {
    if (this.inPlaza(x, z)) { const h = this.plazaFloor(x, z); if (h !== null) return h; }
    return this.world.collision.floorAt(x, z, this.world.terrain.heightAt(x, z) + 0.5, 100);
  }
  private addNode(x: number, z: number, kind: NodeKind, extra: Partial<NavNode> = {}): number {
    const id = this.nodes.length;
    this.nodes.push({ id, x, y: this.floorY(x, z), z, kind, edges: [], halfW: 1.2, storefront: false, facing: 0, ...extra });
    const k = this.key(Math.floor(x / 16), Math.floor(z / 16)); let arr = this.grid.get(k); if (!arr) this.grid.set(k, (arr = [])); arr.push(id);
    return id;
  }
  private _v = new THREE.Vector3();
  /** True when a body of radius r at (x,z) is not intersecting any wall (e.g. not inside a kiosk footprint). */
  nodeClear(x: number, z: number, r = 0.5): boolean {
    const v = this._v.set(x, this.floorY(x, z), z);
    this.world.collision.resolve(v, r, 1.5, 2);
    return Math.abs(v.x - x) + Math.abs(v.z - z) < 1e-3;
  }
  private link(a: number, b: number, kind: EdgeKind, opts: Partial<NavEdge> = {}): number {
    if (a === b || a < 0 || b < 0) return -1;
    const A = this.nodes[a], B = this.nodes[b];
    for (const e of A.edges) { const ed = this.edges[e]; if (ed.a === b || ed.b === b) return e; }
    const id = this.edges.length;
    const e: NavEdge = { id, a, b, len: Math.hypot(A.x - B.x, A.z - B.z), kind, crossing: false, intersection: -1, walkDir: null, ...opts };
    this.edges.push(e); A.edges.push(id); B.edges.push(id);
    return id;
  }
  private key(cx: number, cz: number) { return (cx + 4096) * 8192 + (cz + 4096); }
  private buildWallGrid() {
    for (const w of this.world.collision.walls) {
      const minx = Math.floor(Math.min(w.ax, w.bx) / WCELL), maxx = Math.floor(Math.max(w.ax, w.bx) / WCELL);
      const minz = Math.floor(Math.min(w.az, w.bz) / WCELL), maxz = Math.floor(Math.max(w.az, w.bz) / WCELL);
      for (let cx = minx; cx <= maxx; cx++) for (let cz = minz; cz <= maxz; cz++) { const k = this.key(cx, cz); let arr = this.wallGrid.get(k); if (!arr) this.wallGrid.set(k, (arr = [])); arr.push(w); }
    }
  }
  /** Does the 2D segment a→b cross a wall that spans the body height at y? */
  wallHit(ax: number, az: number, bx: number, bz: number, y: number, ignoreBuildings = false): boolean {
    const minx = Math.floor(Math.min(ax, bx) / WCELL), maxx = Math.floor(Math.max(ax, bx) / WCELL);
    const minz = Math.floor(Math.min(az, bz) / WCELL), maxz = Math.floor(Math.max(az, bz) / WCELL);
    for (let cx = minx; cx <= maxx; cx++) for (let cz = minz; cz <= maxz; cz++) {
      const arr = this.wallGrid.get(this.key(cx, cz)); if (!arr) continue;
      for (const w of arr) {
        if (w.y1 < y + 0.3 || w.y0 > y + 1.6) continue;
        if (ignoreBuildings && w.tag && w.tag.startsWith('bld:')) continue;
        if (segIntersect(ax, az, bx, bz, w.ax, w.az, w.bx, w.bz)) return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- streets
  private specAt(axis: 'ns' | 'ew', c: number, along: number): StreetSpec | undefined {
    return this.world.streetSpecs.find((s) => s.axis === axis && Math.abs(s.c - c) < 0.5 && along >= Math.min(s.from, s.to) - 0.5 && along <= Math.max(s.from, s.to) + 0.5);
  }
  private buildStreets() {
    const w = this.world;
    // --- intersections (dedupe stacked specs, e.g. the three Powell segments) ---
    const seen = new Map<string, number>();
    const cornerOf = new Map<string, number>(); // `${int},${sx},${sz}` -> node id
    const curbNS = new Map<string, number>(), curbEW = new Map<string, number>();
    for (const c of w.streets.crossings) {
      if (Math.abs(c.x) > BOUNDS || Math.abs(c.z) > BOUNDS) continue;
      const k = `${Math.round(c.x)},${Math.round(c.z)}`;
      if (seen.has(k)) continue;
      const id = this.intersections.length;
      seen.set(k, id);
      const h = Math.abs(Math.sin(c.x * 12.9898 + c.z * 78.233) * 43758.5453);
      this.intersections.push({ id, x: c.x, z: c.z, offset: (h - Math.floor(h)) * CYCLE, signal: c.signal });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const ns = this.specAt('ns', c.x, c.z + sz * (c.b.width / 2 + 2)) || c.a;
        const ew = this.specAt('ew', c.z, c.x + sx * (c.a.width / 2 + 2)) || c.b;
        const hwA = ns.width / 2, hwB = ew.width / 2;
        const cx = c.x + sx * (hwA + ns.sidewalk / 2), cz = c.z + sz * (hwB + ew.sidewalk / 2);
        const corner = this.addNode(cx, cz, 'corner', { halfW: Math.max(0.5, Math.min(ns.sidewalk, ew.sidewalk) / 2 - 0.5) });
        cornerOf.set(`${id},${sx},${sz}`, corner); this.corners.push(corner);
        // curb nodes: one for the crossing over the ns street (walk ew), one for the crossing over the ew street (walk ns)
        const nsCurb = this.addNode(c.x + sx * (hwA + 0.7), c.z + sz * (hwB + 1.5), 'curb', { halfW: 0.6 });
        const ewCurb = this.addNode(c.x + sx * (hwA + 1.5), c.z + sz * (hwB + 0.7), 'curb', { halfW: 0.6 });
        curbNS.set(`${id},${sx},${sz}`, nsCurb); curbEW.set(`${id},${sx},${sz}`, ewCurb);
        this.link(corner, nsCurb, 'sidewalk'); this.link(corner, ewCurb, 'sidewalk');
      }
      // crosswalk edges
      for (const sz of [-1, 1]) this.link(curbNS.get(`${id},-1,${sz}`)!, curbNS.get(`${id},1,${sz}`)!, 'crosswalk', { crossing: c.signal, intersection: id, walkDir: 'ew' });
      for (const sx of [-1, 1]) this.link(curbEW.get(`${id},${sx},-1`)!, curbEW.get(`${id},${sx},1`)!, 'crosswalk', { crossing: c.signal, intersection: id, walkDir: 'ns' });
    }
    // --- sidewalk chains along every road segment, both sides ---
    const plazaBlock = (x: number, z: number) => x > -63 && x < 63 && z > -42 && z < 42;
    for (const seg of w.streets.segments) {
      const s = seg.street, hw = s.width / 2;
      if (Math.abs(s.c) > BOUNDS) continue;
      const from = Math.max(seg.from, -BOUNDS), to = Math.min(seg.to, BOUNDS);
      if (to - from < 1) continue;
      for (const side of [-1, 1]) {
        const c = s.c + side * (hw + s.sidewalk / 2);
        const n = Math.max(1, Math.round((to - from) / SPACING));
        const nx = s.axis === 'ns' ? side : 0, nz = s.axis === 'ns' ? 0 : side;
        const facing = Math.atan2(nx, nz);
        let prev = -1;
        for (let i = 0; i <= n; i++) {
          const t = from + ((to - from) * i) / n;
          const x = s.axis === 'ns' ? c : t, z = s.axis === 'ns' ? t : c;
          const boundary = Math.abs(t) >= BOUNDS - 0.01;
          const id = this.addNode(x, z, boundary ? 'boundary' : 'sidewalk', { halfW: Math.max(0.4, s.sidewalk / 2 - 0.5), street: s, side, facing });
          const nd = this.nodes[id];
          if (!boundary && !plazaBlock(x + nx * 5, z + nz * 5)) nd.storefront = this.wallHit(x, z, x + nx * (s.sidewalk / 2 + 2.5), z + nz * (s.sidewalk / 2 + 2.5), nd.y);
          if (prev >= 0) this.link(prev, id, 'sidewalk');
          prev = id;
          // hook segment ends to the nearest intersection corner
          if (i === 0 || i === n) {
            const corner = this.nearestOf(this.corners, x, z, s.sidewalk + 2.5);
            if (corner >= 0) this.link(id, corner, 'sidewalk');
          }
        }
      }
    }
  }
  private nearestOf(ids: number[], x: number, z: number, maxD: number): number {
    let best = -1, bd = maxD * maxD;
    for (const id of ids) { const n = this.nodes[id]; const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = id; } }
    return best;
  }

  // ---------------------------------------------------------------- plaza
  private buildPlaza() {
    const cols: number[] = []; for (let x = -56; x <= 56.1; x += 7) cols.push(x);
    const regions: { name: string; pts: P2[]; halfW?: number }[] = [];
    const R = (name: string, pts: P2[], halfW = 2.5) => regions.push({ name, pts, halfW });
    const lawn = (x: number, z: number) => ((x > -52 && x < -22) || (x > 22 && x < 52)) && z > -34 && z < -16;
    // central deck (0) + north terrace (+0.9, NW ramp to +1.6): one region — the seat-step band between them is wall-free.
    // Keep clear of the monument plinth (|x|,|z| < 7) and the two lawns; the x=±56 column moves to ±54.5 north of the palms.
    const deck: P2[] = [];
    for (const z of [-8.5, -4, 0, 4, 8.5]) for (const x of cols) { if (Math.abs(x) < 7 && Math.abs(z) < 7) continue; deck.push([x, z]); }
    deck.push([0, 12.5]);
    for (const z of [-14, -20, -26, -32, -37]) for (const x of cols) { const xx = Math.abs(x) === 56 ? Math.sign(x) * 54.5 : x; if (lawn(xx, z)) continue; deck.push([xx, z]); }
    R('deck', deck);
    // south promenade (-1); the central stair occupies x∈[-6,6] z∈[15,21]
    // (an invisible OSM garage footprint wall runs along z≈21.2 for x>11.5 — keep the rows north of it)
    const prom: P2[] = [];
    for (const z of [17.2, 19.8]) for (const x of cols) { if (Math.abs(x) < 7) continue; prom.push([x, z]); }
    for (const x of [-31.7, -19.3, 16.1]) prom.push([x, 19.8]);
    prom.push([0, 22.3], [-7, 22.3], [7, 22.3]);
    R('promenade', prom, 1.6);
    // garage portal deck (-1)
    R('portal', [[-7, 28], [0, 28], [7, 28], [-7, 35], [0, 35], [7, 35]], 2);
    // corner entrance plazas (-4 / -4.6)
    R('sw', [[-53, 29], [-47, 29], [-53, 35], [-47, 35], [-50, 39]], 2);
    R('se', [[47, 29], [53, 29], [47, 35], [53, 35], [50, 39]], 2);
    const byRegion = new Map<string, number[]>();
    for (const r of regions) {
      const ids: number[] = [];
      for (const [x0, z0] of r.pts) if (this.nodeClear(x0, z0)) ids.push(this.addNode(x0, z0, 'plaza', { halfW: r.halfW, region: r.name, facing: Math.atan2(-x0, -z0) }));
      byRegion.set(r.name, ids);
      const canLink = (A: NavNode, B: NavNode, maxD: number) => {
        const d = Math.hypot(A.x - B.x, A.z - B.z); if (d > maxD) return false;
        if (segPointDist(A.x, A.z, B.x, B.z, 0, 0) < 6.5) return false;
        for (const t of [0.25, 0.5, 0.75]) if (lawn(A.x + (B.x - A.x) * t, A.z + (B.z - A.z) * t)) return false;
        if (Math.abs(A.y - B.y) > 1.2) return false;
        return !this.wallHit(A.x, A.z, B.x, B.z, Math.min(A.y, B.y));
      };
      // pass 1: grid neighbours (≤ 10.2 m); pass 2: bridge holes left by collider-rejected nodes (≤ 15 m) for sparse nodes
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (canLink(this.nodes[ids[i]], this.nodes[ids[j]], 10.2)) this.link(ids[i], ids[j], 'plaza');
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const A = this.nodes[ids[i]], B = this.nodes[ids[j]];
        if (A.edges.length >= 3 && B.edges.length >= 3) continue;
        if (canLink(A, B, 15)) this.link(ids[i], ids[j], 'plaza');
      }
    }
    const at = (region: string, x: number, z: number) => this.nearestOf(byRegion.get(region)!, x, z, 5);
    const stairChain = (pts: [number, number][], kind: EdgeKind = 'stairs') => { let prev = -1; for (const [x, z] of pts) { const id = this.addNode(x, z, 'stairs', { halfW: 1.0, region: 'stairs' }); if (prev >= 0) this.link(prev, id, kind); prev = id; } return prev; };
    const S = (a: number, b: number) => this.link(a, b, 'stairs');
    // central stair (x -6..6, z 15..21) down to the promenade
    { const top = at('deck', 0, 12.5), first = this.nodes.length, last = stairChain([[0, 16], [0, 19.5]]); S(top, first); S(last, at('promenade', 0, 22.3)); }
    // lawn stairs down to Geary (x = -31.7, -19.3, 16.1)
    for (const x of [-31.7, -19.3, 16.1]) {
      const bottom = stairChain([[x, 26], [x, 32], [x, 38]]);
      S(at('promenade', x, 19.8), bottom - 2);
      this.entranceLink(bottom, x, 42, 'stairs');
    }
    // SW corner stair (x -44..-41 rises from the corner plaza to the promenade level)
    { const top = stairChain([[-41.5, 31], [-41.5, 25]]); S(at('sw', -47, 29), top - 1); S(top, at('promenade', -42, 19.8)); }
    // corner plazas open onto the Geary sidewalk
    this.entranceLink(at('sw', -50, 39), -50, 43, 'plaza'); this.entranceLink(at('se', 50, 39), 50, 43, 'plaza');
    // east stairs to Stockton: central (z -10..10), NE (z -39..-30), SE (z 23.4..33)
    { const e = this.addNode(61.5, 0, 'entrance', { halfW: 1.5 }); S(at('deck', 56, 0), e); this.entranceLink(e, 65, 0, 'stairs'); }
    { const e = this.addNode(61.5, -34.5, 'entrance', { halfW: 1.5 }); S(at('deck', 54.5, -32), e); S(at('deck', 54.5, -37), e); this.entranceLink(e, 65, -34.5, 'stairs'); }
    { const s = stairChain([[56, 28]]); const e = this.addNode(61.5, 28, 'entrance', { halfW: 1.5 }); S(at('promenade', 56, 19.8), s); S(s, e); this.entranceLink(e, 65, 28, 'stairs'); }
    // west steps to Powell (z -8..8), passing either side of the sculpture at (-57.5, 0)
    for (const z of [-4, 4]) { const e = this.addNode(-61.5, z * 0.75, 'entrance', { halfW: 1.5 }); S(at('deck', -56, z), e); this.entranceLink(e, -65, z * 0.75, 'stairs'); }
    // north edge: open (no wall) west of x = -20 → step down/up to the Post sidewalk
    for (const x of [-54.5, -49, -42, -35, -28, -21]) this.entranceLink(at('deck', x, -37), x, -43, 'stairs');
  }
  /** Link a node to the nearest sidewalk-ish node near (x,z). */
  private entranceLink(from: number, x: number, z: number, kind: EdgeKind) {
    if (from < 0) return;
    const F = this.nodes[from];
    const cands = this.nodesWithin(x, z, 10, (n) => n.kind === 'sidewalk' || n.kind === 'corner').sort((a, b) => (this.nodes[a].x - x) ** 2 + (this.nodes[a].z - z) ** 2 - (this.nodes[b].x - x) ** 2 - (this.nodes[b].z - z) ** 2);
    for (const to of cands.slice(0, 4)) { const T = this.nodes[to]; if (!this.wallHit(F.x, F.z, T.x, T.z, Math.min(F.y, T.y), true)) { this.link(from, to, kind); return; } }
  }

  // ---------------------------------------------------------------- finalize / queries
  private finalize() {
    // keep only the largest connected component; everything else is unreachable and must not be a target
    const comp = new Int32Array(this.nodes.length).fill(-1); const sizes: number[] = [];
    for (let s = 0; s < this.nodes.length; s++) {
      if (comp[s] >= 0) continue;
      const c = sizes.length; const stack = [s]; comp[s] = c; let n = 0;
      while (stack.length) { const cur = stack.pop()!; n++; for (const e of this.nodes[cur].edges) { const o = this.other(this.edges[e], cur); if (comp[o] < 0) { comp[o] = c; stack.push(o); } } }
      sizes.push(n);
    }
    let main = 0; for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[main]) main = i;
    this.deadCount = 0;
    for (const n of this.nodes) if (comp[n.id] !== main) { n.dead = true; this.deadCount++; }
    const N = this.nodes.length;
    this.gScore = new Float32Array(N); this.cameFrom = new Int32Array(N); this.closedStamp = new Int32Array(N); this.openStamp = new Int32Array(N);
  }
  nearest(x: number, z: number, filter?: (n: NavNode) => boolean): number {
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    let best = -1, bd = Infinity;
    for (let ring = 0; ring <= 4; ring++) {
      for (let ox = -ring; ox <= ring; ox++) for (let oz = -ring; oz <= ring; oz++) {
        if (Math.max(Math.abs(ox), Math.abs(oz)) !== ring) continue;
        const arr = this.grid.get(this.key(cx + ox, cz + oz)); if (!arr) continue;
        for (const id of arr) { const n = this.nodes[id]; if (n.dead || (filter && !filter(n))) continue; const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = id; } }
      }
      if (best >= 0 && Math.sqrt(bd) < ring * 16) break;
    }
    return best;
  }
  nodesWithin(x: number, z: number, r: number, filter?: (n: NavNode) => boolean): number[] {
    const out: number[] = [];
    const r2 = r * r;
    for (let cx = Math.floor((x - r) / 16); cx <= Math.floor((x + r) / 16); cx++) for (let cz = Math.floor((z - r) / 16); cz <= Math.floor((z + r) / 16); cz++) {
      const arr = this.grid.get(this.key(cx, cz)); if (!arr) continue;
      for (const id of arr) { const n = this.nodes[id]; if (!n.dead && (n.x - x) ** 2 + (n.z - z) ** 2 <= r2 && (!filter || filter(n))) out.push(id); }
    }
    return out;
  }
  randomNode(rng: Rng, kind?: NodeKind | ((n: NavNode) => boolean)): number {
    const g = typeof kind === 'function' ? kind : kind ? (n: NavNode) => n.kind === kind : null;
    const f = (n: NavNode) => !n.dead && (!g || g(n));
    for (let i = 0; i < 64; i++) { const id = Math.floor(rng.next() * this.nodes.length); if (f(this.nodes[id])) return id; }
    const all = this.nodes.filter(f); return all.length ? all[Math.floor(rng.next() * all.length)].id : 0;
  }
  /** Register a store entrance (door) and link it to the nearest sidewalk node. Returns the node id. */
  addEntrance(id: string, x: number, z: number): number {
    const existing = this.entrances.get(id); if (existing !== undefined) return existing;
    const n = this.addNode(x, z, 'entrance', { halfW: 0.6, facing: 0 });
    const to = this.nearest(x, z, (m) => m.kind === 'sidewalk' || m.kind === 'corner');
    if (to >= 0) { this.link(n, to, 'sidewalk'); const T = this.nodes[to]; this.nodes[n].facing = Math.atan2(x - T.x, z - T.z); }
    if (this.gScore.length < this.nodes.length) { const N = this.nodes.length + 64; this.gScore = new Float32Array(N); this.cameFrom = new Int32Array(N); this.closedStamp = new Int32Array(N); this.openStamp = new Int32Array(N); }
    this.entrances.set(id, n);
    return n;
  }
  other(e: NavEdge, n: number) { return e.a === n ? e.b : e.a; }
  edgeBetween(a: number, b: number): NavEdge | null { for (const id of this.nodes[a].edges) { const e = this.edges[id]; if (e.a === b || e.b === b) return e; } return null; }

  // ---------------------------------------------------------------- signals
  /** Pedestrian signal: may an agent START crossing `edge` at time t (walk phase and not in the last CLEAR seconds)? */
  /** Optional live signal hook (TrafficLights.state) so pedestrians obey the same clock as vehicles. */
  lights: ((x: number, z: number) => { walkNS: boolean; walkEW: boolean } | null) | null = null;
  crossingOpen(e: NavEdge, t: number): boolean {
    if (!e.crossing) return true;
    const it = this.intersections[e.intersection]; if (!it || !it.signal) return true;
    if (this.lights) { const st = this.lights((it as any).x, (it as any).z); if (st) return e.walkDir === 'ns' ? st.walkNS : st.walkEW; }
    const p = (t + it.offset) % CYCLE;
    const w = e.walkDir === 'ns' ? NS_WALK : EW_WALK;
    return p >= w[0] && p < w[1] - CLEAR;
  }
  signalPhase(intersection: number, t: number): 'ns' | 'ew' | 'none' {
    const it = this.intersections[intersection]; if (!it) return 'none';
    const p = (t + it.offset) % CYCLE;
    if (p >= NS_WALK[0] && p < NS_WALK[1]) return 'ns'; if (p >= EW_WALK[0] && p < EW_WALK[1]) return 'ew'; return 'none';
  }

  // ---------------------------------------------------------------- A*
  /** Shortest path (node ids, inclusive) or null. `avoidStairs` adds a cost to stairs edges. */
  path(from: number, to: number, opts: { stairsCost?: number; crossingCost?: number; maxNodes?: number } = {}): number[] | null {
    if (from < 0 || to < 0) return null;
    if (from === to) return [from];
    const stairsCost = opts.stairsCost ?? 1.3, crossingCost = opts.crossingCost ?? 6, maxNodes = opts.maxNodes ?? 4000;
    const stamp = ++this.stamp;
    const nodes = this.nodes, edges = this.edges, g = this.gScore, came = this.cameFrom, closed = this.closedStamp, open = this.openStamp;
    const T = nodes[to];
    const h = (n: NavNode) => Math.hypot(n.x - T.x, n.z - T.z);
    const heap = new MinHeap();
    g[from] = 0; came[from] = -1; open[from] = stamp; heap.push(from, h(nodes[from]));
    let expanded = 0;
    while (heap.size) {
      const cur = heap.pop();
      if (cur === to) break;
      if (closed[cur] === stamp) continue;
      closed[cur] = stamp;
      if (++expanded > maxNodes) return null;
      const N = nodes[cur];
      for (const eid of N.edges) {
        const e = edges[eid]; const nb = e.a === cur ? e.b : e.a;
        if (closed[nb] === stamp) continue;
        let cost = e.len; if (e.kind === 'stairs') cost *= stairsCost; if (e.crossing) cost += crossingCost;
        const ng = g[cur] + cost;
        if (open[nb] !== stamp || ng < g[nb]) { g[nb] = ng; came[nb] = cur; open[nb] = stamp; heap.push(nb, ng + h(nodes[nb])); }
      }
    }
    if (closed[to] !== stamp && open[to] !== stamp) return null;
    if (came[to] === -1 && to !== from) return null;
    const out: number[] = []; let c = to; let guard = 0;
    while (c !== -1 && guard++ < 100000) { out.push(c); c = came[c]; }
    out.reverse();
    return out[0] === from ? out : null;
  }
  stats() { return { nodes: this.nodes.length, edges: this.edges.length, intersections: this.intersections.length, dead: this.deadCount }; }
}

// ---------------------------------------------------------------- utilities
class MinHeap {
  private ids: number[] = []; private keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, k: number) {
    const ids = this.ids, keys = this.keys; ids.push(id); keys.push(k);
    let i = ids.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (keys[p] <= keys[i]) break; [ids[p], ids[i]] = [ids[i], ids[p]]; [keys[p], keys[i]] = [keys[i], keys[p]]; i = p; }
  }
  pop(): number {
    const ids = this.ids, keys = this.keys; const top = ids[0]; const li = ids.pop()!, lk = keys.pop()!;
    if (ids.length) {
      ids[0] = li; keys[0] = lk; let i = 0; const n = ids.length;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < n && keys[l] < keys[m]) m = l; if (r < n && keys[r] < keys[m]) m = r; if (m === i) break; [ids[m], ids[i]] = [ids[i], ids[m]]; [keys[m], keys[i]] = [keys[i], keys[m]]; i = m; }
    }
    return top;
  }
}
function segIntersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx), d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
export function segPointDist(ax: number, az: number, bx: number, bz: number, px: number, pz: number): number {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}
