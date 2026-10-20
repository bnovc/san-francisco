// Nintendo SAN FRANCISCO (331 Powell St) — storefront carved into the Westin St. Francis SE corner (Powell & Geary)
// + explorable two-level interior. The Westin massing/façade stays (excludeOsmIds = []): the store volume is clipped
// out of the existing building meshes and rebuilt here with its own geometry, collision and lighting.
//
// Draw-call budget: everything static is merged into one mesh per material (world matrices baked), repeated GLB fixtures
// (gondolas, wall shelves, kiosk bodies) are InstancedMeshes, and only animated / interactive objects stay individual:
// door leaves, ? blocks + coins, the game wall and kiosk screens (live canvas textures), the plush bin and the two photo-spot
// statues. The output is split into `exterior` (storefront) and `interior` (shown only within 70 m or when inside).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { HeroModule, HeroContext, Interactable } from '../world/HeroContext';
import { Materials } from '../materials/Library';
import { makeLogoSign } from '../materials/Signage';
import { Assets, InstancedModel } from '../assets/Assets';
import { slab, rect } from '../util/MeshUtil';
import { P2, segClosest } from '../util/Geometry2D';
import { PARADE, MascotKind, paradeAtlas, type ParadeSpec, sfPanelTexture, GameWall, KioskScreen, splatTexture, labelAtlas, GAME_SCENES } from './nintendo/canvases';

const WESTIN_ID = 'way/332378158';
const POWELL_M = 14.0, GEARY_M = 21.0, PIER = 0.9, PROUD = 0.15;
const RISE = 4.0 / 24, TREAD = 0.28, STEPS = 24, STAIR_W = 1.2;
const INTERIOR_VIS_M = 70;                      // interior group is drawn within this distance of the store centre (or when inside)
const INSTANCED: Record<string, number> = { nintendo_gondola: 12, nintendo_wall_shelf_3m: 11, nintendo_demo_kiosk: 9 }; // rel -> capacity

// ---------- small helpers ----------
function boxGeo(w: number, h: number, d: number, cx: number, cy: number, cz: number, rotY = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute; const faces: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * faces[f][0], uv.getY(k) * faces[f][1]); }
  if (rotY) g.rotateY(rotY);
  g.translate(cx, cy, cz);
  return g;
}
function planeGeo(w: number, h: number, cx: number, cy: number, cz: number, rotY: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h); g.rotateY(rotY); g.translate(cx, cy, cz); return g;
}
function xform(pos: [number, number, number], rotY = 0, rotX = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
}
/** Plain indexed copy of a geometry with only position/normal/uv (interleaved / normalized attributes flattened), optionally
 *  transformed by `mat` and restricted to one index range (a material group). Makes any geometry mergeable with any other. */
function norm(src: THREE.BufferGeometry, mat?: THREE.Matrix4, range?: { start: number; count: number }): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = src.getAttribute('position'); const n = pos.count;
  const copy = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number) => {
    const out = new Float32Array(n * size);
    for (let i = 0; i < n; i++) { out[i * size] = a.getX(i); if (size > 1) out[i * size + 1] = a.getY(i); if (size > 2) out[i * size + 2] = a.getZ(i); }
    return new THREE.BufferAttribute(out, size);
  };
  g.setAttribute('position', copy(pos, 3));
  const nor = src.getAttribute('normal'); if (nor) g.setAttribute('normal', copy(nor, 3));
  const uv = src.getAttribute('uv'); g.setAttribute('uv', uv ? copy(uv, 2) : new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  const si = src.getIndex(); const total = si ? si.count : n;
  const start = range?.start ?? 0, count = Math.max(0, Math.min(range?.count ?? total, total - start));
  const idx = new Uint32Array(count); for (let i = 0; i < count; i++) idx[i] = si ? si.getX(start + i) : start + i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  if (mat) g.applyMatrix4(mat);
  if (!nor) g.computeVertexNormals();
  return g;
}
/** Merges world-space geometries per material into a single mesh per material (shadow flags are per batch). */
class Batch {
  private m = new Map<THREE.Material, THREE.BufferGeometry[]>();
  constructor(private cast = true, private receive = true) {}
  add(mat: THREE.Material, g: THREE.BufferGeometry) {
    let a = this.m.get(mat); if (!a) this.m.set(mat, (a = []));
    const plain = !!g.index && !!g.getAttribute('normal') && !!g.getAttribute('uv') && Object.keys(g.attributes).length === 3;
    a.push(plain ? g : norm(g));
  }
  /** Bakes every mesh below `root` (world matrices applied; multi-material meshes split per group). */
  bake(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; const geo = mesh.geometry;
      if (mats.length > 1 && geo.groups.length) { for (const gr of geo.groups) this.add(mats[gr.materialIndex ?? 0], norm(geo, mesh.matrixWorld, gr)); }
      else this.add(mats[0], norm(geo, mesh.matrixWorld));
    });
  }
  flush(parent: THREE.Object3D, name: string) {
    for (const [mat, gs] of this.m) { const g = mergeGeometries(gs, false); if (!g) continue; const mesh = new THREE.Mesh(g, mat); mesh.name = `${name}:${mat.name}`; mesh.castShadow = this.cast; mesh.receiveShadow = this.receive; parent.add(mesh); }
    this.m.clear();
  }
}
function toast(msg: string, ms = 2600) {
  const el = document.getElementById('toast'); if (!el) { console.log('[nintendo]', msg); return; }
  el.textContent = msg; el.style.display = 'block'; clearTimeout((el as any).__ninT); (el as any).__ninT = window.setTimeout(() => (el.style.display = 'none'), ms);
}
function track(m: THREE.MeshStandardMaterial, day: number, night: number, nf: number) { m.emissiveIntensity = day + (night - day) * nf; Materials.trackEmissive(m, day, night); }
const std = (o: THREE.MeshStandardMaterialParameters, name = '') => { const m = new THREE.MeshStandardMaterial(o); m.name = name; return m; };

interface Face { name: 'powell' | 'geary'; o: P2; u: P2; n: P2; L: number; rotN: number; nBays: number; doorBay: number; parade: MascotKind[][] }
const at = (f: Face, s: number, d: number): P2 => [f.o[0] + f.u[0] * s + f.n[0] * d, f.o[1] + f.u[1] * s + f.n[1] * d];

