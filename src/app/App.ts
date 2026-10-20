import * as THREE from 'three';
import { Config } from './Config';
import { TimeOfDay } from '../systems/TimeOfDay';

export interface Updatable { update(dt: number, t: number): void }

export class App {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  clock = new THREE.Timer();
  time: TimeOfDay;
  updatables: Updatable[] = [];
  frame = 0;
  elapsed = 0;
  fps = 0;
  private fpsAcc = 0; private fpsN = 0;
  paused = false;
  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: Config.qa, logarithmicDepthBuffer: false });
    const dpr = Config.quality === 'low' ? 1 : Math.min(window.devicePixelRatio, Config.qa ? 1 : 1.5);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = Config.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(Config.fov || 65, window.innerWidth / window.innerHeight, 0.15, 3000);
    this.camera.position.set(0, 1.7, 30);
    this.time = new TimeOfDay(this.scene, this.renderer, Config.quality === 'ultra' ? 4096 : 2048);
    window.addEventListener('resize', () => this.onResize());
  }
  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
  add(u: Updatable) { this.updatables.push(u); return u; }
  remove(u: Updatable) { const i = this.updatables.indexOf(u); if (i >= 0) this.updatables.splice(i, 1); }
  start() {

    const loop = () => {
      requestAnimationFrame(loop);
      this.clock.update(); const dt = Math.min(0.1, this.clock.getDelta());
      this.elapsed += dt;
      if (!this.paused) for (const u of this.updatables) u.update(dt, this.elapsed);
      { const f = this.camera.getWorldDirection(new THREE.Vector3()); f.y = 0; f.normalize(); this.time.update(this.camera.position, f, this.camera.position.y - 0); }
      this.renderer.render(this.scene, this.camera);
      this.frame++;
      this.fpsAcc += dt; this.fpsN++;
      if (this.fpsAcc >= 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
    };
    loop();
  }
  /** Render a single frame synchronously (used by QA harness). */
  renderOnce() { this.renderer.render(this.scene, this.camera); }
  stats() {
    const r = this.renderer.info;
    return { fps: Math.round(this.fps), calls: r.render.calls, triangles: r.render.triangles, geometries: r.memory.geometries, textures: r.memory.textures, programs: r.programs?.length ?? 0 };
  }
}
