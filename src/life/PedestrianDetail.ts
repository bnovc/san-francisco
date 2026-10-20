import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BASE } from '../assets/Assets';
import { bindPoseIdle } from '../assets/CharacterClips';

/** A conversation-distance replacement for one instanced crowd member. */
export class PedestrianDetail {
  readonly group = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private idle: THREE.AnimationAction | null = null;
  private walk: THREE.AnimationAction | null = null;
  private active: THREE.AnimationAction | null = null;

  constructor(private model: 'man' | 'woman') {
    this.group.name = `pedestrian-detail-${model}`;
    this.group.visible = false;
  }

  async load() {
    const file = this.model === 'woman' ? 'npc_casual_woman.glb' : 'player_casual_man.glb';
    const gltf = await new GLTFLoader().loadAsync(`${BASE}assets/models/people/${file}`);
    this.group.add(gltf.scene);
    gltf.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = false; }
    });
    this.mixer = new THREE.AnimationMixer(gltf.scene);
    const walkClip = gltf.animations.find((clip) => clip.name.toLowerCase() === 'walk');
    this.idle = this.mixer.clipAction(bindPoseIdle(gltf.scene, walkClip));
    if (walkClip) this.walk = this.mixer.clipAction(walkClip);
    this.idle.play();
    this.active = this.idle;
  }

  get ready() { return this.mixer !== null; }

  show(x: number, y: number, z: number, yaw: number, scale: number, moving: boolean, speed: number, dt: number) {
    if (!this.mixer) return;
    this.group.visible = true;
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
    this.group.scale.setScalar(scale);
    const next = moving && this.walk ? this.walk : this.idle;
    if (next && next !== this.active) {
      next.reset().play();
      if (this.active) next.crossFadeFrom(this.active, 0.2, true);
      this.active = next;
    }
    if (this.walk) this.walk.timeScale = Math.max(0.7, Math.min(1.5, speed / 1.2));
    this.mixer.update(dt);
  }

  hide() { this.group.visible = false; }
}
