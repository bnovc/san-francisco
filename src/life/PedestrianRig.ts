// Procedural, skinning-free pedestrian rig: every body part type is one InstancedMesh (per material slot), each
// pedestrian owns one instance index per part. Joint matrices are computed on the CPU each frame.
// Part origins are their joints: limbs hang along -Y, torso/head extend +Y, front = +Z.
import * as THREE from 'three';
import { Assets } from '../assets/Assets';
import type { Rng } from '../util/Rng';

export type ColorRole = 'skin' | 'hair' | 'hat' | 'top' | 'bottom' | 'shoe' | 'cuff' | 'bag' | 'umb' | number;
interface PartDef { rel: string; per: number; roles: ColorRole[]; mat: 'fabric' | 'skin' | 'gloss' }
const PARTS: Record<string, PartDef> = {
  pelvis: { rel: 'people/pelvis', per: 1, roles: ['bottom'], mat: 'fabric' },
  torso: { rel: 'people/torso', per: 1, roles: ['top', 'skin'], mat: 'fabric' },
  torso_coat: { rel: 'people/torso_coat', per: 1, roles: ['top', 'skin'], mat: 'fabric' },
  torso_dress: { rel: 'people/torso_dress', per: 1, roles: ['top', 'skin'], mat: 'fabric' },
  head: { rel: 'people/head', per: 1, roles: ['skin', 'hair', 0x211b18], mat: 'skin' },
  head_hat: { rel: 'people/head_hat', per: 1, roles: ['skin', 'hair', 'hat', 0x211b18], mat: 'skin' },
  head_longhair: { rel: 'people/head_longhair', per: 1, roles: ['skin', 'hair', 0x211b18], mat: 'skin' },
  upper_arm: { rel: 'people/upper_arm', per: 2, roles: ['top'], mat: 'fabric' },
  lower_arm: { rel: 'people/lower_arm', per: 2, roles: ['cuff', 'skin'], mat: 'skin' },
  upper_leg: { rel: 'people/upper_leg', per: 2, roles: ['bottom'], mat: 'fabric' },
  lower_leg: { rel: 'people/lower_leg', per: 2, roles: ['bottom', 'shoe'], mat: 'fabric' },
  backpack: { rel: 'people/backpack', per: 1, roles: ['bag'], mat: 'fabric' },
  handbag: { rel: 'people/handbag', per: 1, roles: ['bag'], mat: 'gloss' },
  phone: { rel: 'people/phone', per: 1, roles: [0x151515, 0x9fb8d0], mat: 'gloss' },
  camera: { rel: 'people/camera', per: 1, roles: [0x1a1a1a], mat: 'gloss' },
  umbrella: { rel: 'people/umbrella', per: 1, roles: [0x4a2e18, 0x333333, 'umb'], mat: 'fabric' },
  coffee_cup: { rel: 'people/coffee_cup', per: 1, roles: [0xf2efe8, 0x222222], mat: 'gloss' },
};
const TORSOS = ['torso', 'torso_coat', 'torso_dress'], HEADS = ['head', 'head_hat', 'head_longhair'];
const ACCESSORIES = ['backpack', 'handbag', 'phone', 'camera', 'umbrella', 'coffee_cup'];

