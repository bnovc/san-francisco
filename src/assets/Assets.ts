// GLB asset loading with material remapping and instancing helpers.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Materials } from '../materials/Library';

export interface ManifestEntry { file: string; tris: number; bbox_threejs?: { min: number[]; max: number[] }; sizeBytes: number; [k: string]: any }

const loader = new GLTFLoader();
const protos = new Map<string, Promise<THREE.Group>>();
export const BASE = (import.meta as any).env?.BASE_URL || '/';

export class InstancedModel {
  meshes: THREE.InstancedMesh[] = [];
  group = new THREE.Group();
  count = 0;
  private _dummy = new THREE.Object3D();
  constructor(proto: THREE.Object3D, public capacity: number, opts: { castShadow?: boolean; receiveShadow?: boolean } = {}) {
    proto.updateMatrixWorld(true);
    proto.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const geo = m.geometry.clone();
      geo.applyMatrix4(m.matrixWorld);
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.length === 1) {
        const im = new THREE.InstancedMesh(geo, mats[0], capacity);
        im.castShadow = opts.castShadow ?? true; im.receiveShadow = opts.receiveShadow ?? true;
        im.frustumCulled = true; im.count = 0; im.name = m.name;
        this.meshes.push(im); this.group.add(im);
      } else {
        // split by group
        for (const g of geo.groups) {
          const sub = new THREE.BufferGeometry();
          sub.setAttribute('position', geo.getAttribute('position'));
          if (geo.getAttribute('normal')) sub.setAttribute('normal', geo.getAttribute('normal'));
          if (geo.getAttribute('uv')) sub.setAttribute('uv', geo.getAttribute('uv'));
          const idx = geo.getIndex()!;
          const arr = idx.array.slice(g.start, g.start + g.count);
          sub.setIndex(new THREE.BufferAttribute(arr as any, 1));
          const im = new THREE.InstancedMesh(sub, mats[g.materialIndex ?? 0], capacity);
          im.castShadow = opts.castShadow ?? true; im.receiveShadow = opts.receiveShadow ?? true; im.count = 0; im.name = m.name;
          this.meshes.push(im); this.group.add(im);
        }
      }
    });
  }
  add(position: THREE.Vector3 | [number, number, number], rotationY = 0, scale: number | [number, number, number] = 1): number {
    const i = this.count++;
    if (i >= this.capacity) { this.count = this.capacity; if (!(this as any)._warned) { (this as any)._warned = true; console.warn('InstancedModel capacity exceeded', this.group.name || this.meshes[0]?.name); } return -1; }
    const d = this._dummy;
    if (Array.isArray(position)) d.position.set(position[0], position[1], position[2]); else d.position.copy(position);
    d.rotation.set(0, rotationY, 0);
    if (Array.isArray(scale)) d.scale.set(scale[0], scale[1], scale[2]); else d.scale.setScalar(scale);
    d.updateMatrix();
    for (const m of this.meshes) { m.setMatrixAt(i, d.matrix); m.count = this.count; }
    return i;
  }
  setMatrixAt(i: number, m: THREE.Matrix4) { for (const im of this.meshes) im.setMatrixAt(i, m); }
  setColorAt(i: number, c: THREE.Color, meshNameFilter?: string) { for (const im of this.meshes) if (!meshNameFilter || im.name === meshNameFilter) im.setColorAt(i, c); }
  finalize() { for (const m of this.meshes) { m.count = this.count; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); } }
  markDirty() { for (const m of this.meshes) { m.instanceMatrix.needsUpdate = true; } }
}

export const Assets = {
  manifest: {} as Record<string, ManifestEntry>,
  async loadManifests(categories: string[]) {
    await Promise.all(categories.map(async (c) => {
      try {
        const r = await fetch(`${BASE}assets/models/manifest_${c}.json`);
        if (r.ok) Object.assign(this.manifest, await r.json());
      } catch (e) { console.warn('manifest missing', c); }
    }));
  },
  /** Load (once) a GLB prototype by relative name, e.g. "street/streetlight_sf_teardrop". */
  load(rel: string): Promise<THREE.Group> {
    let p = protos.get(rel);
    if (!p) {
      p = new Promise((resolve, reject) => {
        loader.load(`${BASE}assets/models/${rel}.glb`, (gltf) => {
          const g = gltf.scene;
          Materials.remap(g);
          g.name = rel;
          resolve(g);
        }, undefined, (err) => { console.warn('GLB load failed', rel, err); reject(err); });
      });
      protos.set(rel, p);
    }
    return p;
  },
  async instance(rel: string): Promise<THREE.Group> {
    const proto = await this.load(rel);
    const c = proto.clone(true);
    c.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    return c;
  },
  async instanced(rel: string, capacity: number, opts?: { castShadow?: boolean; receiveShadow?: boolean }): Promise<InstancedModel> {
    const proto = await this.load(rel);
    return new InstancedModel(proto, capacity, opts);
  },
  has(rel: string) { return !!this.manifest[rel]; },
};
