import * as THREE from 'three';
import type { Updatable } from '../app/App';
import type { CollisionWorld } from './Collision';

/** Player movement is stored independently of the camera so either view follows the same body. */
export class WalkControls implements Updatable {
  enabled = false;
  thirdPerson = true;
  yaw = 0;
  pitch = 0;
  bodyYaw = Math.PI;
  eyeHeight = 1.7;
  radius = 0.35;
  walkSpeed = 2.4;
  runSpeed = 6.2;
  jumpSpeed = 5.5;
  gravity = 9.8;
  velY = 0;
  footY = 0;
  grounded = false;
  fly = false;
  moving = false;
  moveSpeed = 0;
  keys = new Set<string>();
  locked = false;
  readonly body = new THREE.Vector3();
  /** Optional moving-world collision pass (crowd and traffic). */
  resolveDynamic: ((pos: THREE.Vector3, radius: number) => void) | null = null;
  private onMove = (e: MouseEvent) => {
    if (!this.locked || !this.enabled) return;
    this.yaw -= e.movementX * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0022, -0.7, 0.85);
    this.applyLook();
  };

  constructor(public camera: THREE.PerspectiveCamera, public world: CollisionWorld, public dom: HTMLElement) {
    document.addEventListener('mousemove', this.onMove);
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      document.dispatchEvent(new CustomEvent('twin:lock', { detail: this.locked }));
    });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement) return;
      this.keys.add(e.code);
      if (e.code === 'Space' && !e.repeat && this.enabled && !this.fly) this.jumpQueued = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  requestLock() { if (this.enabled) this.dom.requestPointerLock?.(); }
  setThirdPerson(value: boolean) {
    if (this.thirdPerson && !value) this.pitch = 0;
    this.thirdPerson = value;
    this.applyLook();
  }

  /** Teleport position is at the feet; heading zero faces local north (-Z). */
  teleport(x: number, z: number, yaw?: number, pitch?: number, footY?: number) {
    const floor = this.world.floorAt(x, z, footY ?? this.world.terrain(x, z) + 0.5, 100);
    this.fly = footY !== undefined && footY - floor > 3;
    this.footY = this.fly ? footY! : floor;
    this.body.set(x, this.footY, z);
    if (yaw !== undefined) { this.yaw = yaw; this.bodyYaw = yaw + Math.PI; }
    if (pitch !== undefined) this.pitch = pitch;
    this.velY = 0;
    this.grounded = !this.fly;
    this.jumpQueued = false;
    this.applyLook();
  }

  private jumpQueued = false;

  get forward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  get right() { return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }

  applyLook() {
    if (!this.thirdPerson || this.fly) {
      this.camera.position.set(this.body.x, this.footY + this.eyeHeight, this.body.z);
      this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      return;
    }

    // Shorten the chase camera if a wall lies between it and the player.
    let distance = 3.4;
    const baseY = this.footY + 1.55;
    while (distance > 0.8) {
      const cx = this.body.x + Math.sin(this.yaw) * distance;
      const cz = this.body.z + Math.cos(this.yaw) * distance;
      if (!this.world.blocked(this.body.x, this.body.z, cx, cz, baseY)) break;
      distance -= 0.4;
    }
    this.camera.position.set(
      this.body.x + Math.sin(this.yaw) * distance,
      baseY + 1.1 + Math.sin(this.pitch) * 2.2,
      this.body.z + Math.cos(this.yaw) * distance,
    );
    this.camera.lookAt(
      this.body.x - Math.sin(this.yaw) * 2,
      baseY - 0.05 - Math.sin(this.pitch) * 0.8,
      this.body.z - Math.cos(this.yaw) * 2,
    );
  }

  update(dt: number) {
    if (!this.enabled) return;
    const k = this.keys;
    const run = k.has('ShiftLeft') || k.has('ShiftRight');
    const speed = run ? this.runSpeed : this.walkSpeed;
    const move = new THREE.Vector3();
    if (k.has('KeyW') || k.has('ArrowUp')) move.add(this.forward);
    if (k.has('KeyS') || k.has('ArrowDown')) move.sub(this.forward);
    if (k.has('KeyD') || k.has('ArrowRight')) move.add(this.right);
    if (k.has('KeyA') || k.has('ArrowLeft')) move.sub(this.right);
    this.moving = move.lengthSq() > 0;
    this.moveSpeed = this.moving ? speed : 0;
    if (this.moving) {
      move.normalize();
      this.bodyYaw = Math.atan2(move.x, move.z);
      move.multiplyScalar(speed * dt);
    }
    const pos = this.body;
    if (!this.fly && this.jumpQueued && this.grounded) {
      this.velY = this.jumpSpeed;
      this.grounded = false;
    }
    this.jumpQueued = false;
    // Resolve in short steps so running cannot skip a thin wall or parked vehicle.
    const steps = Math.max(1, Math.ceil(move.length() / 0.22));
    for (let i = 0; i < steps; i++) {
      pos.x += move.x / steps;
      pos.z += move.z / steps;
      pos.y = this.footY;
      this.world.resolve(pos, this.radius, 1.7);
      this.resolveDynamic?.(pos, this.radius);
      this.world.resolve(pos, this.radius, 1.7);
    }
    if (!this.fly) {
      const floor = this.world.floorAt(pos.x, pos.z, this.footY);
      if (this.grounded) {
        if (floor >= this.footY) this.footY = floor;
        else this.grounded = false;
      }
      if (!this.grounded) {
        this.velY -= this.gravity * dt;
        this.footY += this.velY * dt;
        if (this.footY <= floor) {
          this.footY = floor;
          this.velY = 0;
          this.grounded = true;
        }
      }
    }
    pos.y = this.footY;
    this.applyLook();
  }
}
