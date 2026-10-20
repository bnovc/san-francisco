// Lightweight activity around the viewer in the streamed city base. These are
// ambient agents on OSM road polylines, not the authored downtown route/signal simulation.
import * as THREE from 'three';
import type { App, Updatable } from '../app/App';
import { Config } from '../app/Config';
import { Assets, type InstancedModel } from '../assets/Assets';
import { Rng } from '../util/Rng';
import type { CityBase, CityRoad } from '../world/CityBase';
import { PedestrianRig, PoseMode, type Pose } from './PedestrianRig';

type Point = [number, number];
interface Segment { a: Point; b: Point; dx: number; dz: number; len: number; width: number; foot: boolean; key: string }
interface Walker { seg: Segment | null; s: number; side: number; speed: number; phase: number; x: number; y: number; z: number }
interface Car { model: InstancedModel; slot: number; seg: Segment | null; s: number; speed: number; x: number; y: number; z: number; yaw: number }

const CORE = 420;
const RADIUS = 330;
const FOOT = new Set(['pedestrian', 'footway', 'path', 'steps']);
const NO_CARS = new Set([...FOOT, 'cycleway', 'motorway', 'motorway_link', 'trunk', 'trunk_link']);
const endpoint = ([x, z]: Point) => `${Math.round(x * 10)},${Math.round(z * 10)}`;
const inLegacy = (x: number, z: number) => Math.abs(x) <= CORE && Math.abs(z) <= CORE;
const WALKER_GAP = 0.85;
const CAR_GAP = 5.2;
const CAR_WALKER_GAP = 2.4;

export class CityLife implements Updatable {
  frozen = false;
  readonly group = new THREE.Group();
  readonly rig = new PedestrianRig(52);
  private walkers: Walker[] = [];
  private cars: Car[] = [];
  private models: InstancedModel[] = [];
  private segments: Segment[] = [];
  private byStart = new Map<string, Segment[]>();
  private rng = new Rng((Config.seed ^ 0x51c17) >>> 0);
  private centerX = Infinity;
  private centerZ = Infinity;
  private refreshTime = 0;
  private pose: Pose = { x: 0, y: 0, z: 0, yaw: 0, mode: PoseMode.Walk, phase: 0, amp: 1, headYaw: 0, headPitch: 0, t: 0, seed: 0 };
  private carMatrix = new THREE.Matrix4();
  private hiddenCar = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(private city: CityBase, private app: App) { this.group.name = 'city-life'; }

