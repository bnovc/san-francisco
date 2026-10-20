import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Updatable } from '../app/App';

export class OrbitMode implements Updatable {
  controls: OrbitControls;
  enabled = false;
  private keys = new Set<string>();
  private forward = new THREE.Vector3();
  private right = new THREE.Vector3();
  private movement = new THREE.Vector3();
  constructor(public camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.minDistance = 5; this.controls.maxDistance = 900;
    this.controls.target.set(0, 5, 0);
    this.controls.enabled = false;
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        this.keys.add(e.code);
        e.preventDefault();
        return;
      }
      if (e.target instanceof HTMLButtonElement) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(e.code)) this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }
  setEnabled(v: boolean) { this.enabled = v; this.controls.enabled = v; if (!v) this.keys.clear(); else this.controls.update(); }
  frame(target: THREE.Vector3, distance: number, azimuthDeg: number, elevationDeg: number) {
    this.controls.target.copy(target);
    const a = THREE.MathUtils.degToRad(azimuthDeg), e = THREE.MathUtils.degToRad(elevationDeg);
    this.camera.position.set(target.x + Math.sin(a) * Math.cos(e) * distance, target.y + Math.sin(e) * distance, target.z + Math.cos(a) * Math.cos(e) * distance);
    this.controls.update();
  }
  update(dt: number) {
    if (!this.enabled) return;
    this.camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    this.forward.normalize();
    this.right.set(-this.forward.z, 0, this.forward.x);
    this.movement.set(0, 0, 0);
    if (this.keys.has('KeyW')) this.movement.add(this.forward);
    if (this.keys.has('KeyS')) this.movement.sub(this.forward);
    if (this.keys.has('KeyD')) this.movement.add(this.right);
    if (this.keys.has('KeyA')) this.movement.sub(this.right);
    if (this.keys.has('ArrowUp')) this.movement.y += 1;
    if (this.keys.has('ArrowDown')) this.movement.y -= 1;
    if (this.movement.lengthSq() > 0) {
      const distance = this.camera.position.distanceTo(this.controls.target);
      const speed = THREE.MathUtils.clamp(distance * 0.6, 12, 220) * (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 3 : 1);
      this.movement.normalize().multiplyScalar(speed * dt);
      this.camera.position.add(this.movement);
      this.controls.target.add(this.movement);
    }
    this.controls.update();
  }
}
