// Lightweight collision world: wall segments (with height range) + floor patches. Spatial hash for speed.
import * as THREE from 'three';
import { P2, pointInPolygon, segClosest } from '../util/Geometry2D';

export interface Wall { ax: number; az: number; bx: number; bz: number; y0: number; y1: number; tag?: string }
export interface FloorPatch { poly: P2[]; height: (x: number, z: number) => number; tag?: string; priority?: number }

const CELL = 8;

export class CollisionWorld {
  walls: Wall[] = [];
  private grid = new Map<string, Wall[]>();
  patches: FloorPatch[] = [];
  private patchGrid = new Map<string, FloorPatch[]>();
  terrain: (x: number, z: number) => number = () => 0;
  disabledTags = new Set<string>();

  private key(cx: number, cz: number) { return `${cx},${cz}`; }
  addWall(w: Wall) {
    this.walls.push(w);
    const minx = Math.floor(Math.min(w.ax, w.bx) / CELL), maxx = Math.floor(Math.max(w.ax, w.bx) / CELL);
    const minz = Math.floor(Math.min(w.az, w.bz) / CELL), maxz = Math.floor(Math.max(w.az, w.bz) / CELL);
    for (let cx = minx; cx <= maxx; cx++) for (let cz = minz; cz <= maxz; cz++) {
      const k = this.key(cx, cz); let arr = this.grid.get(k); if (!arr) this.grid.set(k, (arr = [])); arr.push(w);
    }
  }
  /** Release a streamed tile's walls from both the public list and spatial hash. */
  removeWallsByTag(tag: string) {
    this.walls = this.walls.filter((w) => w.tag !== tag);
    for (const [key, walls] of this.grid) {
      const keep = walls.filter((w) => w.tag !== tag);
      if (keep.length) this.grid.set(key, keep);
      else this.grid.delete(key);
    }
  }
  /** Add a closed polygon as walls (footprint). `openings` = list of [i, t0, t1] edge index + param range to skip (doors). */
  addPolygon(poly: P2[], y0: number, y1: number, tag?: string, openings: { edge: number; t0: number; t1: number }[] = []) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ops = openings.filter((o) => o.edge === i).sort((p, q) => p.t0 - q.t0);
      let t = 0;
      for (const o of ops) {
        if (o.t0 > t) this.addWall({ ax: a[0] + (b[0] - a[0]) * t, az: a[1] + (b[1] - a[1]) * t, bx: a[0] + (b[0] - a[0]) * o.t0, bz: a[1] + (b[1] - a[1]) * o.t0, y0, y1, tag });
        t = o.t1;
      }
      if (t < 1) this.addWall({ ax: a[0] + (b[0] - a[0]) * t, az: a[1] + (b[1] - a[1]) * t, bx: b[0], bz: b[1], y0, y1, tag });
    }
  }
  addBox(cx: number, cz: number, w: number, d: number, y0: number, y1: number, rotY = 0, tag?: string) {
    const c = Math.cos(rotY), s = Math.sin(rotY), hw = w / 2, hd = d / 2;
    const pts: P2[] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, z]) => [cx + x * c - z * s, cz + x * s + z * c]);
    this.addPolygon(pts, y0, y1, tag);
  }
  addPatch(p: FloorPatch) {
    this.patches.push(p);
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (const [x, z] of p.poly) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
    for (let cx = Math.floor(minx / CELL); cx <= Math.floor(maxx / CELL); cx++) for (let cz = Math.floor(minz / CELL); cz <= Math.floor(maxz / CELL); cz++) {
      const k = this.key(cx, cz); let arr = this.patchGrid.get(k); if (!arr) this.patchGrid.set(k, (arr = [])); arr.push(p);
    }
  }
  /** Flat rectangular patch helper. */
  addFlatPatch(poly: P2[], y: number, tag?: string, priority = 0) { this.addPatch({ poly, height: () => y, tag, priority }); }
  /** Ramp/stair patch: height interpolates from yA at point A to yB at point B along the AB axis. */
  addRampPatch(poly: P2[], a: P2, yA: number, b: P2, yB: number, tag?: string) {
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
    this.addPatch({ poly, height: (x, z) => { const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)); return yA + (yB - yA) * t; }, tag, priority: 1 });
  }
  /** Floor height at (x,z) for a body whose feet are currently at footY. Step-up limit 0.6 m. */
  floorAt(x: number, z: number, footY: number, stepUp = 0.6): number {
    let best = this.terrain(x, z);
    let bestScore = best <= footY + stepUp ? -(footY - best) : -Infinity; // prefer highest floor not above stepUp
    const arr = this.patchGrid.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (arr) for (const p of arr) {
      if (p.tag && this.disabledTags.has(p.tag)) continue;
      if (!pointInPolygon(x, z, p.poly)) continue;
      const h = p.height(x, z);
      if (h <= footY + stepUp) {
        const score = -(footY - h) + (p.priority ?? 0) * 0.001;
        if (h >= best - 1e-6 || score > bestScore) { if (h > best - 3.0 || bestScore === -Infinity) { if (score > bestScore) { best = h; bestScore = score; } } }
      }
    }
    return best;
  }
  /** Push a circle of radius r at (pos.x,pos.z) with body y-range [pos.y, pos.y+h] out of walls. Mutates pos. */
  resolve(pos: THREE.Vector3, r: number, h: number, iterations = 3) {
    for (let it = 0; it < iterations; it++) {
      let moved = false;
      const cx = Math.floor(pos.x / CELL), cz = Math.floor(pos.z / CELL);
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
        const arr = this.grid.get(this.key(cx + ox, cz + oz));
        if (!arr) continue;
        for (const w of arr) {
          if (w.tag && this.disabledTags.has(w.tag)) continue;
          if (w.y1 < pos.y + 0.3 || w.y0 > pos.y + h) continue; // walls below knee or above head don't block
          const c = segClosest(pos.x, pos.z, [w.ax, w.az], [w.bx, w.bz]);
          const dx = pos.x - c.x, dz = pos.z - c.z;
          const d = Math.hypot(dx, dz);
          if (d < r && d > 1e-6) { pos.x += (dx / d) * (r - d); pos.z += (dz / d) * (r - d); moved = true; }
          else if (d <= 1e-6) { // exactly on the wall: push along wall normal
            const nx = -(w.bz - w.az), nz = w.bx - w.ax, l = Math.hypot(nx, nz) || 1; pos.x += (nx / l) * r; pos.z += (nz / l) * r; moved = true;
          }
        }
      }
      if (!moved) break;
    }
  }
  /** Ray-ish visibility test in 2D (used for NPC avoidance / entering). */
  blocked(ax: number, az: number, bx: number, bz: number, y: number): boolean {
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 2);
    const p = new THREE.Vector3();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps; p.set(ax + (bx - ax) * t, y, az + (bz - az) * t);
      const q = p.clone(); this.resolve(q, 0.3, 1.6, 1);
      if (q.distanceToSquared(p) > 1e-6) return true;
    }
    return false;
  }
}
