import * as THREE from 'three';
import { P2, ensureCCW } from './Geometry2D';

/** Box with metre-scaled UVs (so tiled textures keep real-world scale). cx,cy,cz = centre. */
export function box(w: number, h: number, d: number, cx: number, cy: number, cz: number, mat: THREE.Material, rotY = 0): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d);
  // metre UVs per face
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const faces: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * faces[f][0], uv.getY(k) * faces[f][1]); }
  const m = new THREE.Mesh(g, mat); m.position.set(cx, cy, cz); m.rotation.y = rotY; m.castShadow = true; m.receiveShadow = true; return m;
}
/** Horizontal polygon slab at height y (top face) with metre UVs; thickness t extrudes downward. */
export function slab(poly: P2[], y: number, t: number, mat: THREE.Material): THREE.Mesh {
  const pts = ensureCCW(poly);
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = t > 0 ? new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false }) : new THREE.ShapeGeometry(shape);
  // ExtrudeGeometry extrudes along +z in shape space; map shape (x, z) -> world (x, y, z): rotate so shape y -> world z and extrusion -> world -y
  g.rotateX(Math.PI / 2);
  g.translate(0, y, 0);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute, p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i), p.getZ(i));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.castShadow = t > 0; m.receiveShadow = true; return m;
}
/** Vertical wall quad from (ax,az) to (bx,bz), y0..y1, metre UVs, facing the left side of a->b (normal = (dz, -dx)). */
export function wallQuad(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, mat: THREE.Material, flip = false): THREE.Mesh {
  const len = Math.hypot(bx - ax, bz - az);
  const g = new THREE.PlaneGeometry(len, y1 - y0);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len, uv.getY(i) * (y1 - y0));
  const m = new THREE.Mesh(g, mat);
  m.position.set((ax + bx) / 2, (y0 + y1) / 2, (az + bz) / 2);
  m.rotation.y = Math.atan2(-(bz - az), bx - ax) + (flip ? Math.PI : 0);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
/** Skirt walls around a polygon from top y down to bottom(x,z) — hides gaps between raised slabs and terrain. */
export function skirt(poly: P2[], yTop: number, bottom: (x: number, z: number) => number, mat: THREE.Material, extra = 0.5): THREE.Group {
  const g = new THREE.Group();
  const pts = ensureCCW(poly);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const yb = Math.min(bottom(a[0], a[1]), bottom(b[0], b[1])) - extra;
    if (yTop - yb < 0.05) continue;
    // CCW in (x,z) with y up means outward is to the right of a->b; wallQuad faces left, so flip
    g.add(wallQuad(a[0], a[1], b[0], b[1], yb, yTop, mat, true));
  }
  return g;
}
export function rect(x0: number, x1: number, z0: number, z1: number): P2[] { return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]; }
