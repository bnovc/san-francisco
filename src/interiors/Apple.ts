// Apple Union Square (300 Post St) — Foster + Partners glass pavilion (2016), rear plaza with the Ruth Asawa fountain and
// green wall, and an explorable two-level interior (product hall, Avenue, glass stairs, Genius Grove, Forum video wall).
// LEVEL 3 hero module. Geometry from OSM way 332223480 (+ west wing 779012330) and src/data/recon/apple.json.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { HeroModule, HeroContext } from '../world/HeroContext';
import { Materials } from '../materials/Library';
import { makeLogoSign, signMesh } from '../materials/Signage';
import { Assets, InstancedModel } from '../assets/Assets';
import { box, slab, rect } from '../util/MeshUtil';
import type { P2 } from '../util/Geometry2D';

// ---- site geometry (local metres; x east, z south, y up) ------------------------------------------------------------
const X0 = 27.28, X1 = 61.3;                 // pavilion west / east faces (OSM)
const Z0 = -63.1, Z1 = -88.4;                // Post St face / plaza (north) face (OSM)
const WT = 0.35;                             // wall thickness
const GX0 = 31.4, GX1 = 55.2;                // glazed bay on the Post face (OSM kinks = pier lines; 23.8 m)
const DX0 = 37.35, DX1 = 49.25, DXM = 43.3;  // two sliding leaves 5.95 m each, 12.8 m tall
const NGX0 = 33.3, NGX1 = 51.4;              // north (plaza) glazing at mezzanine level (OSM entrance nodes)
const ZE = -78.4;                            // mezzanine edge (9.75 m cantilever from the rear wall)
const WING_X0 = 20.7, WING_Z1 = -116.8;      // west service wing (OSM way 779012330)
const HYATT_Z = -105.7;                      // Grand Hyatt south flank = plaza north edge
const H_MEZZ = 4.9, H_CEIL = 12.8, H_HEAD = 13.6, H_ROOF = 14.2, H_WING = 13.5, H_WING_REAR = 17.0;
const PX0 = 27.3, PX1 = 57.8;                // plaza main slab x-extent (green wall .. head of the Stockton stair)
const TZ = -91.6;                            // terrace edge (door-level terrace 3.2 m deep)
const SX0 = 57.8, SX1 = 62.6, SZ0 = -91.6, SZ1 = -100.6; // plaza -> Stockton stair (9 m wide)
const FOUNTAIN: P2 = [58.6, -96.1];
const GLASS_T = 0.03;

interface Levels { y0: number; y1: number; yc: number; yP: number; ySW: number }
interface Door { group: THREE.Group; x: number; dir: number; open: number; cur: number; cx: number; cy: number; cz: number }
interface Anim { obj: THREE.Object3D; t: number; y: number }
interface State { doors: Door[]; anims: Anim[]; forceOpenUntil: number; lights: THREE.PointLight[]; screen: { tex: THREE.CanvasTexture; canvas: HTMLCanvasElement; slide: number; next: number; draw: (i: number) => void } | null; instanced: InstancedModel[] }

/** Merges many boxes/meshes that share a material into one draw call. */
class Batch {
  private geos: THREE.BufferGeometry[] = [];
  constructor(public mat: THREE.Material) {}
  box(w: number, h: number, d: number, cx: number, cy: number, cz: number, rotY = 0) { this.add(box(w, h, d, cx, cy, cz, this.mat, rotY)); }
  add(m: THREE.Mesh) { m.updateMatrix(); const g = m.geometry.clone(); g.applyMatrix4(m.matrix); this.geos.push(g); }
  mesh(name: string): THREE.Mesh | null {
    if (!this.geos.length) return null;
    const g = mergeGeometries(this.geos, false); if (!g) return null;
    const m = new THREE.Mesh(g, this.mat); m.castShadow = true; m.receiveShadow = true; m.name = name; return m;
  }
}

function mats() {
  const panel = Materials.std('metal_alu').clone(); panel.color.set(0xa2a4a6); panel.roughness = 0.62; panel.metalness = 0.18; panel.envMapIntensity = 0.3; panel.name = 'apple_panel';
  const wall = new THREE.MeshStandardMaterial({ color: 0x74777a, roughness: 0.65, metalness: 0.25 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x4a4c4f, roughness: 0.5, metalness: 0.6 });
  const joint = new THREE.MeshStandardMaterial({ color: 0x3a3c3e, roughness: 0.8, metalness: 0.3 });
  const ceil = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, emissive: 0xffffff, emissiveIntensity: 0.7, roughness: 0.9 }); Materials.trackEmissive(ceil, 0.7, 2.6);
  const ceilJoint = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 });
  const tread = new THREE.MeshStandardMaterial({ color: 0xe4ebe9, roughness: 0.25, metalness: 0.05 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f1ec, roughness: 0.6 });
  const leather = new THREE.MeshStandardMaterial({ color: 0xa0623a, roughness: 0.75 });
  const bronze = new THREE.MeshStandardMaterial({ color: 0x66746c, roughness: 0.8, metalness: 0.45, bumpMap: Materials.std('bark').map, bumpScale: 0.8 });
  const water = new THREE.MeshStandardMaterial({ color: 0x4fb3c9, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.85 });
  const pv = new THREE.MeshStandardMaterial({ color: 0x1f2a33, roughness: 0.3, metalness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0d1a22, roughness: 0.25, metalness: 0.3 });
  const stone = Materials.std('limestone').clone(); stone.color.set(0xd9d5cc);
  const shelfLight = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff0d0, emissiveIntensity: 0.8, roughness: 0.9 }); Materials.trackEmissive(shelfLight, 0.8, 2.0);
  return {
    panel, wall, frame, joint, ceil, ceilJoint, tread, white, leather, bronze, water, pv, dark, stone, shelfLight,
    glass: Materials.get('glass_clear'), glassDark: Materials.get('glass_dark'), floor: Materials.get('terrazzo'), paving: Materials.get('concrete_plain'),
    granite: Materials.get('granite_grey'), graniteDark: Materials.get('granite_dark'), chrome: Materials.get('chrome'), sidewalk: Materials.get('concrete'),
  };
}
type Mats = ReturnType<typeof mats>;