// palettes (sRGB)
const SKIN = [0xf3d3b8, 0xefc4a2, 0xe0ac7e, 0xd29b70, 0xc68642, 0xa86e3c, 0x8d5524, 0x6b3f1e, 0x4e2f18];
const HAIR = [0x1b1310, 0x1b1310, 0x2c1b12, 0x4a2c17, 0x7a4b2a, 0xb08850, 0xd6b370, 0x8a8a8a, 0xc9c9c9, 0x7a2e1a];
const TOPS = [0xf4f4f4, 0xe6e2da, 0x1f2a44, 0x2b2b2b, 0x8b1e2d, 0x2d5a3c, 0x4a6fa5, 0xc9b79c, 0x3b3b52, 0xe8c85a, 0x556b2f, 0x9c2f2f, 0xb5cde3, 0x333333, 0x6a4c93, 0xd98c4a, 0x1d6f77];
const COATS = [0x1a1a1a, 0x24304a, 0x3d3d3d, 0x8b6a3e, 0x556b2f, 0x5a3a2a, 0x777777, 0x2f4f4f, 0xc8b89a, 0x6b1e2c];
const DRESSES = [0x1a1a1a, 0x6b1e3c, 0x2f4d8a, 0xd8b0c0, 0x334433, 0xb03030, 0xf2e8d8, 0x3a3a5a, 0xe0a040];
const BOTTOMS = [0x2b3a5c, 0x1c2540, 0x3a4a6a, 0x222222, 0x4a4a4a, 0x8a7a5a, 0xc8b89a, 0x2f2f3a, 0x6a6a72, 0x556b2f, 0x2b3a5c, 0x1c2540];
const SHOES = [0x111111, 0x2a1a0a, 0xf0f0f0, 0x555555, 0x7a2a1a, 0x1a2a4a];
const HATS = [0x222222, 0x8a2020, 0x2f4d8a, 0xc8b89a, 0x334433, 0xf0f0f0, 0x444444];
const BAGS = [0x111111, 0x3a2a1a, 0x2f4d8a, 0x7a2020, 0x556b2f, 0x777777, 0x1a1a1a];
const UMBS = [0xb02020, 0x202040, 0x111111, 0x2a7a3a, 0xf0e0a0];

export interface Appearance {
  torso: number; head: number;             // variant index
  accessory: number;                       // index in ACCESSORIES or -1
  scale: number; width: number;            // overall scale, width multiplier
  longSleeve: boolean; child: boolean;
  colors: Record<string, number>;
}
export const enum PoseMode { Walk = 0, Idle = 1, Sit = 2, Photo = 3 }
export interface Pose {
  x: number; y: number; z: number; yaw: number;
  mode: PoseMode;
  phase: number;                           // walk cycle (rad)
  amp: number;                             // 0..1 walk amplitude (speed blend)
  headYaw: number; headPitch: number;      // look direction relative to body
  t: number;                               // time (for idle sway)
  seed: number;                            // per-agent phase offset for sway
}

const LEG = 0.45, ARM_UP = 0.3, ARM_LO = 0.28, TORSO_H = 0.55;
const HIP_X = 0.09, HIP_DY = -0.05, SHOULDER_X = 0.235, SHOULDER_Y = 0.5;
const SWING_A = 0.42, KNEE_B = 0.7;

export class PedestrianRig {
  group = new THREE.Group();
  meshes = new Map<string, THREE.InstancedMesh[]>();  // part -> one InstancedMesh per material slot
  appearance: Appearance[] = [];
  private mats: Record<string, THREE.MeshStandardMaterial>;
  private hidden = new THREE.Matrix4().makeScale(1e-6, 1e-6, 1e-6);
  private dirtyColor = new Set<THREE.InstancedMesh>();
  // scratch
  private m = Array.from({ length: 24 }, () => new THREE.Matrix4());
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private c = new THREE.Color();
  private parts: string[] = [];

