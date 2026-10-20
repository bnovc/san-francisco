// Crowd simulation: role-based state machines on the NavGraph, local avoidance (grid hash separation),
// crosswalk signal waiting, bench sitting, tourists photographing the Dewey Monument. Deterministic (Rng(Config.seed)).
import * as THREE from 'three';
import type { Updatable, App } from '../app/App';
import type { World } from '../world/World';
import { Config } from '../app/Config';
import { Rng } from '../util/Rng';
import { NavGraph, NavEdge, NavNode } from './NavGraph';
import { PedestrianRig, Pose, PoseMode } from './PedestrianRig';
import { PedestrianDetail } from './PedestrianDetail';
import { PLAZA } from '../world/Plaza';

type Role = 'commuter' | 'shopper' | 'tourist' | 'sitter' | 'crosser';
type State = 'walk' | 'wait' | 'look' | 'photo' | 'idle' | 'toSeat' | 'sit';
interface Seat { x: number; y: number; z: number; yaw: number; taken: boolean }

class Ped {
  role: Role = 'commuter'; state: State = 'walk'; stage = 0;
  x = 0; y = 0; z = 0; yaw = 0; vx = 0; vz = 0;
  speed = 1.4; phase = 0; amp = 0; timer = 0; seed = 0; lane = 0;
  path: number[] = []; idx = 0; node = -1; edge: NavEdge | null = null; cleared = false;
  lookYaw = 0; headYaw = 0; headPitch = 0; seat: Seat | null = null; stuck = 0; noise = 0;
  constructor(public slot: number) {}
}

const SEP_R = 1.2, GRID_CELL = 2, HASH = 4096;

export class Pedestrians implements Updatable {
  player: THREE.Vector3 | null = null;
  frozen = false;
  nav!: NavGraph;
  rig: PedestrianRig;
  readonly detailMan = new PedestrianDetail('man');
  readonly detailWoman = new PedestrianDetail('woman');
  peds: Ped[] = [];
  seats: Seat[] = [];
  rng: Rng;
  time = 0;
  private count: number;
  private near: number[] = []; private far: number[] = []; private photoSpots: number[] = []; private plazaNodes: number[] = []; private storefronts: number[] = []; private corners: number[] = []; private boundary: number[] = [];
  private head = new Int32Array(HASH); private next: Int32Array;
  private updMs = 0; private updMax = 0; private frame = 0;
  private pose: Pose = { x: 0, y: 0, z: 0, yaw: 0, mode: PoseMode.Walk, phase: 0, amp: 0, headYaw: 0, headPitch: 0, t: 0, seed: 0 };
  private tmpV = new THREE.Vector3();

  constructor(public world: World, public app: App, opts: { count?: number } = {}) {
    const q = Number(new URLSearchParams(location.search).get('peds'));
    this.count = Math.max(0, Math.min(1000, Number.isFinite(q) && q > 0 ? q : opts.count ?? 220));
    this.rng = new Rng(Config.seed ^ 0x9e3779b9);
    this.rig = new PedestrianRig(this.count);
    this.next = new Int32Array(this.count);
  }

  async build() {
    const t0 = performance.now();
    this.nav = new NavGraph(this.world);
    const nav = this.nav;
    const kinds = new Set(['sidewalk', 'plaza', 'corner']);
    for (const n of nav.nodes) {
      const r = Math.hypot(n.x, n.z);
      if (n.dead) continue;
      if (n.kind === 'boundary') this.boundary.push(n.id);
      if (!kinds.has(n.kind)) continue;
      (r < 80 ? this.near : this.far).push(n.id);
      if (n.kind === 'plaza') { this.plazaNodes.push(n.id); if (r >= 8 && r <= 14.7 && n.region === 'deck') this.photoSpots.push(n.id); }
      if (n.storefront) this.storefronts.push(n.id);
      if (n.kind === 'corner') this.corners.push(n.id);
    }
    this.buildSeats();
    await this.rig.load();
    await Promise.all([this.detailMan.load(), this.detailWoman.load()].map((p) => p.catch((e) => console.warn('[peds] detail model unavailable', e))));
    this.rig.group.add(this.detailMan.group, this.detailWoman.group);
    this.app.scene.add(this.rig.group);
    for (let i = 0; i < this.count; i++) { const p = new Ped(i); this.peds.push(p); this.spawn(p, true); }
    // warm-up so the first frame (possibly frozen) already shows a settled crowd: crossings, sitters, photographers
    const dt = 1 / 15;
    for (let k = 0; k < 40 * 15; k++) this.simulate(dt);
    this.poseAll(0);
    if (Config.qa || Config.debug) (window as any).__peds = this;
    console.log(`[peds] ${this.count} pedestrians, nav ${nav.nodes.length} nodes (${nav.deadCount} pruned) / ${nav.edges.length} edges, build ${(performance.now() - t0).toFixed(0)} ms`);
  }