// ---- helpers ----------------------------------------------------------------------------------------------------------
/** Ground strip following a height function (aprons between the sidewalk meshes and the building faces). */
function groundStrip(x0: number, x1: number, z0: number, z1: number, h: (x: number, z: number) => number, mat: THREE.Material): THREE.Mesh {
  const [za, zb] = z0 < z1 ? [z0, z1] : [z1, z0];
  const nx = Math.max(1, Math.ceil((x1 - x0) / 2)), nz = Math.max(1, Math.ceil((zb - za) / 2));
  const g = new THREE.PlaneGeometry(x1 - x0, zb - za, nx, nz); g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute, uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) + (x0 + x1) / 2, z = p.getZ(i) + (za + zb) / 2; p.setXYZ(i, x, h(x, z), z); uv.setXY(i, x, z); }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; return m;
}
/** Vertical panel joints (thin dark strips) over a wall face: face normal along +x/-x (axis 'x') or +z/-z (axis 'z'). */
function panelJoints(J: Batch, axis: 'x' | 'z', at: number, a0: number, a1: number, y0: number, y1: number, pitch = 1.2) {
  const h = y1 - y0;
  for (let a = a0 + pitch; a < a1 - 0.3; a += pitch) {
    if (axis === 'z') J.box(0.05, h, 0.04, a, (y0 + y1) / 2, at); else J.box(0.04, h, 0.05, at, (y0 + y1) / 2, a);
  }
}
/** Steel-framed sliding glass leaf (Foster door): glass + stiles + rails, origin at the leaf centre. */
function makeLeaf(w: number, h: number, M: Mats): THREE.Group {
  const g = new THREE.Group();
  const glass = box(w - 0.24, h - 0.4, GLASS_T, 0, h / 2, 0, M.glass); glass.castShadow = false; g.add(glass);
  const F = new Batch(M.frame);
  F.box(0.12, h, 0.2, -w / 2 + 0.06, h / 2, 0); F.box(0.12, h, 0.2, w / 2 - 0.06, h / 2, 0); F.box(0.1, h, 0.18, 0, h / 2, 0);
  F.box(w, 0.16, 0.2, 0, 0.08, 0); F.box(w, 0.3, 0.2, 0, h - 0.15, 0);
  const fm = F.mesh('leaf_frame'); if (fm) g.add(fm);
  return g;
}
/** Make a 2-leaf sliding door in a wall plane parallel to x. Leaves park sideways (west leaf west, east leaf east). */
function slidingDoors(ctx: HeroContext, S: State, M: Mats, zPlane: number, yBase: number, h: number) {
  const w = (DX1 - DX0) / 2;
  for (const [i, dir] of [[0, -1], [1, 1]] as [number, number][]) {
    const x = DX0 + w * (i + 0.5);
    const leaf = makeLeaf(w, h, M); leaf.position.set(x, yBase, zPlane); ctx.group.add(leaf);
    S.doors.push({ group: leaf, x, dir, open: w - 0.05, cur: 0, cx: DXM, cy: yBase, cz: zPlane });
  }
}
function toast(msg: string, seconds = 3) {
  let el = document.getElementById('apple-toast');
  if (!el) {
    el = document.createElement('div'); el.id = 'apple-toast';
    el.style.cssText = 'position:fixed;left:50%;bottom:18%;transform:translateX(-50%);background:rgba(20,20,22,.82);color:#fff;font:15px/1.4 -apple-system,Helvetica,Arial,sans-serif;padding:10px 18px;border-radius:12px;pointer-events:none;z-index:50;display:none;max-width:60vw;text-align:center';
    document.body.appendChild(el);
  }
  el.textContent = msg; el.style.display = 'block';
  const tok = String(Date.now()); el.dataset.tok = tok;
  setTimeout(() => { if (el && el.dataset.tok === tok) el.style.display = 'none'; }, seconds * 1000);
}

// ---- terrain cut: hide the heightfield inside the pavilion (the floor is 2 m below the natural grade at the rear) -------
function cutTerrain(ctx: HeroContext) {
  const mesh = ctx.world.terrain.mesh;
  const m = (mesh.material as THREE.MeshStandardMaterial).clone();
  m.clippingPlanes = [
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), X0 + 0.02), new THREE.Plane(new THREE.Vector3(1, 0, 0), -(X1 - 0.02)),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), Z1 + 0.02), new THREE.Plane(new THREE.Vector3(0, 0, 1), -(Z0 - 0.02)),
  ];
  m.clipIntersection = true; mesh.material = m;
  ctx.app.renderer.localClippingEnabled = true;
}

