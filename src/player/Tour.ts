import * as THREE from 'three';
import type { Updatable } from '../app/App';

export interface TourStop { title: string; subtitle?: string; pos: [number, number, number]; look: [number, number, number]; duration: number; time?: 'day' | 'sunset' | 'night'; hold?: number }

export class Tour implements Updatable {
  enabled = false;
  stops: TourStop[] = [];
  i = 0; t = 0;
  onStop?: (s: TourStop, idx: number) => void;
  onEnd?: () => void;
  private from = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  private lookCur = new THREE.Vector3();
  constructor(public camera: THREE.PerspectiveCamera) {}
  start(stops: TourStop[]) {
    this.stops = stops; this.i = 0; this.t = 0; this.enabled = true;
    this.from.pos.copy(this.camera.position);
    this.from.look.copy(this.camera.position).add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(30));
    this.onStop?.(stops[0], 0);
  }
  stop() { this.enabled = false; this.onEnd?.(); }
  update(dt: number) {
    if (!this.enabled) return;
    const s = this.stops[this.i]; if (!s) { this.stop(); return; }
    this.t += dt;
    const move = s.duration, hold = s.hold ?? 3;
    const k = Math.min(1, this.t / move);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const target = new THREE.Vector3(...s.pos), look = new THREE.Vector3(...s.look);
    this.camera.position.lerpVectors(this.from.pos, target, e);
    this.lookCur.lerpVectors(this.from.look, look, e);
    this.camera.lookAt(this.lookCur);
    if (this.t >= move + hold) {
      this.from.pos.copy(target); this.from.look.copy(look);
      this.i++; this.t = 0;
      if (this.i >= this.stops.length) { this.stop(); return; }
      this.onStop?.(this.stops[this.i], this.i);
    }
  }
}