  private buildSeats() {
    const floor = (x: number, z: number) => this.nav.floorY(x, z);
    const bench = (x: number, z: number, yaw: number) => {
      const fx = Math.sin(yaw), fz = Math.cos(yaw), px = fz, pz = -fx; // facing & along-bench directions
      const y = floor(x, z);
      for (const o of [-0.8, 0, 0.8]) this.seats.push({ x: x + px * o - fx * 0.02, y, z: z + pz * o - fz * 0.02, yaw, taken: false });
    };
    for (const x of [-48, -36, -24, 24, 36, 48]) { bench(x, 12.4, 0); bench(x, -12.8, Math.PI); }
    for (const z of [-4, 4]) { bench(-52, z, Math.PI / 2); bench(52, z, -Math.PI / 2); }
    void PLAZA; // (the z=15 seat wall is planted with a hedge, so only the benches are used as seats)
  }

  // ------------------------------------------------------------------ spawning & planning
  private pickRole(): Role {
    const r = this.rng.next();
    return r < 0.3 ? 'commuter' : r < 0.55 ? 'shopper' : r < 0.77 ? 'tourist' : r < 0.87 ? 'sitter' : 'crosser';
  }
  private spawn(p: Ped, initial: boolean) {
    const rng = this.rng, nav = this.nav;
    if (p.seat) { p.seat.taken = false; p.seat = null; }
    p.role = this.pickRole(); p.stage = 0; p.cleared = false; p.stuck = 0; p.edge = null;
    const nearP = { commuter: 0.25, shopper: 0.4, tourist: 0.7, sitter: 0.8, crosser: 0.4 }[p.role];
    let pool = rng.chance(nearP) ? this.near : this.far;
    if (!initial && p.role === 'commuter' && rng.chance(0.6) && this.boundary.length) pool = this.boundary;
    if (p.role === 'shopper' && rng.chance(0.7) && this.storefronts.length) pool = this.storefronts;
    if (p.role === 'crosser' && this.corners.length) pool = this.corners;
    if (p.role === 'tourist' && rng.chance(0.5) && this.plazaNodes.length) pool = this.plazaNodes;
    const node = nav.nodes[pool.length ? rng.pick(pool) : 0];
    p.node = node.id; p.x = node.x + rng.range(-0.8, 0.8); p.z = node.z + rng.range(-0.8, 0.8); p.y = node.y;
    p.yaw = rng.range(-Math.PI, Math.PI); p.vx = p.vz = 0; p.amp = 0; p.phase = rng.range(0, Math.PI * 2);
    p.seed = rng.range(0, 100); p.lane = rng.range(-1, 1); p.noise = rng.range(0, 6.28);
    p.speed = p.role === 'commuter' ? rng.range(1.4, 1.7) : p.role === 'tourist' ? rng.range(0.9, 1.25) : p.role === 'shopper' ? rng.range(1.0, 1.35) : rng.range(1.15, 1.5);
    const app = this.rig.randomAppearance(rng);
    if (app.child) p.speed *= 0.85;
    if (p.role === 'tourist' && app.accessory < 0 && rng.chance(0.5)) app.accessory = rng.chance(0.5) ? 2 : 3; // phone / camera
    this.rig.setAppearance(p.slot, app);
    p.state = 'walk';
    if (!this.plan(p)) { p.state = 'idle'; p.timer = rng.range(2, 6); }
  }
  private setPath(p: Ped, to: number): boolean {
    const from = p.node >= 0 ? p.node : this.nav.nearest(p.x, p.z);
    const path = this.nav.path(from, to);
    if (!path || path.length < 2) return false;
    p.path = path; p.idx = 1; p.cleared = false; p.edge = this.nav.edgeBetween(path[0], path[1]); p.state = 'walk'; p.stuck = 0;
    return true;
  }
  private randomFrom(ids: number[], minD: number, maxD: number, p: Ped): number {
    for (let k = 0; k < 24; k++) { const id = this.rng.pick(ids); const n = this.nav.nodes[id]; const d = Math.hypot(n.x - p.x, n.z - p.z); if (d >= minD && d <= maxD) return id; }
    return -1;
  }
  /** Choose the next goal for a pedestrian standing at p.node. Returns false when it should be respawned. */
  private plan(p: Ped): boolean {
    const rng = this.rng, nav = this.nav, cur = nav.nodes[p.node];
    if (cur && cur.kind === 'boundary' && p.stage > 0) return false;
    switch (p.role) {
      case 'commuter': {
        const far = rng.chance(0.5) && this.boundary.length ? this.randomFrom(this.boundary, 60, 900, p) : this.randomFrom(this.far, 80, 400, p);
        p.stage++; return far >= 0 && this.setPath(p, far);
      }
      case 'shopper': {
        const id = rng.chance(0.2) ? this.randomFrom(this.storefronts, 60, 200, p) : this.randomFrom(this.storefronts, 12, 45, p);
        p.stage++; return id >= 0 && this.setPath(p, id);
      }
      case 'tourist': {
        if (p.stage === 0) { p.stage = 1; const s = this.photoSpots.length ? rng.pick(this.photoSpots) : -1; if (s >= 0 && this.setPath(p, s)) return true; }
        if (p.stage < 4) { p.stage++; const id = this.randomFrom(this.plazaNodes, 15, 120, p); if (id >= 0 && this.setPath(p, id)) return true; }
        const far = this.randomFrom(this.far, 80, 400, p); p.stage = 10; return far >= 0 && this.setPath(p, far);
      }
      case 'sitter': {
        if (p.stage === 0) {
          let best: Seat | null = null, bd = 1e9;
          for (const s of this.seats) { if (s.taken) continue; const d = Math.hypot(s.x - p.x, s.z - p.z) + rng.range(0, 20); if (d < bd) { bd = d; best = s; } }
          if (best) { best.taken = true; p.seat = best; p.stage = 1; const n = nav.nearest(best.x + Math.sin(best.yaw) * 1.5, best.z + Math.cos(best.yaw) * 1.5, (m) => m.kind === 'plaza'); if (n >= 0 && this.setPath(p, n)) return true; best.taken = false; p.seat = null; }
          p.role = 'tourist'; return this.plan(p);
        }
        const far = this.randomFrom(this.far, 80, 400, p); p.stage = 10; return far >= 0 && this.setPath(p, far);
      }
      case 'crosser': {
        if (p.stage < 3 && rng.chance(0.75)) {
          p.stage++;
          const cs = nav.nodesWithin(p.x, p.z, 26, (n) => n.kind === 'corner' && n.id !== p.node);
          if (cs.length && this.setPath(p, rng.pick(cs))) return true;
        }
        p.stage = 10; const id = this.randomFrom(this.far, 40, 120, p) >= 0 ? this.randomFrom(this.far, 40, 120, p) : this.randomFrom(this.near, 30, 90, p);
        return id >= 0 && this.setPath(p, id);
      }
    }
    return false;
  }
  /** Reached the end of the path. */
  private arrive(p: Ped) {
    const rng = this.rng, node = this.nav.nodes[p.node];
    if (node.kind === 'boundary') { this.spawn(p, false); return; }
    switch (p.role) {
      case 'shopper':
        if (node.storefront) { p.state = 'look'; p.timer = rng.range(3, 8); p.lookYaw = node.facing; return; }
        break;
      case 'tourist':
        if (p.stage === 1) { p.state = 'photo'; p.timer = rng.range(3, 4.5); p.lookYaw = Math.atan2(-p.x, -p.z); return; }
        if (p.stage < 10 && rng.chance(0.6)) { p.state = 'idle'; p.timer = rng.range(2, 7); p.lookYaw = p.yaw + rng.range(-1.2, 1.2); return; }
        break;
      case 'sitter':
        if (p.stage === 1 && p.seat) { p.state = 'toSeat'; return; }
        break;
      case 'crosser':
        if (rng.chance(0.3)) { p.state = 'idle'; p.timer = rng.range(1, 3); p.lookYaw = p.yaw + rng.range(-0.8, 0.8); return; }
        break;
    }
    if (p.stage >= 10 || !this.plan(p)) this.spawn(p, false);
  }