// ---- shell: exterior + structure + ceiling + stairs -------------------------------------------------------------------
function buildShell(ctx: HeroContext, L: Levels, M: Mats, S: State) {
  const G = ctx.group, { y0, y1, yc } = L;
  const base = y0 - 1.5, top = y0 + H_HEAD;
  const P = new Batch(M.panel), F = new Batch(M.frame), J = new Batch(M.joint), GL = new Batch(M.glass), C = new Batch(M.ceil), CJ = new Batch(M.ceilJoint), W = new Batch(M.wall);
  const T = (x: number, z: number) => ctx.world.terrain.heightAt(x, z);

  // side walls (full depth, full height)
  P.box(WT, top - base, Z0 - Z1, X0 + WT / 2, (base + top) / 2, (Z0 + Z1) / 2);
  // east (Stockton) wall in three parts around the full-height glass notch (2.4 m wide, 17-19.5 m north of Post)
  const NZ0 = -80.1, NZ1 = -82.5;
  P.box(WT, top - base, Z0 - NZ0, X1 - WT / 2, (base + top) / 2, (Z0 + NZ0) / 2);
  P.box(WT, top - base, NZ1 - Z1, X1 - WT / 2, (base + top) / 2, (NZ1 + Z1) / 2);
  GL.box(GLASS_T, yc - y0, NZ0 - NZ1, X1 - WT / 2, (y0 + yc) / 2, (NZ0 + NZ1) / 2);
  F.box(0.2, yc - y0, 0.14, X1 - WT / 2, (y0 + yc) / 2, NZ0 - 0.07); F.box(0.2, yc - y0, 0.14, X1 - WT / 2, (y0 + yc) / 2, NZ1 + 0.07);
  P.box(WT, top - yc, NZ0 - NZ1, X1 - WT / 2, (yc + top) / 2, (NZ0 + NZ1) / 2);
  panelJoints(J, 'x', X1 + 0.02, Z1, NZ1, y0, top); panelJoints(J, 'x', X1 + 0.02, NZ0, Z0, y0, top);
  // Post face: piers (west 4.1 m, east 6.1 m wrapping the corner) 0.95 m deep, glass set back 0.6 m behind the portal
  const PD = 0.95;
  P.box(GX0 - X0 - WT, top - base, PD, (X0 + WT + GX0) / 2, (base + top) / 2, Z0 - PD / 2);
  P.box(X1 - WT - GX1, top - base, PD, (GX1 + X1 - WT) / 2, (base + top) / 2, Z0 - PD / 2);
  P.box(GX1 - GX0, top - yc, PD, DXM, (yc + top) / 2, Z0 - PD / 2);               // head band over the glazed bay
  panelJoints(J, 'z', Z0 + 0.02, X0, GX0, y0, top); panelJoints(J, 'z', Z0 + 0.02, GX1, X1, y0, top); panelJoints(J, 'z', Z0 + 0.02, GX0, GX1, yc, top, 2.0);
  // glazed bay: [fixed][slider][slider][fixed], each bay 5.95 m split by one slim mullion
  const ZG = Z0 - 0.6, bayW = (GX1 - GX0) / 4;
  for (const b of [0, 3]) { const cx = GX0 + bayW * (b + 0.5); GL.box(bayW - 0.12, yc - y0, GLASS_T, cx, (y0 + yc) / 2, ZG); F.box(0.1, yc - y0, 0.18, cx, (y0 + yc) / 2, ZG); }
  for (const x of [GX0 + 0.06, GX0 + bayW, GX1 - bayW, GX1 - 0.06]) F.box(0.12, yc - y0, 0.22, x, (y0 + yc) / 2, ZG);
  F.box(GX1 - GX0, 0.3, 0.4, DXM, yc - 0.15, ZG); F.box(GX1 - GX0, 0.1, 0.3, DXM, y0 + 0.05, ZG);
  F.box(GX1 - GX0, 0.12, 0.12, DXM, yc + 0.06, ZG - 0.45);                        // door track
  slidingDoors(ctx, S, M, ZG - 0.28, y0, yc - y0 - 0.05);
  // north wall: solid at ground level; at mezzanine level solid ends + 18 m of 7.9 m tall glass with two sliding leaves
  P.box(X1 - X0, y1 - base, WT, (X0 + X1) / 2, (base + y1) / 2, Z1 + WT / 2);
  P.box(NGX0 - X0, top - y1, WT, (X0 + NGX0) / 2, (y1 + top) / 2, Z1 + WT / 2);
  P.box(X1 - NGX1, top - y1, WT, (NGX1 + X1) / 2, (y1 + top) / 2, Z1 + WT / 2);
  P.box(NGX1 - NGX0, top - yc, WT, (NGX0 + NGX1) / 2, (yc + top) / 2, Z1 + WT / 2);
  panelJoints(J, 'z', Z1 - 0.02, X0, NGX0, y0, top); panelJoints(J, 'z', Z1 - 0.02, NGX1, X1, y0, top); panelJoints(J, 'z', Z1 - 0.02, X0, X1, y0, y1);
  const ZN = Z1 + WT / 2, nbay = (NGX1 - NGX0) / 6;
  for (let i = 0; i < 6; i++) { const cx = NGX0 + nbay * (i + 0.5); if (cx > DX0 && cx < DX1) continue; GL.box(nbay - 0.1, yc - y1, GLASS_T, cx, (y1 + yc) / 2, ZN); }
  for (let i = 0; i <= 6; i++) F.box(0.12, yc - y1, 0.22, NGX0 + nbay * i, (y1 + yc) / 2, ZN);
  F.box(NGX1 - NGX0, 0.3, 0.4, DXM, yc - 0.15, ZN); F.box(NGX1 - NGX0, 0.1, 0.3, DXM, y1 + 0.05, ZN);
  slidingDoors(ctx, S, M, ZN + 0.28, y1, yc - y1 - 0.05);
  // roof: 0.6 m slab with alu fascia, near-flush PV field, small mechanical box at the west/back
  P.box(X1 - X0, H_ROOF - H_HEAD, Z0 - Z1, (X0 + X1) / 2, y0 + (H_HEAD + H_ROOF) / 2, (Z0 + Z1) / 2);
  const PV = new Batch(M.pv); PV.box(X1 - X0 - 1.6, 0.12, Z0 - Z1 - 1.6, (X0 + X1) / 2, y0 + H_ROOF + 0.06, (Z0 + Z1) / 2);
  for (let i = 1; i < 7; i++) PV.box(X1 - X0 - 1.6, 0.14, 0.06, (X0 + X1) / 2, y0 + H_ROOF + 0.07, Z1 + 0.8 + i * ((Z0 - Z1 - 1.6) / 7));
  P.box(5, 1.5, 3.5, X0 + 3.5, y0 + H_ROOF + 0.75, Z1 + 2.8);
  // ground floor (terrazzo) + aprons to the sidewalks
  G.add(slab(rect(X0, X1, Z1, Z0), y0, 0.08, M.floor));
  G.add(groundStrip(WING_X0, X1 + 0.3, -62.3, Z0, (x, z) => T(x, z) + 0.155, M.sidewalk));
  G.add(groundStrip(X1, 63.2, Z0, -88.6, (x, z) => T(x, z) + 0.155, M.sidewalk));
  G.add(slab(rect(GX0, GX1, Z0 - 0.62, Z0 + 0.02), y0 + 0.005, 0.02, M.floor));      // threshold
  // mezzanine: tapered slab (1.2 m at the root -> 0.3 m at the edge), terrazzo top, frameless glass balustrade
  {
    const zi = Z1 + WT;
    const shape = new THREE.Shape([new THREE.Vector2(ZE, y1), new THREE.Vector2(zi, y1), new THREE.Vector2(zi, y1 - 1.2), new THREE.Vector2(ZE, y1 - 0.3)]);
    const g = new THREE.ExtrudeGeometry(shape, { depth: X1 - X0 - 2 * WT, bevelEnabled: false }); g.rotateY(-Math.PI / 2); g.translate(X1 - WT, 0, 0);
    const m = new THREE.Mesh(g, M.wall); m.castShadow = true; m.receiveShadow = true; m.name = 'mezz_slab'; G.add(m);
    G.add(slab(rect(X0 + WT, X1 - WT, zi, ZE), y1 + 0.01, 0.02, M.floor));
    const bx0 = X0 + WT + 2.13, bx1 = X1 - WT - 2.13;
    GL.box(bx1 - bx0, 1.1, GLASS_T, (bx0 + bx1) / 2, y1 + 0.55, ZE + 0.02);
    const CH = new Batch(M.chrome); CH.box(bx1 - bx0, 0.05, 0.06, (bx0 + bx1) / 2, y1 + 1.12, ZE + 0.02); const chm = CH.mesh('rails'); if (chm) G.add(chm);
  }
  // luminous ceiling: 13 strips 2.4 m wide running N-S with 0.15 m dark joints, over the whole plan at 12.8 m
  const pitch = 2.55, n = 13, zc0 = Z0 - PD, zc1 = Z1 + WT;
  CJ.box(X1 - X0 - 2 * WT, 0.05, zc0 - zc1, (X0 + X1) / 2, yc + 0.06, (zc0 + zc1) / 2);
  for (let i = 0; i < n; i++) C.box(2.4, 0.06, zc0 - zc1, X0 + WT + 0.16 + i * pitch + 1.2, yc - 0.03, (zc0 + zc1) / 2);
  // soffit under the mezzanine: same strips, tilted with the taper
  {
    const zi = Z1 + WT, len = ZE - zi, ang = -Math.atan2(0.9, len);
    for (let i = 0; i < n; i++) { const m = box(2.4, 0.05, len - 0.3, X0 + WT + 0.16 + i * pitch + 1.2, y1 - 0.78, (ZE + zi) / 2, M.ceil); m.rotation.x = ang; C.add(m); }
  }
  // two floating glass stairs (2.13 m wide, 28 x 0.175 m) along the west and east walls, rising from z=-70 to the mezzanine edge
  const TR = new Batch(M.tread), RA = new Batch(M.chrome);
  for (const side of [0, 1]) {
    const xa = side === 0 ? X0 + WT : X1 - WT - 2.13, xc = xa + 1.065, xin = side === 0 ? xa + 2.13 : xa;
    for (let i = 0; i < 28; i++) TR.box(2.13, 0.06, 0.31, xc, y0 + (i + 1) * 0.175 - 0.03, -70.0 - (i + 0.5) * 0.3);
    const ang = Math.atan2(4.9, 8.4), run = Math.hypot(8.4, 4.9);
    const gl = box(GLASS_T, 1.1, run + 0.4, xin + (side === 0 ? 0.03 : -0.03), y0 + 2.45 + 0.62, -74.2, M.glass); gl.rotation.x = ang; gl.castShadow = false; GL.add(gl);
    const rail = box(0.05, 0.05, run + 0.4, xin + (side === 0 ? 0.03 : -0.03), y0 + 2.45 + 1.15, -74.2, M.chrome); rail.rotation.x = ang; RA.add(rail);
  }
  // logos: cut into the Stockton panels (upper third, toward Post) + small one on the Post head band
  const big = signMesh(makeLogoSign('apple', 2.4, 2.4), 0.05); big.rotation.y = Math.PI / 2; big.position.set(X1 + 0.03, y0 + 10.4, -70.5); G.add(big);
  // (no logo on the Post St glass face — the real store carries the logo only on the Stockton wall)
  // west service wing (3 levels of cream limestone on Post; taller rear block carries the green wall)
  const ST = new Batch(M.stone);
  ST.box(PX0 - WING_X0, y0 + H_WING + 1.5, -76 - Z0, (WING_X0 + PX0) / 2, (y0 + H_WING - 1.5) / 2, (Z0 - 76) / 2);
  ST.box(PX0 - WING_X0, y0 + H_WING_REAR + 1.5, -76 - WING_Z1, (WING_X0 + PX0) / 2, (y0 + H_WING_REAR - 1.5) / 2, (-76 + WING_Z1) / 2);
  const DK = new Batch(M.glassDark);
  for (const yy of [y0 + 5.6, y0 + 9.4]) for (const xx of [22.6, 25.4]) DK.box(1.2, 1.6, 0.1, xx, yy, Z0 + 0.05);
  F.box(1.3, 2.6, 0.1, 24.0, y0 + 1.3, Z0 + 0.05);
  const RF = new Batch(Materials.get('roof')); RF.box(PX0 - WING_X0 - 0.4, 0.1, -76 - Z0 - 0.4, (WING_X0 + PX0) / 2, y0 + H_WING + 0.05, (Z0 - 76) / 2); RF.box(PX0 - WING_X0 - 0.4, 0.1, -76 - WING_Z1 - 0.4, (WING_X0 + PX0) / 2, y0 + H_WING_REAR + 0.05, (-76 + WING_Z1) / 2);
  for (const [b, name] of [[P, 'panels'], [F, 'frames'], [J, 'joints'], [C, 'ceiling'], [CJ, 'ceiling_joints'], [W, 'walls'], [PV, 'pv'], [TR, 'treads'], [RA, 'rails'], [ST, 'wing'], [DK, 'wing_windows'], [RF, 'wing_roof'], [GL, 'glass']] as [Batch, string][]) {
    const m = b.mesh(name); if (m) { if (name === 'glass') { m.castShadow = false; m.renderOrder = 10; } G.add(m); }
  }
}

