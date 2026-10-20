// Vehicle traffic: instanced cars/taxis/vans/bikes on the lane graph, Muni buses on their real routes, Powell cable cars on
// the centre tracks. IDM car-following, signal compliance (stop bar 3 m before the crosswalk), intersection-box yielding,
// stops with dwell times, wheel spin/steer, per-instance paint colours, canvas screens for buses and cable cars.
import * as THREE from 'three';
import type { Updatable, App } from '../app/App';
import type { World } from '../world/World';
import type { Props } from '../world/Props';
import { Assets } from '../assets/Assets';
import { Materials } from '../materials/Library';
import { Rng } from '../util/Rng';
import { Config } from '../app/Config';
import { LaneGraph, Link, Node, NextRef, CLS, Dir, Lane } from './LaneGraph';
import type { TrafficLights } from './TrafficLights';

interface Meta { length: number; width: number; wheelbase: number; wheelRadius: number }
interface Part { im: THREE.InstancedMesh; wheel: string | null; pivot: THREE.Vector3; paint: boolean }
interface Stop { link: Link; s: number; dwell: number }
interface Route { name: string; street: string; dir: Dir; pick: (l: Lane) => boolean; stops: { t: number; dwell: number }[]; sign: string; board?: string; number?: string; startT: number }

class VehicleModel {
  parts: Part[] = [];
  group = new THREE.Group();
  count = 0;
  constructor(public name: string, proto: THREE.Object3D, public meta: Meta, public capacity: number, paintMat: THREE.Material) {
    this.group.name = `traffic_${name}`;
    proto.updateMatrixWorld(true);
    proto.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      let wheel: string | null = null; const pivot = new THREE.Vector3();
      for (let a: THREE.Object3D | null = m; a; a = a.parent) { const mm = /^wheel_(fl|fr|rl|rr|rl2|rr2)/.exec(a.name); if (mm) { wheel = mm[1]; a.getWorldPosition(pivot); } }
      const geo = m.geometry.clone(); geo.applyMatrix4(m.matrixWorld);
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material;
      const paint = mat.name === 'car_paint';
      const im = new THREE.InstancedMesh(geo, paint ? paintMat : mat, capacity);
      im.castShadow = true; im.receiveShadow = false; im.frustumCulled = false; im.count = 0; im.name = `${name}:${m.name}`;
      this.parts.push({ im, wheel, pivot, paint }); this.group.add(im);
    });
  }
  add(): number { const i = this.count++; for (const p of this.parts) p.im.count = this.count; return i; }
  setColor(i: number, c: THREE.Color) { for (const p of this.parts) if (p.paint) { p.im.setColorAt(i, c); p.im.instanceColor!.needsUpdate = true; } }
  markDirty() { for (const p of this.parts) p.im.instanceMatrix.needsUpdate = true; }
}

interface Vehicle {
  id: number; cls: number; kind: string;
  model: VehicleModel | null; index: number;                 // instanced
  obj: THREE.Group | null; wheels: { o: THREE.Object3D; front: boolean }[]; // non-instanced clone
  link: Link; s: number; v: number; vmax: number; acc: number; dec: number; halfLen: number; wheelR: number; wheelbase: number;
  spin: number; steer: number; yaw: number; committed: boolean;
  next: NextRef | null; cursor: { i: number };
  stops: Stop[] | null; stopIdx: number; dwell: number; route: Route | null;
  alive: boolean; respawn: number; served: number;
}

const PALETTE: [number, number][] = [[0xf2f2f0, 0.24], [0x111214, 0.2], [0x6f7276, 0.16], [0xc2c4c8, 0.14], [0x17264d, 0.1], [0xa3161b, 0.08], [0x2f4a2e, 0.03], [0x5a3d2b, 0.03], [0xd9c8a0, 0.02]];
const S0 = 2.0, HEADWAY = 1.2;
const DWELL_BUS = 12, DWELL_CABLE = 20;

