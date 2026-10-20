import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Updatable } from '../app/App';
import { BASE } from '../assets/Assets';
import { bindPoseIdle } from '../assets/CharacterClips';
import type { WalkControls } from './WalkControls';

/** One higher-detail, rigged player model. The instanced crowd stays inexpensive. */
export class PlayerAvatar implements Updatable {
  readonly group = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private active = '';

  constructor(private walk: WalkControls, scene: THREE.Scene) {
    this.group.name = 'player';
    scene.add(this.group);
  }

  async load() {
    const gltf = await new GLTFLoader().loadAsync(`${BASE}assets/models/people/player_casual_man.glb`);
    this.group.add(gltf.scene);
    gltf.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    this.mixer = new THREE.AnimationMixer(gltf.scene);
    // Hold the first planted walk pose while still; the bind pose spreads the arms.
    gltf.animations.push(bindPoseIdle(gltf.scene, gltf.animations.find((clip) => clip.name.toLowerCase() === 'walk')));
    for (const clip of gltf.animations) {
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      this.actions.set(clip.name.toLowerCase(), action);
    }
    this.play('idle');
    this.update(0);
  }

  private play(name: string) {
    if (name === this.active) return;
    const next = this.actions.get(name);
    if (!next) return;
    const previous = this.actions.get(this.active);
    next.reset().play();
    if (previous) next.crossFadeFrom(previous, 0.22, true);
    this.active = name;
  }

  update(dt: number) {
    this.group.visible = this.walk.enabled && this.walk.thirdPerson && !this.walk.fly;
    if (!this.group.visible) return;
    this.group.position.copy(this.walk.body);
    this.group.rotation.y = this.walk.bodyYaw;
    const motion = this.walk.moving ? (this.walk.moveSpeed > this.walk.walkSpeed ? 'run' : 'walk') : 'idle';
    this.play(motion);
    const action = this.actions.get(this.active);
    if (action) action.timeScale = motion === 'run' ? 1.3 : motion === 'walk' ? 1.55 : 1;
    this.mixer?.update(dt);
  }
}