// ---- interior furnishing (assets) --------------------------------------------------------------------------------------
async function buildInterior(ctx: HeroContext, L: Levels, M: Mats, S: State) {
  const G = ctx.group, C = ctx.world.collision, { y0, y1 } = L;
  const cache = new Map<string, InstancedModel>();
  const inst = async (rel: string, cap: number) => { let im = cache.get(rel); if (!im) { im = await Assets.instanced(rel, cap); im.group.name = rel; G.add(im.group); S.instanced.push(im); cache.set(rel, im); } return im; };
  const [tableL, table, iphone, ipad, mac, imac, watch, pods, shelf, stool, bench, planter, ficus] = await Promise.all([
    inst('retail/apple_table_long', 12), inst('retail/apple_table', 4), inst('retail/apple_iphone_stand', 64), inst('retail/apple_ipad_stand', 32), inst('retail/apple_macbook', 24),
    inst('retail/apple_imac', 8), inst('retail/apple_watch_stand', 32), inst('retail/apple_headphones', 12), inst('retail/apple_avenue_shelf', 14), inst('retail/apple_stool', 24),
    inst('retail/apple_bench_forum', 14), inst('retail/apple_planter_tree_box', 8), inst('veg/tree_ficus_indoor', 8),
  ]);
  const grid = (im: InstancedModel, cx: number, z: number, y: number, nx: number, nz: number, px: number, pz: number, rot = 0) => {
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) im.add([cx + (i - (nx - 1) / 2) * px, y, z + (j - (nz - 1) / 2) * pz], rot);
  };
  const tableBox = (x: number, z: number, w: number) => C.addBox(x, z, w, 1.2, y0 - 0.5, y0 + 0.9, 0, 'apple:furniture');
  // product hall: 3 rows x 3 long oak tables (iPhone nearest the doors, Watch/AirPods, then Mac/iPad)
  const rows = [-68.6, -72.6, -76.6], xs = [36.6, DXM, 52.0];   // clear entry aisle + 4 m walkways between table columns
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const x = xs[c], z = rows[r], yt = y0 + 0.9; tableL.add([x, y0, z], 0); tableBox(x, z, 3.6);
    const kind = r === 0 ? 'iphone' : r === 1 ? (c === 0 ? 'watch' : c === 1 ? 'iphone' : 'pods') : (c === 0 ? 'mac' : c === 1 ? 'imac' : 'ipad');
    if (kind === 'iphone') grid(iphone, x, z, yt, 6, 2, 0.55, 0.62);
    else if (kind === 'watch') grid(watch, x, z, yt, 6, 2, 0.5, 0.6);
    else if (kind === 'pods') { grid(pods, x - 0.9, z, yt, 3, 2, 0.5, 0.6); grid(ipad, x + 1.0, z, yt, 3, 2, 0.5, 0.6); }
    else if (kind === 'mac') grid(mac, x, z, yt, 5, 2, 0.6, 0.62);
    else if (kind === 'imac') grid(imac, x, z, yt, 3, 1, 1.0, 0);
    else grid(ipad, x, z, yt, 5, 2, 0.6, 0.6);
  }
  for (const [x, z] of [[36.0, -82.6], [50.6, -82.6]]) { table.add([x, y0, z], 0); tableBox(x, z, 2.4); grid(watch, x, z, y0 + 0.9, 4, 2, 0.5, 0.6); }
  for (const [x, z] of [[40.2, -66.8], [46.4, -66.8], [40.2, -74.8], [46.4, -74.8], [35.0, -70.8], [51.6, -70.8]]) stool.add([x, y0, z], 0);
  // hero devices (individually animated) at the centre of three tables
  const heroes: { rel: string; x: number; z: number; label: string }[] = [
    { rel: 'retail/apple_iphone_stand', x: DXM, z: -66.8, label: 'Inspect iPhone' }, { rel: 'retail/apple_macbook', x: 38.5, z: -74.8, label: 'Inspect MacBook' }, { rel: 'retail/apple_ipad_stand', x: 48.1, z: -74.8, label: 'Inspect iPad' },
  ];
  for (const h of heroes) {
    const o = await Assets.instance(h.rel); o.position.set(h.x, y0 + 0.9, h.z); G.add(o);
    ctx.registerInteractable({ id: `apple-${h.label.split(' ')[1].toLowerCase()}`, label: h.label, hint: 'Press E to inspect', position: new THREE.Vector3(h.x, y0 + 1.0, h.z), radius: 2.6, object: o,
      onActivate: () => { if (!S.anims.find((a) => a.obj === o)) S.anims.push({ obj: o, t: 0, y: y0 + 0.9 }); toast(`${h.label.split(' ')[1]} — ${h.label.includes('iPhone') ? 'iPhone 17 Pro, titanium, 6.3"' : h.label.includes('MacBook') ? 'MacBook Pro 14", M5' : 'iPad Pro 13", M5'}`, 2.5); } });
  }
  // the Avenue: back-lit oak display windows along the rear wall and the west return (under the mezzanine)
  const SL = new Batch(M.shelfLight);
  for (let x = 30.5; x <= 56.2; x += 3.2) { shelf.add([x, y0, Z1 + WT + 0.26], 0); C.addBox(x, Z1 + WT + 0.26, 3.0, 0.5, y0, y0 + 3, 0, 'apple:furniture'); SL.box(2.8, 2.8, 0.03, x, y0 + 1.5, Z1 + WT + 0.05); }
  for (const z of [-81.2, -84.6]) { shelf.add([X0 + WT + 0.26, y0, z], Math.PI / 2); C.addBox(X0 + WT + 0.26, z, 0.5, 3.0, y0, y0 + 3, 0, 'apple:furniture'); SL.box(0.03, 2.8, 2.8, X0 + WT + 0.05, y0 + 1.5, z); }
  shelf.add([X1 - WT - 0.26, y0, -85.2], -Math.PI / 2); C.addBox(X1 - WT - 0.26, -85.2, 0.5, 3.0, y0, y0 + 3, 0, 'apple:furniture'); SL.box(0.03, 2.8, 2.8, X1 - WT - 0.05, y0 + 1.5, -85.2);
  const slm = SL.mesh('avenue_backlight'); if (slm) G.add(slm);
  // mezzanine: Genius Grove (ficus in planters along the north glass, long tables + stools, leather cubes)
  const LB = new Batch(M.leather), WB = new Batch(M.white);
  for (const x of [34.2, 37.0, 39.8, 46.8, 49.6, 52.4]) {
    planter.add([x, y1, -86.6], 0); ficus.add([x, y1 + 0.55, -86.6], (x * 1.7) % 6.28, 0.95); C.addBox(x, -86.6, 2.0, 2.0, y1, y1 + 0.6, 0, 'apple:furniture');
  }
  for (const x of [32.5, 38.5]) { tableL.add([x, y1, -82.2], 0); C.addBox(x, -82.2, 3.6, 1.2, y1, y1 + 0.9, 0, 'apple:furniture'); for (const dx of [-1.2, 0, 1.2]) for (const dz of [-1.0, 1.0]) stool.add([x + dx, y1, -82.2 + dz], 0); }
  const cubes: P2[] = [[35.6, -84.6], [36.2, -83.9], [41.8, -85.2], [42.5, -84.5], [44.6, -85.2], [45.3, -84.5], [31.5, -84.8]];
  for (const [x, z] of cubes) { LB.box(0.45, 0.45, 0.45, x, y1 + 0.225, z, (x * 3.1) % 1.2); WB.box(0.5, 0.05, 0.5, x, y1 + 0.02, z, (x * 3.1) % 1.2); }
  ctx.registerInteractable({ id: 'apple-grove-seat', label: 'Sit', hint: 'Press E to sit in the Genius Grove', position: new THREE.Vector3(36.0, y1 + 0.4, -84.3), radius: 2.2,
    onActivate: () => toast('You sit on a leather cube under the ficus trees of the Genius Grove. A Genius will be with you shortly.', 3) });
  // the Forum: 6K video wall on the Stockton wall, six rows of oak benches facing it
  const vw = await Assets.instance('retail/apple_video_wall_frame'); vw.rotation.y = -Math.PI / 2; vw.position.set(X1 - WT - 0.21, y1 + 0.2, -75.0); G.add(vw);
  C.addBox(X1 - WT - 0.21, -75.0, 0.42, 11.8, y1, y1 + 7, 0, 'apple:furniture');
  const screenMat = makeScreen(S);
  vw.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { const mm = m.material as THREE.Material; if ((mm.name || '').replace(/\.\d+$/, '') === 'screen') m.material = screenMat; } });
  for (const x of [46.5, 48.5, 50.5, 52.5, 54.5, 56.5]) for (const z of [-80.3, -83.8]) { bench.add([x, y1, z], Math.PI / 2); C.addBox(x, z, 0.5, 3.0, y1, y1 + 0.45, 0, 'apple:furniture'); }
  ctx.registerInteractable({ id: 'apple-forum-screen', label: 'Play presentation', hint: 'Press E to play the next Today at Apple slide', position: new THREE.Vector3(X1 - WT - 1.0, y1 + 2.0, -75.0), radius: 8, object: vw,
    onActivate: () => { if (S.screen) { S.screen.slide = (S.screen.slide + 1) % 3; S.screen.draw(S.screen.slide); S.screen.next = ctx.app.elapsed + 8; } toast('Today at Apple — session starting', 2); } });
  // Boardroom / back-of-house box at the west end of the mezzanine
  const BR = new Batch(M.wall), FR = new Batch(M.frame);
  const bx0 = X0 + WT, bx1 = 33.0, bz0 = -80.6, bz1 = Z1 + WT;
  BR.box(bx1 - bx0, 3.2, bz0 - bz1, (bx0 + bx1) / 2, y1 + 1.6, (bz0 + bz1) / 2); FR.box(0.06, 2.3, 1.0, bx1 + 0.03, y1 + 1.15, bz0 - 1.4);
  C.addBox((bx0 + bx1) / 2, (bz0 + bz1) / 2, bx1 - bx0, bz0 - bz1, y1, y1 + 3.2, 0, 'apple:furniture');
  const brSign = signMesh(makeLogoSign('Boardroom', 1.2, 0.3, { color: '#f4f4f2' }), 0.02); brSign.rotation.y = Math.PI / 2; brSign.position.set(bx1 + 0.03, y1 + 2.6, bz0 - 1.4); G.add(brSign);
  for (const [b, name] of [[LB, 'leather_cubes'], [WB, 'cube_bases'], [BR, 'boardroom'], [FR, 'boardroom_door']] as [Batch, string][]) { const m = b.mesh(name); if (m) G.add(m); }
  // interior lights (emissive ceiling does most of the work; one point light per level, scaled by night factor)
  for (const [y, z] of [[y0 + 9.5, -71.0], [y1 + 6.5, -83.5]]) { const pl = new THREE.PointLight(0xfff3e4, 40, 48, 2); pl.position.set(DXM, y, z); G.add(pl); S.lights.push(pl); }
}

