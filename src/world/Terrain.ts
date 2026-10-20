// Heightfield from USGS elevation samples (src/data/recon/elevation.json), IDW-gridded at 8 m, bilinear sampling.
import * as THREE from 'three';
import { geoToLocal, ORIGIN_ELEVATION_M } from '../geo/geo';
import { Materials } from '../materials/Library';

export interface ElevSample { lat: number; lon: number; elev_m: number }

export class Terrain {
  minX = -420; maxX = 420; minZ = -420; maxZ = 420;
  res = 8;
  nx = 0; nz = 0;
  h!: Float32Array;
  mesh!: THREE.Mesh;
  constructor(samples: ElevSample[]) {
    this.nx = Math.round((this.maxX - this.minX) / this.res) + 1;
    this.nz = Math.round((this.maxZ - this.minZ) / this.res) + 1;
    this.h = new Float32Array(this.nx * this.nz);
    const pts = samples.map((s) => { const l = geoToLocal(s.lat, s.lon); return { x: l.x, z: l.z, y: s.elev_m - ORIGIN_ELEVATION_M }; });
    // bucket samples to accelerate IDW
    const B = 32; const buckets = new Map<string, typeof pts>();
    for (const p of pts) { const k = `${Math.floor(p.x / B)},${Math.floor(p.z / B)}`; let a = buckets.get(k); if (!a) buckets.set(k, (a = [])); a.push(p); }
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const x = this.minX + i * this.res, z = this.minZ + j * this.res;
      const bx = Math.floor(x / B), bz = Math.floor(z / B);
      let num = 0, den = 0, radius = 1;
      for (let r = 1; r <= 3 && den === 0; r++) {
        for (let ox = -r; ox <= r; ox++) for (let oz = -r; oz <= r; oz++) {
          const a = buckets.get(`${bx + ox},${bz + oz}`); if (!a) continue;
          for (const p of a) { const d2 = (p.x - x) ** 2 + (p.z - z) ** 2; if (d2 > (B * r) ** 2 * 1.2) continue; const w = 1 / (d2 + 4); num += w * p.y; den += w; }
        }
        radius = r;
      }
      this.h[j * this.nx + i] = den > 0 ? num / den : 0;
      void radius;
    }
    // light smoothing pass (3x3) to remove sampling noise
    const s = new Float32Array(this.h.length);
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      let sum = 0, n = 0;
      for (let oj = -1; oj <= 1; oj++) for (let oi = -1; oi <= 1; oi++) { const ii = i + oi, jj = j + oj; if (ii < 0 || jj < 0 || ii >= this.nx || jj >= this.nz) continue; sum += this.h[jj * this.nx + ii]; n++; }
      s[j * this.nx + i] = sum / n;
    }
    this.h = s;
    this.buildMesh();
  }
  heightAt(x: number, z: number): number {
    const fx = (x - this.minX) / this.res, fz = (z - this.minZ) / this.res;
    const i = Math.max(0, Math.min(this.nx - 2, Math.floor(fx))), j = Math.max(0, Math.min(this.nz - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - i)), tz = Math.max(0, Math.min(1, fz - j));
    const h00 = this.h[j * this.nx + i], h10 = this.h[j * this.nx + i + 1], h01 = this.h[(j + 1) * this.nx + i], h11 = this.h[(j + 1) * this.nx + i + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }
  private buildMesh() {
    const geo = new THREE.PlaneGeometry(this.maxX - this.minX, this.maxZ - this.minZ, this.nx - 1, this.nz - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k) + (this.minX + this.maxX) / 2, z = pos.getZ(k) + (this.minZ + this.maxZ) / 2;
      pos.setXYZ(k, x, this.heightAt(x, z) - 0.02, z);
      uv.setXY(k, x, z);
    }
    geo.computeVertexNormals();
    this.mesh = new THREE.Mesh(geo, Materials.get('concrete'));
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';
  }
}
