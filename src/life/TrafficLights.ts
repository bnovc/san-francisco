// Signal controller: a 60 s coordinated cycle per signalised crossing (NS green 25 → amber 3 → all-red 2 → EW green 25 → amber 3 → all-red 2)
// with a small per-intersection offset. Drives the lamp materials of the signal heads placed by Props (found by walking the
// 'props' group for masts that contain a 'lamp_red' mesh, so this class does not depend on Props) and exposes the phase
// state for vehicles and pedestrians.
import * as THREE from 'three';
import type { Updatable, App } from '../app/App';
import type { World } from '../world/World';

export type LampColour = 'green' | 'amber' | 'red';
export interface SignalState { ns: LampColour; ew: LampColour; walkNS: boolean; walkEW: boolean; t: number }
interface Crossing { x: number; z: number; offset: number; state: SignalState; heads: Head[]; key: string }
interface Head { axis: 'ns' | 'ew'; lamps: Record<string, THREE.MeshStandardMaterial>; last: string }

export const CYCLE = 60, GREEN = 25, AMBER = 3, ALL_RED = 2, WALK_CLEAR = 6;
const ON = 2.5, OFF = 0.05;

function hash(x: number, z: number) { let h = (Math.round(x) * 73856093) ^ (Math.round(z) * 19349663); h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); return ((h ^ (h >>> 15)) >>> 0) / 4294967296; }

export class TrafficLights implements Updatable {
  frozen = false;
  time = 0;
  crossings: Crossing[] = [];
  private byKey = new Map<string, Crossing>();
  private attached = false;
  constructor(public world: World, public app: App, opts: { maxOffset?: number } = {}) {
    const maxOffset = opts.maxOffset ?? 8;
    const seen = new Set<string>();
    for (const c of world.streets.crossings) {
      if (!c.signal) continue;
      const key = `${Math.round(c.x)},${Math.round(c.z)}`;
      if (seen.has(key)) continue; seen.add(key);
      const cr: Crossing = { x: c.x, z: c.z, key, offset: hash(c.x, c.z) * maxOffset, state: { ns: 'red', ew: 'red', walkNS: false, walkEW: false, t: 0 }, heads: [] };
      this.crossings.push(cr); this.byKey.set(key, cr);
    }
    this.attachHeads();
    this.applyAll(true);
  }
  /** Find signal masts in the scene (children of the 'props' group that contain a 'lamp_red' mesh) and bind their lamp materials. */
  attachHeads() {
    const props = this.app.scene.getObjectByName('props');
    if (!props) return;
    for (const mast of props.children) {
      const red = mast.getObjectByName('lamp_red') as THREE.Mesh | undefined;
      if (!red || (mast as any).__tlBound) continue;
      const cr = this.nearest(mast.position.x, mast.position.z);
      if (!cr || Math.hypot(cr.x - mast.position.x, cr.z - mast.position.z) > 14) continue;
      (mast as any).__tlBound = true;
      const sx = Math.sign(mast.position.x - cr.x), sz = Math.sign(mast.position.z - cr.z);
      const head: Head = { axis: sx * sz < 0 ? 'ns' : 'ew', lamps: {}, last: '' };
      mast.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !/^(lamp_|ped_)/.test(o.name)) return;
        const mat = (m.material as THREE.MeshStandardMaterial).clone(); m.material = mat; head.lamps[o.name] = mat;
      });
      cr.heads.push(head);
    }
    this.attached = this.crossings.some((c) => c.heads.length > 0);
  }
  /** Signal state at a crossing (nearest to x,z). */
  state(x: number, z: number): SignalState | null { return this.nearest(x, z)?.state ?? null; }
  nearest(x: number, z: number): Crossing | null {
    const k = this.byKey.get(`${Math.round(x)},${Math.round(z)}`); if (k) return k;
    let best: Crossing | null = null, bd = 1e12;
    for (const c of this.crossings) { const d = (c.x - x) ** 2 + (c.z - z) ** 2; if (d < bd) { bd = d; best = c; } }
    return best;
  }
  static phase(t: number): SignalState {
    const ns: LampColour = t < GREEN ? 'green' : t < GREEN + AMBER ? 'amber' : 'red';
    const t2 = t - (GREEN + AMBER + ALL_RED);
    const ew: LampColour = t2 < 0 ? 'red' : t2 < GREEN ? 'green' : t2 < GREEN + AMBER ? 'amber' : 'red';
    return { ns, ew, walkNS: t < GREEN - WALK_CLEAR, walkEW: t2 >= 0 && t2 < GREEN - WALK_CLEAR, t };
  }
  update(dt: number) {
    if (!this.frozen) this.time += dt;
    if (!this.attached) this.attachHeads();
    this.applyAll(false);
  }
  private applyAll(force: boolean) {
    for (const c of this.crossings) {
      const t = ((this.time + c.offset) % CYCLE + CYCLE) % CYCLE;
      const p = TrafficLights.phase(t);
      const s = c.state; s.ns = p.ns; s.ew = p.ew; s.walkNS = p.walkNS; s.walkEW = p.walkEW; s.t = t;
      for (const h of c.heads) {
        const col = h.axis === 'ns' ? s.ns : s.ew, walk = h.axis === 'ns' ? s.walkNS : s.walkEW;
        const sig = col + (walk ? 'w' : 's');
        if (!force && sig === h.last) continue;
        h.last = sig;
        const L = h.lamps;
        if (L.lamp_red) L.lamp_red.emissiveIntensity = col === 'red' ? ON : OFF;
        if (L.lamp_amber) L.lamp_amber.emissiveIntensity = col === 'amber' ? ON : OFF;
        if (L.lamp_green) L.lamp_green.emissiveIntensity = col === 'green' ? ON : OFF;
        if (L.ped_walk) L.ped_walk.emissiveIntensity = walk ? ON : OFF;
        if (L.ped_stop) L.ped_stop.emissiveIntensity = walk ? OFF : ON;
      }
    }
  }
  stats() { return { signals: this.crossings.length, heads: this.crossings.reduce((a, c) => a + c.heads.length, 0), t: Math.round(this.time) }; }
}
