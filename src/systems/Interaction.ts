// Look-at highlight + prompt for storefronts and interactables; E activates.
import * as THREE from 'three';
import type { Updatable } from '../app/App';
import type { App } from '../app/App';
import type { World } from '../world/World';
import type { WalkControls } from '../player/WalkControls';
import type { Hero, Storefront } from '../world/Hero';
import type { Interactable } from '../world/HeroContext';

export class Interaction implements Updatable {
  prompt = document.getElementById('prompt')!;
  focus: Storefront | null = null;
  focusItem: Interactable | null = null;
  souvenirs = 0;
  private ring: THREE.Mesh;
  constructor(public app: App, public world: World, public walk: WalkControls, public hero: Hero) {
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.45, 32), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }));
    this.ring.visible = false; this.ring.renderOrder = 999; app.scene.add(this.ring);
  }
  hudLine() { return this.focusItem ? `look: ${this.focusItem.label}` : this.focus ? `look: ${this.focus.name} (${this.focus.category}, ${this.focus.status})` : ''; }
  nearby() { const c = this.walk.body; return this.hero.storefronts.filter((s) => s.position.distanceTo(c) < 25).map((s) => ({ id: s.id, name: s.name, d: +s.position.distanceTo(c).toFixed(1) })); }
  activate() {
    if (this.focusItem) { this.focusItem.onActivate(); document.dispatchEvent(new CustomEvent('twin:activate', { detail: this.focusItem.id })); return; }
    if (this.focus) this.toast(`${this.focus.name} · ${this.focus.address} · ${this.focus.status}${this.focus.enterable ? ' · walk in through the doors' : ''}`);
  }
  enter(id: string) { const s = this.hero.storefronts.find((x) => x.id === id || x.name.toLowerCase() === id.toLowerCase()); if (!s) return false; const p = s.position.clone().addScaledVector(s.facing, -3.5); this.walk.teleport(p.x, p.z, Math.atan2(s.facing.x, s.facing.z)); return true; }
  toast(msg: string) { const t = document.getElementById('toast')!; t.textContent = msg; t.style.display = 'block'; clearTimeout((this as any)._tt); (this as any)._tt = setTimeout(() => (t.style.display = 'none'), 3000); }
  toggleFlashlightHint() {}
  update() {
    if (!this.walk.enabled) { this.prompt.style.display = 'none'; this.ring.visible = false; return; }
    const cam = this.app.camera; const dir = cam.getWorldDirection(new THREE.Vector3());
    const player = this.walk.body.clone().add(new THREE.Vector3(0, 1.4, 0));
    // interactables first (close range, in view)
    let bestItem: Interactable | null = null, bestScore = 0;
    for (const it of this.hero.interactables) {
      const to = it.position.clone().sub(cam.position); const d = it.position.distanceTo(player); if (d > it.radius) continue;
      const cos = to.normalize().dot(dir); if (cos < 0.7) continue;
      const score = cos / (1 + d * 0.2); if (score > bestScore) { bestScore = score; bestItem = it; }
    }
    this.focusItem = bestItem;
    if (bestItem) {
      this.focus = null;
      this.prompt.innerHTML = `<b>${bestItem.label}</b><small>${bestItem.hint || 'Press E'}</small>`; this.prompt.style.display = 'block';
      this.ring.visible = true; this.ring.position.copy(bestItem.position); this.ring.lookAt(cam.position);
      return;
    }
    this.ring.visible = false;
    let best: Storefront | null = null; bestScore = 0;
    for (const s of this.hero.storefronts) {
      const to = s.position.clone().sub(cam.position); const d = s.position.distanceTo(player); if (d > 32) continue;
      const cos = to.normalize().dot(dir); if (cos < 0.86) continue;
      const score = cos / (1 + d * 0.05); if (score > bestScore) { bestScore = score; best = s; }
    }
    this.focus = best;
    if (best) { this.prompt.innerHTML = `<b>${best.name}</b> · ${best.category}${best.status !== 'open' && best.status !== 'unknown' ? ` · ${best.status}` : ''}<small>${best.enterable ? 'Open — walk in' : 'E · info'}</small>`; this.prompt.style.display = 'block'; }
    else this.prompt.style.display = 'none';
  }
}
