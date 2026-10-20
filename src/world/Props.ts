// Street furniture placement from GLB props (instanced): streetlights, signals, meters, hydrants, benches, trash cans, trees.
import * as THREE from 'three';
import { Assets, InstancedModel } from '../assets/Assets';
import type { World } from './World';
import type { App } from '../app/App';
import { Rng } from '../util/Rng';
import { pointInPolygon } from '../util/Geometry2D';
import { mergeGeometries as mergeBufferGeos } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLAZA, Plaza } from './Plaza';
import type { StreetSpec } from './StreetGrid';

export interface SignalHead { mesh: THREE.Object3D; lamps: Record<string, THREE.Mesh>; axis: 'ns' | 'ew'; x: number; z: number }

export class Props {
  group = new THREE.Group();
  rng = new Rng(4242);
  signals: SignalHead[] = [];
  lampPositions: [number, number, number][] = [];
  plazaLampPositions: [number, number, number][] = [];
  constructor(public world: World, public app: App) { this.group.name = 'props'; }

  async build() {
    const w = this.world, t = w.terrain;
    const gy = (x: number, z: number) => t.heightAt(x, z) + 0.15;
    const has = (n: string) => Assets.has(n);
    const inst = async (name: string, cap: number) => (has(name) ? Assets.instanced(name, cap) : null);
    // --- streetlights along every street (both sides, alternating), avoiding intersections and the plaza edges ---
    const teardrop = await inst('street/streetlight_sf_teardrop', 900);
    const pedLamp = await inst('street/streetlight_pedestrian_4m', 400);
    const plazaGlobe = await inst('street/streetlight_plaza_globe', 80);
    const meter = has('street/parking_meter_sf') ? await Assets.instanced('street/parking_meter_sf', 1600, { castShadow: false }) : null;
    const hydrant = await inst('street/hydrant_sf', 120);
    const trash = await inst('street/trashcan_sf', 400);
    const benchPlaza = await inst('street/bench_plaza', 120);
    const newsrack = await inst('street/newsrack', 80);
    const bikeRack = await inst('street/bike_rack', 120);
    const signPole = await inst('street/street_sign_pole', 120);
    const utility = await inst('street/utility_box', 80);
    const bollard = await inst('street/bollard_steel', 200);
    const treeGrate = await inst('street/tree_grate', 900);
    const heart = await inst('street/hearts_sculpture', 4);
    const flag = await inst('street/flagpole_10m', 4);
    const kiosk = await inst('street/garage_kiosk', 4);
    const busShelter = await inst('street/bus_shelter_sfmta', 20);
    const cableStop = await inst('street/cable_car_stop_sign', 8);
    const muniPole = await inst('street/muni_stop_pole', 20);
    const crossings = w.streets.crossings;
    const nearCrossing = (x: number, z: number, d = 9) => crossings.some((c) => Math.abs(c.x - x) < d + c.a.width / 2 && Math.abs(c.z - z) < d + c.b.width / 2);
    const onPlazaEdge = (x: number, z: number) => x > PLAZA.xMin - 8 && x < PLAZA.xMax + 8 && z > PLAZA.zMin - 8 && z < PLAZA.zMax + 8;
    const inBounds = (x: number, z: number) => Math.abs(x) < 400 && Math.abs(z) < 400;
    for (const s of w.streetSpecs) {
      if (s.pedestrian) continue;
      const hw = s.width / 2, lo = Math.min(s.from, s.to), hi = Math.max(s.from, s.to);
      const spacing = 28;
      let k = 0;
      for (let d = lo + 12; d < hi - 6; d += spacing, k++) {
        for (const side of [-1, 1]) {
          if ((k + (side > 0 ? 1 : 0)) % 2) continue; // alternate sides
          const c = s.c + side * (hw + 0.6);
          const x = s.axis === 'ns' ? c : d, z = s.axis === 'ns' ? d : c;
          if (!inBounds(x, z) || nearCrossing(x, z)) continue;
          // pole faces the road: arm toward -side
          const rot = s.axis === 'ns' ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : side > 0 ? Math.PI : 0;
          const ped = onPlazaEdge(x, z) || (s.name === 'Powell Street');
          if (ped) pedLamp?.add([x, gy(x, z), z], rot); else teardrop?.add([x, gy(x, z), z], rot);
          this.lampPositions.push([x + (ped ? 0 : -Math.sin(rot) * 0) , gy(x, z) + (ped ? 4.6 : 7.6), z]);
        }
      }
      // parking meters on parking sides every 6 m
      const park = (side: number) => (side < 0 ? s.parking.left : s.parking.right);
      for (const side of [-1, 1]) {
        if (!park(side)) continue;
        for (let d = lo + 14; d < hi - 10; d += 6.2) {
          const c = s.c + side * (hw + 0.5); const x = s.axis === 'ns' ? c : d, z = s.axis === 'ns' ? d : c;
          if (!inBounds(x, z) || nearCrossing(x, z, 12)) continue;
          meter?.add([x, gy(x, z), z], this.rng.range(-0.1, 0.1) + (s.axis === 'ns' ? 0 : Math.PI / 2));
        }
      }
      // trash cans, newsracks, bike racks, hydrants near corners
      for (let d = lo + 20; d < hi - 10; d += 44) for (const side of [-1, 1]) {
        const c = s.c + side * (hw + 0.9); const x = s.axis === 'ns' ? c : d, z = s.axis === 'ns' ? d : c;
        if (!inBounds(x, z) || nearCrossing(x, z, 5)) continue;
        const r = this.rng.next();
        if (r < 0.45) trash?.add([x, gy(x, z), z], this.rng.range(0, 6.28));
        else if (r < 0.65) newsrack?.add([x, gy(x, z), z], s.axis === 'ns' ? Math.PI / 2 : 0);
        else if (r < 0.85) bikeRack?.add([x, gy(x, z), z], s.axis === 'ns' ? 0 : Math.PI / 2);
        else utility?.add([x, gy(x, z), z], s.axis === 'ns' ? Math.PI / 2 : 0);
      }
      // street trees on Post/Geary/Stockton/Sutter/Mason/Grant sidewalks (Powell has none) every 11 m
      if (!['Powell Street', "O'Farrell Street", 'Ellis Street', 'Bush Street'].includes(s.name)) {
        for (let d = lo + 16; d < hi - 12; d += 11) for (const side of [-1, 1]) {
          const c = s.c + side * (hw + 1.4); const x = s.axis === 'ns' ? c : d, z = s.axis === 'ns' ? d : c;
          if (!inBounds(x, z) || nearCrossing(x, z, 8) || onPlazaEdge(x, z)) continue;
          if (this.rng.next() < 0.35) continue;
          treeGrate?.add([x, gy(x, z) + 0.005, z], 0);
          this.world.treeSpots.push([x, gy(x, z), z]);
        }
      }
    }
    // --- intersections: hydrant, signals (instanced bodies + instanced unlit/lit lamp lenses), street name signs ---
    const signalProto = has('street/traffic_signal_post') ? await Assets.load('street/traffic_signal_post') : null;
    const signalSpots: { x: number; z: number; y: number; rot: number; cx: number; cz: number }[] = [];
    for (const c of crossings) {
      if (!c.signal || !inBounds(c.x, c.z) || Math.abs(c.x) > 360 || Math.abs(c.z) > 360) continue;
      const hwA = c.a.width / 2, hwB = c.b.width / 2;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const x = c.x + sx * (hwA + 0.7), z = c.z + sz * (hwB + 0.7);
        const y = gy(x, z);
        signalSpots.push({ x, z, y, rot: sx < 0 ? (sz < 0 ? Math.PI : Math.PI / 2) : sz < 0 ? -Math.PI / 2 : 0, cx: c.x, cz: c.z });
        if (sx * sz > 0 && hydrant) hydrant.add([x + sx * 1.2, y, z - sz * 1.0], 0);
        if (sx * sz < 0 && signPole) signPole.add([x + sx * 1.5, y, z + sz * 0.5], 0);
      }
    }
    if (signalProto && signalSpots.length) this.buildSignals(signalProto, signalSpots);
    // --- plaza: benches along terraces, globe lamps, hearts at corners, flagpoles, garage kiosks ---
    // metal slat benches at OSM-mapped positions (u = x, v = -z)
    for (const u of [-30.5, -24.5, -18.3, -12.2, 11.8, 17.9, 23.5, 29.6]) benchPlaza?.add([u, PLAZA.central, 14.2], Math.PI);
    for (const u of [-30.4, -24, -18.2, -11.8, 11.8, 18.2, 24, 30.4]) benchPlaza?.add([u, PLAZA.southPromenade, 20.5], 0);
    for (const u of [-18.2, -27.2, -32.5, 18.2, 27.2, 32.5]) benchPlaza?.add([u, PLAZA.north, -19.5], 0);
    for (const z of [-4, 4]) { benchPlaza?.add([-56.5, PLAZA.central, z], Math.PI / 2); benchPlaza?.add([56.5, PLAZA.central, z], -Math.PI / 2); }
    for (const x of [-50, -30, -10, 10, 30, 50]) { plazaGlobe?.add([x, PLAZA.north, -36], 0); plazaGlobe?.add([x, PLAZA.southPromenade, 22.6], 0); this.plazaLampPositions.push([x, PLAZA.north + 4.6, -36], [x, PLAZA.southPromenade + 4.6, 22.6]); }
    for (const z of [-30, -18, -6, 6, 18]) { const y = z < -12 ? PLAZA.north : PLAZA.central; plazaGlobe?.add([-57.5, y, z], 0); plazaGlobe?.add([57.5, y, z], 0); this.plazaLampPositions.push([-57.5, y + 4.6, z], [57.5, y + 4.6, z]); }
    const heartSpots: [number, number, number, number][] = [[-50.1, PLAZA.swCorner, 33.4, 0], [52.4, PLAZA.seCorner, 31.4, 1], [-57, PLAZA.nwCorner, -24, 2], [52, PLAZA.north, -34, 3]];
    if (heart) { for (const [x, y, z, i] of heartSpots) { const k = heart.add([x, y, z], Math.PI / 4 + (i * Math.PI) / 2); heart.setColorAt(k, new THREE.Color().setHSL((i * 0.23 + 0.02) % 1, 0.8, 0.5)); } }
    flag?.add([-8, PLAZA.north, -34], 0); flag?.add([8, PLAZA.north, -34], 0);
    kiosk?.add([-24, PLAZA.central, 8], Math.PI); kiosk?.add([24, PLAZA.central, 8], Math.PI);
    // --- bus shelters (38 Geary at Geary&Stockton north curb; 8/30/45 on Stockton west curb; 2 on Post south curb) ---
    const gearyZ = w.streetSpecs.find((s) => s.name === 'Geary Street')!.c, stocktonX = w.streetSpecs.find((s) => s.name === 'Stockton Street')!.c, postZ = w.streetSpecs.find((s) => s.name === 'Post Street')!.c, powellX = w.streetSpecs.find((s) => s.name === 'Powell Street')!.c;
    busShelter?.add([stocktonX - 6.7 - 1.2, gy(stocktonX - 8, gearyZ - 22), gearyZ - 22], -Math.PI / 2);
    busShelter?.add([stocktonX + 16, gy(stocktonX + 16, gearyZ - 6.7 - 1.2), gearyZ - 6.7 - 1.2], Math.PI);
    busShelter?.add([powellX + 22, gy(powellX + 22, postZ + 6.65 + 1.2), postZ + 6.65 + 1.2], 0);
    muniPole?.add([powellX + 30, gy(powellX + 30, postZ + 7.2), postZ + 7.2], 0);
    // cable car stops: Powell & Post (both sides), Powell & Geary
    cableStop?.add([powellX + 6.9, gy(powellX + 7, postZ + 12), postZ + 12], Math.PI / 2);
    cableStop?.add([powellX - 6.9, gy(powellX - 7, postZ - 12), postZ - 12], -Math.PI / 2);
    cableStop?.add([powellX + 4.6, gy(powellX + 5, gearyZ + 14), gearyZ + 14], Math.PI / 2);
    // bollards at the Maiden Lane mouth and around the subway headhouse
    for (let i = 0; i < 5; i++) bollard?.add([stocktonX + 7.5 + 0.2, gy(stocktonX + 7.7, -2 + i), -2 + i], 0);
    // --- rooftop mechanical boxes on large flat roofs (massing buildings only; façade buildings get their own) ---
    const utilBig = await inst('street/utility_box', 900);
    for (const info of w.buildings.infos.values()) {
      if (info.b.areaM2 < 400 || info.height < 12) continue;
      if (w.detailedIds.has(info.id) || (info.b as any).__part) continue;   // façade-engine buildings carry their own rooftop kit; parts share the outline's roof
      const [cx, cz] = info.b.centroid; if (!inBounds(cx, cz)) continue;
      const n = Math.min(6, Math.floor(info.b.areaM2 / 500));
      for (let i = 0, tries = 0; i < n && tries < 30; tries++) { const ang = this.rng.range(0, 6.28), r = this.rng.range(2, Math.sqrt(info.b.areaM2) * 0.3); const x = cx + Math.cos(ang) * r, z = cz + Math.sin(ang) * r; if (!pointInPolygon(x, z, info.footprint)) continue; utilBig?.add([x, info.topY, z], this.rng.range(0, 3.14), [this.rng.range(1.5, 3.2), this.rng.range(0.9, 1.6), this.rng.range(1.5, 3.0)]); i++; }
    }
    // --- trolleybus overhead wires on the electric-trolley streets (Stockton 30/45, Sutter/Post 2/3, Mason loop) ---
    { const pts: number[] = []; for (const s of w.streetSpecs) { if (!['Stockton Street', 'Sutter Street', 'Post Street', 'Mason Street'].includes(s.name)) continue; const hw = s.width / 2; const lanes = s.oneway ? [s.c + (s.transitLane === 'min' ? -hw + 2.0 : s.transitLane === 'max' ? hw - 2.0 : (s.name === 'Stockton Street' ? -hw + 2.0 : 1.8))] : [s.c - 2.2, s.c + 2.2]; const lo = Math.max(-300, Math.min(s.from, s.to)), hi = Math.min(300, Math.max(s.from, s.to)); for (const lc of lanes) for (const off of [-0.32, 0.32]) { const c = lc + off; for (let d = lo; d < hi; d += 30) { const d2 = Math.min(hi, d + 30); const ax = s.axis === 'ns' ? c : d, az = s.axis === 'ns' ? d : c, bx = s.axis === 'ns' ? c : d2, bz = s.axis === 'ns' ? d2 : c; pts.push(ax, gy(ax, az) + 5.6, az, bx, gy(bx, bz) + 5.6, bz); } } }
      if (pts.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); const wires = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x1a1a1a })); wires.name = 'trolley_wires'; wires.frustumCulled = false; this.group.add(wires); } }
    // --- Maiden Lane: bollards at the mouth, planters + café tables along the lane, Isaia/gallery frontage props ---
    { const planter = await inst('street/planter_square', 40); const tbl = has('retail/gen_cafe_table') ? await Assets.instanced('retail/gen_cafe_table', 30) : null; const ch = has('retail/gen_cafe_chair') ? await Assets.instanced('retail/gen_cafe_chair', 90) : null;
      for (let x = 92; x < 205; x += 9) { for (const z of [-3.6, 3.6]) planter?.add([x, gy(x, z), z], 0); if (x % 18 < 9) { for (const z of [-2.2, 2.2]) { tbl?.add([x + 4, gy(x + 4, z), z], 0); for (let k = 0; k < 2; k++) ch?.add([x + 4 + (k ? 0.7 : -0.7), gy(x + 4, z), z], k ? -Math.PI / 2 : Math.PI / 2); } } }
      for (const im of [planter, tbl, ch]) if (im) { im.finalize(); this.group.add(im.group); } }
    // --- Union Square Alliance banners on the pedestrian lamp posts around the square ---
    const banner = has('street/banner_pole_bracket') ? await Assets.instanced('street/banner_pole_bracket', 200, { castShadow: false }) : null;
    if (banner) for (const [x, y, z] of this.lampPositions) { if (Math.abs(x) < 110 && Math.abs(z) < 90 && this.rng.chance(0.7)) { const k = banner.add([x, y - 4.6 + 3.6, z], Math.abs(x) > Math.abs(z) ? 0 : Math.PI / 2); banner.setColorAt(k, new THREE.Color().setHSL(this.rng.pick([0.0, 0.58, 0.83, 0.12]), 0.75, 0.45)); } }
    for (const im of [teardrop, pedLamp, plazaGlobe, meter, hydrant, trash, benchPlaza, newsrack, bikeRack, signPole, utility, bollard, treeGrate, heart, flag, kiosk, busShelter, cableStop, muniPole, utilBig, banner]) if (im) { im.finalize(); this.group.add(im.group); }
    this.app.scene.add(this.group);
    // collision for lamp posts & benches is skipped (thin) except benches & shelters
    for (const im of [benchPlaza, busShelter, kiosk]) if (im) for (const m of im.meshes) { void m; }
    return this;
  }

  /** Signal masts: one instanced body + five instanced lamp lenses (per-instance colour = lit/unlit) + invisible proxy meshes so
   *  TrafficLights can keep driving `material.emissiveIntensity` per mast without any per-signal draw calls. */
  private buildSignals(proto: THREE.Object3D, spots: { x: number; z: number; y: number; rot: number }[]) {
    proto.updateMatrixWorld(true);
    const lampNames = ['lamp_red', 'lamp_amber', 'lamp_green', 'ped_walk', 'ped_stop'];
    const lampColors: Record<string, [THREE.Color, THREE.Color]> = {
      lamp_red: [new THREE.Color(0x2a0404), new THREE.Color(0xff1a1a)], lamp_amber: [new THREE.Color(0x2a1a02), new THREE.Color(0xffa020)], lamp_green: [new THREE.Color(0x032a08), new THREE.Color(0x22ff55)],
      ped_walk: [new THREE.Color(0x0a0a0a), new THREE.Color(0xf4f4f4)], ped_stop: [new THREE.Color(0x2a0404), new THREE.Color(0xff3a1a)],
    };
    const bodyGeos: THREE.BufferGeometry[] = []; const bodyMats: THREE.Material[] = [];
    const lampGeos = new Map<string, THREE.BufferGeometry>();
    proto.traverse((o) => {
      const m = o as THREE.Mesh; if (!m.isMesh) return;
      const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld);
      if (lampNames.includes(m.name)) { lampGeos.set(m.name, g); return; }
      // keep only position/normal/uv for merging
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      bodyGeos.push(g); bodyMats.push(Array.isArray(m.material) ? m.material[0] : m.material);
    });
    const n = spots.length;
    const d = new THREE.Object3D();
    // body: group by material
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    bodyGeos.forEach((g, i) => { const arr = byMat.get(bodyMats[i]) || []; arr.push(g); byMat.set(bodyMats[i], arr); });
    for (const [mat, geos] of byMat) {
      const merged = mergeBufferGeos(geos); if (!merged) continue;
      const im = new THREE.InstancedMesh(merged, mat, n); im.castShadow = true; im.receiveShadow = true; im.name = 'signal_body';
      spots.forEach((sp, i) => { d.position.set(sp.x, sp.y, sp.z); d.rotation.set(0, sp.rot, 0); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
      im.instanceMatrix.needsUpdate = true; this.group.add(im);
    }
    // lamps: unlit MeshBasicMaterial with per-instance colour
    const lampMeshes = new Map<string, THREE.InstancedMesh>();
    for (const name of lampNames) {
      const g = lampGeos.get(name); if (!g) continue;
      const im = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), n); im.name = `signal_${name}`; im.castShadow = false;
      spots.forEach((sp, i) => { d.position.set(sp.x, sp.y, sp.z); d.rotation.set(0, sp.rot, 0); d.updateMatrix(); im.setMatrixAt(i, d.matrix); im.setColorAt(i, lampColors[name][0]); });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      this.group.add(im); lampMeshes.set(name, im);
    }
    // proxy masts for TrafficLights (invisible; materials expose emissiveIntensity → instance colour)
    const emptyGeo = new THREE.BufferGeometry();
    spots.forEach((sp, i) => {
      const mast = new THREE.Group(); mast.position.set(sp.x, sp.y, sp.z); mast.name = 'signal_proxy';
      const lamps: Record<string, THREE.Mesh> = {};
      for (const name of lampNames) {
        const im = lampMeshes.get(name); if (!im) continue;
        let intensity = 0;
        const proxyMat: any = new THREE.MeshBasicMaterial({ visible: false }); proxyMat.name = `proxy:${name}`; proxyMat.clone = () => proxyMat;
        Object.defineProperty(proxyMat, 'emissiveIntensity', { get: () => intensity, set: (v: number) => { intensity = v; im.setColorAt(i, lampColors[name][v > 0.5 ? 1 : 0]); im.instanceColor!.needsUpdate = true; } });
        const mesh = new THREE.Mesh(emptyGeo, proxyMat); mesh.name = name; mesh.visible = false; mast.add(mesh); lamps[name] = mesh;
      }
      this.group.add(mast);
      this.signals.push({ mesh: mast, lamps, axis: 'ns', x: sp.x, z: sp.z });
    });
  }
}