function makeScreen(S: State): THREE.MeshStandardMaterial {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 576;
  const c = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.flipY = false; // the frame's screen quad has v=1 at its bottom edge
  const draw = (i: number) => {
    const w = canvas.width, h = canvas.height;
    if (i === 0) {
      c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#fff'; c.font = '600 92px -apple-system, Helvetica, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('Today at Apple', w / 2, h / 2 - 20);
      c.fillStyle = '#9a9a9f'; c.font = '400 34px -apple-system, Helvetica, Arial, sans-serif'; c.fillText('Photo Walk: Union Square light and shadow  ·  Sat 11:00', w / 2, h / 2 + 70);
    } else if (i === 1) {
      const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#ff5f6d'); g.addColorStop(0.35, '#ffc371'); g.addColorStop(0.65, '#2bd2ff'); g.addColorStop(1, '#5b3fff');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      for (let k = 0; k < 14; k++) { const r = c.createRadialGradient(w * ((k * 0.37) % 1), h * ((k * 0.61) % 1), 0, w * ((k * 0.37) % 1), h * ((k * 0.61) % 1), 120 + (k % 4) * 60); r.addColorStop(0, `hsla(${(k * 47) % 360},90%,65%,0.75)`); r.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = r; c.fillRect(0, 0, w, h); }
    } else {
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#1b1f3a'); g.addColorStop(1, '#5a2a6e'); c.fillStyle = g; c.fillRect(0, 0, w, h);
      const tg = c.createLinearGradient(0, 0, w, 0); tg.addColorStop(0, '#ff9a9e'); tg.addColorStop(0.5, '#fad0c4'); tg.addColorStop(1, '#a1c4fd');
      c.fillStyle = tg; c.font = '700 110px -apple-system, Helvetica, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('Union Square', w / 2, h / 2 - 10);
      c.fillStyle = '#e8e8f0'; c.font = '400 32px -apple-system, Helvetica, Arial, sans-serif'; c.fillText('300 Post Street · San Francisco', w / 2, h / 2 + 85);
    }
    tex.needsUpdate = true;
  };
  draw(0);
  S.screen = { tex, canvas, slide: 0, next: 8, draw };
  return new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.1, roughness: 0.35, metalness: 0.1 });
}