export const NintendoModule: HeroModule = {
  id: 'nintendo',
  excludeOsmIds: [],
  async build(ctx: HeroContext) {
    const { world, group } = ctx; const col = world.collision; const nf = ctx.nightFactor();
    group.name = 'nintendo-sf';
    const exterior = new THREE.Group(); exterior.name = 'exterior'; group.add(exterior);
    const interior = new THREE.Group(); interior.name = 'interior'; interior.userData.interior = true; group.add(interior);
    const interactables: Interactable[] = []; const reg = ctx.registerInteractable.bind(ctx); ctx = { ...ctx, registerInteractable: (i) => { interactables.push(i); reg(i); } };
    (window as any).__nintendo = { interactables, group, exterior, interior };

    // ---------- site: exact Westin footprint corner ----------
    const info = world.buildings.infos.get(WESTIN_ID) ?? [...world.buildings.infos.values()].find((i) => /Francis/.test(i.name));
    const fp: P2[] = info?.footprint ?? [[-83.78, 41.45], [-83.66, -42.45], [-176, -42.7], [-167.3, 41.2]];
    let corner: P2 = fp[0]; for (const p of fp) if (Math.hypot(p[0] + 83.5, p[1] - 41.5) < Math.hypot(corner[0] + 83.5, corner[1] - 41.5)) corner = p;
    const X1 = corner[0], Z1 = corner[1], X0 = X1 - GEARY_M, Z0 = Z1 - POWELL_M;   // store box (x east, z south)
    const CX = (X0 + X1) / 2, CZ = (Z0 + Z1) / 2;
    const bayW = (L: number, n: number) => (L - (n + 1) * PIER) / n;
    const faces: Face[] = [
      { name: 'powell', o: [X1, Z1], u: [0, -1], n: [1, 0], L: POWELL_M, rotN: Math.PI / 2, nBays: 3, doorBay: 1, parade: [['mario', 'luigi', 'toad', 'yoshi'], [], ['link', 'isabelle', 'kirby', 'inkling']] },
      { name: 'geary', o: [X1, Z1], u: [-1, 0], n: [0, 1], L: GEARY_M, rotN: 0, nBays: 4, doorBay: 1, parade: [['dk', 'toad', 'mario', 'pikmin'], [], ['yoshi', 'luigi', 'kirby', 'isabelle'], ['link', 'inkling', 'mario', 'toad']] },
    ];
    const doorS = (f: Face) => { const w = bayW(f.L, f.nBays); return PIER + f.doorBay * (w + PIER) + w / 2; };
    const powellDoor = at(faces[0], doorS(faces[0]), 0), gearyDoor = at(faces[1], doorS(faces[1]), 0);
    // levels: store floor = Powell sidewalk at the door
    const floor0 = Math.round(col.terrain(powellDoor[0] + 1.2, powellDoor[1]) * 20) / 20;
    const ceil0 = floor0 + 5.5, floor1 = floor0 - 4.0, ceil1 = floor1 + 3.5, top = floor0 + 6.0;
    const sill = floor0 + 0.5, lintel = floor0 + 4.3, doorH = 2.7, DW = 2.2;
    const baseY = info?.baseY ?? floor0 - 1;

    // (The former clip-plane carve of the Westin façade meshes was removed: the west_powell.json spec leaves the Nintendo bays
    //  as `module: "custom"` so the façade engine builds no walls there, and the carve's inverted plane constants discarded
    //  other buildings' walls at some camera pitches.)
    ctx.app.renderer.localClippingEnabled = true;

    // ---------- collision: replace the Westin footprint walls with door openings; store floors/walls ----------
    const stairTopX = X1 - 7.6, stairBotX = stairTopX - STEPS * TREAD;
    const voidX0 = stairBotX - 1.0, voidX1 = stairTopX, voidZ0 = CZ - 0.75, voidZ1 = CZ + 0.75;
    const inStore = (x: number, z: number) => x >= X0 && x <= X1 && z >= Z0 && z <= Z1;
    const inVoid = (x: number, z: number) => x >= voidX0 && x <= voidX1 && z >= voidZ0 && z <= voidZ1;
    if (info) {
      col.disabledTags.add(`bld:${info.id}`);
      const openings: { edge: number; t0: number; t1: number }[] = [];
      for (const f of faces) {
        const dc = at(f, doorS(f), 0), a: P2 = [dc[0] - f.u[0] * DW / 2, dc[1] - f.u[1] * DW / 2], b: P2 = [dc[0] + f.u[0] * DW / 2, dc[1] + f.u[1] * DW / 2];
        for (let i = 0; i < fp.length; i++) {
          const p = fp[i], q = fp[(i + 1) % fp.length];
          const c = segClosest(dc[0], dc[1], p, q); if (Math.hypot(c.x - dc[0], c.z - dc[1]) > 0.6) continue;
          const ta = segClosest(a[0], a[1], p, q).t, tb = segClosest(b[0], b[1], p, q).t;
          const t0 = Math.min(ta, tb), t1 = Math.max(ta, tb); if (t1 - t0 > 1e-4) openings.push({ edge: i, t0, t1 });
        }
      }
      col.addPolygon(fp, info.baseY, info.topY, 'westin-walls', openings);
    }
    // sink the visual terrain mesh under the store (the block interior sits above the shop floor)
    { const tg = world.terrain.mesh.geometry; const pos = tg.getAttribute('position') as THREE.BufferAttribute; let n = 0;
      for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); if (x > X0 + 0.05 && x < X1 - 0.05 && z > Z0 + 0.05 && z < Z1 - 0.05) { pos.setY(i, floor1 - 1.5); n++; } }
      if (n) { pos.needsUpdate = true; tg.computeBoundingSphere(); tg.computeBoundingBox(); } }
    const prevTerrain = col.terrain;
    col.terrain = (x, z) => (inStore(x, z) ? (inVoid(x, z) ? floor1 : floor0) : prevTerrain(x, z));
    const l0Rects: P2[][] = [rect(X0, voidX0, Z0, Z1), rect(voidX1, X1, Z0, Z1), rect(voidX0, voidX1, Z0, voidZ0), rect(voidX0, voidX1, voidZ1, Z1)];
    for (const r of l0Rects) col.addFlatPatch(r, floor0, 'nintendo-l0');
    col.addFlatPatch(rect(X0, X1, Z0, Z1), floor1, 'nintendo-l1');
    col.addRampPatch(rect(voidX0, stairTopX + 0.3, voidZ0, voidZ1), [stairTopX, CZ], floor0, [stairBotX, CZ], floor1, 'nintendo-stair');
    const W = (ax: number, az: number, bx: number, bz: number, y0: number, y1: number) => col.addWall({ ax, az, bx, bz, y0, y1, tag: 'nintendo-walls' });
    W(X0, Z0, X1, Z0, floor1 - 1, ceil0); W(X0, Z1, X0, Z0, floor1 - 1, ceil0);                 // north + west party walls (both levels)
    W(X1, Z0, X1, Z1, floor1 - 1, ceil1 - 0.2); W(X1, Z1, X0, Z1, floor1 - 1, ceil1 - 0.2);     // lower level east/south (windowless)
    W(voidX0, voidZ0, voidX1, voidZ0, floor0 - 0.2, floor0 + 1.2); W(voidX0, voidZ1, voidX1, voidZ1, floor0 - 0.2, floor0 + 1.2); W(voidX0, voidZ0, voidX0, voidZ1, floor0 - 0.2, floor0 + 1.2); // void balustrade
    W(stairBotX, CZ - 0.7, stairTopX, CZ - 0.7, floor1 - 1, ceil0); W(stairBotX, CZ + 0.7, stairTopX, CZ + 0.7, floor1 - 1, ceil0); // stair flanks
    W(stairTopX, CZ - 0.7, stairTopX, CZ + 0.7, floor1 - 1, floor1 + 1.2);                                                          // stair mass, lower level side

    // ---------- materials ----------
    const sandstone = Materials.get('sandstone'), darkStone = Materials.get('granite_dark'), brass = Materials.get('brass'), glass = Materials.get('glass_clear');
    const white = Materials.get('plaster_white'), ceilingMat = Materials.get('ceiling_white'), woodLight = Materials.get('wood_light'), fabricRed = Materials.get('fabric_red');
    const emissiveWhite = Materials.get('emissive_white'), emissiveWarm = Materials.get('emissive_warm');
    const transom = std({ color: 0x2a2320, roughness: 0.85, metalness: 0.15 }, 'transom_dark');
    const groove = std({ color: 0x4a4436, roughness: 1 }, 'groove');
    const red = std({ color: 0xe60012, roughness: 0.45 }, 'nintendo_red');
    const redGlow = std({ color: 0xe60012, emissive: 0xe60012, roughness: 0.4 }, 'nintendo_red_glow'); track(redGlow, 0.12, 1.1, nf);
    const mint = std({ color: 0x9fdc8f, roughness: 0.8 }, 'ac_mint'), pinkK = std({ color: 0xf7b8cf, roughness: 0.8 }, 'kirby_pink'), zeldaGreen = std({ color: 0x1f4a2c, roughness: 0.8 }, 'zelda_green');
    const hwDark = std({ color: 0x2a2a2e, roughness: 0.6 }, 'hw_dark'), jungle = std({ color: 0x5a3a1e, roughness: 0.85 }, 'dk_brown');
    const gold = std({ color: 0xf0c64a, metalness: 0.7, roughness: 0.3, emissive: 0xb08a20 }, 'triforce_gold'); track(gold, 0.35, 1.0, nf);
    const coinMat = std({ color: 0xffd24a, metalness: 0.8, roughness: 0.25, emissive: 0xffb000, emissiveIntensity: 0.5 }, 'coin');

    // ---------- storefront (Level 3) → `exterior` ----------
    const batch = new Batch();                 // stone / brass / glass frames (cast + receive)
    const canopy = new Batch(true, false);     // awning tops + fascia signs (cast only, as the original individual meshes)
    const sign = makeLogoSign('nintendo', 2.4, 1.07, { bg: '#e60012', color: '#ffffff', illuminated: true, nightIntensity: 2.4 }); // one night-tracked material, both faces
    const shell = new Batch();                 // interior walls, accents, stairs, floors (cast + receive) — declared here for the soffit
    const doors: { grp: THREE.Group; e: THREE.Vector2; inward: THREE.Vector2; centre: THREE.Vector3; open: number; forcedUntil: number }[] = [];
    const vinyls: (ParadeSpec & { x: number; y: number; z: number; rotY: number })[] = [];
    for (const f of faces) {
      const bw = bayW(f.L, f.nBays);
      const tAt = (s: number, d = 1.0) => { const p = at(f, s, d); return col.terrain(p[0], p[1]); };
      const plinthBot = Math.min(tAt(0.5), tAt(f.L / 2), tAt(f.L - 0.5)) - 0.6;
      const rotBox = f.rotN; // box local z -> outward normal
      const B = (w: number, h: number, depth: number, s: number, y: number, d: number, mat: THREE.Material) => { const p = at(f, s, d); batch.add(mat, boxGeo(w, h, depth, p[0], y, p[1], rotBox)); };
      const localX = new THREE.Vector2(Math.cos(f.rotN), -Math.sin(f.rotN)); const uDotLx = Math.sign(localX.x * f.u[0] + localX.y * f.u[1]) || 1;
      // fascia band + string course + plinth-level grooves
      B(f.L, top - lintel, 0.5, f.L / 2, (lintel + top) / 2, -0.1, sandstone);
      B(f.L + 0.4, 0.28, 0.8, f.L / 2, top - 0.14, 0.0, sandstone);
      { const p = at(f, f.L / 2, -0.5); shell.add(white, boxGeo(f.L + 0.3, ceil0 - lintel + 0.4, 0.3, p[0], (ceil0 + lintel) / 2, p[1], rotBox)); }   // white interior soffit over the glazing (interior group)
      for (const gy of [lintel + 0.55, lintel + 1.1]) B(f.L, 0.05, 0.02, f.L / 2, gy, PROUD + 0.005, groove);
      for (let i = 0; i < f.nBays; i++) {
        const s0 = PIER + i * (bw + PIER), s1 = s0 + bw, sc = (s0 + s1) / 2, isDoor = i === f.doorBay;
        // pier after this bay (the corner pier is a shared block, the end pier closes the frontage)
        const ps = s1 + PIER / 2;
        B(PIER, top - plinthBot, 0.5, ps, (top + plinthBot) / 2, -0.1, sandstone);
        for (let gy = floor0 + 0.25; gy < lintel - 0.2; gy += 0.5) B(PIER + 0.02, 0.05, 0.02, ps, gy, PROUD + 0.005, groove);
        // brass frame: posts + head
        B(0.1, lintel - floor0 + 0.05, 0.12, s0 + 0.05, (lintel + floor0) / 2, 0.08, brass); B(0.1, lintel - floor0 + 0.05, 0.12, s1 - 0.05, (lintel + floor0) / 2, 0.08, brass);
        B(bw, 0.1, 0.12, sc, lintel - 0.05, 0.08, brass);
        if (!isDoor) {
          B(bw + 0.02, sill - plinthBot, 0.5, sc, (sill + plinthBot) / 2, -0.1, darkStone);
          B(bw, 0.07, 0.12, sc, sill + 0.035, 0.08, brass);
          const p = at(f, sc, 0.12); batch.add(glass, planeGeo(bw - 0.12, lintel - sill - 0.1, p[0], (lintel + sill) / 2, p[1], f.rotN));
          // window vinyl parade marching toward the door (all bays painted into one atlas below)
          const kinds = f.parade[i].length ? f.parade[i] : PARADE.slice(0, 4);
          const dir = ((sc < doorS(f) ? 1 : -1) * uDotLx) as 1 | -1;
          const pv = at(f, sc, 0.09); vinyls.push({ widthM: bw - 0.2, heightM: lintel - sill - 0.2, kinds, dir, x: pv[0], y: (lintel + sill) / 2, z: pv[1], rotY: f.rotN });
          // flat red awning (existing Westin awnings, 1.2 m projection) + two under-awning downlights
          const pitch = Math.atan2(0.35, 1.2);
          const pa = at(f, sc, PROUD + 0.6); const ag = new THREE.BoxGeometry(bw - 0.08, 0.04, 1.25); ag.applyMatrix4(xform([pa[0], floor0 + 3.175, pa[1]], f.rotN, pitch)); canopy.add(fabricRed, ag);
          B(bw - 0.08, 0.28, 0.03, sc, floor0 + 3.0 - 0.14, PROUD + 1.18, fabricRed);
          B(0.05, 0.08, 0.05, s0 + 0.04, floor0 + 3.02, PROUD + 1.16, brass); B(0.05, 0.08, 0.05, s1 - 0.04, floor0 + 3.02, PROUD + 1.16, brass);
          for (const ds of [sc - bw * 0.25, sc + bw * 0.25]) B(0.14, 0.05, 0.14, ds, floor0 + 3.1, PROUD + 0.7, emissiveWarm);
        } else {
          // entrance: brass double doors + sidelights + dark transom panel with the illuminated Nintendo fascia sign
          const sw = (bw - DW) / 2;
          for (const ss of [s0 + sw / 2, s1 - sw / 2]) { const p = at(f, ss, 0.1); batch.add(glass, planeGeo(sw - 0.1, doorH - 0.1, p[0], floor0 + doorH / 2, p[1], f.rotN)); }
          B(0.1, doorH, 0.12, sc - DW / 2 - 0.05, floor0 + doorH / 2, 0.08, brass); B(0.1, doorH, 0.12, sc + DW / 2 + 0.05, floor0 + doorH / 2, 0.08, brass);
          B(bw, 0.12, 0.14, sc, floor0 + doorH + 0.06, 0.08, brass);
          B(bw, lintel - floor0 - doorH - 0.12, 0.14, sc, (lintel + floor0 + doorH + 0.12) / 2, 0.06, transom);
          const swalk = tAt(sc, 0.9); if (floor0 - swalk > 0.04) B(DW + 0.8, floor0 - swalk + 0.02, 0.8, sc, swalk + (floor0 - swalk) / 2, PROUD + 0.4, Materials.get('granite_grey'));
          // sign box: red-glow sides + logo front face (face group 4 = +z = outward), merged with the other face's sign
          const sp = at(f, sc, PROUD + 0.12); const sg = new THREE.BoxGeometry(2.4, 1.07, 0.22); const sm = xform([sp[0], floor0 + 3.3 + 0.535, sp[1]], f.rotN);
          for (const gr of sg.groups) canopy.add(gr.materialIndex === 4 ? sign.material : redGlow, norm(sg, sm, gr));
          // door leaves (hinged at the jambs, swing inward) — animated, so they stay individual meshes
          const inward = new THREE.Vector2(-f.n[0], -f.n[1]);
          for (const side of [-1, 1]) {
            const hinge = at(f, sc + side * DW / 2, 0.0); const e = new THREE.Vector2(-side * f.u[0], -side * f.u[1]);
            const leaf = new THREE.Group(); leaf.position.set(hinge[0], floor0, hinge[1]); leaf.name = `door:${f.name}`;
            const lw = DW / 2 - 0.02, lb = new Batch();
            lb.add(brass, boxGeo(0.06, doorH, 0.06, 0.03, doorH / 2, 0)); lb.add(brass, boxGeo(0.06, doorH, 0.06, lw - 0.03, doorH / 2, 0));
            lb.add(brass, boxGeo(lw, 0.08, 0.06, lw / 2, doorH - 0.04, 0)); lb.add(brass, boxGeo(lw, 0.25, 0.06, lw / 2, 0.125, 0)); lb.add(brass, boxGeo(lw - 0.2, 0.035, 0.035, lw / 2, 1.0, 0.05));
            lb.add(glass, planeGeo(lw - 0.12, doorH - 0.4, lw / 2, doorH / 2 + 0.08, 0, 0));
            lb.flush(leaf, 'door');
            exterior.add(leaf);
            doors.push({ grp: leaf, e, inward, centre: new THREE.Vector3(at(f, sc, 0)[0], floor0 + 1.0, at(f, sc, 0)[1]), open: 0, forcedUntil: 0 });
          }
          ctx.registerInteractable({ id: `nintendo-door-${f.name}`, label: `${f.name === 'powell' ? 'Powell St' : 'Geary St'} entrance`, hint: 'Press E to open the doors', position: new THREE.Vector3(at(f, sc, 0.8)[0], floor0 + 1.2, at(f, sc, 0.8)[1]), radius: 3.5, onActivate: () => { for (const d of doors.slice(-2)) d.forcedUntil = performance.now() / 1000 + 6; toast('Welcome to Nintendo SAN FRANCISCO'); } });
        }
      }
      // "Nintendo SAN FRANCISCO" red square panel inside the Powell window north of the entrance (window display → exterior)
      if (f.name === 'powell') {
        const s3 = PIER + 2 * (bw + PIER) + bw / 2; const pp = at(f, s3, -0.75);
        const pm = std({ map: sfPanelTexture(), emissive: 0xffffff, roughness: 0.5 }, 'sf_panel'); (pm as any).emissiveMap = pm.map; track(pm, 0.25, 1.6, nf);
        const panel = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 0.08), [red, red, red, red, pm, red]); panel.position.set(pp[0], floor0 + 1.5 + 0.6, pp[1]); panel.rotation.y = f.rotN; panel.name = 'sf-panel'; exterior.add(panel);
        batch.add(darkStone, boxGeo(0.5, 1.5, 0.5, pp[0] - 0.02, floor0 + 0.75, pp[1]));
      }
    }
    // shared corner block (rusticated pier wrapping the corner)
    {
      const s = PIER + PROUD, cx = X1 + (PROUD - PIER) / 2, cz = Z1 + (PROUD - PIER) / 2; const pb = col.terrain(X1 + 1, Z1 + 1) - 0.6;
      batch.add(sandstone, boxGeo(s, top - pb, s, cx, (top + pb) / 2, cz));
      for (let gy = floor0 + 0.25; gy < lintel + 1.3; gy += 0.5) { batch.add(groove, boxGeo(0.02, 0.05, s + 0.02, X1 + PROUD + 0.005, gy, cz)); batch.add(groove, boxGeo(s + 0.02, 0.05, 0.02, cx, gy, Z1 + PROUD + 0.005)); }
    }
    { // window vinyls: one atlas texture (each parade at its original pixel size) → one transparent mesh
      const atlas = paradeAtlas(vinyls);
      const vm = std({ map: atlas.texture, transparent: true, alphaTest: 0.05, depthWrite: false, side: THREE.DoubleSide, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, 'vinyl');
      const geos = vinyls.map((v, i) => { const [u0, v0, u1, v1] = atlas.rects[i]; const g = new THREE.PlaneGeometry(v.widthM, v.heightM); const uv = g.getAttribute('uv') as THREE.BufferAttribute; for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0)); g.rotateY(v.rotY); g.translate(v.x, v.y, v.z); return g; });
      const vinyl = new THREE.Mesh(mergeGeometries(geos, false)!, vm); vinyl.renderOrder = 2; vinyl.name = 'vinyl'; exterior.add(vinyl);
    }
    batch.flush(exterior, 'storefront'); canopy.flush(exterior, 'canopy');

    // ---------- interior shell → `interior` ----------
    const storeRect = rect(X0, X1, Z0, Z1);
    const soft = new Batch(false, true);       // ceilings, ceiling light panels, balustrades (receive only)
    const decor = new Batch(false, false);     // unlit-by-shadow decor: labels, splat wall, triforce, logo, planter
    for (const r of l0Rects) shell.add(woodLight, slab(r, floor0, 0.5, woodLight).geometry);
    shell.add(Materials.get('terrazzo'), slab(storeRect, floor1, 0.3, Materials.get('terrazzo')).geometry);
    soft.add(ceilingMat, slab(storeRect, ceil0 + 0.3, 0.3, ceilingMat).geometry);
    for (const r of l0Rects) soft.add(ceilingMat, slab(r, ceil1 - 0.02, 0.02, ceilingMat).geometry);
    const wallH = ceil0 - floor1 + 0.8, wallY = (ceil0 + floor1) / 2;
    shell.add(white, boxGeo(X1 - X0 + 0.5, wallH, 0.25, CX, wallY, Z0 - 0.125));           // north party wall
    shell.add(white, boxGeo(0.25, wallH, Z1 - Z0 + 0.5, X0 - 0.125, wallY, CZ));            // west party wall
    shell.add(white, boxGeo(0.25, ceil1 - floor1 + 0.6, Z1 - Z0, X1 - 0.125, (ceil1 + floor1) / 2, CZ)); // lower east
    shell.add(white, boxGeo(X1 - X0, ceil1 - floor1 + 0.6, 0.25, CX, (ceil1 + floor1) / 2, Z1 - 0.125)); // lower south
    shell.add(white, boxGeo(X1 - X0 + 0.2, 0.55, 0.3, CX, floor0 - 0.25, Z0 - 0.15));       // slab edges
    // red accent bands (ground: north/west walls; lower: all four)
    for (const [w, d, x, z] of [[X1 - X0, 0.04, CX, Z0 + 0.03], [0.04, Z1 - Z0, X0 + 0.03, CZ]] as const) shell.add(red, boxGeo(w, 0.35, d, x, ceil0 - 0.9, z));
    for (const [w, d, x, z] of [[X1 - X0, 0.04, CX, Z0 + 0.03], [0.04, Z1 - Z0, X0 + 0.03, CZ], [X1 - X0, 0.04, CX, Z1 - 0.03], [0.04, Z1 - Z0, X1 - 0.03, CZ]] as const) shell.add(red, boxGeo(w, 0.3, d, x, ceil1 - 0.5, z));
    // zone accent panels
    shell.add(mint, boxGeo(10.8, 3.1, 0.04, X0 + 5.6, floor0 + 1.65, Z0 + 0.03));           // Animal Crossing (NW)
    shell.add(hwDark, boxGeo(8.6, 3.1, 0.04, X1 - 4.5, floor0 + 1.65, Z0 + 0.03));          // hardware (NE)
    shell.add(jungle, boxGeo(0.04, 3.0, 3.9, X0 + 0.03, floor0 + 1.6, Z1 - 2.25));          // Donkey Kong (SW)
    shell.add(red, boxGeo(0.04, 3.6, 5.2, X0 + 0.03, floor0 + 1.9, CZ));                   // registers backdrop (W)
    shell.add(zeldaGreen, boxGeo(0.04, 3.0, 9.0, X0 + 0.03, floor1 + 1.6, CZ));             // Zelda (lower W)
    shell.add(pinkK, boxGeo(6.0, 2.8, 0.04, X0 + 9.5, floor1 + 1.5, Z0 + 0.03));            // Kirby (lower N)
    // stair: solid box steps + glass balustrades + brass rails
    for (let i = 0; i < STEPS; i++) { const yi = floor0 - (i + 1) * RISE, x = stairTopX - (i + 0.5) * TREAD; shell.add(woodLight, boxGeo(TREAD, yi - floor1, STAIR_W, x, (yi + floor1) / 2, CZ)); }
    const balH = 1.1;
    const balGlass = (ax: number, az: number, bx: number, bz: number, y0: number, y1: number) => { const len = Math.hypot(bx - ax, bz - az); soft.add(glass, planeGeo(len, y1 - y0, (ax + bx) / 2, (y0 + y1) / 2, (az + bz) / 2, Math.atan2(-(bz - az), bx - ax))); soft.add(brass, boxGeo(len, 0.05, 0.05, (ax + bx) / 2, y1 + 0.025, (az + bz) / 2, Math.atan2(-(bz - az), bx - ax))); };
    balGlass(voidX0, voidZ0, voidX1, voidZ0, floor0, floor0 + balH); balGlass(voidX0, voidZ1, voidX1, voidZ1, floor0, floor0 + balH); balGlass(voidX0, voidZ0, voidX0, voidZ1, floor0, floor0 + balH);
    for (const zz of [CZ - STAIR_W / 2 - 0.03, CZ + STAIR_W / 2 + 0.03]) { const len = Math.hypot(STEPS * TREAD, 4.0), ang = Math.atan2(4.0, STEPS * TREAD); const g = new THREE.PlaneGeometry(len, balH); g.rotateZ(ang); g.translate((stairTopX + stairBotX) / 2, (floor0 + floor1) / 2 + balH / 2 - 0.05, zz); soft.add(glass, g); const r = new THREE.BoxGeometry(len, 0.05, 0.05); r.rotateZ(ang); r.translate((stairTopX + stairBotX) / 2, (floor0 + floor1) / 2 + balH, zz); soft.add(brass, r); }
    // emissive ceiling panels
    for (let ix = 0; ix < 4; ix++) for (let iz = 0; iz < 3; iz++) soft.add(emissiveWhite, boxGeo(1.4, 0.04, 0.7, X0 + 2.8 + ix * 5.2, ceil0 - 0.03, Z0 + 2.3 + iz * 4.8));
    for (let ix = 0; ix < 4; ix++) for (let iz = 0; iz < 2; iz++) soft.add(emissiveWhite, boxGeo(1.4, 0.04, 0.7, X0 + 2.8 + ix * 5.2, ceil1 - 0.03, Z0 + 3.5 + iz * 7.0));
    // zone labels: collected, then painted into one atlas so all share a single material/mesh
    const labels: { text: string; bg: string; x: number; y: number; z: number; rotY: number; w: number; twoSided: boolean }[] = [];
    const label = (text: string, bg: string, x: number, y: number, z: number, rotY: number, w = 3.2, twoSided = false) => labels.push({ text, bg, x, y, z, rotY, w, twoSided });
    label('ANIMAL CROSSING', '#7ACB6C', X0 + 5.6, floor0 + 3.55, Z0 + 0.06, 0, 4.0); label('NINTENDO SWITCH 2', '#1a1a1a', X1 - 4.5, floor0 + 3.55, Z0 + 0.06, 0, 4.0);
    label('DONKEY KONG', '#8B4513', X0 + 0.06, floor0 + 3.45, Z1 - 2.25, Math.PI / 2, 3.0); label('SUPER MARIO', '#E4000F', X1 - 11.0, ceil0 - 1.3, Z1 - 3.6, 0, 3.6, true);
    label('THE LEGEND OF ZELDA', '#1f4a2c', X0 + 0.06, floor1 + 3.25, CZ, Math.PI / 2, 4.0); label('KIRBY', '#e8748f', X0 + 9.5, floor1 + 3.05, Z0 + 0.06, 0, 2.4);
    label('amiibo', '#ffffff', X0 + 10.9, floor1 + 2.9, Z1 - 0.06, Math.PI, 3.0); label('SPLATOON', '#1a1a1a', X1 - 3.4, floor1 + 3.05, Z0 + 0.06, 0, 3.0);
    decor.add(std({ map: splatTexture(), roughness: 0.8 }, 'splat'), planeGeo(6.2, 3.0, X1 - 3.4, floor1 + 1.5, Z0 + 0.05, 0));
    { // triforce on the Zelda wall
      const s = 0.55, sh = new THREE.Shape(); const tri = (cx: number, cy: number) => { sh.moveTo(cx, cy + s); sh.lineTo(cx - s * 0.87, cy - s / 2); sh.lineTo(cx + s * 0.87, cy - s / 2); sh.closePath(); };
      tri(0, s); tri(-s * 0.87, -s / 2); tri(s * 0.87, -s / 2);
      const g = new THREE.ShapeGeometry(sh); g.rotateY(Math.PI / 2); g.translate(X0 + 0.07, floor1 + 1.75, CZ); decor.add(gold, g);
    }
    { // registers backdrop logo
      const r = makeLogoSign('nintendo', 1.9, 0.6, { bg: '#e60012', color: '#ffffff', illuminated: true, nightIntensity: 1.6 });
      decor.add(r.material, planeGeo(1.9, 0.6, X0 + 0.07, floor0 + 3.25, CZ, Math.PI / 2));
    }

    // ---------- lighting (interiors stay bright at night) ----------
    // Point lights live on the module group, not on `interior`: toggling lights would change the scene light count and force
    // every material to recompile its shader program when the 70 m interior boundary is crossed.
    const pls: THREE.PointLight[] = [];
    for (const [x, y, z, base] of [[X1 - 5.5, ceil0 - 1.0, CZ, 70], [X0 + 5.5, ceil0 - 1.0, CZ, 70], [X1 - 5.5, ceil1 - 0.7, CZ, 60], [X0 + 5.5, ceil1 - 0.7, CZ, 60]]) {
      const l = new THREE.PointLight(0xfff4e6, base, 24, 2); l.position.set(x, y, z); l.userData.base = base; group.add(l); pls.push(l);
    }

    // ---------- fixtures & characters ----------
    // 'static' fixtures are baked into the per-material batch, 'instanced' ones share one InstancedMesh set per GLB and 'live'
    // ones stay individual clones (animated / interactive). Collision uses the manifest footprint at the placement transform,
    // so it is identical for all three modes; the returned object sits at the fixture transform (used as screen parent / interactable object).
    const fixtures = new Batch();
    const insts = new Map<string, Promise<InstancedModel | null>>();   // promise cached: placements run concurrently, one InstancedModel per GLB
    const fallback = (key: string) => { const g = new THREE.Group(); const e = Assets.manifest[key]; const [w, d] = e?.footprint ?? [1, 1]; const m = new THREE.Mesh(new THREE.BoxGeometry(w, e?.height ?? 1, d), Materials.get('plastic_white')); m.position.y = (e?.height ?? 1) / 2; g.add(m); return g; };
    const put = async (rel: string, x: number, z: number, y: number, rotY = 0, collide = true, mode: 'static' | 'instanced' | 'live' = 'static', tag = 'nintendo-fx'): Promise<THREE.Group> => {
      const key = `retail/${rel}`;
      if (collide) { const e = Assets.manifest[key]; const [w, d] = e?.footprint ?? [1, 1]; col.addBox(x, z, w, d, y, y + (e?.height ?? 1), rotY, tag); }
      const holder = () => { const h = new THREE.Group(); h.position.set(x, y, z); h.rotation.y = rotY; h.name = rel; interior.add(h); return h; };
      if (mode === 'instanced') {
        let p = insts.get(rel);
        // prototype merged to one mesh per material first (a GLB may split one material over several meshes), then instanced
        if (!p) { p = Assets.load(key).then((proto) => { const merged = new THREE.Group(); const b = new Batch(); b.bake(proto); b.flush(merged, rel); const im = new InstancedModel(merged, INSTANCED[rel] ?? 8); im.group.name = `instanced:${rel}`; interior.add(im.group); return im; }, () => null); insts.set(rel, p); } // null → GLB missing → static fallback box below
        const im = await p;
        if (im && im.add([x, y, z], rotY) >= 0) return holder();
      }
      let g: THREE.Group; try { g = await Assets.instance(key); } catch { g = fallback(key); }
      g.position.set(x, y, z); g.rotation.y = rotY; g.name = rel;
      if (mode === 'live') { interior.add(g); return g; }
      fixtures.bake(g); return holder();
    };
    const statue = async (rel: string, x: number, z: number, y: number, rotY: number, mode: 'static' | 'live' = 'static') => { await put('nintendo_pedestal_statue', x, z, y, rotY); return put(rel, x, z, y + 0.5, rotY, false, mode); };
    const gameWall = new GameWall(), kiosk = new KioskScreen();
    const kioskScreenMat = std({ map: kiosk.texture, emissive: 0xffffff, emissiveMap: kiosk.texture, emissiveIntensity: 0.9, roughness: 0.4, color: 0x333333 }, 'kiosk_screen');
    const screens = new Batch(false, false);   // every kiosk screen shows the one shared live canvas → a single mesh
    const demoKiosk = async (x: number, z: number, y: number, rotY: number, id: string) => {
      const g = await put('nintendo_demo_kiosk', x, z, y, rotY, true, 'instanced');
      const sg = new THREE.PlaneGeometry(0.56, 0.315); sg.applyMatrix4(xform([0, 1.12, 0.2], 0, -0.45)); sg.applyMatrix4(xform([x, y, z], rotY)); screens.add(kioskScreenMat, sg);
      ctx.registerInteractable({ id, label: 'Switch 2 demo kiosk', hint: 'Press E to play a demo', position: new THREE.Vector3(x, y + 1.0, z), radius: 3.2, object: g, onActivate: () => { kiosk.play(); toast('Demo started: Mario Kart World (5 s)'); } });
    };
    const jobs: Promise<unknown>[] = [];
    // -- ground floor
    const dz = powellDoor[1];
    jobs.push((async () => { const g = await statue('char_mario', X1 - 2.7, Z1 - 2.9, floor0, Math.atan2(1, -0.55), 'live'); ctx.registerInteractable({ id: 'nintendo-mario-statue', label: 'Mario statue (photo spot)', hint: 'Press E for a photo with Mario', position: new THREE.Vector3(X1 - 2.7, floor0 + 1.2, Z1 - 2.9), radius: 3.0, object: g, onActivate: () => toast('Photo spot: say cheese with Mario! (camera shutter)') }); })());
    let plushCount = 0; const plushInter: Interactable = { id: 'nintendo-plush-bin', label: 'Plush bin', hint: 'Press E to grab a plush (collected: 0)', position: new THREE.Vector3(X1 - 3.0, floor0 + 0.8, Z1 - 9.2), radius: 2.4, onActivate: () => { plushCount++; plushInter.hint = `Press E to grab a plush (collected: ${plushCount})`; toast(`Souvenir collected: Mario plush (${plushCount})`); } };
    jobs.push(put('nintendo_plush_bin', X1 - 3.0, Z1 - 9.2, floor0, 0, true, 'live').then((g) => { plushInter.object = g; ctx.registerInteractable(plushInter); }));
    const gondola = (x: number, z: number, y: number, rotY = 0) => put('nintendo_gondola', x, z, y, rotY, true, 'instanced');
    const shelf = (x: number, z: number, y: number, rotY = 0) => put('nintendo_wall_shelf_3m', x, z, y, rotY, true, 'instanced');
    jobs.push(gondola(X1 - 5.5, Z1 - 8.6, floor0, Math.PI / 2), gondola(X1 - 5.5, Z1 - 3.9, floor0, Math.PI / 2));
    jobs.push(gondola(X1 - 10.3, Z1 - 1.9, floor0), gondola(X1 - 13.8, Z1 - 1.9, floor0), gondola(X1 - 12.0, Z1 - 4.6, floor0), put('nintendo_warp_pipe', X1 - 7.6, Z1 - 1.5, floor0));
    jobs.push(gondola(X0 + 2.0, Z1 - 1.9, floor0), shelf(X0 + 0.24, Z1 - 2.3, floor0, Math.PI / 2));
    jobs.push(put('nintendo_checkout', X0 + 1.2, CZ, floor0, Math.PI / 2), shelf(X0 + 0.24, CZ, floor0, Math.PI / 2));
    jobs.push(shelf(X1 - 2.0, Z0 + 0.24, floor0), shelf(X1 - 5.2, Z0 + 0.24, floor0), put('nintendo_switch2_display', X1 - 2.2, Z0 + 3.2, floor0));
    for (let i = 0; i < 4; i++) jobs.push(demoKiosk(X1 - 4.4 - i, Z0 + 3.2, floor0, 0, `nintendo-kiosk-l0-${i}`));
    jobs.push(statue('char_isabelle', X0 + 6.5, Z0 + 3.0, floor0, Math.PI / 4), gondola(X0 + 3.0, Z0 + 3.0, floor0), gondola(X0 + 9.8, Z0 + 3.2, floor0));
    jobs.push(shelf(X0 + 2.0, Z0 + 0.24, floor0), shelf(X0 + 5.2, Z0 + 0.24, floor0));
    jobs.push(put('char_toad', X0 + 8.2, Z0 + 1.0, floor0, Math.PI / 2 + 0.6, false));
    // floating ? blocks (animated → live clones)
    const blocks: { g: THREE.Group; base: THREE.Vector3; hit: number; phase: number }[] = [];
    for (let i = 0; i < 3; i++) jobs.push(put('nintendo_question_block', X1 - 9.5 - i * 1.5, Z1 - 3.6, floor0 + 2.35, 0, false, 'live').then((g) => { const b = { g, base: g.position.clone(), hit: -1, phase: i * 1.3 }; blocks.push(b); ctx.registerInteractable({ id: `nintendo-qblock-${i}`, label: '? block', hint: 'Press E to hit the block', position: g.position.clone(), radius: 3.0, object: g, onActivate: () => { b.hit = performance.now() / 1000; spawnCoin(b.base); } }); }));
    // -- lower level
    jobs.push((async () => { const g = await statue('char_link', X0 + 3.4, CZ, floor1, Math.PI / 2, 'live'); ctx.registerInteractable({ id: 'nintendo-link-statue', label: 'Link statue (photo spot)', hint: 'Press E for a photo with Link', position: new THREE.Vector3(X0 + 3.4, floor1 + 1.2, CZ), radius: 3.0, object: g, onActivate: () => toast('Photo spot: Link guards the Zelda zone') }); })());
    jobs.push(gondola(X0 + 3.0, CZ - 3.6, floor1), gondola(X0 + 3.0, CZ + 3.6, floor1), shelf(X0 + 0.24, CZ - 4.5, floor1, Math.PI / 2), shelf(X0 + 0.24, CZ + 4.5, floor1, Math.PI / 2));
    jobs.push(statue('char_kirby', X0 + 9.5, Z0 + 2.4, floor1, Math.PI * 0.75), gondola(X0 + 12.5, Z0 + 2.4, floor1), shelf(X0 + 9.5, Z0 + 0.24, floor1));
    jobs.push(gondola(X1 - 3.0, Z0 + 2.4, floor1), put('gen_mannequin', X1 - 5.5, Z0 + 1.2, floor1, 0, false));
    // Pikmin planter (centre-south of the lower level)
    { const px = CX + 1.0, pz = CZ + 2.8;
      const planter = new THREE.CylinderGeometry(0.9, 0.8, 0.5, 28); planter.translate(px, floor1 + 0.25, pz); decor.add(Materials.get('plastic_white'), planter);
      const soil = new THREE.CylinderGeometry(0.82, 0.82, 0.04, 28); soil.translate(px, floor1 + 0.51, pz); decor.add(Materials.get('soil'), soil);
      col.addBox(px, pz, 1.8, 1.8, floor1, floor1 + 0.5, 0, 'nintendo-fx');
      (['char_pikmin_red', 'char_pikmin_blue', 'char_pikmin_yellow'] as const).forEach((k, i) => { const a = i * Math.PI * 2 / 3 + 0.4; jobs.push(put(k, px + Math.cos(a) * 0.45, pz + Math.sin(a) * 0.45, floor1 + 0.53, Math.atan2(Math.cos(a), Math.sin(a)), false)); });
      label('PIKMIN', '#f5d000', px, floor1 + 0.25, pz + 0.86, 0, 1.4); }
    // game wall (east wall of the lower level) + demo kiosks + lounge sofa
    jobs.push((async () => {
      const g = await put('nintendo_led_wall', X1 - 0.45, CZ + 2.0, floor1, -Math.PI / 2);   // housing baked; the live screen plane below stays individual
      const scrMat = std({ map: gameWall.texture, emissive: 0xffffff, emissiveMap: gameWall.texture, emissiveIntensity: 1.1, roughness: 0.5, color: 0x222222 }, 'game_wall');
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 3.4), scrMat); scr.position.set(X1 - 0.45 - 0.075, floor1 + 1.85, CZ + 2.0); scr.rotation.y = -Math.PI / 2; scr.name = 'game-wall'; interior.add(scr);
      const gl = new THREE.PointLight(0x99bbff, 12, 9, 2); gl.position.set(X1 - 2.2, floor1 + 2.0, CZ + 2.0); group.add(gl); pls.push(gl); gl.userData.base = 12;
      ctx.registerInteractable({ id: 'nintendo-game-wall', label: 'Projected game wall', hint: 'Press E to change the game', position: new THREE.Vector3(X1 - 2.4, floor1 + 1.6, CZ + 2.0), radius: 4.5, object: g, onActivate: () => { gameWall.next(); toast(`Game wall: ${GAME_SCENES[gameWall.scene]}`); } });
    })());
    for (let i = 0; i < 4; i++) jobs.push(demoKiosk(X1 - 3.6, CZ - 0.3 + i * 1.3, floor1, -Math.PI / 2, `nintendo-kiosk-l1-${i}`));
    jobs.push(put('gen_hotel_lobby_sofa', X1 - 6.5, CZ + 1.7, floor1, Math.PI / 2));
    jobs.push(shelf(X1 - 8.5, Z1 - 0.24, floor1, Math.PI), shelf(X1 - 11.7, Z1 - 0.24, floor1, Math.PI), put('nintendo_demo_kiosk', X1 - 14.5, Z1 - 1.5, floor1, Math.PI, true, 'instanced'));
    await Promise.all(jobs);
    fixtures.flush(interior, 'fixtures');
    for (const p of insts.values()) (await p)?.finalize();
    screens.flush(interior, 'kiosk-screens');
    // label atlas (after every label() call, including PIKMIN)
    {
      const atlas = labelAtlas(labels.map((l) => ({ text: l.text, bg: l.bg })));
      const labelMat = std({ map: atlas.texture, roughness: 0.6, emissive: 0xffffff, emissiveMap: atlas.texture, emissiveIntensity: 0.35 }, 'label');
      labels.forEach((l, i) => {
        const [v0, v1] = atlas.rows[i];
        const mk = (rot: number) => { const g = new THREE.PlaneGeometry(l.w, l.w / 8); const uv = g.getAttribute('uv') as THREE.BufferAttribute; for (let k = 0; k < uv.count; k++) uv.setY(k, v0 + uv.getY(k) * (v1 - v0)); g.rotateY(rot); g.translate(l.x, l.y, l.z); decor.add(labelMat, g); };
        mk(l.rotY); if (l.twoSided) mk(l.rotY + Math.PI);
      });
    }
    shell.flush(interior, 'shell'); soft.flush(interior, 'soft'); decor.flush(interior, 'decor');

    // ---------- dynamics: doors, ? blocks + coins, screens, lights, interior visibility ----------
    const coins: { m: THREE.Mesh; t0: number }[] = [];
    const coinGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.03, 24); coinGeo.rotateX(Math.PI / 2);
    function spawnCoin(base: THREE.Vector3) { const m = new THREE.Mesh(coinGeo, coinMat); m.position.set(base.x, base.y + 0.95, base.z); interior.add(m); coins.push({ m, t0: performance.now() / 1000 }); }
    const cam = ctx.app.camera; const centre = new THREE.Vector3(CX, floor0, CZ);
    ctx.addUpdatable({
      update(dt: number, t: number) {
        const now = performance.now() / 1000;
        // interior is only seen through the windows when near; always drawn while the camera is inside the store footprint
        const p = cam.position; interior.visible = inStore(p.x, p.z) || p.distanceTo(centre) < INTERIOR_VIS_M;
        for (const d of doors) {
          const near = cam.position.distanceTo(d.centre) < 4.0 || d.forcedUntil > now;
          d.open += ((near ? 1 : 0) - d.open) * Math.min(1, dt * 3.5);
          const a = d.open * 1.5; const dx = d.e.x * Math.cos(a) + d.inward.x * Math.sin(a), dz = d.e.y * Math.cos(a) + d.inward.y * Math.sin(a);
          d.grp.rotation.y = Math.atan2(-dz, dx);
        }
        for (const b of blocks) {
          const bounce = b.hit >= 0 && now - b.hit < 0.35 ? Math.sin((now - b.hit) / 0.35 * Math.PI) * 0.3 : 0;
          b.g.position.set(b.base.x, b.base.y + Math.sin(t * 1.6 + b.phase) * 0.08 + bounce, b.base.z); b.g.rotation.y = t * 0.6 + b.phase;
        }
        for (let i = coins.length - 1; i >= 0; i--) { const c = coins[i], a = now - c.t0; if (a > 0.9) { interior.remove(c.m); coins.splice(i, 1); continue; } c.m.position.y += dt * 1.3; c.m.rotation.y = a * 12; (c.m.material as THREE.MeshStandardMaterial).opacity = 1; }
        gameWall.update(dt, t); kiosk.update(dt, t);
        const n = ctx.nightFactor(); for (const l of pls) l.intensity = l.userData.base * (1 + 0.8 * n);
      },
    });

    // ---------- storefront registration ----------
    const swY = prevTerrain(powellDoor[0] + 2.0, powellDoor[1]);
    ctx.registerStorefront({ id: 'nintendo', name: 'Nintendo SAN FRANCISCO', category: 'toys-games', address: '331 Powell St', position: new THREE.Vector3(powellDoor[0] + 2.0, swY, dz), facing: new THREE.Vector3(1, 0, 0), width: POWELL_M, enterable: true, status: 'open', confidence: 'high', interiorTag: 'nintendo' });
    void gearyDoor;
  },
};
