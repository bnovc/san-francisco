// Building massing from OSM footprints (LEVEL 1) with procedural façade tiles (mid/far LOD) + roofs + collision.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { P2, ensureCCW, polygonArea, pointInPolygon } from '../util/Geometry2D';
import { Materials } from '../materials/Library';
import { facadeMaterial, FacadeStyle } from '../materials/FacadeTextures';
import type { Terrain } from './Terrain';
import type { CollisionWorld } from '../player/Collision';
import { Rng } from '../util/Rng';
import { buildingInspection, type InspectionData } from '../inspection/InspectionData';

export interface GisBuilding { osmId: string; name?: string | null; address?: string | null; footprint: P2[]; heightM: number | null; levels: number | null; minHeightM?: number | null; centroid: P2; groundElevM: number; areaM2: number; kind: string; tags: Record<string, string>; insideBbox?: boolean }

export interface BuildingInfo { id: string; name: string; address: string; footprint: P2[]; baseY: number; topY: number; height: number; floors: number; style: FacadeStyle; floorH: number; bayW: number; groundFloorH: number; b: GisBuilding }

export interface BuildingOverride { heightM?: number; floors?: number; style?: FacadeStyle; floorH?: number; bayW?: number; groundFloorH?: number; hide?: boolean }

const rng = new Rng(77);

function guessStyle(b: GisBuilding): { style: FacadeStyle; floorH: number; bayW: number } {
  const t = b.tags, name = (b.name || '').toLowerCase();
  const mat = (t['building:material'] || '').toLowerCase();
  const h = b.heightM || 0, lv = b.levels || (h ? Math.round(h / 3.6) : 0);
  const start = parseInt(t['start_date'] || '0', 10);
  let style: FacadeStyle = 'stone_light';
  if (mat.includes('glass') || (h > 60 && start > 1960)) style = 'glass';
  else if (mat.includes('brick')) style = 'brick';
  else if (mat.includes('concrete') || (start > 1950 && start < 1990)) style = 'concrete';
  else if (mat.includes('stone') || mat.includes('sandstone') || mat.includes('limestone')) style = 'stone_warm';
  else if (start && start < 1935) style = rng.pick(['stone_light', 'stone_warm', 'terracotta', 'brick', 'plaster']);
  else if (h > 50) style = rng.pick(['glass', 'concrete']);
  else style = rng.pick(['stone_light', 'terracotta', 'plaster', 'stone_warm', 'brick']);
  if (/hyatt|hilton|marriott|parc 55|nikko/.test(name)) style = 'concrete';
  const floorH = style === 'glass' ? 3.9 : (start && start < 1935 ? 3.8 : 3.4);
  const bayW = style === 'glass' ? 3.0 : rng.pick([3.5, 4.0, 4.5]);
  void lv;
  return { style, floorH, bayW };
}