export class Traffic implements Updatable {
  frozen = false;
  group = new THREE.Group();
  graph!: LaneGraph;
  vehicles: Vehicle[] = [];
  models = new Map<string, VehicleModel>();
  rng: Rng;
  count: number;
  built = false;
  private paintMat!: THREE.MeshStandardMaterial;
  private spawnCache = new Map<number, Link[]>();
  private tmp = new Float64Array(6); private tmpA = new Float64Array(6); private tmpB = new Float64Array(6);
  private playerCollisionSample = new Float64Array(6);
  private m4 = new THREE.Matrix4(); private m4b = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(0, 0, 0, 'YXZ'); private v3 = new THREE.Vector3(); private v3b = new THREE.Vector3(); private one = new THREE.Vector3(1, 1, 1);
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private msAcc = 0; private msN = 0; ms = 0;
  constructor(public world: World, public app: App, public props: Props | null, public lights: TrafficLights, opts: { count?: number } = {}) {
    this.group.name = 'traffic';
    this.count = opts.count ?? 110;
    this.rng = new Rng((Config.seed ^ 0x7a11) >>> 0);
  }

  async build() {
    this.graph = new LaneGraph(this.world);
    for (const n of this.graph.nodes) if (n.signal) n.light = this.lights.state(n.x, n.z);
    const base = Materials.get('car_paint') as THREE.MeshStandardMaterial;
    this.paintMat = base.clone(); this.paintMat.color.set(0xffffff); this.paintMat.name = 'car_paint_inst';
    const k = this.count / 110;
    const mix: [string, number, number][] = [['sedan', Math.round(32 * k), CLS.CAR], ['suv', Math.round(24 * k), CLS.CAR], ['hatch', Math.round(18 * k), CLS.CAR], ['taxi', Math.round(11 * k), CLS.TAXI], ['van_delivery', Math.round(6 * k), CLS.VAN], ['box_truck', Math.max(1, Math.round(3 * k)), CLS.VAN], ['police_suv', Math.max(1, Math.round(2 * k)), CLS.CAR], ['bus_tour', Math.max(1, Math.round(2 * k)), CLS.TOUR], ['bicycle', Math.max(2, Math.round(6 * k)), CLS.BIKE]];
    for (const [name, n, cls] of mix) {
      const rel = `vehicles/${name}`; if (!Assets.has(rel) || n <= 0) continue;
      const meta = Assets.manifest[rel] as any as Meta;
      const proto = await Assets.load(rel);
      const model = new VehicleModel(name, proto, meta, n, this.paintMat);
      this.models.set(name, model); this.group.add(model.group);
      for (let i = 0; i < n; i++) {
        const v = this.newVehicle(name, cls, meta); v.model = model; v.index = model.add();
        model.setColor(v.index, this.pickColour(name));
      }
    }
    // Muni buses (non-instanced clones so each can carry its own destination sign)
    const gearyZ = this.spec('Geary Street'), postZ = this.spec('Post Street'), sutterZ = this.spec('Sutter Street'), ofarrellZ = this.spec("O'Farrell Street"), powellX = this.spec('Powell Street'), stocktonX = this.spec('Stockton Street'), grantX = this.spec('Grant Avenue'), masonX = this.spec('Mason Street');
    const transit = (l: Lane) => l.kind === 'transit', curbRight = (l: Lane) => l.kind === 'car' && l.index === l.spec.lanes - 1, curbLeft = (l: Lane) => l.kind === 'car' && l.index === 0;
    const routes: Route[] = [
      { name: '38 Geary WB', street: 'Geary Street', dir: 'W', pick: transit, sign: '38 GEARY', startT: 240, stops: [{ t: stocktonX + 18, dwell: DWELL_BUS }, { t: powellX - 21, dwell: DWELL_BUS }, { t: masonX - 20, dwell: DWELL_BUS }] },
      { name: "38 O'Farrell EB", street: "O'Farrell Street", dir: 'E', pick: transit, sign: '38 GEARY', startT: -300, stops: [{ t: masonX + 22, dwell: DWELL_BUS }, { t: powellX + 22, dwell: DWELL_BUS }, { t: grantX - 22, dwell: DWELL_BUS }] },
      { name: '30 Stockton SB', street: 'Stockton Street', dir: 'S', pick: transit, sign: '30 STOCKTON', startT: -330, stops: [{ t: sutterZ - 21, dwell: DWELL_BUS }, { t: gearyZ - 20, dwell: DWELL_BUS }] },
      { name: '2 Clement EB', street: 'Post Street', dir: 'E', pick: curbRight, sign: '2 CLEMENT', startT: -160, stops: [{ t: powellX + 24, dwell: DWELL_BUS }, { t: grantX - 22, dwell: DWELL_BUS }] },
    ];
    void sutterZ; void ofarrellZ; void postZ; void curbLeft;
    const busMeta = Assets.manifest['vehicles/bus_muni'] as any as Meta;
    if (Assets.has('vehicles/bus_muni')) for (const r of routes) {
      const v = this.newVehicle('bus_muni', CLS.BUS, busMeta); v.route = r;
      v.obj = await Assets.instance('vehicles/bus_muni'); v.obj.name = `bus ${r.name}`; this.bindClone(v);
      this.screen(v.obj, 'destsign', r.sign, { w: 512, h: 112, bg: '#0a0a0a', fg: '#ffb000', font: 'bold 78px Arial Narrow, Arial, sans-serif' });
      this.group.add(v.obj);
      if (!this.placeRoute(v)) v.alive = false;
    }
    // cable cars: 2 per direction on the Powell centre tracks
    const cableMeta = Assets.manifest['vehicles/cable_car_powell'] as any as Meta;
    const cableStops = (dir: Dir) => dir === 'N' ? [{ t: gearyZ + 17.5, dwell: DWELL_CABLE }, { t: postZ + 17.5, dwell: DWELL_CABLE }] : [{ t: postZ - 17.5, dwell: DWELL_CABLE }, { t: gearyZ - 17.5, dwell: DWELL_CABLE }];   // near-side stops, nose ~2 m short of the stop bar
    const cableDefs: [Dir, number, string, string][] = [['N', 300, '27', 'POWELL & MARKET · HYDE & BEACH'], ['N', -30, '12', 'POWELL & MASON'], ['S', -320, '5', 'POWELL & MASON'], ['S', 90, '18', 'POWELL & MARKET · HYDE & BEACH']];
    if (Assets.has('vehicles/cable_car_powell')) for (const [dir, startT, num, board] of cableDefs) {
      const r: Route = { name: `cable ${num} ${dir}`, street: 'Powell Street', dir, pick: (l) => l.kind === 'cable' || l.kind === 'shared', stops: cableStops(dir), sign: '', number: num, board, startT };
      const v = this.newVehicle('cable_car_powell', CLS.CABLE, cableMeta); v.route = r; v.vmax = 4.2; v.acc = 0.7; v.dec = 1.2;
      v.obj = await Assets.instance('vehicles/cable_car_powell'); v.obj.name = `cablecar ${num}`; this.bindClone(v);
      this.screen(v.obj, 'number', num, { w: 160, h: 96, bg: '#e8dcb8', fg: '#2a1010', font: 'bold 76px Georgia, serif' });
      this.screen(v.obj, 'destboard_l', board, { w: 1024, h: 128, bg: '#6a1420', fg: '#f0e0a0', font: 'bold 64px Georgia, serif' });
      this.group.add(v.obj);
      if (!this.placeRoute(v)) v.alive = false;
    }
    // initial population of the instanced fleet along the block links
    this.populate();
    for (const m of this.models.values()) m.markDirty();
    this.app.scene.add(this.group);
    this.built = true;
    this.pose(0);
    return this;
  }
  private spec(name: string) { return this.world.streetSpecs.find((s) => s.name === name)!.c; }
  private newVehicle(kind: string, cls: number, meta: Meta): Vehicle {
    const v: Vehicle = { id: this.vehicles.length, cls, kind, model: null, index: -1, obj: null, wheels: [], link: null as any, s: 0, v: 0, vmax: 11.2, acc: 1.6, dec: 2.5, halfLen: meta.length / 2 + 0.25, wheelR: meta.wheelRadius || 0.33, wheelbase: meta.wheelbase || 2.7, spin: 0, steer: 0, yaw: 0, committed: false, next: null, cursor: { i: 0 }, stops: null, stopIdx: 0, dwell: 0, route: null, alive: false, respawn: 0, served: 0 };
    if (cls === CLS.BIKE) { v.vmax = this.rng.range(4.2, 5.6); v.acc = 1.0; v.dec = 1.8; }
    else if (cls === CLS.BUS || cls === CLS.TOUR) { v.vmax = this.rng.range(9.5, 10.5); v.acc = 1.0; v.dec = 2.0; }
    else if (cls === CLS.VAN) { v.vmax = this.rng.range(9.5, 11); v.acc = 1.2; }
    else v.vmax = this.rng.range(10.2, 12.4);
    this.vehicles.push(v);
    return v;
  }
  private pickColour(kind: string): THREE.Color {
    const c = new THREE.Color();
    if (kind === 'taxi') return c.set(0xf2c41a);
    if (kind === 'police_suv') return c.set(0xf4f4f4);
    if (kind === 'van_delivery') return c.set(this.rng.chance(0.7) ? 0xf0f0ee : this.rng.chance(0.5) ? 0x4a3421 : 0xf2c41a);
    if (kind === 'box_truck') return c.set(this.rng.chance(0.8) ? 0xf0f0ee : 0xf2c41a);
    if (kind === 'bicycle') return c.set(this.rng.pick([0x1b1b1d, 0xc4342a, 0x2b5fa8, 0xe0e0e0, 0x3f8a3a, 0xd67a1c]));
    let r = this.rng.next();
    for (const [hex, p] of PALETTE) { r -= p; if (r <= 0) return c.set(hex); }
    return c.set(PALETTE[0][0]);
  }
  private bindClone(v: Vehicle) {
    const o = v.obj!;
    o.traverse((c) => { const mm = /^wheel_(fl|fr|rl|rr|rl2|rr2)/.exec(c.name); if (mm && !(c.parent && /^wheel_/.test(c.parent.name))) v.wheels.push({ o: c, front: mm[1] === 'fl' || mm[1] === 'fr' }); });
    o.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; } });
  }
  /** Replace the named mesh's 'screen' material with a canvas texture showing `text`. */
  private screen(root: THREE.Object3D, meshName: string, text: string, o: { w: number; h: number; bg: string; fg: string; font: string }) {
    const mesh = root.getObjectByName(meshName) as THREE.Mesh | undefined; if (!mesh) return;
    const cv = document.createElement('canvas'); cv.width = o.w; cv.height = o.h;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = o.bg; ctx.fillRect(0, 0, o.w, o.h);
    ctx.translate(o.w, 0); ctx.scale(-1, 1);   // the screen quads' u axis runs right-to-left as seen from outside the vehicle
    ctx.fillStyle = o.fg; ctx.font = o.font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let size = parseInt(o.font.match(/(\d+)px/)?.[1] || '64', 10);
    while (ctx.measureText(text).width > o.w * 0.92 && size > 12) { size -= 4; ctx.font = o.font.replace(/\d+px/, `${size}px`); }
    ctx.fillText(text, o.w / 2, o.h / 2 + size * 0.04);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    mesh.material = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0 });
  }
  private spawnLinks(cls: number): Link[] {
    let l = this.spawnCache.get(cls);
    if (!l) { l = this.graph.links.filter((k) => k.entry && (k.allow & cls)); this.spawnCache.set(cls, l); }
    return l;
  }
  private resolveStops(v: Vehicle): boolean {
    const r = v.route!; v.stops = [];
    for (const st of r.stops) { const f = this.graph.findLink(r.street, r.dir, st.t, r.pick); if (f) v.stops.push({ link: f.link, s: f.s, dwell: st.dwell }); }
    const order = new Map<Link, number>(); this.graph.lanes.forEach((ln) => ln.links.forEach((lk, i) => order.set(lk, i)));
    v.stops.sort((a, b) => (order.get(a.link)! - order.get(b.link)!) || a.s - b.s);
    return true;
  }
  private placeRoute(v: Vehicle): boolean {
    const r = v.route!; this.resolveStops(v);
    const f = this.graph.findLink(r.street, r.dir, r.startT, r.pick); if (!f) return false;
    this.enter(v, f.link, f.s); v.v = Math.min(v.vmax, f.link.vmax) * 0.6;
    v.stopIdx = 0; while (v.stopIdx < v.stops!.length && v.stops![v.stopIdx].link === v.link && v.stops![v.stopIdx].s < v.s) v.stopIdx++;
    for (let i = 0; i < v.stopIdx; i++) void 0;
    return true;
  }
  private enter(v: Vehicle, link: Link, s: number) {
    v.link = link; v.s = s; v.cursor.i = 0; v.committed = false; v.alive = true;
    link.vehicles.push(v); this.sortLink(link);
    if (link.node) link.node.occ[link.axis === 'ns' ? 0 : 1]++;
    v.next = this.chooseNext(v);
  }
  private leave(v: Vehicle) {
    const l = v.link; const i = l.vehicles.indexOf(v); if (i >= 0) l.vehicles.splice(i, 1);
    if (l.node) l.node.occ[l.axis === 'ns' ? 0 : 1] = Math.max(0, l.node.occ[l.axis === 'ns' ? 0 : 1] - 1);
  }
  private chooseNext(v: Vehicle): NextRef | null {
    const opts = v.link.next.filter((n) => n.allow & v.cls);
    if (!opts.length) return null;
    if (v.link.node) return opts[0];
    const through = opts.filter((n) => !n.turn), turns = opts.filter((n) => n.turn);
    if (v.cls & (CLS.BUS | CLS.CABLE | CLS.BIKE)) return through[0] ?? null;
    if (!through.length) return turns[0];
    if (turns.length && this.rng.chance(0.12)) return turns[0];
    return through[0];
  }
  private sortLink(l: Link) {
    const a = l.vehicles;
    for (let i = 1; i < a.length; i++) { const x = a[i]; let j = i - 1; while (j >= 0 && a[j].s < x.s) { a[j + 1] = a[j]; j--; } a[j + 1] = x; }
  }
  private populate() {
    const blocks = this.graph.links.filter((l) => l.lane && !l.node);
    const total = blocks.reduce((a, l) => a + l.len, 0);
    for (const v of this.vehicles) {
      if (v.route) continue;
      let ok = false;
      for (let tries = 0; tries < 40 && !ok; tries++) {
        let r = this.rng.next() * total; let link = blocks[0];
        for (const l of blocks) { r -= l.len; if (r <= 0) { link = l; break; } }
        if (!(link.allow & v.cls)) continue;
        // bias the visible core: skip half of the picks far from the square
        const mid = link.pts.length / 6 | 0; const cx = link.pts[mid * 3], cz = link.pts[mid * 3 + 2];
        const far = Math.hypot(cx, cz); if (far > 300 && this.rng.chance(0.85)) continue; if (far > 180 && this.rng.chance(0.55)) continue;
        const s = this.rng.range(v.halfLen + 1, Math.max(v.halfLen + 1.5, link.len - v.halfLen - 1));
        if (link.vehicles.some((w) => Math.abs(w.s - s) < w.halfLen + v.halfLen + 6)) continue;
        this.enter(v, link, s); v.v = Math.min(v.vmax, link.vmax) * this.rng.range(0.5, 0.9); ok = true;
      }
      if (!ok) { v.alive = false; v.respawn = this.rng.range(0.2, 2); }
    }
  }
  private trySpawn(v: Vehicle): boolean {
    if (v.route) {
      const r = v.route; const lane = this.graph.lanes.find((l) => l.spec.name === r.street && l.dir === r.dir && r.pick(l) && l.links[0]?.entry);
      const link = lane?.links[0]; if (!link) return false;
      const last = link.vehicles[link.vehicles.length - 1]; if (last && last.s < last.halfLen + v.halfLen + 8) return false;
      this.resolveStops(v); v.stopIdx = 0; this.enter(v, link, 0.5); v.v = Math.min(v.vmax, link.vmax) * 0.5; return true;
    }
    const links = this.spawnLinks(v.cls); if (!links.length) return false;
    for (let t = 0; t < 3; t++) {
      const link = this.rng.pick(links);
      const last = link.vehicles[link.vehicles.length - 1]; if (last && last.s < last.halfLen + v.halfLen + 8) continue;
      this.enter(v, link, 0.5); v.v = Math.min(v.vmax, link.vmax) * 0.7; return true;
    }
    return false;
  }

  update(dt: number) {
    if (!this.built || this.frozen || dt <= 0) return;
    const t0 = performance.now();
    dt = Math.min(dt, 0.1);
    for (const v of this.vehicles) {
      if (!v.alive) { v.respawn -= dt; if (v.respawn <= 0) { if (!this.trySpawn(v)) v.respawn = 0.4; } continue; }
      this.drive(v, dt);
    }
    for (const l of this.graph.links) if (l.vehicles.length > 1) this.sortLink(l);
    this.pose(dt);
    const ms = performance.now() - t0; this.msAcc += ms; this.msN++; if (this.msN >= 60) { this.ms = this.msAcc / this.msN; this.msAcc = 0; this.msN = 0; }
  }

  private drive(v: Vehicle, dt: number) {
    const K = v.link, list = K.vehicles;
    let gap = 1e9, lv = 0;
    const idx = list.indexOf(v);
    let leader: Vehicle | null = null;
    if (idx > 0) { const L = list[idx - 1]; leader = L; gap = L.s - L.halfLen - v.s - v.halfLen; lv = L.v; }
    const rem = K.len - v.s;
    const n1 = v.next?.link ?? null;
    if (!leader && n1) {
      if (n1.vehicles.length) { const w = n1.vehicles[n1.vehicles.length - 1]; const g = rem + w.s - w.halfLen - v.halfLen; if (g < gap) { gap = g; lv = w.v; } }
      else if (n1.len < 40 && n1.next.length === 1) { const n2 = n1.next[0].link; if (n2.vehicles.length) { const w = n2.vehicles[n2.vehicles.length - 1]; const g = rem + n1.len + w.s - w.halfLen - v.halfLen; if (g < gap) { gap = g; lv = w.v; } } }
      if (rem < 30) for (const P of n1.preds) { if (P === K) continue; for (const w of P.vehicles) { if (w.next?.link !== n1) continue; const remW = P.len - w.s; if (remW < rem) { const g = rem - remW - w.halfLen - v.halfLen; if (g < gap) { gap = g; lv = w.v; } } } }
    }
    // stop line: red / amber / occupied box
    let stopAt = 1e9;
    const node = K.endNode;
    if (node && n1?.node === node && !node.signal && rem > v.halfLen + 0.3 && this.unsignalizedConflict(v, node)) {
      stopAt = Math.min(stopAt, Math.max(0, rem - v.halfLen - 0.3));
    }
    if (node && node.signal && node.light) {
      const col = K.axis === 'ns' ? node.light.ns : node.light.ew;
      const dE = rem - v.halfLen;
      if (col === 'green') v.committed = false;
      else if (v.committed || dE < -0.3) { /* already past the line (or committed on amber): clear the box */ }
      else if (col === 'red') stopAt = Math.min(stopAt, dE);
      else if (dE > (v.v * v.v) / (2 * 3.2) + 0.5) stopAt = Math.min(stopAt, dE); else v.committed = true;   // amber: stop if comfortable
      if (stopAt > 1e8 && dE < 14 && node.occ[K.axis === 'ns' ? 1 : 0] > 0) stopAt = Math.min(stopAt, dE);   // yield: cross traffic still in the box
    }
    // bus / cable-car stop
    if (v.stops && v.stopIdx < v.stops.length) {
      const st = v.stops[v.stopIdx];
      let d = st.link === K ? st.s - v.s : n1 && st.link === n1 ? rem + st.s : NaN;
      if (Number.isFinite(d)) {
        if (d < 1.0 && v.v < 0.3) { if (v.dwell <= 0 && !(v as any).dwelling) { (v as any).dwelling = true; v.dwell = st.dwell; } v.dwell -= dt; if (v.dwell <= 0) { v.stopIdx++; v.served++; (v as any).dwelling = false; } else { v.v = 0; d = 0; stopAt = 0; } }
        else if (d > -1.0) stopAt = Math.min(stopAt, Math.max(0, d));
      }
    }
    // desired speed: link limit, slow ahead of a turn
    let v0 = Math.min(v.vmax, K.vmax);
    if (n1 && n1.vmax < v0 && rem < 25) v0 = Math.min(v0, n1.vmax + rem * 0.35);
    // IDM
    let g = gap, dv = v.v - lv;
    if (stopAt + S0 - 0.4 < g) { g = Math.max(0.05, stopAt + S0 - 0.4); dv = v.v; }   // point obstacle: IDM settles at gap S0, so offset it to put the bumper ~0.4 m short of the line
    const a = v.acc, b = v.dec;
    const sStar = S0 + Math.max(0, v.v * HEADWAY + (v.v * dv) / (2 * Math.sqrt(a * b)));
    let acc = a * (1 - Math.pow(v.v / v0, 4) - Math.pow(sStar / Math.max(g, 0.3), 2));
    if (acc < -9) acc = -9;
    v.v = Math.max(0, v.v + acc * dt);
    if (g < 0.35 && stopAt <= 0.35) v.v = 0;
    let s = v.s + v.v * dt;
    // hard constraints: never overlap the same-link leader, never cross a stop line we decided to stop at
    const L = leader as Vehicle | null;
    if (L) { const maxS = L.s - L.halfLen - v.halfLen - 0.3; if (s > maxS) { s = Math.max(v.s, maxS); v.v = Math.min(v.v, L.v); } }
    if (stopAt < 1e8) { const maxS = v.s + stopAt; if (s > maxS) { s = Math.max(v.s, maxS); v.v = 0; } }
    v.spin += (s - v.s) / v.wheelR;
    v.s = s;
    // link transitions
    while (v.s >= v.link.len) {
      const nx = v.next;
      if (!nx) { this.leave(v); v.alive = false; v.respawn = this.rng.range(0.3, 2.5); v.stopIdx = 0; if (v.model) this.hide(v); return; }
      const carry = v.s - v.link.len;
      this.leave(v); this.enter(v, nx.link, carry);
    }
  }
  private hide(v: Vehicle) { if (v.model) for (const p of v.model.parts) p.im.setMatrixAt(v.index, this.zero); }

  /** Deterministic right-of-way for the few unsignalized crossings in the
   * analytic downtown graph. Signalized nodes use the light path below. */
  private unsignalizedConflict(v: Vehicle, node: Node): boolean {
    const axis = v.link.axis;
    for (const other of this.vehicles) {
      if (other === v || !other.alive) continue;
      const approaching = other.link.node ?? other.next?.link.node ?? null;
      if (approaching !== node || other.link.axis === axis) continue;
      // A vehicle already in the box always has priority. When both are still
      // approaching, the stable pool id breaks the tie so both cannot enter on
      // the same frame and occupy the same intersection.
      if (other.link.node === node || other.id < v.id) return true;
    }
    return false;
  }

  private pose(dt: number) {
    const P = this.tmp, A = this.tmpA, B = this.tmpB;
    for (const v of this.vehicles) {
      if (!v.alive) { if (v.obj) v.obj.visible = false; continue; }
      const K = v.link;
      LaneGraph.sample(K, v.s, P, v.cursor);
      const h = Math.min(1.5, K.len / 2);
      LaneGraph.sample(K, Math.max(0, v.s - h), A, { i: v.cursor.i }); LaneGraph.sample(K, Math.min(K.len, v.s + h), B, { i: v.cursor.i });
      let tx = B[0] - A[0], ty = B[1] - A[1], tz = B[2] - A[2];
      if (tx * tx + tz * tz < 1e-6) { tx = P[3]; ty = P[4]; tz = P[5]; }
      const yaw = Math.atan2(tx, tz), pitch = -Math.atan2(ty, Math.hypot(tx, tz));
      if (dt > 0) { let dy = yaw - v.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); const target = Math.max(-0.6, Math.min(0.6, Math.atan2(v.wheelbase * dy / dt, Math.max(v.v, 1)))); v.steer += (target - v.steer) * Math.min(1, dt * 8); }
      v.yaw = yaw;
      this.e.set(pitch, yaw, 0, 'YXZ'); this.q.setFromEuler(this.e);
      this.v3.set(P[0], P[1], P[2]);
      if (v.model) {
        this.m4.compose(this.v3, this.q, this.one);
        for (const p of v.model.parts) {
          if (!p.wheel) { p.im.setMatrixAt(v.index, this.m4); continue; }
          const front = p.wheel === 'fl' || p.wheel === 'fr';
          this.e.set(v.spin, front ? v.steer : 0, 0, 'YXZ'); this.m4b.makeRotationFromEuler(this.e);
          this.v3b.copy(p.pivot).applyMatrix4(this.m4b);
          this.m4b.setPosition(p.pivot.x - this.v3b.x, p.pivot.y - this.v3b.y, p.pivot.z - this.v3b.z);
          this.m4b.premultiply(this.m4);
          p.im.setMatrixAt(v.index, this.m4b);
        }
      } else if (v.obj) {
        v.obj.visible = true; v.obj.position.copy(this.v3); v.obj.quaternion.copy(this.q);
        for (const w of v.wheels) w.o.rotation.set(v.spin, w.front ? v.steer : 0, 0, 'YXZ');
      }
    }
    for (const m of this.models.values()) m.markDirty();
  }

  stats() {
    let moving = 0, stopped = 0, alive = 0, buses = 0, cable = 0, bikes = 0;
    for (const v of this.vehicles) { if (!v.alive) continue; alive++; if (v.v > 0.3) moving++; else stopped++; if (v.cls === CLS.BUS) buses++; if (v.cls === CLS.CABLE) cable++; if (v.cls === CLS.BIKE) bikes++; }
    return { vehicles: alive, total: this.vehicles.length, moving, stopped, buses, cableCars: cable, bikes, links: this.graph?.links.length ?? 0, nodes: this.graph?.nodes.length ?? 0, msUpdate: +this.ms.toFixed(3) };
  }
  /** Oriented vehicle body collision. LaneGraph positions are current even for instanced cars. */
  resolvePlayer(pos: THREE.Vector3, radius: number) {
    if (!this.group.visible) return;
    const P = this.playerCollisionSample;
    for (const v of this.vehicles) {
      if (!v.alive) continue;
      LaneGraph.sample(v.link, v.s, P, { i: v.cursor.i });
      if (Math.abs(P[0] - pos.x) > v.halfLen + 2 || Math.abs(P[2] - pos.z) > v.halfLen + 2 || Math.abs(P[1] - pos.y) > 2.5) continue;
      const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), rx = fz, rz = -fx;
      const dx = pos.x - P[0], dz = pos.z - P[2];
      const side = dx * rx + dz * rz, fore = dx * fx + dz * fz;
      const halfW = ((v.model?.meta.width ?? (v.cls === CLS.BUS ? 2.6 : 2.0)) / 2) + radius;
      const halfL = v.halfLen + radius;
      if (Math.abs(side) >= halfW || Math.abs(fore) >= halfL) continue;
      const pushSide = halfW - Math.abs(side), pushFore = halfL - Math.abs(fore);
      if (pushSide < pushFore) {
        const sign = side >= 0 ? 1 : -1;
        pos.x += rx * sign * pushSide; pos.z += rz * sign * pushSide;
      } else {
        const sign = fore >= 0 ? 1 : -1;
        pos.x += fx * sign * pushFore; pos.z += fz * sign * pushFore;
      }
    }
  }
  /** Debug snapshot of every live vehicle (position, heading, speed, link). */
  snapshot() {
    const P = this.tmp;
    return this.vehicles.filter((v) => v.alive).map((v) => { LaneGraph.sample(v.link, v.s, P, { i: v.cursor.i }); return { id: v.id, kind: v.kind, x: +P[0].toFixed(2), y: +P[1].toFixed(2), z: +P[2].toFixed(2), v: +v.v.toFixed(2), dir: v.link.dir, street: v.link.name, s: +v.s.toFixed(1), len: +v.link.len.toFixed(1), conn: !!v.link.node, turn: v.link.turn, halfLen: v.halfLen, served: v.served }; });
  }
}
export { LaneGraph, CLS, GENERAL } from './LaneGraph';
export type { Node, Link, Dir };