// ---- rear plaza: door-level terrace, main plaza, Stockton stair with the Asawa fountain, green wall, trees, cafe seating --
async function buildPlaza(ctx: HeroContext, L: Levels, M: Mats, S: State) {
  const G = ctx.group, C = ctx.world.collision, { y0, y1, yP, ySW } = L;
  const PA = new Batch(M.paving), GR = new Batch(M.granite), GD = new Batch(M.graniteDark), WH = new Batch(M.white), DK = new Batch(M.dark), CH = new Batch(M.chrome);
  // terrace at door level (3.2 m deep) with 6 risers down to the plaza under the glazing; hedge planters elsewhere
  PA.box(X1 - X0, y1 - (yP - 0.6), Z1 - TZ, (X0 + X1) / 2, (y1 + yP - 0.6) / 2, (Z1 + TZ) / 2);
  const STX0 = 36.0, STX1 = 50.6, rise = (y1 - yP) / 6;
  for (let i = 0; i < 6; i++) { const t = y1 - (i + 1) * rise, zc = TZ - i * 0.3 - 0.15; PA.box(STX1 - STX0, t - (yP - 0.6), 0.3, (STX0 + STX1) / 2, (t + yP - 0.6) / 2, zc); }
  for (const x of [STX0 + 0.5, STX1 - 0.5]) { const r = box(0.04, 0.04, 2.1, x, y1 + 0.35, TZ - 0.95, M.chrome); r.rotation.x = Math.atan2(y1 - yP, 1.8); CH.add(r); CH.box(0.04, 0.9, 0.04, x, y1 + 0.45, TZ + 0.05); CH.box(0.04, 0.9, 0.04, x, yP + 0.45, TZ - 1.9); }
  for (const [a, b] of [[X0, STX0], [STX1, X1]]) { PA.box(b - a, 1.0, 0.9, (a + b) / 2, yP + 0.2, TZ - 0.45); C.addWall({ ax: a, az: TZ, bx: b, bz: TZ, y0: y1 - 0.5, y1: y1 + 1.0, tag: 'apple:plaza' }); C.addBox((a + b) / 2, TZ - 0.45, b - a, 0.9, yP - 1, yP + 1.3, 0, 'apple:plaza'); }
  C.addFlatPatch(rect(X0, X1, Z1, TZ), y1, 'apple:terrace', 2);
  C.addRampPatch(rect(STX0, STX1, TZ - 1.8, TZ), [DXM, TZ], y1, [DXM, TZ - 1.8], yP, 'apple:terrace_steps');
  // main plaza slab (large grey slabs) + Hyatt-side raised hedge planter + two stone benches
  PA.box(PX1 - PX0, 1.8, TZ - HYATT_Z, (PX0 + PX1) / 2, yP - 0.9, (TZ + HYATT_Z) / 2);
  C.addFlatPatch(rect(PX0, PX1, HYATT_Z, TZ), yP, 'apple:plaza', 1);
  PA.box(27, 0.75, 0.9, 43.5, yP + 0.375, HYATT_Z + 0.45); C.addBox(43.5, HYATT_Z + 0.45, 27, 0.9, yP - 1, yP + 1.8, 0, 'apple:plaza');
  for (const x of [33.5, 53.5]) { GR.box(2.2, 0.45, 0.55, x, yP + 0.225, HYATT_Z + 1.3); C.addBox(x, HYATT_Z + 1.3, 2.2, 0.55, yP - 1, yP + 0.45, 0, 'apple:plaza'); }
  // Stockton stair: 14 granite risers, 9 m wide, flanked by planted retaining walls; the Asawa fountain sits at its head
  const nr = 14, srise = (yP - ySW) / nr, tread = (SX1 - SX0) / nr;
  for (let i = 0; i < nr; i++) { const t = yP - (i + 1) * srise, xc = SX0 + (i + 0.5) * tread; GD.box(tread + 0.01, t - (ySW - 1.2), SZ0 - SZ1, xc, (t + ySW - 1.2) / 2, (SZ0 + SZ1) / 2); }
  C.addRampPatch(rect(SX0, SX1, SZ1, SZ0), [SX0, FOUNTAIN[1]], yP, [SX1, FOUNTAIN[1]], ySW, 'apple:stockton_stair');
  for (const [za, zb] of [[Z1, SZ0], [SZ1, HYATT_Z]]) {
    GR.box(63.0 - SX0, yP + 0.15 - (ySW - 1.5), za - zb, (SX0 + 63.0) / 2, (yP + 0.15 + ySW - 1.5) / 2, (za + zb) / 2);
    C.addBox((SX0 + 63.0) / 2, (za + zb) / 2, 63.0 - SX0, za - zb, ySW - 1.5, yP + 1.3, 0, 'apple:plaza');
  }
  {
    const dg = new THREE.CylinderGeometry(2.45, 2.4, 2.3, 96, 12, true);
    const dp = dg.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < dp.count; i++) {              // bas-relief: bands of bumps like the cast bronze panels
      const x = dp.getX(i), y = dp.getY(i), z = dp.getZ(i), a = Math.atan2(z, x), r = Math.hypot(x, z);
      const n = 0.06 * Math.sin(a * 23 + y * 9) * Math.cos(y * 7 + a * 5) + 0.04 * Math.sin(a * 61) * Math.sin(y * 19) + (Math.abs(((y + 1.15) % 0.46) - 0.23) < 0.03 ? -0.04 : 0);
      const rr = r + n; dp.setXYZ(i, Math.cos(a) * rr, y, Math.sin(a) * rr);
    }
    dg.computeVertexNormals();
    const drum = new THREE.Mesh(dg, M.bronze); drum.position.set(FOUNTAIN[0], yP - 1.1 + 1.15, FOUNTAIN[1]); drum.castShadow = true; drum.receiveShadow = true; drum.name = 'asawa_fountain'; G.add(drum);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.12, 64), M.bronze); cap.position.set(FOUNTAIN[0], yP + 1.15, FOUNTAIN[1]); G.add(cap);
    const bot = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.2, 64), M.bronze); bot.position.set(FOUNTAIN[0], yP - 1.05, FOUNTAIN[1]); G.add(bot);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 2.25, 0.06, 40), M.water); water.position.set(FOUNTAIN[0], yP + 1.24, FOUNTAIN[1]); G.add(water);
    for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2, r = k === 0 ? 0 : 0.9; WH.box(0.06, 0.5 + (k % 3) * 0.2, 0.06, FOUNTAIN[0] + Math.cos(a) * r, yP + 1.3 + (k % 3) * 0.1, FOUNTAIN[1] + Math.sin(a) * r); }
    C.addBox(FOUNTAIN[0], FOUNTAIN[1], 4.9, 4.9, yP - 2.5, yP + 1.2, 0, 'apple:plaza');
  }
  // green wall (creeping fig) on the wing's east face along the whole plaza depth, with the dark waterfall slot
  const vine = await Assets.instanced('veg/vine_wall_2m', 40); vine.group.name = 'green_wall'; G.add(vine.group); S.instanced.push(vine);
  const gwTop = y0 + H_WING_REAR - 0.1, rows = 4, rowH = (gwTop - yP) / rows;
  for (let r = 0; r < rows; r++) for (let cI = 0; cI < 7; cI++) vine.add([PX0 + 0.32, yP + r * rowH, Z1 - 1.24 - cI * 2.47], Math.PI / 2, [1, rowH / 3.36, 1]);
  const mat = box(0.16, gwTop - yP, Z1 - HYATT_Z, PX0 + 0.1, (gwTop + yP) / 2, (Z1 + HYATT_Z) / 2, Materials.get('grass')); mat.name = 'green_wall_mat'; G.add(mat); // dense foliage mat behind the vine modules
  DK.box(0.2, gwTop - yP, 0.32, PX0 + 0.5, (gwTop + yP) / 2, -100.4);
  // trees in white round planters (seats), cafe tables and chairs
  const [tree, hedge, cafeT, cafeC] = await Promise.all([Assets.instanced('veg/tree_street_small', 12), Assets.instanced('veg/hedge_1m', 110), Assets.instanced('retail/gen_cafe_table', 8), Assets.instanced('retail/gen_cafe_chair', 24)]);
  for (const im of [tree, hedge, cafeT, cafeC]) { G.add(im.group); S.instanced.push(im); }
  const trees: P2[] = [[36, -95.4], [40, -95.4], [44, -95.4], [48, -95.4], [38, -99.6], [42, -99.6], [46, -99.6], [50, -99.6], [32.5, -97.5], [33.5, -102.0]];
  for (const [x, z] of trees) {
    const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.75, 0.5, 24), M.white); pl.position.set(x, yP + 0.25, z); WH.add(pl);
    tree.add([x, yP + 0.45, z], (x * 2.3 + z) % 6.28, 0.85); C.addBox(x, z, 1.6, 1.6, yP, yP + 0.5, 0, 'apple:plaza');
  }
  for (const [x, z] of [[38, -97.5], [42, -97.5], [46, -97.5], [36, -101.8], [40, -101.8], [44, -101.8]]) {
    cafeT.add([x, yP, z], 0); cafeC.add([x - 0.7, yP, z], Math.PI / 2); cafeC.add([x + 0.7, yP, z], -Math.PI / 2); C.addBox(x, z, 0.7, 0.7, yP, yP + 0.75, 0, 'apple:plaza');
  }
  for (let x = 30.5; x < 56.5; x += 1.05) hedge.add([x, yP + 0.75, HYATT_Z + 0.45], 0, 0.9);
  for (const [a, b] of [[X0 + 0.6, STX0 - 0.5], [STX1 + 0.5, X1 - 0.6]]) for (let x = a; x < b; x += 1.05) hedge.add([x, yP + 0.7, TZ - 0.45], 0, 0.9);
  for (const [za, zb] of [[Z1 - 0.4, SZ0 + 0.4], [SZ1 - 0.6, HYATT_Z + 0.6]]) for (let z = za; z > zb; z -= 1.05) for (const x of [SX0 + 1.2, SX0 + 3.6]) hedge.add([x, yP + 0.15, z], Math.PI / 2, 0.9);
  for (const [b, name] of [[PA, 'plaza_paving'], [GR, 'plaza_granite'], [GD, 'stockton_stair'], [WH, 'planters'], [DK, 'waterfall'], [CH, 'handrails']] as [Batch, string][]) { const m = b.mesh(name); if (m) G.add(m); }
}