  async build() {
    await this.rig.load();
    this.group.add(this.rig.group);
    for (let i = 0; i < this.rig.capacity; i++) {
      this.rig.setAppearance(i, this.rig.randomAppearance(this.rng));
      this.walkers.push({ seg: null, s: 0, side: this.rng.chance(.5) ? 1 : -1, speed: this.rng.range(.95, 1.65), phase: this.rng.range(0, Math.PI * 2), x: 0, y: 0, z: 0 });
    }
    const names = ['sedan', 'suv', 'hatch', 'taxi', 'van_delivery'];
    this.models = await Promise.all(names.map((name) => Assets.instanced(`vehicles/${name}`, 6, { receiveShadow: false })));
    for (const model of this.models) {
      model.group.name = 'city-car-model';
      for (const mesh of model.meshes) { mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
      this.group.add(model.group);
    }
    for (let i = 0; i < 28; i++) {
      const model = this.models[i % this.models.length];
      const slot = model.add([0, -10000, 0]);
      this.cars.push({ model, slot, seg: null, s: 0, speed: this.rng.range(6, 10), x: 0, y: 0, z: 0, yaw: 0 });
    }
    for (const model of this.models) model.finalize();
    this.app.scene.add(this.group);
  }

  private refresh(x: number, z: number) {
    const jumped = Math.hypot(x - this.centerX, z - this.centerZ) > RADIUS;
    this.centerX = x; this.centerZ = z;
    const refreshed: Segment[] = [];
    for (const [, kind, width, points, bridge] of this.city.roadsNear(x, z, RADIUS + 50) as CityRoad[]) {
      if (bridge || kind === 'steps') continue;
      const foot = FOOT.has(kind);
      for (let i = 0; i < points.length - 1; i++) {
        const [a, b] = [points[i], points[i + 1]];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        if (len < 3 || Math.hypot(mx - x, mz - z) > RADIUS || inLegacy(mx, mz)) continue;
        for (const [start, end] of [[a, b], [b, a]] as [Point, Point][]) {
          const seg: Segment = { a: start, b: end, dx: (end[0] - start[0]) / len, dz: (end[1] - start[1]) / len, len, width, foot, key: kind };
          refreshed.push(seg);
        }
      }
    }
    // Keep routes occupied by existing agents alive across a moving tile
    // window. Without this, replacing the segment list could strand an actor
    // at the edge of the new window and force an immediate random respawn.
    if (!jumped) {
      const occupied = new Set<Segment>([...this.walkers.map((w) => w.seg), ...this.cars.map((c) => c.seg)].filter((s): s is Segment => !!s));
      for (const seg of this.segments) if (occupied.has(seg) && !refreshed.includes(seg)) refreshed.push(seg);
    }
    this.segments = refreshed;
    this.byStart.clear();
    for (const seg of this.segments) {
      const k = endpoint(seg.a), list = this.byStart.get(k) ?? [];
      list.push(seg); this.byStart.set(k, list);
    }
    if (jumped) {
      for (const w of this.walkers) w.seg = null;
      for (const c of this.cars) { c.seg = null; c.model.setMatrixAt(c.slot, this.hiddenCar); }
    }
  }

  private candidates(x: number, z: number, car: boolean) {
    const radius = car ? 155 : 105;
    return this.segments.filter((s) => {
      if (car && (s.foot || NO_CARS.has(s.key) || s.width < 4.5)) return false;
      const mx = (s.a[0] + s.b[0]) / 2, mz = (s.a[1] + s.b[1]) / 2;
      return Math.hypot(mx - x, mz - z) < radius;
    });
  }

  private spawn(agent: Walker | Car, car: boolean, x: number, z: number) {
    const choices = this.candidates(x, z, car);
    if (!choices.length) { agent.seg = null; return; }
    // Do not put a newly assigned actor on top of an actor already in the pool.
    // The old implementation picked a segment and offset independently, which
    // made several cars start in exactly the same lane position.
    for (let attempt = 0; attempt < 16; attempt++) {
      const seg = this.rng.pick(choices);
      const s = this.rng.range(car ? 2 : 0, Math.max(car ? 2 : 0, seg.len - (car ? 2 : 0)));
      const [px, py, pz] = this.position(seg, s, car ? 1.5 : seg.foot ? 0 : (agent as Walker).side * (seg.width / 2 + .9));
      const clear = this.walkers.every((w) => w === agent || !w.seg || Math.hypot(w.x - px, w.z - pz) >= (car ? CAR_WALKER_GAP : WALKER_GAP)) &&
        this.cars.every((c) => c === agent || !c.seg || Math.hypot(c.x - px, c.z - pz) >= (car ? CAR_GAP : CAR_WALKER_GAP));
      if (!clear) continue;
      agent.seg = seg;
      agent.s = s;
      agent.x = px; agent.y = py; agent.z = pz;
      return;
    }
    // A dense junction can exhaust the attempts. Keep the actor on the first
    // available segment; the separation pass below will make progress without
    // teleporting it to another random road on the next frame.
    agent.seg = choices[0];
    agent.s = Math.min(agent.seg.len - (car ? 2 : 0), car ? 2 : 0);
    [agent.x, agent.y, agent.z] = this.position(agent.seg, agent.s, car ? 1.5 : agent.seg.foot ? 0 : (agent as Walker).side * (agent.seg.width / 2 + .9));
  }

  private next(seg: Segment, car: boolean): Segment | null {
    const choices = (this.byStart.get(endpoint(seg.b)) ?? []).filter((s) =>
      (!car || (!s.foot && !NO_CARS.has(s.key) && s.width >= 4.5)) &&
      Math.hypot(s.b[0] - seg.a[0], s.b[1] - seg.a[1]) > .5);
    if (!choices.length) return null;
    choices.sort((a, b) => b.dx * seg.dx + b.dz * seg.dz - a.dx * seg.dx - a.dz * seg.dz);
    if (this.rng.chance(.8)) return choices[0];
    return this.rng.pick(choices);
  }

  private reverse(seg: Segment, car: boolean): Segment | null {
    return (this.byStart.get(endpoint(seg.b)) ?? []).find((s) =>
      s.b[0] === seg.a[0] && s.b[1] === seg.a[1] &&
      (!car || (!s.foot && !NO_CARS.has(s.key) && s.width >= 4.5))) ?? null;
  }

  private rewind(agent: Walker | Car, distance: number) {
    if (!agent.seg) return;
    agent.s = Math.max(0, agent.s - distance);
    const offset = 'yaw' in agent ? 1.5 : agent.seg.foot ? 0 : agent.side * (agent.seg.width / 2 + .9);
    [agent.x, agent.y, agent.z] = this.position(agent.seg, agent.s, offset);
  }

  /** Keep the lightweight city agents from occupying the same lane/crossing. */
  private resolveAgentCollisions() {
    // Same-segment queues are handled along the road direction so cars do not
    // jitter sideways into the adjacent lane.
    for (let i = 0; i < this.cars.length; i++) for (let j = i + 1; j < this.cars.length; j++) {
      const a = this.cars[i], b = this.cars[j];
      if (!a.seg || !b.seg || a.seg !== b.seg) continue;
      const lead = a.s >= b.s ? a : b, follow = lead === a ? b : a;
      if (lead.s - follow.s < CAR_GAP) this.rewind(follow, CAR_GAP - (lead.s - follow.s));
    }

    const agents: (Walker | Car)[] = [...this.walkers.filter((w) => w.seg), ...this.cars.filter((c) => c.seg)];
    for (let i = 0; i < agents.length; i++) for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i], b = agents[j];
      const aCar = 'model' in a, bCar = 'model' in b;
      const min = aCar && bCar ? CAR_GAP : aCar || bCar ? CAR_WALKER_GAP : WALKER_GAP;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d >= min) continue;
      // Rewind the later pool member along its route. This is deterministic,
      // keeps the route lane, and prevents a crossing pair from passing through
      // one another. If it is at a route endpoint, use a small visual push.
      const overlap = min - d + .05;
      this.rewind(b, overlap);
      const ndx = b.x - a.x, ndz = b.z - a.z, nd = Math.hypot(ndx, ndz);
      if (nd < min && nd > .001) { b.x += ndx / nd * (min - nd); b.z += ndz / nd * (min - nd); }
      else if (nd <= .001 && b.seg) { b.x += -b.seg.dz * min; b.z += b.seg.dx * min; }
    }
  }

  private poseWalkers(t: number) {
    for (let i = 0; i < this.walkers.length; i++) {
      const w = this.walkers[i];
      if (!w.seg) { this.rig.hide(i); continue; }
      Object.assign(this.pose, { x: w.x, y: w.y, z: w.z, yaw: Math.atan2(w.seg.dx, w.seg.dz), phase: w.phase, t, seed: i });
      this.rig.pose(i, this.pose);
    }
    this.rig.commit();
  }

  private poseCars() {
    for (const c of this.cars) {
      if (!c.seg) { c.model.setMatrixAt(c.slot, this.hiddenCar); continue; }
      c.yaw = Math.atan2(c.seg.dx, c.seg.dz);
      this.carMatrix.makeRotationY(c.yaw).setPosition(c.x, c.y, c.z);
      c.model.setMatrixAt(c.slot, this.carMatrix);
    }
  }

  private position(seg: Segment, s: number, offset: number): [number, number, number] {
    const x = seg.a[0] + seg.dx * s + seg.dz * offset;
    const z = seg.a[1] + seg.dz * s - seg.dx * offset;
    return [x, this.city.heightAt(x, z) + (seg.foot ? .04 : offset === 1.5 ? .04 : .13), z];
  }

  update(dt: number, t: number) {
    if (dt <= 0) return;
    const x = this.app.camera.position.x, z = this.app.camera.position.z;
    const outside = !inLegacy(x, z);
    this.group.visible = outside;
    if (!outside || this.frozen || Config.freeze) return;
    this.refreshTime += dt;
    if (this.refreshTime > 2 || Math.hypot(x - this.centerX, z - this.centerZ) > 110) {
      this.refreshTime = 0; this.refresh(x, z);
    }
    for (let i = 0; i < this.walkers.length; i++) {
      const w = this.walkers[i];
      // Recycle only well outside the active view so a long walk keeps a local crowd.
      if (!w.seg || Math.hypot(w.x - x, w.z - z) > RADIUS + 120) this.spawn(w, false, x, z);
      if (!w.seg) { this.rig.hide(i); continue; }
      w.s += w.speed * dt;
      if (w.s >= w.seg.len) {
        const next = this.next(w.seg, false) ?? this.reverse(w.seg, false);
        if (next) { w.s -= w.seg.len; w.seg = next; }
        else this.spawn(w, false, x, z);
      }
      if (!w.seg) { this.rig.hide(i); continue; }
      const side = w.seg.foot ? 0 : w.side * (w.seg.width / 2 + .9);
      [w.x, w.y, w.z] = this.position(w.seg, w.s, side);
      w.phase += dt * w.speed * 6;
    }
    for (const c of this.cars) {
      if (!c.seg || Math.hypot(c.x - x, c.z - z) > RADIUS + 120) this.spawn(c, true, x, z);
      if (!c.seg) { c.model.setMatrixAt(c.slot, this.hiddenCar); continue; }
      c.s += c.speed * dt;
      if (c.s >= c.seg.len) {
        const next = this.next(c.seg, true) ?? this.reverse(c.seg, true);
        if (next) { c.s -= c.seg.len; c.seg = next; }
        else this.spawn(c, true, x, z);
      }
      if (!c.seg) { c.model.setMatrixAt(c.slot, this.hiddenCar); continue; }
      [c.x, c.y, c.z] = this.position(c.seg, c.s, 1.5);
    }
    this.resolveAgentCollisions();
    this.poseWalkers(t);
    this.poseCars();
    for (const model of this.models) model.markDirty();
  }

  resolvePlayer(pos: THREE.Vector3, radius: number) {
    if (!this.group.visible) return;
    for (const w of this.walkers) {
      if (!w.seg || Math.abs(w.y - pos.y) > 2) continue;
      const dx = pos.x - w.x, dz = pos.z - w.z, d = Math.hypot(dx, dz), limit = radius + .28;
      if (d < limit && d > .001) { pos.x += dx / d * (limit - d); pos.z += dz / d * (limit - d); }
    }
    for (const c of this.cars) {
      if (!c.seg || Math.abs(c.y - pos.y) > 2.5) continue;
      const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz), limit = radius + 1.7;
      if (d < limit && d > .001) { pos.x += dx / d * (limit - d); pos.z += dz / d * (limit - d); }
    }
  }

  stats() { return { cityPedestrians: this.group.visible ? this.walkers.filter((w) => w.seg).length : 0, cityCars: this.group.visible ? this.cars.filter((c) => c.seg).length : 0, cityLifeSegments: this.segments.length }; }
}
