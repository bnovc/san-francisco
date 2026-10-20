// Spec-driven façade engine (LEVEL 2/3): real openings with reveals, instanced BPL modules, storefront band, signage, cornices.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Assets, InstancedModel } from '../../assets/Assets';
import { Materials } from '../../materials/Library';
import { makeTextSign, makeLogoSign, signMesh } from '../../materials/Signage';
import type { BuildingInfo } from '../Buildings';
import type { World } from '../World';
import type { StorefrontReg } from '../HeroContext';
import { FacadeSpec, EdgeSpec, StorefrontBay, WindowModule } from './FacadeSpec';
import { P2, ensureCCW } from '../../util/Geometry2D';
import { Rng } from '../../util/Rng';
import { buildingInspection, type InspectionData } from '../../inspection/InspectionData';

interface Placement { m: THREE.Matrix4; info: InspectionData }
interface GeometryPlacement { geometry: THREE.BufferGeometry; info: InspectionData }
const HEAVY = 1.2, MEDIUM = 0.6, REVEAL = 0.3, CELL = 130;

export class FacadeBuilder {
  group = new THREE.Group();
  storefronts: StorefrontReg[] = [];
  private pools = new Map<string, Placement[]>();
  private geos = new Map<string, GeometryPlacement[]>();   // key = `${cx},${cz}|${material}`
  private cellKey(x: number, z: number) { return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`; }
  private curCell = '0,0';
  private currentInspection: InspectionData | null = null;
  private signs: THREE.Object3D[] = [];
  private rng = new Rng(99);
  stats = { buildings: 0, openings: 0, modules: 0 };
  constructor(public world: World) { this.group.name = 'facades'; }

  // ---------- geometry helpers (all UVs in metres) ----------
  private quad(mat: string, p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, u0: number, v0: number, u1: number, v1: number, want?: THREE.Vector3) {
    // p0..p3 around the quad; when `want` (intended outward normal) is given the winding is oriented to face it
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u1, v0, u1, v1, u0, v1], 2));
    let flip = false;
    if (want) { const e1 = new THREE.Vector3().subVectors(p1, p0), e2 = new THREE.Vector3().subVectors(p2, p0); flip = e1.cross(e2).dot(want) < 0; }
    g.setIndex(flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    const key = `${this.curCell}|${mat}`; let arr = this.geos.get(key); if (!arr) this.geos.set(key, (arr = []));
    if (this.currentInspection) arr.push({ geometry: g, info: this.currentInspection });
  }
  /** Wall panel on an edge: u range along the edge (from a), y range; `inset` moves it inward (toward -n). */
  private panel(mat: string, a: P2, t: P2, n: P2, u0: number, u1: number, y0: number, y1: number, inset = 0) {
    if (u1 - u0 < 0.01 || y1 - y0 < 0.01) return;
    const P = (u: number, y: number) => new THREE.Vector3(a[0] + t[0] * u - n[0] * inset, y, a[1] + t[1] * u - n[1] * inset);
    this.quad(mat, P(u0, y0), P(u1, y0), P(u1, y1), P(u0, y1), u0, y0, u1, y1, new THREE.Vector3(n[0], 0, n[1]));
  }
  /** Reveal (4 inner faces) of an opening u0..u1 × y0..y1, depth d into the wall. */
  private reveal(mat: string, a: P2, t: P2, n: P2, u0: number, u1: number, y0: number, y1: number, d = REVEAL) {
    const P = (u: number, y: number, k: number) => new THREE.Vector3(a[0] + t[0] * u - n[0] * k, y, a[1] + t[1] * u - n[1] * k);
    // left jamb (faces +t), right jamb (faces -t), sill (faces up), head (faces down)
    const T = new THREE.Vector3(t[0], 0, t[1]);
    this.quad(mat, P(u0, y0, d), P(u0, y0, 0), P(u0, y1, 0), P(u0, y1, d), 0, y0, d, y1, T);
    this.quad(mat, P(u1, y0, 0), P(u1, y0, d), P(u1, y1, d), P(u1, y1, 0), 0, y0, d, y1, T.clone().negate());
    this.quad(mat, P(u0, y0, d), P(u1, y0, d), P(u1, y0, 0), P(u0, y0, 0), u0, 0, u1, d, new THREE.Vector3(0, 1, 0));
    this.quad(mat, P(u0, y1, 0), P(u1, y1, 0), P(u1, y1, d), P(u0, y1, d), u0, 0, u1, d, new THREE.Vector3(0, -1, 0));
  }
  private place(module: string, a: P2, t: P2, n: P2, u: number, y: number, sx = 1, sy = 1, sz = 1, inset = 0) {
    if (!Assets.has(`arch/${module}`) && !Assets.has(module)) return;
    const key = module.includes('/') ? module : `arch/${module}`;
    const rot = Math.atan2(n[0], n[1]);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(a[0] + t[0] * u - n[0] * inset, y, a[1] + t[1] * u - n[1] * inset), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(sx, sy, sz));
    const heavy = /\/(win_|storefront_|stringcourse|cornice|parapet|balustrade|rustication)/.test(key);
    const pk = `${heavy ? this.curCell : 'pool'}|${key}`; let arr = this.pools.get(pk); if (!arr) this.pools.set(pk, (arr = []));
    if (this.currentInspection) arr.push({ m, info: this.currentInspection });
    this.stats.modules++;
  }
  private dims(module: string): { w: number; h: number; d: number } {
    const e = Assets.manifest[module.includes('/') ? module : `arch/${module}`];
    return e ? { w: e.width || 1, h: e.height || 1, d: e.depth || 0.3 } : { w: 1, h: 1, d: 0.3 };
  }
  private isStreetFacing(mid: P2, n: P2): boolean {
    for (const k of [4, 8, 12]) { const x = mid[0] + n[0] * k, z = mid[1] + n[1] * k; if (this.world.isRoad(x, z) || this.world.isSidewalk(x, z)) return true; }
    return false;
  }

  // ---------- main ----------
  build(info: BuildingInfo, spec: FacadeSpec) {
    const previousInspection = this.currentInspection;
    this.currentInspection = buildingInspection(info);
    const fp = ensureCCW(info.footprint);
    { let cx = 0, cz = 0; for (const q of fp) { cx += q[0]; cz += q[1]; } this.curCell = this.cellKey(cx / fp.length, cz / fp.length); }
    const baseY = info.baseY, top = spec.heightM ? baseY + spec.heightM : info.topY;
    const corniceH = spec.cornice === 'heavy' ? HEAVY : spec.cornice === 'medium' ? MEDIUM : 0;
    // Ground-floor datum: the level floor sits at the HIGHEST street-facing sidewalk (SF slopes); lower edges get a taller ground band.
    const edgeFacing: boolean[] = [];
    let frontLevel = -Infinity;
    for (let i = 0; i < fp.length; i++) {
      const a = fp[i], b = fp[(i + 1) % fp.length]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 0.3) { edgeFacing.push(false); continue; }
      const t: P2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], n: P2 = [t[1], -t[0]]; const mid: P2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const f = this.isStreetFacing(mid, n); edgeFacing.push(f);
      if (f) for (const k of [0.15, 0.5, 0.85]) frontLevel = Math.max(frontLevel, this.world.terrain.heightAt(a[0] + (b[0] - a[0]) * k + n[0] * 2.5, a[1] + (b[1] - a[1]) * k + n[1] * 2.5) + 0.15);
    }
    if (!Number.isFinite(frontLevel)) frontLevel = baseY + 0.3;
    const groundLevel = (spec as any).groundLevelY ?? Math.max(baseY, Math.min(frontLevel, top - 3));
    const groundH = Math.min(spec.groundH ?? 5.5, top - groundLevel - 0.5);
    const groundTop = groundLevel + groundH;
    const upperH = Math.max(0, top - groundTop - corniceH);
    const floorHTarget = spec.floorH ?? info.floorH;
    let nFloors = spec.floors ?? Math.max(0, Math.round(upperH / floorHTarget));
    const floorH = nFloors > 0 ? upperH / nFloors : 0;
    const wallMat = spec.wall, baseMat = spec.base?.material ?? spec.wall, baseH = Math.min(spec.base?.height ?? groundH, top - groundLevel);
    const streetEdges: number[] = [];
    for (let i = 0; i < fp.length; i++) {
      const a = fp[i], b = fp[(i + 1) % fp.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 0.3) continue;
      const t: P2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], n: P2 = [t[1], -t[0]];
      const facing = edgeFacing[i];
      const es = spec.edges.find((e) => e.edge === i) ?? (facing ? spec.edges.find((e) => e.edge === 'street') : undefined);
      if ((spec as any).debug) console.log('[facade]', info.name, 'edge', i, 'len', len.toFixed(1), 'facing', facing, 'es', !!es, 'nFloors', nFloors, 'groundLevel', groundLevel.toFixed(2), 'top', top.toFixed(2), 'bays', (spec.storefronts || []).filter((q) => q.edge === i).length);
      if (!es || es.detail === false || len < 2.5 || nFloors === 0) {
        // plain wall (base band + upper wall)
        this.panel(baseMat, a, t, n, 0, len, baseY - 0.5, Math.min(groundLevel + baseH, top));
        if (top > groundLevel + baseH) this.panel(wallMat, a, t, n, 0, len, groundLevel + baseH, top);
        continue;
      }
      if (facing) streetEdges.push(i);
      this.detailEdge(info, spec, es, i, a, b, len, t, n, baseY, groundLevel, top, groundH, floorH, nFloors, corniceH, wallMat, baseMat, baseH);
    }
    // façade-mounted signs (rooftop logotypes, parapet letters, mid-height brand signs)
    for (const sg of spec.signs || []) {
      const a = fp[sg.edge], b = fp[(sg.edge + 1) % fp.length]; if (!a || !b) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const t: P2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], n: P2 = [t[1], -t[0]];
      const res = sg.brand ? makeLogoSign(sg.brand, sg.widthM, sg.heightM, { illuminated: sg.illuminated, bg: sg.bg === undefined ? null : sg.bg }) : makeTextSign({ text: sg.text || '', widthM: sg.widthM, heightM: sg.heightM, color: sg.color ?? '#f2f2f2', bg: sg.bg === undefined ? null : sg.bg, illuminated: sg.illuminated, letterSpacing: sg.letterSpacing ?? 2, uppercase: false });
      const mesh = signMesh(res, 0.1); const out = sg.out ?? 0.12;
      mesh.position.set(a[0] + t[0] * sg.at + n[0] * out, groundLevel + sg.y, a[1] + t[1] * sg.at + n[1] * out); mesh.rotation.y = Math.atan2(n[0], n[1]);
      mesh.userData.inspection = buildingInspection(info);
      this.group.add(mesh); this.signs.push(mesh);
    }
    // roof slab + parapet/cornice top + rooftop props
    this.roof(fp, top, spec);
    for (const m of spec.masses || []) this.mass(info, spec, m);
    this.stats.buildings++;
    this.currentInspection = previousInspection;
  }

  private detailEdge(info: BuildingInfo, spec: FacadeSpec, es: EdgeSpec, edgeIdx: number, a: P2, b: P2, len: number, t: P2, n: P2, baseY: number, groundLevel: number, top: number, groundH: number, floorH: number, nFloors: number, corniceH: number, wallMat: string, baseMat: string, baseH: number) {
    const endPad = es.endPad ?? 0.8;
    // ---- ground band: openings start at the LOCAL sidewalk level (stepped along sloping streets), fascia top is the common ground-floor datum ----
    const groundTop = groundLevel + groundH, fasciaH = 0.9, openingTop = groundTop - fasciaH;
    const explicitGround = (spec as any).groundLevelY !== undefined;
    const sidewalkAt = (u: number) => explicitGround ? groundLevel : Math.min(groundLevel, this.world.terrain.heightAt(a[0] + t[0] * u + n[0] * 2.5, a[1] + t[1] * u + n[1] * 2.5) + 0.12);
    const bays = (spec.storefronts || []).filter((s) => s.edge === edgeIdx).sort((p, q) => p.from - q.from);
    const filled: [number, number][] = [];
    const defaultMod = es.storefront ?? 'storefront_bay_3.0x4.5';
    const solid = (u0: number, u1: number) => { if (u1 - u0 > 0.02) this.panel(baseMat, a, t, n, u0, u1, baseY - 0.5, groundTop); };
    const tileGap = (u0: number, u1: number) => {
      if (defaultMod === 'wall' || u1 - u0 < 2.4) { solid(u0, u1); return; }
      // split long gaps so the band can step down along a slope
      const drop = Math.abs(sidewalkAt(u0) - sidewalkAt(u1));
      if (u1 - u0 > 14 && drop > 0.9) { const mid = (u0 + u1) / 2; tileGap(u0, mid); tileGap(mid, u1); return; }
      const lb = Math.min(sidewalkAt(u0), sidewalkAt(u1)) - 0.05, oh = Math.max(2.4, openingTop - lb);
      const d = this.dims(defaultMod); let count = Math.max(1, Math.round((u1 - u0) / d.w)); const sx = (u1 - u0) / (count * d.w);
      const sy = oh / d.h;
      for (let k = 0; k < count; k++) { const uc = u0 + (k + 0.5) * (u1 - u0) / count; this.place(defaultMod, a, t, n, uc, lb, sx, sy, 1); this.stats.openings++; }
      this.reveal(baseMat, a, t, n, u0, u1, lb, lb + oh, 0.25);
      this.panel(baseMat, a, t, n, u0, u1, lb + oh, groundTop);            // fascia
      this.panel(baseMat, a, t, n, u0, u1, baseY - 0.5, lb);               // plinth below the local sidewalk
      this.panel('shop_lit', a, t, n, u0, u1, lb - 0.2, lb + oh, 0.9);     // lit shop interior backing
    };
    let cursor = 0;
    for (const bay of bays) {
      const from = Math.max(0, bay.from), to = Math.min(len, bay.to); if (to - from < 0.5) continue;
      if (from > cursor + 0.05) { if (cursor === 0 && from < endPad + 0.05) solid(0, from); else tileGap(cursor, from); }
      const lb = Math.min(sidewalkAt(from), sidewalkAt(to)) - 0.05;
      this.storefrontBay(info, spec, bay, from, to, a, t, n, lb, groundTop - lb, Math.max(2.4, openingTop - lb), baseMat);
      this.panel(baseMat, a, t, n, from, to, baseY - 0.5, lb);
      filled.push([from, to]); cursor = to;
    }
    if (cursor < len - 0.05) { if (bays.length === 0) { solid(0, endPad); solid(len - endPad, len); tileGap(endPad, len - endPad); } else tileGap(cursor, len); }
    // ---- upper floors ----
    const bayW = es.bayW ?? info.bayW;
    const inner = len - 2 * endPad;
    const nBays = Math.max(1, Math.round(inner / bayW));
    const bw = inner / nBays;
    const yG = groundTop;
    // stringcourses & base band top line
    const sc = new Set(spec.stringcourseAfterFloors || []);
    if (baseH > groundH + 0.05) { /* base band extends into first upper floor: handled by material choice below */ }
    for (let f = 0; f < nFloors; f++) {
      const y0 = yG + f * floorH, y1 = y0 + floorH;
      const modName: WindowModule = (f === 0 && es.windowFloor2) ? es.windowFloor2 : (es.window ?? 'win_dh_stone_1.2x2.2');
      const mat = (y0 < groundLevel + baseH - 0.05) ? baseMat : wallMat;
      if (modName === 'none') { this.panel(mat, a, t, n, 0, len, y0, y1, 0.15); continue; }
      const d = this.dims(modName);
      const flush = modName.startsWith('win_curtain') || modName.startsWith('win_office_strip');   // curtain-wall modules sit flush (no reveal), fill the floor
      let sy = 1; if (flush) sy = floorH / d.h; else if (d.h > floorH - 0.5) sy = (floorH - 0.5) / d.h;
      let sx = 1; if (flush) sx = bw / d.w; else if (d.w > bw - 0.5) sx = (bw - 0.5) / d.w;
      const wm = d.w * sx, hm = d.h * sy;
      const sill = flush ? 0 : Math.max(0.15, Math.min(0.9, (floorH - hm) * 0.55));
      // end piers
      this.panel(mat, a, t, n, 0, endPad, y0, y1); this.panel(mat, a, t, n, len - endPad, len, y0, y1);
      for (let k = 0; k < nBays; k++) {
        const uc = endPad + (k + 0.5) * bw, u0 = uc - wm / 2, u1 = uc + wm / 2;
        // piers/spandrel/lintel
        this.panel(mat, a, t, n, endPad + k * bw, u0, y0, y1);
        if (k === nBays - 1) this.panel(mat, a, t, n, u1, endPad + (k + 1) * bw, y0, y1); else this.panel(mat, a, t, n, u1, endPad + (k + 1) * bw, y0, y1);
        if (!flush) { this.panel(mat, a, t, n, u0, u1, y0, y0 + sill); this.panel(mat, a, t, n, u0, u1, y0 + sill + hm, y1); this.reveal(mat, a, t, n, u0, u1, y0 + sill, y0 + sill + hm); }
        this.place(modName, a, t, n, uc, y0 + sill, sx, sy, 1, flush ? 0.05 : 0);
        // interior backing (lit at night for ~35%)
        this.panel(this.rng.chance(0.35) ? 'window_lit' : 'window_back', a, t, n, u0, u1, y0 + sill, y0 + sill + hm, 0.6);
        this.stats.openings++;
      }
      if (sc.has(f + 1) || (f === 0 && sc.has(1))) { if (f === 0 || sc.has(f + 1)) this.trim('stringcourse_1m', a, t, n, len, sc.has(f + 1) ? y1 : y0); }
    }
    // stringcourse at the top of the ground floor (always) for classical styles
    if ((spec.stringcourseAfterFloors || []).includes(1) || spec.cornice === 'heavy') this.trim('stringcourse_1m', a, t, n, len, yG);
    // cornice / parapet
    if (corniceH > 0) { this.trim(spec.cornice === 'heavy' ? 'cornice_heavy_1m' : 'cornice_medium_1m', a, t, n, len, top - corniceH); this.panel(wallMat, a, t, n, 0, len, top - corniceH - 0.02, top - corniceH + 0.3, 0.02); }
    if (spec.balustrade) this.trim('balustrade_1m', a, t, n, len, top); else if (spec.parapet ?? corniceH === 0) this.trim('parapet_1m', a, t, n, len, top);
    // extras
    for (const ex of spec.extras || []) {
      if (ex.edge !== edgeIdx && !(ex.edge === -1 && edgeIdx === (spec.edges.length ? edgeIdx : edgeIdx))) continue;
      const at = ex.at <= 1 ? ex.at * len : ex.at;
      if (ex.kind === 'fire_escape') { for (let f = 0; f < nFloors; f++) this.place('fire_escape_module_2.4x3.6', a, t, n, at, yG + f * floorH, 1, floorH / 3.6, 1); }
      else if (ex.kind === 'balcony_stone' || ex.kind === 'balcony_iron') { const f = ex.floor ?? 1; this.place(ex.kind === 'balcony_stone' ? 'balcony_stone_2.4m' : 'balcony_iron_2.4m', a, t, n, at, yG + (f - 1) * floorH); }
      else if (ex.kind === 'flag') this.place('flagpole_facade_4m', a, t, n, at, yG + 0.5);
      else if (ex.kind === 'column_corinthian') { const lb = sidewalkAt(at) - 0.05; this.place('column_corinthian_6m', a, t, n, at, lb, 1, (groundTop - lb) / 6, 1, -0.3); }
      else if (ex.kind === 'column_doric') { const lb = sidewalkAt(at) - 0.05; this.place('column_doric_4m', a, t, n, at, lb, 1, (groundTop - lb) / 4, 1, -0.2); }
      else if (ex.kind === 'pilaster_giant') { const cnt = ex.count ?? 1; for (let k = 0; k < cnt; k++) this.place('pilaster_flat_0.8x12m', a, t, n, at + k * bayW, yG, 1, (top - corniceH - yG) / 12, 1); }
      else if (ex.kind === 'canopy_metal') this.place('canopy_metal_4m', a, t, n, at, sidewalkAt(at) + 3.4);
      else if (ex.kind === 'ac') { for (let f = 0; f < nFloors; f++) if (this.rng.chance(0.25)) this.place('window_ac_unit', a, t, n, at + this.rng.range(-3, 3), yG + f * floorH + 0.9); }
    }
  }

  private storefrontBay(info: BuildingInfo, spec: FacadeSpec, bay: StorefrontBay, from: number, to: number, a: P2, t: P2, n: P2, baseY: number, groundH: number, openingH: number, baseMat: string) {
    const w = to - from, uc = (from + to) / 2;
    const h = bay.height ?? openingH;
    if (bay.module === 'custom') { /* hero module fills this bay */ }
    else if (bay.module === 'wall') this.panel(baseMat, a, t, n, from, to, baseY - 0.5, baseY + groundH);
    else if (bay.module === 'door_hotel_marquee_6.0') {
      const d = this.dims(bay.module); this.place(bay.module, a, t, n, uc, baseY, w / d.w, Math.min(1.15, groundH / d.h), 1);
      this.panel('shop_lit', a, t, n, from, to, baseY - 0.2, baseY + groundH, 1.2);
    } else {
      const d = this.dims(bay.module);
      let count = Math.max(1, Math.round(w / d.w)); if (bay.module.startsWith('door') || bay.module.startsWith('storefront_door')) count = 1;
      const sx = w / (count * d.w), sy = h / d.h;
      for (let k = 0; k < count; k++) this.place(bay.module, a, t, n, from + (k + 0.5) * w / count, baseY, sx, sy, 1);
      this.reveal(baseMat, a, t, n, from, to, baseY, baseY + h, 0.25);
      this.panel('shop_lit', a, t, n, from, to, baseY - 0.2, baseY + h, 0.9);
    }
    if (bay.module !== 'custom') this.panel(baseMat, a, t, n, from, to, baseY + h, baseY + groundH);   // fascia band
    this.stats.openings++;
    const ten = bay.tenant; if (!ten) return;
    // signage
    const rot = Math.atan2(n[0], n[1]);
    const P = (u: number, y: number, out: number) => new THREE.Vector3(a[0] + t[0] * u + n[0] * out, y, a[1] + t[1] * u + n[1] * out);
    const signType = ten.signType ?? 'fascia';
    if (signType === 'fascia' || signType === 'letters') {
      const sw = Math.min(w - 0.4, 9), sh = Math.min(0.75, groundH - h - 0.15);
      const res = ten.brand ? makeLogoSign(ten.brand, sw, sh, { illuminated: ten.illuminated }) : makeTextSign({ text: ten.name, widthM: sw, heightM: sh, color: ten.color ?? '#f2f2f2', bg: signType === 'letters' ? null : (ten.bg ?? '#1a1a1a'), illuminated: ten.illuminated, uppercase: true, letterSpacing: 2 });
      const mesh = signMesh(res, 0.08); mesh.position.copy(P(uc, baseY + h + Math.min(0.45, (groundH - h) / 2), 0.06)); mesh.rotation.y = rot;
      mesh.userData.inspection = buildingInspection(info); this.group.add(mesh); this.signs.push(mesh);
    } else if (signType === 'blade') {
      const res = ten.brand ? makeLogoSign(ten.brand, 1.0, 0.6) : makeTextSign({ text: ten.name, widthM: 1.0, heightM: 0.6, bg: ten.bg ?? '#1a1a1a', color: ten.color ?? '#f2f2f2', uppercase: true });
      const mesh = signMesh(res, 0.06); mesh.position.copy(P(from + 0.6, baseY + 3.4, 0.6)); mesh.rotation.y = rot + Math.PI / 2;
      mesh.userData.inspection = buildingInspection(info); this.group.add(mesh);
    }
    if (ten.awning && ten.awning !== 'none') { const mod = ten.awning === 'red' ? 'awning_fabric_3m' : ten.awning === 'black' ? 'awning_fabric_3m_black' : 'awning_fabric_3m_green'; const cnt = Math.max(1, Math.round(w / 3)); for (let k = 0; k < cnt; k++) this.place(mod, a, t, n, from + (k + 0.5) * w / cnt, baseY + 2.7, (w / cnt) / 3, 1, 1); }
    // registry
    this.storefronts.push({ id: `${info.id}:${bay.edge}:${Math.round(from)}`, name: ten.name, category: ten.category ?? 'retail', address: ten.address ?? info.address, position: P(uc, baseY, 2.2), facing: new THREE.Vector3(n[0], 0, n[1]), width: w, enterable: !!ten.enterable, status: ten.status ?? 'unknown', confidence: ten.confidence ?? 'medium' });
  }

  private trim(module: string, a: P2, t: P2, n: P2, len: number, y: number) {
    const count = Math.max(1, Math.floor(len)), rest = len - count;
    for (let k = 0; k < count; k++) this.place(module, a, t, n, k + 0.5, y);
    if (rest > 0.05) this.place(module, a, t, n, count + rest / 2, y, rest, 1, 1);
  }
  private roof(fp: P2[], top: number, spec: FacadeSpec) {
    const shape = new THREE.Shape(fp.map(([x, z]) => new THREE.Vector2(x, z)));
    const g = new THREE.ShapeGeometry(shape); g.rotateX(Math.PI / 2);
    const p = g.getAttribute('position') as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) p.setY(i, top - 0.05);
    g.computeVertexNormals(); const nr = g.getAttribute('normal') as THREE.BufferAttribute;
    if (nr.getY(0) < 0) { const ix = g.getIndex()!; for (let i = 0; i < ix.count; i += 3) { const tt = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, tt); } g.computeVertexNormals(); }
    const uv = g.getAttribute('uv') as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i), p.getZ(i));
    const rk = `${this.curCell}|roof`; let arr = this.geos.get(rk); if (!arr) this.geos.set(rk, (arr = []));
    if (this.currentInspection) arr.push({ geometry: g, info: this.currentInspection });
    // rooftop props near the centroid
    let cx = 0, cz = 0; for (const q of fp) { cx += q[0]; cz += q[1]; } cx /= fp.length; cz /= fp.length;
    const kinds = spec.rooftop || [];
    const rot = this.rng.range(0, Math.PI);
    if (kinds.includes('penthouse')) this.place('roof_penthouse_6x4x3', [cx, cz], [Math.cos(rot), Math.sin(rot)], [Math.sin(rot), -Math.cos(rot)], 0, top - 0.05);
    if (kinds.includes('watertank')) this.place('roof_watertank', [cx + 6, cz + 4], [1, 0], [0, -1], 0, top - 0.05);
  }
  private mass(info: BuildingInfo, spec: FacadeSpec, m: NonNullable<FacadeSpec['masses']>[number]) {
    const poly = ensureCCW(m.polygon);
    const base = info.baseY + (m.baseY ?? 0), top = base + m.height;
    const e0 = spec.edges[0];
    const edgeSpec = { window: m.window ?? e0?.window, windowFloor2: m.baseY ? undefined : e0?.windowFloor2, bayW: m.bayW ?? e0?.bayW, endPad: 0.8, storefront: m.baseY ? 'wall' as const : e0?.storefront };
    // every face of an elevated mass is detailed (pavilion flanks, light courts); ground-level masses follow street detection
    const edges = m.baseY ? poly.map((_, i) => ({ edge: i, ...edgeSpec })) : [{ edge: 'street' as const, ...edgeSpec }];
    const sub: FacadeSpec & { groundLevelY?: number } = { ...spec, heightM: m.height, floors: undefined, groundLevelY: m.baseY ? base : undefined, wall: m.wall ?? spec.wall, cornice: m.cornice ?? spec.cornice, roof: m.roof ?? 'flat', storefronts: [], masses: [], extras: m.baseY ? [] : spec.extras, groundH: m.baseY ? 0.5 : spec.groundH, edges, rooftop: ['none'] };
    const fake: BuildingInfo = { ...info, footprint: poly, baseY: base, topY: top, height: m.height };
    this.build(fake, { ...sub, masses: [] });
    this.stats.buildings--;
  }

  /** Create meshes: merged walls per material + instanced module pools. */
  async finalize() {
    for (const [ck, entries] of this.geos) {
      if (!entries.length) continue;
      const mat = ck.split('|')[1];
      const merged = mergeGeometries(entries.map((entry) => entry.geometry), false); if (!merged) continue;
      const mesh = new THREE.Mesh(merged, Materials.get(mat)); mesh.name = `facade:${ck}`; mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.inspectionRanges = this.inspectionRanges(entries);
      this.group.add(mesh);
    }
    for (const [pk, list] of this.pools) {
      const key = pk.split('|')[1];
      if (!Assets.has(key)) continue;
      const noShadow = /\/(win_|stringcourse|parapet|balustrade|rustication|window_ac)/.test(key);
      const im: InstancedModel = await Assets.instanced(key, list.length, { castShadow: !noShadow, receiveShadow: true });
      for (let i = 0; i < list.length; i++) im.setMatrixAt(i, list[i].m);
      for (const mesh of im.meshes) mesh.userData.inspectionInstances = list.map((placement) => placement.info);
      im.count = list.length; im.finalize(); im.group.name = pk;
      this.group.add(im.group);
    }
    return this.group;
  }

  private inspectionRanges(entries: GeometryPlacement[]) {
    let nextFace = 0;
    return entries.map(({ geometry, info }) => {
      const startFace = nextFace;
      nextFace += (geometry.getIndex()?.count ?? geometry.getAttribute('position').count) / 3;
      return { startFace, endFace: nextFace, data: info };
    });
  }
}
