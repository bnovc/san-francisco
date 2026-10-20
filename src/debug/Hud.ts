import * as THREE from 'three';
import type { App } from '../app/App';
import { localToGeo, GRID_NORTH_BEARING_DEG } from '../geo/geo';
import { neighborhoodAt } from '../geo/neighborhood';

export class Hud {
  el = document.getElementById('hud')!;
  help = document.getElementById('help')!;
  toast = document.getElementById('toast')!;
  private locationLabel = document.getElementById('neighborhood-label')!;
  private lastLocation = '';
  visible = true;
  extra: () => string = () => '';
  private toastTimer = 0;
  constructor(private app: App) {
    this.help.textContent = 'Click the world to look around  ·  I inspect, then click an object  ·  WASD move (walk/orbit)  ·  Orbit ↑/↓ raise/lower view  ·  Shift run/pan faster  ·  Space jump  ·  Tab orbit  ·  V change camera  ·  E interact  ·  Q quest log  ·  Esc release mouse  ·  1/2/3 change light';
  }
  setVisible(v: boolean) { this.visible = v; this.el.style.display = v ? 'block' : 'none'; }
  setLocation(x: number, z: number) {
    const neighborhood = neighborhoodAt(x, z);
    const label = neighborhood ? `Near ${neighborhood}` : 'San Francisco';
    if (label !== this.lastLocation) {
      this.locationLabel.textContent = label;
      this.lastLocation = label;
    }
  }
  show(msg: string, ms = 2500) { this.toast.textContent = msg; this.toast.style.display = 'block'; clearTimeout(this.toastTimer); this.toastTimer = window.setTimeout(() => (this.toast.style.display = 'none'), ms); }
  update(mode: string) {
    if (!this.visible) return;
    const c = this.app.camera.position;
    const g = localToGeo(c.x, c.z);
    const dir = this.app.camera.getWorldDirection(new THREE.Vector3());
    const yawLocal = Math.atan2(dir.x, -dir.z) * 180 / Math.PI; // cw from grid north
    const compass = ((yawLocal + GRID_NORTH_BEARING_DEG) % 360 + 360) % 360;
    const s = this.app.stats();
    const neighborhood = neighborhoodAt(c.x, c.z);
    const location = neighborhood ? `Near ${neighborhood}` : 'San Francisco';
    this.el.textContent = `${location} · ${mode} · ${this.app.time.preset}
pos ${c.x.toFixed(1)}, ${c.y.toFixed(1)}, ${c.z.toFixed(1)}   ${g.lat.toFixed(6)}, ${g.lon.toFixed(6)}
heading ${compass.toFixed(0)}°   fps ${s.fps}   calls ${s.calls}   tris ${(s.triangles / 1e6).toFixed(2)}M   tex ${s.textures}
${this.extra()}`;
  }
}
