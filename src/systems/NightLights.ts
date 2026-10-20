// Dynamic street lighting: a small pool of point lights on the nearest lamp posts + cheap additive light-pool decals under every lamp.
import * as THREE from 'three';
import type { Updatable } from '../app/App';
import type { App } from '../app/App';
import { genTexture } from '../materials/Textures';

export class NightLights implements Updatable {
  lights: THREE.PointLight[] = [];
  positions: [number, number, number][] = [];
  pools: THREE.InstancedMesh | null = null;
  private poolMat: THREE.MeshBasicMaterial;
  private t = 0;
  constructor(public app: App, count = 8) {
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffd6a0, 0, 26, 2);
      l.castShadow = false; l.visible = false; app.scene.add(l); this.lights.push(l);
    }
    const tex = genTexture('lightpool', 256, (ctx, s) => { const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); g.addColorStop(0, 'rgba(255,214,160,0.55)'); g.addColorStop(0.5, 'rgba(255,200,140,0.18)'); g.addColorStop(1, 'rgba(255,190,120,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, s, s); });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    this.poolMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
  }
  setPositions(p: [number, number, number][], groundAt: (x: number, z: number) => number) {
    this.positions = p;
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    this.pools = new THREE.InstancedMesh(geo, this.poolMat, p.length);
    const d = new THREE.Object3D();
    p.forEach((q, i) => { const r = q[1] - groundAt(q[0], q[2]) > 6 ? 16 : 11; d.position.set(q[0], groundAt(q[0], q[2]) + 0.03, q[2]); d.scale.set(r, 1, r); d.updateMatrix(); this.pools!.setMatrixAt(i, d.matrix); });
    this.pools.renderOrder = 5; this.pools.frustumCulled = false; this.app.scene.add(this.pools);
  }
  update(dt: number) {
    const nf = this.app.time.nightFactor;
    this.poolMat.opacity = nf;
    if (this.pools) this.pools.visible = nf > 0.05;
    if (nf <= 0.05) { for (const l of this.lights) l.visible = false; return; }
    this.t += dt; if (this.t < 0.4 && this.lights[0].visible) return; this.t = 0;
    const c = this.app.camera.position;
    const near = this.positions.map((p) => ({ p, d: (p[0] - c.x) ** 2 + (p[2] - c.z) ** 2 })).sort((a, b) => a.d - b.d).slice(0, this.lights.length);
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i], n = near[i];
      if (!n) { l.visible = false; continue; }
      l.position.set(n.p[0], n.p[1], n.p[2]); l.intensity = 95 * nf; l.visible = true;
    }
  }
}
