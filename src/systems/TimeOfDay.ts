import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Materials } from '../materials/Library';
import { Config, TimePreset } from '../app/Config';

interface Preset { elevation: number; azimuth: number; sunColor: number; sunIntensity: number; hemiSky: number; hemiGround: number; hemiIntensity: number; exposure: number; night: number; fog: number; fogDensity: number; turbidity: number; rayleigh: number; mie: number; background?: number }

const PRESETS: Record<TimePreset, Preset> = {
  day:    { elevation: 56, azimuth: 205, sunColor: 0xfff3e0, sunIntensity: 1.9, hemiSky: 0x9ec0f0, hemiGround: 0x5e574f, hemiIntensity: 0.5, exposure: 0.6, night: 0, fog: 0xb9cbe0, fogDensity: 0.0007, turbidity: 1.8, rayleigh: 3.0, mie: 0.003 },
  sunset: { elevation: 6, azimuth: 262, sunColor: 0xffb070, sunIntensity: 2.2, hemiSky: 0x9aa8d0, hemiGround: 0x5a4a3a, hemiIntensity: 0.55, exposure: 0.8, night: 0.45, fog: 0xe0b090, fogDensity: 0.0012, turbidity: 6, rayleigh: 2.5, mie: 0.02 },
  night:  { elevation: -5, azimuth: 300, sunColor: 0x8090c0, sunIntensity: 0.0, hemiSky: 0x7f8fb8, hemiGround: 0x5a4a38, hemiIntensity: 0.9, exposure: 1.3, night: 1, fog: 0x0e1424, fogDensity: 0.0012, turbidity: 4, rayleigh: 0.8, mie: 0.01, background: 0x070a12 },
};