// ---- collision for the shell + registration ------------------------------------------------------------------------------
function buildCollision(ctx: HeroContext, L: Levels) {
  const C = ctx.world.collision, { y0, y1 } = L, W = X1 - X0;
  const fp: P2[] = [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]];
  C.addPolygon(fp, y0 - 1.5, y1, 'bld:apple', [{ edge: 0, t0: (DX0 - X0) / W, t1: (DX1 - X0) / W }]);
  C.addPolygon(fp, y1, y0 + H_ROOF, 'bld:apple', [{ edge: 2, t0: (X1 - DX1) / W, t1: (X1 - DX0) / W }]);
  C.addPolygon([[WING_X0, Z0], [PX0, Z0], [PX0, WING_Z1], [WING_X0, WING_Z1]], -2, y0 + H_WING_REAR, 'bld:apple_wing');
  C.addFlatPatch(rect(X0, X1, Z1, Z0 + 0.6), y0, 'apple:gf', 1);
  C.addFlatPatch(rect(X0 + WT, X1 - WT, Z1, ZE), y1, 'apple:mezz', 2);
  C.addWall({ ax: X0 + WT + 2.13, az: ZE, bx: X1 - WT - 2.13, bz: ZE, y0: y1 - 0.2, y1: y1 + 1.1, tag: 'apple:mezz' });
  for (const side of [0, 1]) {
    const xa = side === 0 ? X0 + WT : X1 - WT - 2.13, xin = side === 0 ? xa + 2.13 : xa;
    C.addRampPatch(rect(xa, xa + 2.13, ZE, -70.0), [xa, -70.0], y0, [xa, ZE], y1, 'apple:stair');
    C.addWall({ ax: xin, az: -70.0, bx: xin, bz: ZE, y0: y0, y1: y1 + 1.1, tag: 'apple:stair' });            // glass balustrade
    C.addWall({ ax: xa, az: ZE, bx: xa + 2.13, bz: ZE, y0: y0, y1: y1 - 0.6, tag: 'apple:stair' });          // no walking under the top run
  }
}