  // ------------------------------------------------------------------ simulation
  update(dt: number) {
    if (this.frozen || Config.freeze || dt <= 0) return;
    const t0 = performance.now();
    this.simulate(Math.min(dt, 0.1));
    this.poseAll(dt);
    const ms = performance.now() - t0;
    this.updMs = this.updMs ? this.updMs * 0.95 + ms * 0.05 : ms; this.updMax = Math.max(this.updMax * 0.99, ms);
  }
  private hashCell(cx: number, cz: number) { return ((cx * 73856093) ^ (cz * 19349663)) & (HASH - 1); }
  private simulate(dt: number) {
    this.time += dt; this.frame++;
    // spatial hash
    this.head.fill(-1);
    for (const p of this.peds) { const h = this.hashCell(Math.floor(p.x / GRID_CELL), Math.floor(p.z / GRID_CELL)); this.next[p.slot] = this.head[h]; this.head[h] = p.slot; }
    for (const p of this.peds) this.step(p, dt);
  }
  private separation(p: Ped, out: { x: number; z: number }) {
    out.x = 0; out.z = 0;
    const cx = Math.floor(p.x / GRID_CELL), cz = Math.floor(p.z / GRID_CELL);
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
      let j = this.head[this.hashCell(cx + ox, cz + oz)];
      while (j >= 0) {
        if (j !== p.slot) {
          const q = this.peds[j]; const dx = p.x - q.x, dz = p.z - q.z; const d2 = dx * dx + dz * dz;
          if (d2 < SEP_R * SEP_R && d2 > 1e-6 && Math.abs(p.y - q.y) < 1.5) { const d = Math.sqrt(d2); const w = (SEP_R - d) / SEP_R; out.x += (dx / d) * w; out.z += (dz / d) * w; }
        }
        j = this.next[j];
      }
    }
    if (this.player && Math.abs(p.y - this.player.y) < 1.5) {
      const dx = p.x - this.player.x, dz = p.z - this.player.z;
      const d = Math.hypot(dx, dz);
      if (d < SEP_R && d > 1e-4) { const w = (SEP_R - d) / SEP_R; out.x += dx / d * w * 1.6; out.z += dz / d * w * 1.6; }
    }
  }
  /** Keep the player from walking through standing and moving pedestrians. */
  resolvePlayer(pos: THREE.Vector3, radius: number) {
    if (!this.rig.group.visible) return;
    for (const p of this.peds) {
      if (p.state === 'sit' || Math.abs(p.y - pos.y) > 1.4) continue;
      const dx = pos.x - p.x, dz = pos.z - p.z, d = Math.hypot(dx, dz);
      const min = radius + (this.rig.appearance[p.slot]?.child ? 0.22 : 0.3);
      if (d >= min) continue;
      const nx = d > 1e-4 ? dx / d : Math.sin(p.yaw), nz = d > 1e-4 ? dz / d : Math.cos(p.yaw);
      pos.x += nx * (min - d); pos.z += nz * (min - d);
    }
  }
  private sep = { x: 0, z: 0 };
  private step(p: Ped, dt: number): void {
    const nav = this.nav, nodes = nav.nodes;
    const turnTo = (target: number, rate: number) => { let d = target - p.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); p.yaw += Math.max(-rate * dt, Math.min(rate * dt, d)); };
    const settle = () => { p.amp = Math.max(0, p.amp - 5 * dt); p.vx *= 0.7; p.vz *= 0.7; p.headYaw *= 0.9; };
    switch (p.state) {
      case 'look': case 'idle': case 'photo': case 'wait': {
        p.timer -= dt; settle();
        if (p.state === 'wait') {
          if (p.edge && nav.crossingOpen(p.edge, this.time)) { p.state = 'walk'; p.cleared = true; }
          else { const T = nodes[p.path[p.idx]]; turnTo(Math.atan2(T.x - p.x, T.z - p.z), 3); }
          // waiting people still keep their distance
          this.separation(p, this.sep); p.x += this.sep.x * 0.6 * dt; p.z += this.sep.z * 0.6 * dt;
          return;
        }
        turnTo(p.lookYaw, 2.5);
        if (p.state === 'photo') p.headPitch += (-0.45 - p.headPitch) * Math.min(1, 4 * dt);
        else if (p.state === 'idle') { const want = 0.4 * Math.sin(this.time * 0.6 + p.seed); p.headYaw += (want - p.headYaw) * Math.min(1, 2 * dt); }
        if (p.timer <= 0) { p.headPitch = 0; if (p.role === 'tourist' && p.state === 'photo') p.stage = 2; if (!this.plan(p)) this.spawn(p, false); }
        return;
      }
      case 'toSeat': {
        const s = p.seat!; const ax = s.x + Math.sin(s.yaw) * 0.45, az = s.z + Math.cos(s.yaw) * 0.45;
        const dx = ax - p.x, dz = az - p.z, d = Math.hypot(dx, dz);
        if (d < 0.25) { p.state = 'sit'; p.timer = this.rng.range(20, 60); p.x = s.x; p.z = s.z; p.y = s.y; p.yaw = s.yaw; p.vx = p.vz = 0; p.amp = 0; return; }
        const sp = Math.min(p.speed * 0.7, d * 2 + 0.3);
        p.vx = (dx / d) * sp; p.vz = (dz / d) * sp; p.x += p.vx * dt; p.z += p.vz * dt;
        turnTo(Math.atan2(dx, dz), 5); p.amp += (Math.min(1, sp / 1.1) - p.amp) * Math.min(1, 5 * dt); p.phase += (sp / 1.45) * Math.PI * 2 * dt;
        p.y += Math.max(-4 * dt, Math.min(4 * dt, nav.floorY(p.x, p.z) - p.y));
        return;
      }
      case 'sit': {
        p.timer -= dt; p.amp = 0;
        const want = 0.3 * Math.sin(this.time * 0.4 + p.seed); p.headYaw += (want - p.headYaw) * Math.min(1, 2 * dt);
        if (p.timer <= 0) {
          const s = p.seat!; s.taken = false; p.seat = null; p.headYaw = 0;
          p.x = s.x + Math.sin(s.yaw) * 0.5; p.z = s.z + Math.cos(s.yaw) * 0.5; p.node = nav.nearest(p.x, p.z);
          if (!this.plan(p)) this.spawn(p, false);
        }
        return;
      }
    }
    // ---- walking ----
    if (p.idx >= p.path.length) { this.arrive(p); return; }
    const P = nodes[p.path[p.idx - 1]], T = nodes[p.path[p.idx]];
    const ex = T.x - P.x, ez = T.z - P.z, el = Math.hypot(ex, ez) || 1, ux = ex / el, uz = ez / el, px = -uz, pz = ux;
    const edge = p.edge;
    // crosswalk: wait at the curb until the signal says walk
    if (edge && edge.crossing && !p.cleared) {
      const dP = Math.hypot(p.x - P.x, p.z - P.z);
      if (dP < 1.4 && !nav.crossingOpen(edge, this.time)) { p.state = 'wait'; p.timer = 0; return; }
      if (dP >= 1.4) p.cleared = true;
    }
    const laneW = Math.min(P.halfW, T.halfW) * 0.85;
    const tx = T.x + px * p.lane * laneW, tz = T.z + pz * p.lane * laneW;
    let dx = tx - p.x, dz = tz - p.z; const d = Math.hypot(dx, dz);
    const along = (p.x - P.x) * ux + (p.z - P.z) * uz;
    if (d < 0.8 || along > el - 0.3) {
      p.node = T.id; p.idx++; p.cleared = false;
      p.edge = p.idx < p.path.length ? nav.edgeBetween(T.id, p.path[p.idx]) : null;
      if (p.idx >= p.path.length) { this.arrive(p); return; }
      return this.step(p, dt);
    }
    dx /= d; dz /= d;
    const stairs = edge?.kind === 'stairs';
    const speed = p.speed * (stairs ? 0.7 : 1) * (1 + 0.07 * Math.sin(this.time * 0.35 + p.noise));
    this.separation(p, this.sep);
    let wx = dx * speed + this.sep.x * 1.6, wz = dz * speed + this.sep.z * 1.6;
    const wl = Math.hypot(wx, wz); if (wl > speed * 1.25) { wx *= (speed * 1.25) / wl; wz *= (speed * 1.25) / wl; }
    const k = Math.min(1, 6 * dt);
    p.vx += (wx - p.vx) * k; p.vz += (wz - p.vz) * k;
    p.x += p.vx * dt; p.z += p.vz * dt;
    // stay inside the sidewalk corridor (soft)
    const lat = (p.x - P.x) * px + (p.z - P.z) * pz, maxLat = laneW + 0.4;
    if (Math.abs(lat) > maxLat) { const ex2 = (Math.abs(lat) - maxLat) * Math.sign(lat) * Math.min(1, 4 * dt); p.x -= px * ex2; p.z -= pz * ex2; }
    // walls (staggered) except on stairs, which are wall-free by construction
    if (!stairs && ((this.frame + p.slot) & 3) === 0) { const v = this.tmpV.set(p.x, p.y, p.z); this.world.collision.resolve(v, 0.3, 1.6, 1); p.x = v.x; p.z = v.z; }
    // floor
    // graph node heights are validated (≤1.2 m steps); the seat-step band ramp needs a step-up > 0.8. Inside the plaza use slab patches only.
    const fy = (nav.inPlaza(p.x, p.z) ? nav.plazaFloor(p.x, p.z, p.y, 1.6) : null) ?? this.world.collision.floorAt(p.x, p.z, p.y, 1.6);
    const dy = fy - p.y; p.y += Math.abs(dy) > 2.5 ? dy : Math.max(-4 * dt, Math.min(4 * dt, dy));
    // heading / gait
    const v = Math.hypot(p.vx, p.vz);
    if (v > 0.15) turnTo(Math.atan2(p.vx, p.vz), 7);
    p.amp += (Math.min(1, v / 1.1) - p.amp) * Math.min(1, 5 * dt);
    p.phase += (v / 1.45) * Math.PI * 2 * dt;
    p.headYaw *= 0.95; p.headPitch *= 0.95;
    p.stuck = v < 0.12 ? p.stuck + dt : 0;
    if (p.stuck > 8) this.spawn(p, false);
  }

  private poseAll(dt: number) {
    const pose = this.pose; pose.t = this.time;
    const camera = this.app.camera;
    const forward = camera.getWorldDirection(this.tmpV);
    let detailed: Ped | null = null, nearest = 14 * 14;
    if (this.detailMan.ready || this.detailWoman.ready) for (const p of this.peds) {
      const appearance = this.rig.appearance[p.slot];
      if (appearance?.child || p.state === 'sit' || p.state === 'toSeat' || p.state === 'photo') continue;
      const dx = p.x - camera.position.x, dy = p.y + 0.9 - camera.position.y, dz = p.z - camera.position.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < nearest && dx * forward.x + dy * forward.y + dz * forward.z > 0) { nearest = d2; detailed = p; }
    }
    this.detailMan.hide(); this.detailWoman.hide();
    for (const p of this.peds) {
      if (p === detailed) {
        this.rig.hide(p.slot);
        const appearance = this.rig.appearance[p.slot];
        const detail = appearance.torso === 2 ? this.detailWoman : this.detailMan;
        detail.show(p.x, p.y, p.z, p.yaw, appearance.scale, p.amp > 0.1, Math.hypot(p.vx, p.vz), dt);
        continue;
      }
      pose.x = p.x; pose.y = p.y; pose.z = p.z; pose.yaw = p.yaw; pose.phase = p.phase; pose.amp = p.amp;
      pose.headYaw = p.headYaw; pose.headPitch = p.headPitch; pose.seed = p.seed;
      pose.mode = p.state === 'sit' ? PoseMode.Sit : p.state === 'photo' ? PoseMode.Photo : p.amp < 0.02 ? PoseMode.Idle : PoseMode.Walk;
      if (p.state === 'sit') { const a = this.rig.appearance[p.slot]; pose.y = p.y + 0.44 * (1 - (a?.scale ?? 1)); }
      this.rig.pose(p.slot, pose);
    }
    this.rig.commit();
  }

  stats() {
    const st: Record<string, number> = {};
    for (const p of this.peds) st[p.state] = (st[p.state] || 0) + 1;
    return { pedestrians: this.peds.length, detailActive: this.detailMan.group.visible || this.detailWoman.group.visible, pedUpdateMs: Math.round(this.updMs * 100) / 100, pedUpdateMaxMs: Math.round(this.updMax * 100) / 100, pedStates: st, navNodes: this.nav?.nodes.length ?? 0, navEdges: this.nav?.edges.length ?? 0, pedDrawCalls: this.rig.drawCalls };
  }
}
export type { NavNode };