export class Buildings {
  group = new THREE.Group();
  infos = new Map<string, BuildingInfo>();
  plazaPoly: P2[] | null = null;
  private buckets = new Map<string, THREE.BufferGeometry[]>();
  private bucketInfos = new Map<string, BuildingInfo[]>();
  private roofGeos: THREE.BufferGeometry[] = [];
  private roofInfos: BuildingInfo[] = [];
  constructor(list: GisBuilding[], parts: GisBuilding[], public terrain: Terrain, public collision: CollisionWorld, overrides: Record<string, BuildingOverride> = {}, exclude = new Set<string>(), plazaPoly: P2[] | null = null, noCollision = new Set<string>()) {
    this.plazaPoly = plazaPoly;
    this.group.name = 'buildings';
    const buckets = this.buckets;
    const roofGeos = this.roofGeos;
    const partsByParent = new Map<string, GisBuilding[]>();
    for (const p of parts) { const k = p.tags['__parent'] || ''; let a = partsByParent.get(k); if (!a) partsByParent.set(k, (a = [])); a.push(p); }
    const all = [...list, ...parts.map((p) => ({ ...p, __part: true } as GisBuilding & { __part?: boolean }))];
    // OSM building:part volumes that sit inside a façade-detailed outline duplicate its geometry → skip them (keep taller tower parts)
    const detailedOutlines = list.filter((b) => exclude.has(b.osmId) && b.footprint?.length >= 3);
    const partHidden = (p: GisBuilding) => detailedOutlines.some((o) => pointInPolygon(p.centroid[0], p.centroid[1], o.footprint) && (p.heightM ?? 0) <= (o.heightM ?? 0) + 1.5);
    for (const b of all as (GisBuilding & { __part?: boolean })[]) {
      if (!b.footprint || b.footprint.length < 3) continue;
      if (b.__part && partHidden(b)) continue;
      const ov = overrides[b.osmId] || overrides[b.address || ''] || {};
      if (ov.hide) continue;
      const fp = ensureCCW(b.footprint.slice(0, b.footprint.length - (b.footprint[0][0] === b.footprint[b.footprint.length - 1][0] && b.footprint[0][1] === b.footprint[b.footprint.length - 1][1] ? 1 : 0)));
      if (Math.abs(polygonArea(fp)) < 15) continue;
      const g = guessStyle(b);
      let style = ov.style || g.style; const floorH = ov.floorH || g.floorH, bayW = ov.bayW || g.bayW;
      if ((b.tags['building'] === 'kiosk' || (b.areaM2 ?? 0) < 150) && !ov.style) style = 'glass';
      const area = Math.abs(polygonArea(fp));
      const inPlaza = this.plazaPoly ? pointInPolygon(b.centroid[0], b.centroid[1], this.plazaPoly) : false;
      let height = ov.heightM ?? b.heightM ?? (b.levels ? b.levels * floorH + 1 : null) ?? (ov.floors ? ov.floors * floorH : null) ?? (area < 150 ? 3.8 : Math.min(28, 12 + Math.sqrt(area) * 0.25));
      if (inPlaza && !ov.heightM) { height = Math.min(height, 4.0); style = 'glass'; }
      const floors = ov.floors || b.levels || Math.max(1, Math.round(height / floorH));
      // base = lowest terrain along the footprint
      let base = Infinity;
      for (const p of fp) base = Math.min(base, this.terrain.heightAt(p[0], p[1]));
      base = Math.min(base, this.terrain.heightAt(b.centroid[0], b.centroid[1]));
      const minH = b.minHeightM || 0;
      const baseY = base - 0.3, topY = baseY + height;
      if (b.__part && this.infos.has(b.osmId)) continue;
      const info: BuildingInfo = { id: b.osmId, name: b.name || '', address: b.address || '', footprint: fp, baseY, topY, height, floors, style, floorH, bayW, groundFloorH: ov.groundFloorH || Math.min(6, floorH + 1.2), b };
      this.infos.set(b.osmId, info);
      // collision (hero-managed buildings register their own)
      if (!b.__part && !noCollision.has(b.osmId)) this.collision.addPolygon(fp, baseY, topY, `bld:${b.osmId}`);
      if (exclude.has(b.osmId)) continue;   // geometry provided by façade engine / hero module
      const key = `${style}|${bayW}|${floorH}|${Math.floor(b.centroid[0] / 160)},${Math.floor(b.centroid[1] / 160)}`;
      let arr = buckets.get(key); if (!arr) buckets.set(key, (arr = []));
      arr.push(this.walls(fp, baseY + minH, topY, info));
      let infos = this.bucketInfos.get(key); if (!infos) this.bucketInfos.set(key, (infos = []));
      infos.push(info);
      roofGeos.push(this.roof(fp, topY));
      this.roofInfos.push(info);
    }
  }
  /** Re-add massing geometry for a building that the façade engine declined (called before flushMassing). */
  addMassing(info: BuildingInfo) {
    const key = `${info.style}|${info.bayW}|${info.floorH}|0,0`;
    let arr = this.buckets.get(key); if (!arr) this.buckets.set(key, (arr = []));
    arr.push(this.walls(info.footprint, info.baseY, info.topY, info));
    let infos = this.bucketInfos.get(key); if (!infos) this.bucketInfos.set(key, (infos = []));
    infos.push(info);
    this.roofGeos.push(this.roof(info.footprint, info.topY));
    this.roofInfos.push(info);
  }
  /** Merge bucketed massing geometry into meshes (idempotent: clears buckets). */
  flushMassing() {
    const buckets = this.buckets, roofGeos = this.roofGeos;
    for (const [key, geos] of buckets) {
      const [style, bayW, floorH] = key.split('|');
      const mesh = new THREE.Mesh(mergeGeometries(geos, false), facadeMaterial(style as FacadeStyle, Number(bayW), Number(floorH)));
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = `massing:${key}`;
      mesh.userData.inspectionRanges = this.inspectionRanges(geos, this.bucketInfos.get(key) ?? []);
      this.group.add(mesh);
    }
    if (roofGeos.length) {
      const rm = new THREE.Mesh(mergeGeometries(roofGeos, false), Materials.get('roof'));
      rm.receiveShadow = true; rm.castShadow = true; rm.name = 'roofs';
      rm.userData.inspectionRanges = this.inspectionRanges(roofGeos, this.roofInfos);
      this.group.add(rm);
    }
    this.buckets = new Map(); this.roofGeos = [];
    this.bucketInfos = new Map(); this.roofInfos = [];
  }
  private inspectionRanges(geometries: THREE.BufferGeometry[], infos: BuildingInfo[]) {
    let nextFace = 0;
    const ranges: { startFace: number; endFace: number; data: InspectionData }[] = [];
    geometries.forEach((geometry, index) => {
      const faceCount = (geometry.getIndex()?.count ?? geometry.getAttribute('position').count) / 3;
      const startFace = nextFace;
      nextFace += faceCount;
      const info = infos[index];
      if (info && faceCount > 0) ranges.push({ startFace, endFace: nextFace, data: buildingInspection(info) });
    });
    return ranges;
  }
  /** Wall quads around a footprint with metre UVs (u along edge, v = height above base). Ground floor band gets the same tile (storefront pass replaces it later). */
  private walls(fp: P2[], y0: number, y1: number, info: BuildingInfo): THREE.BufferGeometry {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [], nrm: number[] = [];
    let u = 0;
    for (let i = 0; i < fp.length; i++) {
      const a = fp[i], b = fp[(i + 1) % fp.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 0.05) continue;
      // outward normal for CCW polygon (in x,z with y up): right-hand side of edge direction
      const nx = (b[1] - a[1]) / len, nz = -(b[0] - a[0]) / len;
      const k = pos.length / 3;
      // align window rows to floors: v offset so that the ground floor band is taller (groundFloorH)
      const vOff = info.groundFloorH - info.floorH;
      pos.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y1, a[1]);
      uv.push(u, y0 - info.baseY - vOff, u + len, y0 - info.baseY - vOff, u + len, y1 - info.baseY - vOff, u, y1 - info.baseY - vOff);
      for (let q = 0; q < 4; q++) nrm.push(nx, 0, nz);
      idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
      u += len;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }
  private roof(fp: P2[], y: number): THREE.BufferGeometry {
    const shape = new THREE.Shape(fp.map(([x, z]) => new THREE.Vector2(x, z)));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(Math.PI / 2); // shape (x, z) -> world (x, 0, z)
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, y);
    g.computeVertexNormals();
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    if (n.getY(0) < 0) { const ix = g.getIndex()!; for (let i = 0; i < ix.count; i += 3) { const t = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, t); } g.computeVertexNormals(); }
    const uv = g.getAttribute('uv') as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i), p.getZ(i));
    return g;
  }
}
