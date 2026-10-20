// World-space road-marking overlay: lane lines, centre lines, parking lines, crosswalks, stop bars, red transit lanes and the
// brick promenade are painted ONCE into a top-down canvas covering the core, then blended onto the asphalt in the shader
// (sampled by world x/z). No extra geometry → no z-fighting, no sinking on slopes.
import * as THREE from 'three';
import type { StreetSpec, Intersection } from './StreetGrid';

export const MARK_EXTENT = 300;           // covers x,z in [-300, 300]
const SIZE = 4096;                        // 4096 px over 600 m → 14.6 cm/px (≈ 90 MB with mips)
const PX = SIZE / (2 * MARK_EXTENT);

export function buildMarkingsTexture(streets: StreetSpec[], crossings: Intersection[]): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = SIZE;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, SIZE, SIZE);
  const X = (x: number) => (x + MARK_EXTENT) * PX, Z = (z: number) => (z + MARK_EXTENT) * PX;
  const rect = (x0: number, z0: number, x1: number, z1: number, style: string) => { ctx.fillStyle = style; ctx.fillRect(X(Math.min(x0, x1)), Z(Math.min(z0, z1)), Math.abs(x1 - x0) * PX, Math.abs(z1 - z0) * PX); };
  const along = (s: StreetSpec, a: number, b: number, c0: number, c1: number, style: string) => (s.axis === 'ns' ? rect(c0, a, c1, b, style) : rect(a, c0, b, c1, style));
  const WHITE = 'rgba(232,232,222,0.92)', YELLOW = 'rgba(232,192,42,0.95)', RED = 'rgba(150,44,38,0.85)', BRICK = 'rgba(92,72,66,0.72)';
  // per-street: segments between intersections (same trimming rule as Streets.ts)
  for (const s of streets) {
    if (s.pedestrian) continue;
    const hw = s.width / 2;
    const xs = crossings.filter((cr) => (cr.a.name === s.name && Math.abs(cr.a.c - s.c) < 0.5) || (cr.b.name === s.name && Math.abs(cr.b.c - s.c) < 0.5))
      .map((cr) => ({ t: s.axis === 'ns' ? cr.z : cr.x, other: cr.a.name === s.name ? cr.b : cr.a })).filter((p) => p.t > Math.min(s.from, s.to) - 1 && p.t < Math.max(s.from, s.to) + 1).sort((p, q) => p.t - q.t);
    let cur = Math.min(s.from, s.to); const hi = Math.max(s.from, s.to);
    const segs: [number, number][] = [];
    for (const x of xs) { const b = x.t - x.other.width / 2; if (b > cur + 0.5) segs.push([cur, b]); cur = x.t + x.other.width / 2; }
    if (hi > cur + 0.5) segs.push([cur, hi]);
    for (const [a, b] of segs) {
      if (s.surface === 'brick') along(s, a, b, s.c - hw, s.c + hw, BRICK);
      const park = (s.parking.left ? 1 : 0) + (s.parking.right ? 1 : 0);
      const drive = s.width - park * 2.4, laneW = drive / Math.max(1, s.lanes);
      const leftEdge = s.c - hw + (s.parking.left ? 2.4 : 0);
      // transit lanes
      if (s.transitLane === 'max') { const c0 = s.c + hw - (s.parking.right ? 2.4 : 0) - laneW; along(s, a + 0.5, b - 0.5, c0 + 0.1, c0 + laneW - 0.1, RED); }
      else if (s.transitLane === 'min') along(s, a + 0.5, b - 0.5, leftEdge + 0.1, leftEdge + laneW - 0.1, RED);
      else if (s.transitLane === 'center') { const lw = Math.min(laneW, 3.3); along(s, a + 0.5, b - 0.5, s.c - lw + 0.1, s.c - 0.1, RED); along(s, a + 0.5, b - 0.5, s.c + 0.1, s.c + lw - 0.1, RED); }
      // lane lines
      for (let l = 1; l < s.lanes; l++) {
        const cc = leftEdge + l * laneW;
        const isCentre = s.oneway === null && l === Math.floor(s.lanes / 2) && s.lanes % 2 === 0;
        if (isCentre && s.centerLine !== 'none') { for (const off of [-0.12, 0.12]) along(s, a + 1, b - 1, cc + off - 0.09, cc + off + 0.09, YELLOW); }
        else if (!s.cableCar || Math.abs(cc - s.c) > 3.0) { for (let d = a + 1; d < b - 3; d += 6) along(s, d, d + 3, cc - 0.09, cc + 0.09, WHITE); }
      }
      if (s.parking.left) along(s, a + 1, b - 1, leftEdge - 0.09, leftEdge + 0.09, WHITE);
      if (s.parking.right) { const cc = s.c + hw - 2.4; along(s, a + 1, b - 1, cc - 0.09, cc + 0.09, WHITE); }
    }
  }
  // intersections: continental crosswalks + stop bars
  const done = new Set<string>();
  for (const cr of crossings) {
    const key = `${Math.round(cr.x)},${Math.round(cr.z)}`; if (done.has(key)) continue; done.add(key);
    const a = cr.a, b = cr.b; if (a.pedestrian || b.pedestrian) continue;
    const hwA = a.width / 2, hwB = b.width / 2, barW = 0.6, gap = 0.6, cw = 3.0;
    for (const sz of [-1, 1]) {
      const zc = cr.z + sz * (hwB + cw / 2);
      for (let x = cr.x - hwA + 0.6; x < cr.x + hwA - 0.3; x += barW + gap) rect(x, zc - cw / 2, x + barW, zc + cw / 2, WHITE);
      const stopZ = cr.z + sz * (hwB + cw + 0.6);
      const half = a.oneway ? [cr.x - hwA + 0.3, cr.x + hwA - 0.3] : sz < 0 ? [cr.x, cr.x + hwA - 0.3] : [cr.x - hwA + 0.3, cr.x];
      rect(half[0], stopZ - 0.25, half[1], stopZ + 0.25, WHITE);
    }
    for (const sx of [-1, 1]) {
      const xc = cr.x + sx * (hwA + cw / 2);
      for (let z = cr.z - hwB + 0.6; z < cr.z + hwB - 0.3; z += barW + gap) rect(xc - cw / 2, z, xc + cw / 2, z + barW, WHITE);
      const stopX = cr.x + sx * (hwA + cw + 0.6);
      const half = b.oneway ? [cr.z - hwB + 0.3, cr.z + hwB - 0.3] : sx < 0 ? [cr.z - hwB + 0.3, cr.z] : [cr.z, cr.z + hwB - 0.3];
      rect(stopX - 0.25, half[0], stopX + 0.25, half[1], WHITE);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = false;   // canvas row 0 = z = -EXTENT (north); sampled directly by world z
  tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** Patch a MeshStandardMaterial so the markings overlay (alpha-blended) is applied by world x/z. */
export function applyMarkingsOverlay(mat: THREE.MeshStandardMaterial, tex: THREE.Texture) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMarks = { value: tex };
    shader.uniforms.uMarkExtent = { value: MARK_EXTENT };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n{ vec4 wp = modelMatrix * vec4(transformed, 1.0); vWorldXZ = wp.xz; }');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uMarks; uniform float uMarkExtent; varying vec2 vWorldXZ;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n{ vec2 muv = (vWorldXZ + vec2(uMarkExtent)) / (2.0 * uMarkExtent); vec4 mk = texture2D(uMarks, muv); diffuseColor.rgb = mix(diffuseColor.rgb, mk.rgb, mk.a * step(0.0, muv.x) * step(muv.x, 1.0) * step(0.0, muv.y) * step(muv.y, 1.0)); }');
  };
  mat.needsUpdate = true;
}