export class TimeOfDay {
  sun = new THREE.DirectionalLight(0xffffff, 3);
  moon = new THREE.DirectionalLight(0x8090c0, 0);
  hemi = new THREE.HemisphereLight(0xbcd7ff, 0x6b6258, 0.9);
  sky = new Sky();
  preset: TimePreset = 'day';
  nightFactor = 0;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private shadowSize: number;
  private sunDirection = new THREE.Vector3(0, 1, 0);
  nightDome: THREE.Mesh;
  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer, shadowSize = 4096) {
    this.shadowSize = shadowSize;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.sky.scale.setScalar(6000);
    scene.add(this.sky);
    scene.add(this.hemi);
    scene.add(this.sun); scene.add(this.sun.target);
    scene.add(this.moon); scene.add(this.moon.target);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(shadowSize, shadowSize);
    s.camera.near = 1; s.camera.far = 600;
    s.bias = -0.0004; s.normalBias = 0.05; s.radius = 1.5;
    this.setShadowExtent(110);
    scene.fog = new THREE.FogExp2(0xcfdcea, 0.0009);
    // night dome: dark navy zenith to warm city glow at the horizon
    const domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x05070f) }, horizon: { value: new THREE.Color(0x3a3a48) }, glow: { value: new THREE.Color(0x6a4a30) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; uniform vec3 glow; varying vec3 vP; void main(){ float h = clamp(vP.y, -0.05, 1.0); vec3 c = mix(horizon, top, pow(h, 0.45)); c += glow * exp(-h * 14.0) * 0.9; gl_FragColor = vec4(c, 1.0); }',
    });
    this.nightDome = new THREE.Mesh(new THREE.SphereGeometry(2500, 32, 16), domeMat); this.nightDome.visible = false; this.nightDome.renderOrder = -10; scene.add(this.nightDome);
  }
  setShadowExtent(e: number) {
    const c = this.sun.shadow.camera; c.left = -e; c.right = e; c.top = e; c.bottom = -e; c.updateProjectionMatrix();
  }
  set(preset: TimePreset) {
    this.preset = preset;
    const p = PRESETS[preset];
    const phi = THREE.MathUtils.degToRad(90 - p.elevation);
    const theta = THREE.MathUtils.degToRad(p.azimuth);
    // three's Sky: azimuth measured so that 180 = sun in -z? We convert compass azimuth to local frame:
    // compass azimuth A (cw from true north). Local grid-north bearing is -9.314 deg, so local angle = A + 9.314 (cw from -z).
    const a = THREE.MathUtils.degToRad(p.azimuth + 9.314);
    const el = THREE.MathUtils.degToRad(p.elevation);
    const dir = new THREE.Vector3(Math.sin(a) * Math.cos(el), Math.sin(el), -Math.cos(a) * Math.cos(el));
    this.sunDirection.copy(dir);
    const u = this.sky.material.uniforms;
    u.turbidity.value = p.turbidity; u.rayleigh.value = p.rayleigh; u.mieCoefficient.value = p.mie; u.mieDirectionalG.value = 0.8;
    u.sunPosition.value.copy(dir);
    void phi; void theta;
    this.sun.color.setHex(p.sunColor); this.sun.intensity = Config.sun || p.sunIntensity;
    this.sun.position.copy(dir).multiplyScalar(300);
    this.sun.visible = p.elevation > 0;
    this.sun.castShadow = p.elevation > 0;
    // moon at night
    const mdir = new THREE.Vector3(-0.4, 0.6, 0.5).normalize();
    this.moon.position.copy(mdir).multiplyScalar(300);
    this.moon.intensity = preset === 'night' ? 0.45 : 0;
    this.hemi.color.setHex(p.hemiSky); this.hemi.groundColor.setHex(p.hemiGround); this.hemi.intensity = p.hemiIntensity;
    this.renderer.toneMappingExposure = Config.exposure || p.exposure;
    (this.scene.fog as THREE.FogExp2).color.setHex(p.fog); (this.scene.fog as THREE.FogExp2).density = p.fogDensity;
    this.nightFactor = p.night;
    Materials.setNight(p.night);
    this.rebuildEnv();
    this.scene.background = null;
    this.nightDome.visible = preset === 'night'; this.sky.visible = preset !== 'night';
    document.dispatchEvent(new CustomEvent('twin:time', { detail: { preset, night: p.night } }));
  }
  private rebuildEnv() {
    if (this.envRT) this.envRT.dispose();
    const tmp = new THREE.Scene();
    const isNight = (this.preset as string) === 'night';
    if (isNight) {   // city glow: a uniform dim warm-blue environment instead of the black night sky
      tmp.background = new THREE.Color(0x3a3f55);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(5000, 16, 8), new THREE.MeshBasicMaterial({ color: 0x404866, side: THREE.BackSide })); tmp.add(glow);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshBasicMaterial({ color: 0x2a2520 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -5; tmp.add(ground);
      this.envRT = this.pmrem.fromScene(tmp, 0.04);
      this.scene.environment = this.envRT.texture; this.scene.environmentIntensity = Config.env || 0.9; Materials.setEnvMap(this.envRT.texture);
      return;
    }
    const skyClone = new Sky();
    skyClone.scale.setScalar(6000);
    const u = skyClone.material.uniforms, s = this.sky.material.uniforms;
    u.turbidity.value = s.turbidity.value; u.rayleigh.value = s.rayleigh.value; u.mieCoefficient.value = s.mieCoefficient.value; u.mieDirectionalG.value = s.mieDirectionalG.value; u.sunPosition.value.copy(s.sunPosition.value);
    tmp.add(skyClone);
    // ground plane to darken the lower hemisphere of the env map
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshBasicMaterial({ color: isNight ? 0x05060a : 0x6d6a66 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -5; tmp.add(ground);
    this.envRT = this.pmrem.fromScene(tmp, 0.04);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = Config.env || (isNight ? 0.6 : 0.5);
    Materials.setEnvMap(this.envRT.texture);
  }
  /** Keep the shadow frustum centred on the viewer. */
  update(center: THREE.Vector3, forward?: THREE.Vector3, height = 0) {
    // The shadow rig moves with the viewer. Its absolute world position must
    // never become the next frame's direction (which tilts the sun toward the
    // horizon as soon as the viewer is far from the Union Square origin).
    const dir = this.sunDirection;
    // widen the box when the viewer is high (aerials) and push it toward the view direction
    const extent = Math.min(320, 110 + Math.max(0, height) * 1.2);
    if (Math.abs(this.sun.shadow.camera.right - extent) > 5) this.setShadowExtent(extent);
    const texel = (2 * (this.sun.shadow.camera.right)) / this.shadowSize;
    const c = center.clone(); if (forward) c.addScaledVector(forward, Math.min(extent * 0.5, 40 + height * 0.8));
    c.x = Math.round(c.x / texel) * texel; c.z = Math.round(c.z / texel) * texel; c.y = Math.round(c.y / texel) * texel;
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(dir, 300);
    this.sun.target.updateMatrixWorld();
  }
}