// ---- module ----------------------------------------------------------------------------------------------------------------
export const AppleModule: HeroModule = {
  id: 'apple',
  excludeOsmIds: ['way/332223480', 'way/779012330'],
  async build(ctx: HeroContext) {
    const T = (x: number, z: number) => ctx.world.terrain.heightAt(x, z);
    const y0 = T(DXM, -61.5) + 0.15;                               // store floor = Post St sidewalk at the doors
    const L: Levels = { y0, y1: y0 + H_MEZZ, yc: y0 + H_CEIL, yP: y0 + 3.8, ySW: T(63.2, FOUNTAIN[1]) + 0.15 };
    const M = mats();
    const S: State = { doors: [], anims: [], forceOpenUntil: -1, lights: [], screen: null, instanced: [] };
    ctx.group.name = 'apple_union_square';
    cutTerrain(ctx);
    buildShell(ctx, L, M, S);
    buildCollision(ctx, L);
    await buildInterior(ctx, L, M, S);
    await buildPlaza(ctx, L, M, S);
    for (const im of S.instanced) im.finalize();

    ctx.registerStorefront({ id: 'apple-union-square', name: 'Apple Union Square', category: 'electronics', address: '300 Post St', position: new THREE.Vector3(DXM, y0, -60.8), facing: new THREE.Vector3(0, 0, 1), width: GX1 - GX0, enterable: true, status: 'open', confidence: 'high', interiorTag: 'apple' });
    ctx.registerInteractable({ id: 'apple-door', label: 'Open door', hint: 'Press E to open the 42 ft glass doors', position: new THREE.Vector3(DXM, y0 + 1.2, Z0 - 0.9), radius: 5, object: S.doors[0]?.group,
      onActivate: () => { S.forceOpenUntil = ctx.app.elapsed + 10; toast('The two 20-tonne glass leaves slide open.', 2.5); } });

    // animation: sliding doors (proximity / manual), forum slides, device inspection, night lighting
    const cam = ctx.app.camera.position;
    ctx.addUpdatable({
      update(dt: number, t: number) {
        for (const d of S.doors) {
          const dx = cam.x - d.cx, dz = cam.z - d.cz, dy = cam.y - d.cy;
          const near = dx * dx + dz * dz < 36 && dy > -1.5 && dy < 4;
          const target = near || t < S.forceOpenUntil ? d.open : 0;
          d.cur += Math.max(-dt * 1.4, Math.min(dt * 1.4, target - d.cur));
          d.group.position.x = d.x + d.cur * d.dir;
        }
        if (S.screen && t > S.screen.next) { S.screen.slide = (S.screen.slide + 1) % 3; S.screen.draw(S.screen.slide); S.screen.next = t + 8; }
        for (let i = S.anims.length - 1; i >= 0; i--) {
          const a = S.anims[i]; a.t += dt; const k = Math.min(1, a.t / 2);
          a.obj.position.y = a.y + 0.35 * Math.sin(Math.PI * k); a.obj.rotation.y = Math.PI * 2 * k;
          if (a.t >= 2) { a.obj.position.y = a.y; a.obj.rotation.y = 0; S.anims.splice(i, 1); }
        }
        const n = ctx.nightFactor(); for (const pl of S.lights) pl.intensity = 40 + 300 * n;
      },
    });
  },
};
