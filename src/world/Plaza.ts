// Union Square plaza (LEVEL 1 blockout → refined): terraces, stairs, retaining walls, lawns, Dewey Monument, garage portal.
import * as THREE from 'three';
import { Materials } from '../materials/Library';
import { genTexture } from '../materials/Textures';
import { Assets } from '../assets/Assets';
import { box, slab, skirt, rect, wallQuad } from '../util/MeshUtil';
import { P2 } from '../util/Geometry2D';
import type { CollisionWorld } from '../player/Collision';
import type { Terrain } from './Terrain';

// Levels (local y; plaza centre = 0 = 23.9 m NAVD88)
export const PLAZA = {
  central: 0, north: 0.9, nwCorner: 1.6, southPromenade: -1.0, geary: -4.0, swCorner: -2.6, seCorner: -4.8,
  xMin: -60, xMax: 60.5, zMin: -39, zMax: 39.5,
};

export class Plaza {
  group = new THREE.Group();
  uplights: THREE.SpotLight[] = [];
  setNight(t: number) { for (const l of this.uplights) l.intensity = 1400 * t; }
  constructor(public terrain: Terrain, public collision: CollisionWorld) {
    this.group.name = 'plaza';
    const G = Materials.get('granite_grey'), P = Materials.get('pavers'), GR = Materials.get('grass'), D = Materials.get('granite_dark');
    const { xMin, xMax, zMin, zMax } = PLAZA;
    const terr = (x: number, z: number) => this.terrain.heightAt(x, z);

    // --- central deck (z -12 .. 15) ---
    this.terrace(rect(xMin, xMax, -12, 15), PLAZA.central, this.bandedPaving(), 'plaza');
    // --- north terrace (z -39 .. -12), +0.9, with a 6-riser seat-step band at z -12..-9.6 (full width minus the stage centre) ---
    this.terrace(rect(xMin, xMax, zMin, -12), PLAZA.north, P, 'plaza');
    this.stairs(-60, 60.5, -12, -9.6, PLAZA.central, PLAZA.north, 6, 'ns', G);
    // NW corner entrance rises to +1.6 over the west 20 m of the north terrace (ramped)
    this.ramp(rect(xMin, -40, zMin, -12), [-40, -25], PLAZA.north, [xMin, -25], PLAZA.nwCorner, P);
    // --- south promenade (z 15 .. 23.4), -1.0 ---
    this.terrace(rect(xMin, xMax, 15, 23.4), PLAZA.southPromenade, P, 'plaza');
    // central 12 m wide stair from central deck down to promenade (z 15..21)
    this.stairs(-6, 6, 15, 21, PLAZA.central, PLAZA.southPromenade, 6, 'ns', G, true);
    // low retaining walls + planters flanking the central stair along z=15
    for (const [x0, x1] of [[xMin, -6], [6, xMax]] as [number, number][]) {
      this.group.add(wallQuad(x0, 15, x1, 15, PLAZA.southPromenade, PLAZA.central + 0.45, G, false));
      this.group.add(box(x1 - x0, 0.45, 1.2, (x0 + x1) / 2, PLAZA.central + 0.225, 15.6, G)); // planter wall cap
      this.collision.addWall({ ax: x0, az: 15, bx: x1, bz: 15, y0: PLAZA.southPromenade, y1: PLAZA.central + 0.5 });
    }
    // --- Geary edge zone (z 23.4 .. 39.5): corner plazas, lawn terraces, lawn stairs, garage portal ---
    // corner entrance plazas at sidewalk level (-4) with palms (west x<-45, east x>45)
    const swY = terr(-56, 41) + 0.15, seY = terr(56, 41) + 0.15;   // corner plazas match the adjacent sidewalk grade
    PLAZA.swCorner = swY; PLAZA.seCorner = seY;
    this.terrace(rect(xMin, -44, 23.4, zMax), swY, P, 'plaza', false);
    this.terrace(rect(44, xMax, 23.4, zMax), seY, P, 'plaza', false);
    // stairs from corner plazas up to promenade (along x, at the corner)
    this.stairs(-44, -41, 23.4, 39.5, swY, PLAZA.southPromenade, Math.max(4, Math.round((PLAZA.southPromenade - swY) / 0.16)), 'ew', G, true);
    this.stairs(41, 44, 23.4, 39.5, seY, PLAZA.southPromenade, Math.max(4, Math.round((PLAZA.southPromenade - seY) / 0.16)), 'ew', G, true);
    // long lawn stairs (3 m wide) at x = -31.7, -19.3, 16.1 from z 39.5 (-4) to z 23.4 (-1)
    for (const x of [-31.7, -19.3, 16.1]) { const gy = terr(x, 41) + 0.15; this.stairs(x - 1.5, x + 1.5, 23.4, 39.5, PLAZA.southPromenade, gy, Math.max(6, Math.round((PLAZA.southPromenade - gy) / 0.16)), 'ns', G, true); }
    // SW lawn terraces between the stairs: x -41..-33.2 and -30.2..-20.8, -17.8..-10 ; SE lawn x 17.6..41 (stepped grass, 3 steps)
    const lawnSpans: [number, number][] = [[-41, -33.2], [-30.2, -20.8], [-17.8, -11.5], [17.6, 41]];
    for (const [x0, x1] of lawnSpans) this.steppedLawn(x0, x1, 23.4, 39.5, PLAZA.southPromenade, terr((x0 + x1) / 2, 41) + 0.15, GR, G);
    // garage portal block x -10..14, z 30..39.5: deck bridge on top at promenade level, portal opening toward Geary
    this.terrace(rect(-11.5, 15.5, 23.4, 39.5), PLAZA.southPromenade, P, 'plaza', false);
    this.group.add(box(27, 0.6, 0.5, 2, PLAZA.southPromenade + 0.3, 39.25, G)); // parapet
    this.collision.addWall({ ax: -11.5, az: 39.5, bx: 15.5, bz: 39.5, y0: PLAZA.geary, y1: PLAZA.southPromenade + 0.6 });
    // portal headwall (granite) with two dark openings
    const headY0 = terr(2, 41) - 0.5, headY1 = PLAZA.southPromenade;
    this.group.add(wallQuad(15.5, 39.5, -11.5, 39.5, headY0, headY1, G));
    for (const [x0, x1] of [[-9, -3.5], [-2, 4.5], [7, 13]] as [number, number][]) this.group.add(box(x1 - x0, 2.4, 0.3, (x0 + x1) / 2, headY0 + 1.7, 39.2, Materials.get('plastic_black')));
    // south retaining wall pieces between stairs/lawns at Geary (where lawn meets the wall the lawn steps handle it)
    // --- east edge: broad stair to Stockton across the middle (x 54..60.5, z -10..10) and retaining wall elsewhere ---
    this.stairs(54, 60.5, -10, 10, PLAZA.central, terr(63, 0) + 0.15, 14, 'ew', G, true);
    // SE terrace stair (x 38..41, z 15..23.2) is covered by the promenade ; NE corner steps down to Post&Stockton sidewalk
    this.stairs(54, 60.5, -39, -30, PLAZA.north, terr(63, -34) + 0.15, 12, 'ew', G, true);
    this.stairs(54, 60.5, 23.4, 33, PLAZA.southPromenade, terr(63, 28) + 0.15, 16, 'ew', G, true);
    // --- west edge: near level; small 3-riser steps at the plaza entrances along Powell mid-block ---
    this.stairs(-60, -56, -8, 8, PLAZA.central, terr(-63, 0) + 0.15, 3, 'ew', G, true);
    // retaining skirt around the whole plaza (outer polygon) down to terrain — per edge levels
    this.group.add(skirt(rect(xMin, xMax, -12, 15), PLAZA.central, terr, G));
    this.group.add(skirt(rect(xMin, xMax, zMin, -12), PLAZA.north, terr, G));
    this.group.add(skirt(rect(xMin, xMax, 15, 23.4), PLAZA.southPromenade, terr, G));
    // outer collision walls where the plaza edge is a drop (player can't walk off): east and south edges except stairs
    this.edgeWalls();
    // --- Dewey Monument ---
    this.monument();
    // --- Union Square Colonnade light sculptures (R.M. Fischer): 4 red-granite pylons along the south edge of the central deck ---
    for (const x of [-45, -14, 14, 45]) this.lightPylon(x, 13.2);
    // --- stage canopy on the north terrace (steel + glass, ~16 x 8 m) ---
    this.stageCanopy();
    // --- lawns at NW / NE corners of the north terrace (grass panels) ---
    for (const [x0, x1] of [[-52, -22], [22, 52]] as [number, number][]) { const l = slab(rect(x0, x1, -34, -16), PLAZA.north + 0.05, 0, GR); this.group.add(l); }
    // plaza light poles & benches are placed by Props; palms by Vegetation (positions exported below)
    void D;
  }
  /** Flat terrace slab with collision patch. */
  terrace(poly: P2[], y: number, mat: THREE.Material, tag: string, thick = true) {
    this.group.add(slab(poly, y, thick ? 0.4 : 0.2, mat));
    this.collision.addFlatPatch(poly, y, tag, 2);
  }
  ramp(poly: P2[], a: P2, ya: number, b: P2, yb: number, mat: THREE.Material) {
    // visual: subdivided slab
    const [x0, x1, z0, z1] = [Math.min(...poly.map((p) => p[0])), Math.max(...poly.map((p) => p[0])), Math.min(...poly.map((p) => p[1])), Math.max(...poly.map((p) => p[1]))];
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 16, 4); g.rotateX(-Math.PI / 2);
    const p = g.getAttribute('position') as THREE.BufferAttribute, uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i) + (x0 + x1) / 2, z = p.getZ(i) + (z0 + z1) / 2; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)); p.setXYZ(i, x, ya + (yb - ya) * t + 0.01, z); uv.setXY(i, x, z); }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; this.group.add(m);
    this.collision.addRampPatch(poly, a, ya, b, yb, 'plaza');
  }
  /** Stair block: rectangle x0..x1, z0..z1; y goes from yStart at the start edge to yEnd at the far edge along axis ('ns' → along z from z0 to z1; 'ew' → along x from x0 to x1). */
  stairs(x0: number, x1: number, z0: number, z1: number, yStart: number, yEnd: number, risers: number, axis: 'ns' | 'ew', mat: THREE.Material, sideWalls = false) {
    const len = axis === 'ns' ? z1 - z0 : x1 - x0;
    const run = len / risers, rise = (yEnd - yStart) / risers;
    const geos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < risers; i++) {
      const yTop = yStart + rise * (i + 1), yBot = Math.min(yStart, yEnd) - 0.3;
      const h = yTop - yBot;
      const g = new THREE.BoxGeometry(axis === 'ns' ? x1 - x0 : run, h, axis === 'ns' ? run : z1 - z0);
      const cx = axis === 'ns' ? (x0 + x1) / 2 : x0 + run * (i + 0.5), cz = axis === 'ns' ? z0 + run * (i + 0.5) : (z0 + z1) / 2;
      g.translate(cx, yBot + h / 2, cz);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute, p = g.getAttribute('position') as THREE.BufferAttribute; for (let k = 0; k < uv.count; k++) uv.setXY(k, p.getX(k) + p.getZ(k), p.getY(k));
      geos.push(g);
    }
    // merge into one mesh
    const merged = mergeGeos(geos);
    const m = new THREE.Mesh(merged, mat); m.castShadow = true; m.receiveShadow = true; this.group.add(m);
    const poly = rect(x0, x1, z0, z1);
    const a: P2 = axis === 'ns' ? [(x0 + x1) / 2, z0] : [x0, (z0 + z1) / 2], b: P2 = axis === 'ns' ? [(x0 + x1) / 2, z1] : [x1, (z0 + z1) / 2];
    this.collision.addRampPatch(poly, a, yStart, b, yEnd, 'plaza');
    if (sideWalls) {
      const lo = Math.min(yStart, yEnd), hi = Math.max(yStart, yEnd);
      if (axis === 'ns') { for (const x of [x0, x1]) this.collision.addWall({ ax: x, az: z0, bx: x, bz: z1, y0: lo, y1: hi + 1.0 }); }
      else { for (const z of [z0, z1]) this.collision.addWall({ ax: x0, az: z, bx: x1, bz: z, y0: lo, y1: hi + 1.0 }); }
    }
  }
  /** Stepped lawn (amphitheatre): 3 grass terraces with low granite risers, from yTop at z0 to yBot at z1. */
  steppedLawn(x0: number, x1: number, z0: number, z1: number, yTop: number, yBot: number, grass: THREE.Material, stone: THREE.Material) {
    const n = 3, dz = (z1 - z0) / n, dy = (yTop - yBot) / n;
    for (let i = 0; i < n; i++) {
      const za = z0 + dz * i, zb = za + dz, y = yTop - dy * i;
      const s = slab(rect(x0, x1, za, zb), y, 0.15, grass); this.group.add(s);
      // riser wall at the far (south) edge of each terrace
      this.group.add(wallQuad(x1, zb, x0, zb, y - dy - 0.3, y, stone));
      this.collision.addFlatPatch(rect(x0, x1, za, zb), y, 'plaza', 1);
      this.collision.addWall({ ax: x0, az: zb, bx: x1, bz: zb, y0: y - dy, y1: y + 0.3 });
    }
    // low hedge/wall along the top edge so players don't step onto the lawn from the promenade
    this.group.add(box(x1 - x0, 0.5, 0.4, (x0 + x1) / 2, yTop + 0.25, z0 + 0.2, stone));
    this.collision.addWall({ ax: x0, az: z0, bx: x1, bz: z0, y0: yTop - 0.5, y1: yTop + 0.6 });
  }
  edgeWalls() {
    const { xMin, xMax, zMin, zMax } = PLAZA;
    const W = (ax: number, az: number, bx: number, bz: number) => this.collision.addWall({ ax, az, bx, bz, y0: -6, y1: 2.5 });
    // east edge except stair openings (z -39..-30, -10..10, 23.4..33)
    W(xMax, zMin - 0, xMax, -30); W(xMax, -30, xMax, -10); W(xMax, 10, xMax, 23.4); W(xMax, 33, xMax, zMax);
    // south: lawns and portal have their own walls; corner plazas are open to the sidewalk at -4 (no wall)
    // north edge: terrace (+0.9) vs Post sidewalk (-1.5 .. +1.9): allow stepping where the difference is < 0.6 (west), wall where the drop is bigger (east part)
    W(-20, zMin, 54, zMin);
    // west edge: level-ish; the stair at z -8..8 is open; low walls elsewhere
    W(xMin, zMin, xMin, -8); W(xMin, 8, xMin, 23.4);
  }
  monument() {
    const G = Materials.get('granite_grey'), B = Materials.get('bronze_green'), BR = Materials.get('bronze');
    const D = new THREE.MeshStandardMaterial({ color: 0x9a9691, roughness: 0.55 });   // grey California granite (monument)
    const g = this.group;
    // plinth: 3 stepped granite tiers, then pedestal, then column
    g.add(box(9, 0.3, 9, 0, 0.15, 0, G)); g.add(box(7.5, 0.3, 7.5, 0, 0.45, 0, G)); g.add(box(6, 0.3, 6, 0, 0.75, 0, G));   // 3 plinth steps
    g.add(box(4.0, 0.4, 4.0, 0, 1.1, 0, D));                        // pedestal base moulding
    g.add(box(3.35, 2.4, 3.35, 0, 1.3 + 1.2, 0, D));                // pedestal (11 ft square, 8 ft tall) with inscriptions
    g.add(box(3.8, 0.4, 3.8, 0, 3.9, 0, D));                        // pedestal cap
    g.add(box(2.4, 0.5, 2.4, 0, 4.35, 0, D));                       // column base plinth
    const torus = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.2, 10, 32), D); torus.rotation.x = Math.PI / 2; torus.position.y = 4.75; g.add(torus);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.78, 20.0, 28), D); shaft.position.y = 4.8 + 10.0; shaft.castShadow = true; g.add(shaft);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 0.72, 2.0, 28), D); cap.position.y = 24.8 + 1.0; cap.castShadow = true; g.add(cap);
    g.add(box(2.6, 0.35, 2.6, 0, 25.98, 0, D));                     // abacus
    // Victory (bronze): globe + winged figure with trident (top ≈ 29 m)
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), BR); globe.position.y = 26.7; g.add(globe);
    const fig = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.8, 6, 12), B); fig.position.y = 28.3; g.add(fig);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2, 1.0), B); wing.position.set(0.1, 28.6, -0.32); wing.rotation.z = 0.4; g.add(wing);
    const trident = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6), B); trident.position.set(0.42, 28.6, 0); g.add(trident);
    // bronze plaques + stars on the pedestal faces
    for (let i = 0; i < 4; i++) { const p = box(1.9, 1.1, 0.06, 0, 2.5, 0, BR); p.rotation.y = (i * Math.PI) / 2; p.position.set(Math.sin(p.rotation.y) * 1.7, 2.5, Math.cos(p.rotation.y) * 1.7); g.add(p); }
    this.collision.addBox(0, 0, 4.2, 4.2, 0, 30);
    // night uplights on the column (4 spotlights in the monument bed)
    for (let i = 0; i < 2; i++) { const a = (i / 2) * Math.PI * 2 + Math.PI / 4; const sp = new THREE.SpotLight(0xfff0d0, 0, 40, 0.42, 0.6, 1.2); sp.position.set(Math.cos(a) * 5.5, 0.4, Math.sin(a) * 5.5); sp.target.position.set(0, 22, 0); sp.castShadow = false; g.add(sp); g.add(sp.target); this.uplights.push(sp); }
    // plinth steps are walkable
    this.collision.addFlatPatch(rect(-4.5, 4.5, -4.5, 4.5), 0.3, 'plaza', 3);
    this.collision.addFlatPatch(rect(-3.75, 3.75, -3.75, 3.75), 0.6, 'plaza', 3);
    this.collision.addFlatPatch(rect(-3, 3, -3, 3), 0.9, 'plaza', 3);
  }
  /** Central-deck paving: full-width E-W bands alternating warm-light and charcoal granite (~4 m each). */
  bandedPaving(): THREE.Material {
    const key = 'plaza_bands';
    if (Materials.has(key)) return Materials.get(key);
    const tex = genTexture(key, 1024, (ctx, s) => {
      // tile covers 8 m x 8 m: two 4 m bands (light, dark) along v, pavers 0.6 x 0.9 m
      const px = s / 8;
      for (let band = 0; band < 2; band++) {
        const light = band === 0;
        ctx.fillStyle = light ? '#c9b8a4' : '#5c6165'; ctx.fillRect(0, band * s / 2, s, s / 2);
        for (let z = 0; z < 4; z += 0.6) for (let x = ((z / 0.6) % 2) * -0.45; x < 8; x += 0.9) {
          const d = (Math.random() - 0.5) * 18;
          ctx.fillStyle = light ? `rgb(${201 + d},${184 + d},${164 + d})` : `rgb(${92 + d},${97 + d},${101 + d})`;
          ctx.fillRect(x * px + 1, band * s / 2 + z * px + 1, 0.9 * px - 2, 0.6 * px - 2);
        }
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, band * s / 2 + s / 2 - 4, s, 4);
      }
    });
    tex.repeat.set(1 / 8, 1 / 8);
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 });
    Materials.register(key, () => m);
    return Materials.get(key);
  }
  lightPylon(x: number, z: number) {
    const red = new THREE.MeshStandardMaterial({ color: 0x7a2e2a, roughness: 0.25, metalness: 0.05 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.75, 0.5, 24), red); base.position.set(x, PLAZA.central + 0.25, z); this.group.add(base);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 4.0, 24), red); col.position.set(x, PLAZA.central + 2.5, z); col.castShadow = true; this.group.add(col);
    const steel = Materials.get('chrome');
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.35, 0.6, 16), steel); crown.position.set(x, PLAZA.central + 4.8, z); this.group.add(crown);
    const globeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 0.15, roughness: 0.3 });
    Materials.trackEmissive(globeMat, 0.15, 3.0);
    for (let i = 0; i < 3; i++) { const g = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), globeMat); const a = (i / 3) * Math.PI * 2; g.position.set(x + Math.cos(a) * 0.45, PLAZA.central + 5.4, z + Math.sin(a) * 0.45); this.group.add(g); }
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14), steel); top.position.set(x, PLAZA.central + 6.3, z); this.group.add(top);
    this.collision.addBox(x, z, 1.4, 1.4, PLAZA.central, PLAZA.central + 7);
  }
  stageCanopy() {
    const steel = Materials.get('metal_alu'), glass = Materials.get('glass_tint');
    const x0 = -8, x1 = 8, z0 = -25.5, z1 = -17.0, y = PLAZA.north;   // OSM amphitheatre roof way/616479965 (centre 0,-21)
    for (const x of [x0 + 0.5, x1 - 0.5]) for (const z of [z0 + 0.5, z1 - 0.5]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 5.0, 12), steel); c.position.set(x, y + 2.5, z); c.castShadow = true; this.group.add(c); this.collision.addBox(x, z, 0.4, 0.4, y, y + 5); }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 1, 0.12, z1 - z0 + 1), glass); roof.position.set(0, y + 5.1, (z0 + z1) / 2); roof.rotation.x = 0.06; this.group.add(roof);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 1, 0.25, 0.25), steel); beam.position.set(0, y + 5.0, z0 + 0.5); this.group.add(beam);
    const beam2 = beam.clone(); beam2.position.z = z1 - 0.5; this.group.add(beam2);
    // low stage platform
    const stage = new THREE.Mesh(new THREE.BoxGeometry(14, 0.4, 7), Materials.get('wood_dark')); stage.position.set(0, y + 0.2, (z0 + z1) / 2); this.group.add(stage);
    this.collision.addFlatPatch(rect(-7, 7, z0 + 0.5, z1 - 0.5), y + 0.4, 'plaza', 3);
  }
  /** Movable bistro tables + red umbrellas on the central deck (BRV programming). */
  async furniture() {
    const table = Assets.has('retail/gen_cafe_table') ? await Assets.instanced('retail/gen_cafe_table', 60) : null;
    const chair = Assets.has('retail/gen_cafe_chair') ? await Assets.instanced('retail/gen_cafe_chair', 200) : null;
    const red = new THREE.MeshStandardMaterial({ color: 0xc8202a, roughness: 0.9, side: THREE.DoubleSide });
    const umbGeo = new THREE.ConeGeometry(1.4, 0.5, 8, 1, true), poleGeo = new THREE.CylinderGeometry(0.02, 0.02, 2.4, 6);
    const umbrellas = new THREE.InstancedMesh(umbGeo, red, 60), poles = new THREE.InstancedMesh(poleGeo, Materials.get('metal_black'), 60);
    const d = new THREE.Object3D(); let n = 0;
    const spots: [number, number][] = [];
    for (let x = -50; x <= 50; x += 8.5) for (const z of [-8, -1, 6, 11]) if (Math.hypot(x, z) > 11 && (x + z) % 3 !== 0) spots.push([x + ((z * 7) % 3), z]);
    for (const [x, z] of spots.slice(0, 44)) {
      const y = PLAZA.central; table?.add([x, y, z], 0);
      for (let k = 0; k < 3; k++) { const a = k * 2.1 + x * 0.1; chair?.add([x + Math.cos(a) * 0.75, y, z + Math.sin(a) * 0.75], -a + Math.PI / 2); }
      if (n < 60 && (x * 3 + z) % 2 === 0) { d.position.set(x, y + 2.35, z); d.rotation.set(0, 0, 0); d.updateMatrix(); umbrellas.setMatrixAt(n, d.matrix); d.position.y = y + 1.2; d.updateMatrix(); poles.setMatrixAt(n, d.matrix); n++; }
      this.collision.addBox(x, z, 0.8, 0.8, y, y + 1);
    }
    umbrellas.count = n; poles.count = n; umbrellas.castShadow = true; this.group.add(umbrellas, poles);
    for (const im of [table, chair]) if (im) { im.finalize(); this.group.add(im.group); }
  }
  /** Suggested palm / tree / lamp / bench positions for the props & vegetation passes. */
  static palmPositions(): [number, number, number][] {
    const out: [number, number, number][] = [];
    // rows of Canary palms along the Geary edge corner plazas and along Powell/Stockton edges
    for (const x of [-56, -50]) for (const z of [26, 32, 38]) out.push([x, PLAZA.geary, z]);
    for (const x of [50, 56]) for (const z of [26, 32, 38]) out.push([x, PLAZA.geary - 0.6, z]);
    for (const z of [-30, -22, -14]) { out.push([-57, PLAZA.north, z]); out.push([57, PLAZA.north, z]); }
    for (const x of [-45, -30, -15, 15, 30, 45]) out.push([x, PLAZA.north, -37]);
    return out;
  }
}
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
function mergeGeos(g: THREE.BufferGeometry[]) { return mergeGeometries(g, false)!; }