  constructor(public capacity: number) {
    this.group.name = 'pedestrians';
    this.mats = {
      fabric: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 }),
      skin: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0 }),
      gloss: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.05 }),
    };
  }

  async load() {
    const entries = Object.entries(PARTS).filter(([, d]) => Assets.has(d.rel));
    const protos = await Promise.all(entries.map(([, d]) => Assets.load(d.rel).catch(() => null)));
    entries.forEach(([name, def], k) => {
      const proto = protos[k]; if (!proto) return;
      proto.updateMatrixWorld(true);
      const list: THREE.InstancedMesh[] = [];
      proto.traverse((o) => {
        const src = o as THREE.Mesh; if (!src.isMesh) return;
        const geo = src.geometry.clone(); geo.applyMatrix4(src.matrixWorld);
        const im = new THREE.InstancedMesh(geo, this.mats[def.mat], this.capacity * def.per);
        im.name = `ped_${name}_${list.length}`; im.castShadow = true; im.receiveShadow = false; im.frustumCulled = false;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < im.count; i++) im.setMatrixAt(i, this.hidden);
        im.setColorAt(0, this.c.set(0xffffff)); // allocate instanceColor
        for (let i = 0; i < im.count; i++) im.setColorAt(i, this.c);
        list.push(im); this.group.add(im);
      });
      this.meshes.set(name, list); this.parts.push(name);
    });
  }

  /** Random appearance for slot i (deterministic with rng). */
  randomAppearance(rng: Rng, opts: { child?: boolean } = {}): Appearance {
    const child = opts.child ?? rng.chance(0.05);
    const torso = rng.next() < 0.55 ? 0 : rng.next() < 0.7 ? 1 : 2;
    const head = rng.next() < 0.6 ? 0 : rng.next() < 0.45 ? 1 : 2;
    let accessory = rng.next() < 0.45 ? -1 : child ? 0 : rng.pick([0, 0, 1, 1, 2, 2, 3, 5, 5]);
    if (!child && rng.chance(0.025)) accessory = 4; // the occasional sun umbrella
    const skin = rng.pick(SKIN);
    const colors: Record<string, number> = {
      skin, hair: rng.pick(HAIR), hat: rng.pick(HATS), shoe: rng.pick(SHOES), bag: rng.pick(BAGS), umb: rng.pick(UMBS),
      top: torso === 1 ? rng.pick(COATS) : torso === 2 ? rng.pick(DRESSES) : rng.pick(TOPS),
      bottom: torso === 2 ? (rng.chance(0.5) ? skin : rng.pick([0x111111, 0x2a2a3a, 0x5a4a4a])) : rng.pick(BOTTOMS),
    };
    const longSleeve = torso === 1 || rng.chance(0.5);
    colors.cuff = longSleeve ? colors.top : skin;
    return { torso, head, accessory, scale: child ? 0.6 : rng.range(0.9, 1.08), width: rng.range(0.93, 1.08), longSleeve, child, colors };
  }

  setAppearance(i: number, a: Appearance) {
    this.appearance[i] = a;
    for (const name of this.parts) {
      const def = PARTS[name], list = this.meshes.get(name)!;
      for (let s = 0; s < list.length; s++) {
        const role = def.roles[Math.min(s, def.roles.length - 1)];
        const hex = typeof role === 'number' ? role : a.colors[role] ?? 0xffffff;
        this.c.set(hex);
        for (let k = 0; k < def.per; k++) list[s].setColorAt(i * def.per + k, this.c);
        this.dirtyColor.add(list[s]);
      }
    }
  }

  hide(i: number) {
    for (const name of this.parts) { const def = PARTS[name]; for (const im of this.meshes.get(name)!) for (let k = 0; k < def.per; k++) im.setMatrixAt(i * def.per + k, this.hidden); }
  }

  private local(out: THREE.Matrix4, tx: number, ty: number, tz: number, rx: number, ry = 0, rz = 0) {
    this.e.set(rx, ry, rz); out.makeRotationFromEuler(this.e); out.setPosition(tx, ty, tz); return out;
  }
  private setPart(name: string, i: number, k: number, mat: THREE.Matrix4) {
    const list = this.meshes.get(name); if (!list) return;
    const idx = i * PARTS[name].per + k;
    for (const im of list) im.setMatrixAt(idx, mat);
  }
  private hidePart(name: string, i: number) {
    const list = this.meshes.get(name); if (!list) return;
    for (let k = 0; k < PARTS[name].per; k++) for (const im of list) im.setMatrixAt(i * PARTS[name].per + k, this.hidden);
  }

  /** Compute and write all joint matrices for pedestrian slot i. */
  pose(i: number, p: Pose) {
    const a = this.appearance[i]; if (!a) return;
    const m = this.m, L = this.local.bind(this);
    const root = m[0], tmp = m[1];
    // --- root: position, heading, scale ---
    this.e.set(0, p.yaw, 0); root.makeRotationFromEuler(this.e); root.setPosition(p.x, p.y, p.z);
    tmp.makeScale(a.width * a.scale, a.scale, a.scale); root.multiply(tmp);
    // --- gait parameters ---
    const sit = p.mode === PoseMode.Sit, photo = p.mode === PoseMode.Photo;
    const amp = sit ? 0 : p.amp, sp = Math.sin(p.phase), cp = Math.cos(p.phase);
    const sway = p.t * 0.9 + p.seed;
    let legL = SWING_A * amp * sp, legR = -legL;
    let kneeL = KNEE_B * amp * Math.max(0, cp) * Math.max(0, cp), kneeR = KNEE_B * amp * Math.max(0, -cp) * Math.max(0, -cp);
    let hipY = -HIP_DY + 2 * LEG * Math.cos(SWING_A * amp * Math.abs(sp));
    let torsoRx = 0.05 * amp + 0.015 * Math.sin(sway * 0.7), torsoRy = -0.06 * amp * sp + 0.02 * Math.sin(sway * 0.5), pelvisRy = 0.08 * amp * sp;
    let armL = -0.75 * legL - 0.04 + 0.03 * Math.sin(sway * 0.6), armR = -0.75 * legR - 0.04 + 0.03 * Math.sin(sway * 0.6 + 1.3);
    let elbowL = 0.25 + 0.25 * amp, elbowR = 0.25 + 0.25 * amp;
    let abd = 0.1;
    let headYaw = p.headYaw, headPitch = p.headPitch;
    let bob = 0;
    if (sit) {
      hipY = 0.44 - HIP_DY; legL = legR = Math.PI / 2; kneeL = kneeR = Math.PI / 2 - 0.05;
      torsoRx = -0.06 + 0.01 * Math.sin(sway * 0.5); torsoRy = 0.02 * Math.sin(sway * 0.4); pelvisRy = 0;
      armL = armR = 0.35; elbowL = elbowR = 0.95; abd = 0.12;
    } else if (amp < 0.02) {
      // idle: subtle weight shift
      bob = 0.01 * Math.sin(sway * 0.8);
      torsoRy += 0.03 * Math.sin(sway * 0.35);
    }
    const acc = a.accessory >= 0 ? ACCESSORIES[a.accessory] : '';
    // accessory arm overrides
    let holdL = false, holdR = false;
    if (photo) { armR = 1.45 + 0.02 * Math.sin(sway); elbowR = 0.75; holdR = true; headPitch = Math.min(headPitch, -0.25); }
    else if (acc === 'coffee_cup') { armL = 0.45; elbowL = 1.35; holdL = true; }
    else if (acc === 'umbrella') { armR = 0.85; elbowR = 1.1; holdR = true; }
    else if (acc === 'phone' && !sit && amp < 0.02) { armR = 0.55; elbowR = 1.5; holdR = true; headPitch += 0.35; }
    else if (acc === 'handbag') { armR *= 0.4; elbowR = 0.15; }
    if (sit && acc === 'phone') { armR = 0.5; elbowR = 1.35; holdR = true; headPitch += 0.4; }
    // --- pelvis & torso ---
    const pelvis = m[2].multiplyMatrices(root, L(tmp, 0, hipY + bob, 0, 0, pelvisRy));
    const torso = m[3].multiplyMatrices(root, L(tmp, 0, hipY + bob, 0, torsoRx, torsoRy));
    const head = m[4].multiplyMatrices(torso, L(tmp, 0, TORSO_H, 0, headPitch, headYaw));
    this.setPart('pelvis', i, 0, pelvis);
    for (let v = 0; v < TORSOS.length; v++) { if (v === a.torso) this.setPart(TORSOS[v], i, 0, torso); else this.hidePart(TORSOS[v], i); }
    for (let v = 0; v < HEADS.length; v++) { if (v === a.head) this.setPart(HEADS[v], i, 0, head); else this.hidePart(HEADS[v], i); }
    // --- legs ---
    const hipL = m[5].multiplyMatrices(pelvis, L(tmp, -HIP_X, HIP_DY, 0, -legL, 0, -0.02));
    const hipR = m[6].multiplyMatrices(pelvis, L(tmp, HIP_X, HIP_DY, 0, -legR, 0, 0.02));
    const kneeLm = m[7].multiplyMatrices(hipL, L(tmp, 0, -LEG, 0, kneeL));
    const kneeRm = m[8].multiplyMatrices(hipR, L(tmp, 0, -LEG, 0, kneeR));
    this.setPart('upper_leg', i, 0, hipL); this.setPart('upper_leg', i, 1, hipR);
    this.setPart('lower_leg', i, 0, kneeLm); this.setPart('lower_leg', i, 1, kneeRm);
    // --- arms ---
    const shL = m[9].multiplyMatrices(torso, L(tmp, -SHOULDER_X, SHOULDER_Y, 0, -armL, 0, -abd));
    const shR = m[10].multiplyMatrices(torso, L(tmp, SHOULDER_X, SHOULDER_Y, 0, -armR, 0, abd));
    const elL = m[11].multiplyMatrices(shL, L(tmp, 0, -ARM_UP, 0, -elbowL, 0, abd * 0.5));
    const elR = m[12].multiplyMatrices(shR, L(tmp, 0, -ARM_UP, 0, -elbowR, 0, -abd * 0.5));
    this.setPart('upper_arm', i, 0, shL); this.setPart('upper_arm', i, 1, shR);
    this.setPart('lower_arm', i, 0, elL); this.setPart('lower_arm', i, 1, elR);
    // --- accessories ---
    for (const name of ACCESSORIES) if (name !== acc && !(photo && (name === 'phone' || name === 'camera'))) this.hidePart(name, i);
    if (photo) {
      const dev = acc === 'camera' ? 'camera' : 'phone';
      this.setPart(dev, i, 0, m[13].multiplyMatrices(elR, L(tmp, 0, -ARM_LO + 0.02, 0.03, armR + elbowR - 0.35)));
      if (dev === 'phone') this.hidePart('camera', i); else this.hidePart('phone', i);
    } else if (acc === 'backpack') this.setPart('backpack', i, 0, m[13].multiplyMatrices(torso, L(tmp, 0, 0.52, 0.01, 0)));
    else if (acc === 'handbag') { L(tmp, 0.03, -ARM_LO + 0.02, 0, armR + elbowR); tmp.multiply(m[14].makeRotationY(Math.PI / 2)); this.setPart('handbag', i, 0, m[13].multiplyMatrices(elR, tmp)); }
    else if (acc === 'coffee_cup' && holdL) this.setPart('coffee_cup', i, 0, m[13].multiplyMatrices(elL, L(tmp, 0, -ARM_LO + 0.03, 0.035, armL + elbowL)));
    else if (acc === 'umbrella' && holdR) this.setPart('umbrella', i, 0, m[13].multiplyMatrices(elR, L(tmp, 0, -ARM_LO + 0.03, 0.02, armR + elbowR)));
    else if (acc === 'phone' && holdR) this.setPart('phone', i, 0, m[13].multiplyMatrices(elR, L(tmp, 0, -ARM_LO + 0.02, 0.04, armR + elbowR - 0.9)));
    else if (acc === 'phone' || acc === 'camera') this.hidePart(acc, i);
  }

  /** Flag instance buffers for upload. */
  commit() {
    for (const list of this.meshes.values()) for (const im of list) im.instanceMatrix.needsUpdate = true;
    for (const im of this.dirtyColor) if (im.instanceColor) im.instanceColor.needsUpdate = true;
    this.dirtyColor.clear();
  }
  get drawCalls() { let n = 0; for (const l of this.meshes.values()) n += l.length; return n; }
}
