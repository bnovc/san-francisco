// Streamed tier-0 SF geography. The Union Square square remains the authored legacy scene.
import * as THREE from 'three';
import { BASE } from '../assets/Assets';
import { geoToLocal, localToGeo, ORIGIN_ELEVATION_M } from '../geo/geo';
import type { World } from './World';
import { CitySignals, type CitySignalRecord } from './CitySignals';
import { osmFeatureUrl, type InspectionData } from '../inspection/InspectionData';
import { market15AddressLabels } from '../data/market15AddressLabels';
import { addAreaSurfaces, areaBuildingInfo, areaBuildings, areaLampSpots, areaRoadTags, areaTreeVisible, type AreaBuilding } from './AreaGeography';
import { featherPalmCrown } from './TreeGeometry';
import { Materials } from '../materials/Library';
import { citySurfaceMaterial, groundUvs } from './CitySurfaceMaterials';

type Point = [number, number];
export type CityRoad = [string, string, number, Point[], number];
type Building = AreaBuilding;
type CityLabel = [string, string, number, number, number, number, number, number];
type Area = [string, 'park' | 'water', Point[]];
interface TileData { roads: CityRoad[]; buildings: Building[]; areas: Area[]; labels?: CityLabel[] }
type Tree = [number, number, number, number, number]; // DataSF ID, x, z, shape, approximate size class
interface InspectionRange { startFace: number; endFace: number; data: InspectionData }
interface TreeIndex { schemaVersion: number; tileSizeM: number; coordinateFrame: string; tiles: [number, number, string, number][] }
interface SignalIndex { schemaVersion: number; tileSizeM: number; coordinateFrame: string; tiles: [number, number, string, number][] }
interface CityIndex {
  schemaVersion: number;
  coordinateFrame: string;
  tileSizeM: number;
  bboxWgs84: { west: number; south: number; east: number; north: number };
  dem: { file: string; width: number; height: number; scaleM: number; nodata: number };
  tiles: [number, number, string, number, number, number][];
}

const CORE = 420;
const LOAD_RING = 2;
const KEEP_RING = 3;
const SHADOW_REACH = 180;
const ROAD_FOOT = new Set(['pedestrian', 'footway', 'path', 'cycleway', 'steps']);
// Stylized massing colors, assigned from stable OSM IDs. These do not claim to
// reproduce a building's actual paint, material, or storefront.
const BUILDING_PALETTE = [
  [0xc9b9a1, 0x83776b, 0x736f69], // warm stone
  [0xaeb5ad, 0x68746d, 0x646d68], // sage gray
  [0xb78c7d, 0x795d57, 0x746763], // muted brick
  [0x9bafbb, 0x5c707e, 0x646e74], // blue gray
  [0xc2ac8d, 0x81715c, 0x726d64], // sand
  [0xaaa5a0, 0x66615f, 0x65696b], // concrete
].map(([wall, ground, roof]) => [new THREE.Color(wall), new THREE.Color(ground), new THREE.Color(roof)]);

function buildingColors(id: string): THREE.Color[] {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return BUILDING_PALETTE[(hash >>> 0) % BUILDING_PALETTE.length];
}

function windowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#4d5960'; ctx.fillRect(24, 21, 80, 88);
  ctx.fillStyle = '#a7afb0';
  ctx.fillRect(61, 21, 6, 88);
  ctx.fillRect(24, 63, 80, 5);
  ctx.fillStyle = '#d5d1c8'; ctx.fillRect(17, 109, 94, 6);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

function addTri(out: number[], originX: number, originZ: number, a: [number, number, number], b: [number, number, number], c: [number, number, number]) {
  out.push(a[0] - originX, a[1], a[2] - originZ, b[0] - originX, b[1], b[2] - originZ, c[0] - originX, c[1], c[2] - originZ);
}

function addColoredTri(vertices: number[], colors: number[], originX: number, originZ: number,
  a: [number, number, number], b: [number, number, number], c: [number, number, number], color: THREE.Color) {
  addTri(vertices, originX, originZ, a, b, c);
  for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
}

function mesh(vertices: number[], material: THREE.Material, name: string, colors?: number[], uvs?: number[]): THREE.Mesh | null {
  if (!vertices.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  if (uvs) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  const result = new THREE.Mesh(geometry, material);
  result.name = name;
  result.receiveShadow = true;
  return result;
}

interface LabelAtlas { texture: THREE.CanvasTexture; rects: [number, number, number, number][]; offset: number }

function labelAtlases(labels: CityLabel[]): LabelAtlas[] {
  if (!labels.length) return [];
  const cellW = 256, cellH = 48, cols = 8, perAtlas = 640;
  const atlases: LabelAtlas[] = [];
  for (let start = 0; start < labels.length; start += perAtlas) {
    const chunk = labels.slice(start, start + perAtlas);
    const rows = Math.ceil(chunk.length / cols), width = cellW * cols, height = cellH * rows;
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '700 18px Arial, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    const rects: [number, number, number, number][] = [];
    for (let i = 0; i < chunk.length; i++) {
      const text = chunk[i][1].replace(/\s+/g, ' ').trim();
      const addressRecord = market15AddressLabels[chunk[i][0]];
      const address = addressRecord?.name === text ? addressRecord.address : '';
      const x = (i % cols) * cellW, y = Math.floor(i / cols) * cellH;
      ctx.fillStyle = 'rgba(20, 22, 25, 0.88)'; ctx.fillRect(x + 3, y + 4, cellW - 6, cellH - 8);
      ctx.strokeStyle = 'rgba(255, 245, 220, 0.45)'; ctx.lineWidth = 2; ctx.strokeRect(x + 4, y + 5, cellW - 8, cellH - 10);
      ctx.font = `700 ${address ? 16 : 18}px Arial, sans-serif`;
      let shown = text;
      while (shown.length > 3 && ctx.measureText(shown).width > cellW - 24) shown = `${shown.slice(0, -4)}…`;
      ctx.fillStyle = '#fff8e7'; ctx.fillText(shown, x + cellW / 2, y + (address ? 19 : cellH / 2 + 1));
      if (address) {
        ctx.font = '12px Arial, sans-serif';
        ctx.fillStyle = '#d9e3e1';
        ctx.fillText(address, x + cellW / 2, y + 34);
      }
      rects.push([(x + 3) / width, 1 - (y + cellH - 4) / height, (x + cellW - 3) / width, 1 - (y + 4) / height]);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4; texture.generateMipmaps = true;
    atlases.push({ texture, rects, offset: start });
  }
  return atlases;
}

export class CityBase {
  group = new THREE.Group();
  private index!: CityIndex;
  private dem!: Int16Array;
  private available = new Map<string, string>();
  private treeAvailable = new Map<string, string>();
  private signalAvailable = new Map<string, string>();
  private active = new Map<string, THREE.Group>();
  private activeRoads = new Map<string, CityRoad[]>();
  private loading = new Map<string, Promise<void>>();
  private signalLayer: CitySignals;
  private materials = {
    terrain: new THREE.MeshLambertMaterial({ color: 0x8d987d, side: THREE.DoubleSide }),
    road: citySurfaceMaterial('asphalt'),
    walkway: citySurfaceMaterial('concrete'),
    park: new THREE.MeshLambertMaterial({ color: 0x668a59, side: THREE.DoubleSide }),
    water: new THREE.MeshLambertMaterial({ color: 0x4d829a, side: THREE.DoubleSide }),
    building: new THREE.MeshLambertMaterial({ color: 0xffffff, map: windowTexture(), vertexColors: true, side: THREE.DoubleSide }),
    roof: new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide }),
    trunk: Materials.get('bark'),
    foliage: new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
    palm: new THREE.MeshStandardMaterial({ map: (Materials.get('palm_frond') as THREE.MeshStandardMaterial).map, alphaTest: .36, alphaToCoverage: true, roughness: .9, side: THREE.DoubleSide }),
  };
  private treeShapes = [new THREE.IcosahedronGeometry(1, 1), new THREE.ConeGeometry(1, 2, 7), featherPalmCrown()];
  private distantPalmShape = featherPalmCrown(16, 6);
  private trunkShape = new THREE.CylinderGeometry(1, 1, 1, 6);

  constructor(private world: World) {
    this.group.name = 'city-base';
    this.signalLayer = new CitySignals((x, z) => this.heightAt(x, z));
    this.group.add(this.signalLayer.group);
  }

  async load() {
    const response = await fetch(`${BASE}data/city/index.json`);
    if (!response.ok) throw new Error(`city index HTTP ${response.status}`);
    this.index = await response.json() as CityIndex;
    if (this.index.schemaVersion !== 2 || this.index.coordinateFrame !== 'union-square-local-v1' || this.index.tileSizeM !== CORE) {
      throw new Error('City index schema/frame mismatch');
    }
    const demResponse = await fetch(`${BASE}data/city/${this.index.dem.file}`);
    if (!demResponse.ok) throw new Error(`city DEM HTTP ${demResponse.status}`);
    const buffer = await demResponse.arrayBuffer();
    this.dem = new Int16Array(buffer);
    if (this.dem.length !== this.index.dem.width * this.index.dem.height) throw new Error('City DEM dimensions mismatch');
    for (const [ix, iz, file] of this.index.tiles) this.available.set(`${ix},${iz}`, file);
    const treesResponse = await fetch(`${BASE}data/trees/index.json`);
    if (!treesResponse.ok) throw new Error(`street tree index HTTP ${treesResponse.status}`);
    const treeIndex = await treesResponse.json() as TreeIndex;
    if (treeIndex.schemaVersion !== 1 || treeIndex.tileSizeM !== CORE || treeIndex.coordinateFrame !== 'union-square-local-v1') {
      throw new Error('Street tree index frame mismatch');
    }
    for (const [ix, iz, file] of treeIndex.tiles) this.treeAvailable.set(`${ix},${iz}`, file);
    const signalResponse = await fetch(`${BASE}data/signals/index.json`);
    if (signalResponse.ok) {
      const signalIndex = await signalResponse.json() as SignalIndex;
      if (signalIndex.schemaVersion !== 1 || signalIndex.tileSizeM !== CORE || signalIndex.coordinateFrame !== 'union-square-local-v1') {
        throw new Error('Traffic signal index frame mismatch');
      }
      for (const [ix, iz, file] of signalIndex.tiles) this.signalAvailable.set(`${ix},${iz}`, file);
      await this.signalLayer.load();
    } else {
      console.warn(`city signals index HTTP ${signalResponse.status}; continuing without city signals`);
    }

    const bounds = this.index.bboxWgs84;
    const corners = [
      [bounds.south, bounds.west], [bounds.south, bounds.east],
      [bounds.north, bounds.west], [bounds.north, bounds.east],
    ].map(([lat, lon]) => geoToLocal(lat, lon));
    const minX = Math.min(...corners.map((p) => p.x)), maxX = Math.max(...corners.map((p) => p.x));
    const minZ = Math.min(...corners.map((p) => p.z)), maxZ = Math.max(...corners.map((p) => p.z));
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(maxX - minX, maxZ - minZ), this.materials.water);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set((minX + maxX) / 2, -ORIGIN_ELEVATION_M - .4, (minZ + maxZ) / 2);
    sea.name = 'bay-and-ocean';
    this.group.add(sea);

    const oldFloor = this.world.collision.terrain;
    this.world.collision.terrain = (x, z) => {
      if (Math.abs(x) <= CORE && Math.abs(z) <= CORE) return oldFloor(x, z);
      return this.heightAt(x, z);
    };
  }

  private demAt(x: number, z: number): number | null {
    const p = localToGeo(x, z), b = this.index.bboxWgs84, info = this.index.dem;
    const u = (p.lon - b.west) / (b.east - b.west) * (info.width - 1);
    const v = (b.north - p.lat) / (b.north - b.south) * (info.height - 1);
    if (u < 0 || v < 0 || u >= info.width - 1 || v >= info.height - 1) return null;
    const ix = Math.floor(u), iz = Math.floor(v), tx = u - ix, tz = v - iz;
    let sum = 0, weight = 0;
    for (const [dx, dz, w] of [[0, 0, (1 - tx) * (1 - tz)], [1, 0, tx * (1 - tz)], [0, 1, (1 - tx) * tz], [1, 1, tx * tz]]) {
      const sample = this.dem[(iz + dz) * info.width + ix + dx];
      if (sample === info.nodata) continue;
      sum += sample * w; weight += w;
    }
    return weight ? sum / weight * info.scaleM - ORIGIN_ELEVATION_M : null;
  }

  heightAt(x: number, z: number): number {
    if (Math.abs(x) <= CORE && Math.abs(z) <= CORE) return this.world.terrain.heightAt(x, z);
    const y = this.demAt(x, z) ?? -ORIGIN_ELEVATION_M;
    const distance = Math.max(Math.abs(x), Math.abs(z)) - CORE;
    if (distance >= 80) return y;
    const edge = this.world.terrain.heightAt(Math.max(-CORE, Math.min(CORE, x)), Math.max(-CORE, Math.min(CORE, z)));
    const t = Math.max(0, distance / 80);
    return edge * (1 - t) + y * t;
  }

  private addSurface(vertices: number[], ix: number, iz: number, polygon: Point[], yAt: (x: number, z: number) => number, holes: Point[][] = []) {
    if (polygon.length < 3) return;
    const contour = polygon.map(([x, z]) => new THREE.Vector2(x, z));
    const faces = THREE.ShapeUtils.triangulateShape(contour, holes.map((ring) => ring.map(([x, z]) => new THREE.Vector2(x, z))));
    const all = [...polygon, ...holes.flat()];
    for (const [a, b, c] of faces) {
      const points = [all[a], all[b], all[c]].map(([x, z]) => [x, yAt(x, z), z] as [number, number, number]);
      addTri(vertices, ix * CORE, iz * CORE, points[0], points[1], points[2]);
    }
  }

  private addRibbon(vertices: number[], ix: number, iz: number, a: Point, b: Point, inner: number, outer: number, offset: number) {
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    if (len < .15) return;
    const nx = -dz / len, nz = dx / len;
    const n = Math.max(1, Math.ceil(len / 12));
    for (let k = 0; k < n; k++) {
      const p = k / n, q = (k + 1) / n;
      const vertex = (t: number, d: number): [number, number, number] => {
        const x = a[0] + dx * t + nx * d, z = a[1] + dz * t + nz * d;
        return [x, this.heightAt(x, z) + offset, z];
      };
      const v0 = vertex(p, inner), v1 = vertex(q, inner), v2 = vertex(q, outer), v3 = vertex(p, outer);
      addTri(vertices, ix * CORE, iz * CORE, v0, v1, v2);
      addTri(vertices, ix * CORE, iz * CORE, v0, v2, v3);
    }
  }

  private addLabels(group: THREE.Group, ix: number, iz: number, labels: CityLabel[]) {
    for (const atlas of labelAtlases(labels)) {
      const vertices: number[] = [], uvs: number[] = [];
      for (let i = 0; i < atlas.rects.length; i++) {
        const label = labels[atlas.offset + i];
        const addressRecord = market15AddressLabels[label[0]];
        const address = addressRecord?.name === label[1] ? addressRecord.address : '';
        const [, , sourceX, sourceZ, sourceLength, sourceAngle, buildingLabel, side] = label;
        const { x, z, length: edgeLength, angle } = address && addressRecord.frontage
          ? addressRecord.frontage
          : { x: sourceX, z: sourceZ, length: sourceLength, angle: sourceAngle };
        const width = Math.min(Math.max(2.2, .18 * Math.max(label[1].length, address.length) + .9), Math.max(2.2, edgeLength * .82), 22);
        const height = Math.min(1.35, Math.max(address ? 1 : .72, width * .16));
        const yGround = this.heightAt(x, z);
        // Ground-floor business names read as storefronts; named buildings get
        // a slightly higher panel without pretending to know their actual sign.
        const y = yGround + (buildingLabel ? Math.min(8, Math.max(3.6, .35 * (edgeLength || 10))) : 3.45);
        const tx = Math.cos(angle), tz = Math.sin(angle);
        const nx = Math.sin(angle) * (side || 1), nz = -Math.cos(angle) * (side || 1);
        const [u0, v0, u1, v1] = atlas.rects[i];
        // Put the same lightweight panel on both sides of the wall edge. The
        // coarse importer does not know which mapped side is the storefront,
        // and this keeps names readable from either sidewalk without a camera
        // billboard floating above the block.
        for (const offset of [-.12, .12]) {
          const cx = x + nx * offset - ix * CORE, cz = z + nz * offset - iz * CORE;
          const ax = cx - tx * width / 2, az = cz - tz * width / 2;
          const bx = cx + tx * width / 2, bz = cz + tz * width / 2;
          // Each side has outward-facing triangles and matching UV direction,
          // so text reads normally from either sidewalk instead of mirroring.
          if (offset * (side || 1) < 0) vertices.push(
            ax, y - height / 2, az, bx, y - height / 2, bz, bx, y + height / 2, bz,
            ax, y - height / 2, az, bx, y + height / 2, bz, ax, y + height / 2, az,
          );
          else vertices.push(
            bx, y - height / 2, bz, ax, y - height / 2, az, ax, y + height / 2, az,
            bx, y - height / 2, bz, ax, y + height / 2, az, bx, y + height / 2, bz,
          );
          uvs.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
        }
      }
      const labelMesh = mesh(vertices, new THREE.MeshBasicMaterial({
        map: atlas.texture, transparent: true, alphaTest: .2, depthWrite: false, depthTest: true,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      }), 'business-labels', undefined, uvs);
      if (labelMesh) {
        labelMesh.userData.cityLabel = true;
        labelMesh.userData.labelTexture = atlas.texture;
        group.add(labelMesh);
      } else atlas.texture.dispose();
    }
  }

  private addTrees(group: THREE.Group, ix: number, iz: number, trees: Tree[]) {
    trees = trees.filter(([, x, z]) => areaTreeVisible(x, z));
    if (!trees.length) return;
    const trunk = new THREE.InstancedMesh(this.trunkShape, this.materials.trunk, trees.length);
    trunk.name = 'street-tree-trunks';
    trunk.userData.sharedGeometry = true;
    const treeData = trees.map(([id, , , , size]) => ({
      title: 'Street tree', kind: 'Vegetation', id: String(id),
      facts: [{ label: 'DataSF tree ID', value: String(id) }, { label: 'Approx. size class', value: String(size) }],
      source: 'Street tree inventory by San Francisco Public Works / DataSF. Position and rendered shape may be approximate.',
      sourceUrl: 'https://data.sf.gov/City-Infrastructure/San-Francisco-Street-Tree-Inventory/tkzw-k3nq',
    } satisfies InspectionData));
    trunk.userData.inspectionInstances = treeData;
    const canopies = this.treeShapes.map((geometry, kind) => {
      const count = trees.filter((tree) => tree[3] === kind).length;
      const mesh = new THREE.InstancedMesh(geometry, kind === 2 ? this.materials.palm : this.materials.foliage, count);
      mesh.name = `street-tree-canopy-${kind}`;
      mesh.userData.sharedGeometry = true;
      mesh.userData.inspectionInstances = [] as InspectionData[];
      return mesh;
    });
    const next = [0, 0, 0];
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < trees.length; i++) {
      const [id, x, z, kind, size] = trees[i];
      const y = this.heightAt(x, z);
      const h = [4.8, 6.4, 8.1, 10.3][size] ?? 6.4;
      const stem = kind === 2 ? h * .65 : kind === 1 ? h * .52 : h * .48;
      const radius = kind === 2 ? [.18, .25, .36, .48][size] : [.11, .16, .23, .30][size];
      const canopyRadius = kind === 2 ? h * .39 : kind === 1 ? h * .31 : h * .36;
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(x - ix * CORE, y + stem / 2, z - iz * CORE);
      dummy.scale.set(radius, stem, radius);
      dummy.updateMatrix();
      trunk.setMatrixAt(i, dummy.matrix);
      dummy.position.y = y + (kind === 2 ? stem - .05 : kind === 1 ? h * .73 : h * .72);
      dummy.rotation.y = (id % 47) / 47 * Math.PI * 2;
      dummy.scale.set(canopyRadius, kind === 2 ? canopyRadius : h * .30, canopyRadius);
      dummy.updateMatrix();
      const canopy = canopies[kind];
      const n = next[kind]++;
      canopy.setMatrixAt(n, dummy.matrix);
      canopy.userData.inspectionInstances.push(treeData[i]);
      color.setHex(kind === 1 ? 0x42634b : kind === 2 ? 0xc3c9ad : [0x63834d, 0x567b4c, 0x789158][id % 3]);
      canopy.setColorAt(n, color);
      this.world.collision.addBox(x, z, radius * 2, radius * 2, y, y + stem, 0, `city:${ix},${iz}`);
    }
    trunk.instanceMatrix.needsUpdate = true;
    trunk.computeBoundingSphere();
    group.add(trunk);
    for (const canopy of canopies) if (canopy.count) {
      canopy.instanceMatrix.needsUpdate = true;
      if (canopy.instanceColor) canopy.instanceColor.needsUpdate = true;
      canopy.computeBoundingSphere();
      group.add(canopy);
    }
  }

  private buildTile(ix: number, iz: number, data: TileData, trees: Tree[]): THREE.Group {
    const group = new THREE.Group();
    group.name = `city:${ix},${iz}`;
    group.position.set(ix * CORE, 0, iz * CORE);
    const buildings = areaBuildings(ix, iz, data.buildings);
    const ground: number[] = [], roads: number[] = [], walks: number[] = [];
    const parks: number[] = [], waters: number[] = [], walls: number[] = [], roofs: number[] = [];
    const wallColors: number[] = [], roofColors: number[] = [], wallUvs: number[] = [];
    const wallInspection: InspectionRange[] = [], roofInspection: InspectionRange[] = [];
    const step = 21, cells = CORE / step;
    // 3DEP reports broad water surfaces as exactly 0 m. Keep low lying land where
    // OSM features provide evidence of land; let the sea plane show through elsewhere.
    const occupied = new Uint8Array(cells * cells);
    const mark = (x: number, z: number, radius: number) => {
      const loX = Math.max(0, Math.floor((x - radius - ix * CORE) / step));
      const hiX = Math.min(cells - 1, Math.floor((x + radius - ix * CORE) / step));
      const loZ = Math.max(0, Math.floor((z - radius - iz * CORE) / step));
      const hiZ = Math.min(cells - 1, Math.floor((z + radius - iz * CORE) / step));
      for (let i = loX; i <= hiX; i++) for (let j = loZ; j <= hiZ; j++) occupied[j * cells + i] = 1;
    };
    for (const [, , , points] of data.roads) for (let k = 0; k < points.length - 1; k++) {
      const a = points[k], b = points[k + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 18));
      for (let t = 0; t <= n; t++) mark(a[0] + (b[0] - a[0]) * t / n, a[1] + (b[1] - a[1]) * t / n, 30);
    }
    for (const [, polygon] of buildings) for (const [x, z] of polygon) mark(x, z, 28);
    for (const [, kind, polygon] of data.areas) if (kind === 'park') for (const [x, z] of polygon) mark(x, z, 30);
    for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
      const x = ix * CORE + i * step, z = iz * CORE + j * step;
      const elevation = this.demAt(x + step / 2, z + step / 2);
      if (elevation === null || (Math.abs(elevation + ORIGIN_ELEVATION_M) < .25 && !occupied[j * cells + i])) continue;
      const p = (a: number, b: number) => [a, this.heightAt(a, b) - .025, b] as [number, number, number];
      const a = p(x, z), b = p(x + step, z), c = p(x + step, z + step), d = p(x, z + step);
      addTri(ground, ix * CORE, iz * CORE, a, b, c);
      addTri(ground, ix * CORE, iz * CORE, a, c, d);
    }
    for (const [, kind, polygon] of data.areas) {
      this.addSurface(kind === 'water' ? waters : parks, ix, iz, polygon,
        kind === 'water' ? () => -ORIGIN_ELEVATION_M + .05 : (x, z) => this.heightAt(x, z) + .04);
    }
    for (const [id, kind, width, points, bridge] of data.roads) {
      if (points.length < 2) continue;
      const tags = areaRoadTags(id, (points[0][0] + points.at(-1)![0]) / 2, (points[0][1] + points.at(-1)![1]) / 2);
      // A crossing is road paint, never a concrete path across the carriageway.
      if (tags?.footway === 'crossing') continue;
      const foot = ROAD_FOOT.has(kind), half = width / 2;
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        this.addRibbon(foot ? walks : roads, ix, iz, a, b, -half, half, bridge ? 2.5 : .04);
        if (!foot) {
          const separate = (side: string) => ['separate', 'no'].includes(tags?.[`sidewalk:${side}`] || tags?.['sidewalk:both'] || tags?.sidewalk || '');
          if (!separate('right')) this.addRibbon(walks, ix, iz, a, b, half, half + 1.8, bridge ? 2.6 : .13);
          if (!separate('left')) this.addRibbon(walks, ix, iz, a, b, -half - 1.8, -half, bridge ? 2.6 : .13);
        }
      }
    }
    const tag = `city:${ix},${iz}`;
    for (const [id, polygon, height, heightSource, holes = []] of buildings) {
      if (polygon.length < 3) continue;
      const inspection: InspectionData = {
        title: areaBuildingInfo(id)?.tags.name || 'City base building', kind: 'Building', id,
        facts: [
          { label: 'Approx. height', value: `${height.toFixed(1)} m` },
          { label: 'Height source', value: heightSource.replace(/^osm:/, 'OpenStreetMap ').replace(/^inferred:/, 'Inferred · ') },
        ],
        source: 'OpenStreetMap footprint. This city-base building is stylized massing; its position, height, and appearance may be approximate.',
        sourceUrl: osmFeatureUrl(id),
      };
      const [wallColor, groundColor, roofColor] = buildingColors(id);
      const groundY = polygon.reduce((sum, [x, z]) => sum + this.heightAt(x, z), 0) / polygon.length;
      const top = groundY + height;
      const roofStart = top - Math.min(.45, height * .08);
      const bandTop = Math.min(roofStart - .25, groundY + Math.min(3.8, height * .48));
      const roofStartFace = roofs.length / 9;
      const roofStartIndex = roofs.length;
      this.addSurface(roofs, ix, iz, polygon, () => top, holes);
      for (let i = roofStartIndex; i < roofs.length; i += 3) roofColors.push(roofColor.r, roofColor.g, roofColor.b);
      if (roofs.length > roofStartIndex) roofInspection.push({ startFace: roofStartFace, endFace: roofs.length / 9, data: inspection });
      const wallStartFace = walls.length / 9;
      for (const ring of [polygon, ...holes]) for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < .2) continue;
        const baseA = Math.min(groundY - 3, this.heightAt(a[0], a[1]) - .2);
        const baseB = Math.min(groundY - 3, this.heightAt(b[0], b[1]) - .2);
        const strip = (bottomA: number, bottomB: number, upper: number, color: THREE.Color, v0: number, v1: number) => {
          const p0: [number, number, number] = [a[0], bottomA, a[1]], p1: [number, number, number] = [b[0], bottomB, b[1]];
          const p2: [number, number, number] = [b[0], upper, b[1]], p3: [number, number, number] = [a[0], upper, a[1]];
          addColoredTri(walls, wallColors, ix * CORE, iz * CORE, p0, p1, p2, color);
          addColoredTri(walls, wallColors, ix * CORE, iz * CORE, p0, p2, p3, color);
          const u = Math.hypot(a[0] - b[0], a[1] - b[1]) / 3.3;
          wallUvs.push(0, v0, u, v0, u, v1, 0, v0, u, v1, 0, v1);
        };
        strip(baseA, baseB, bandTop, groundColor, .06, .94);
        strip(bandTop, bandTop, roofStart, wallColor, 1.06, 1.06 + (roofStart - bandTop) / 3.2);
        strip(roofStart, roofStart, top, roofColor, .02, .02);
        this.world.collision.addWall({ ax: a[0], az: a[1], bx: b[0], bz: b[1], y0: Math.min(baseA, baseB), y1: top, tag });
      }
      if (walls.length > wallStartFace * 9) wallInspection.push({ startFace: wallStartFace, endFace: walls.length / 9, data: inspection });
    }
    for (const [vertices, material, name] of [
      [ground, this.materials.terrain, 'ground'], [waters, this.materials.water, 'water'],
      [parks, this.materials.park, 'park'], [roads, this.materials.road, 'roads'],
      [walks, this.materials.walkway, 'walkways'], [walls, this.materials.building, 'buildings'],
      [roofs, this.materials.roof, 'roofs'],
    ] as [number[], THREE.Material, string][]) {
      const m = mesh(vertices, material, name, name === 'buildings' ? wallColors : name === 'roofs' ? roofColors : undefined,
        name === 'buildings' ? wallUvs : name === 'roads' || name === 'walkways' ? groundUvs(vertices, ix * CORE, iz * CORE) : undefined);
      if (m) {
        if (name === 'buildings') m.userData.inspectionRanges = wallInspection;
        if (name === 'roofs') m.userData.inspectionRanges = roofInspection;
        group.add(m);
      }
    }
    addAreaSurfaces(group, ix, iz, (x, z) => this.heightAt(x, z));
    for (const lamp of areaLampSpots(ix, iz)) this.world.collision.addBox(lamp.x, lamp.z, .64, .64, this.heightAt(lamp.x, lamp.z), this.heightAt(lamp.x, lamp.z) + 2, 0, tag);
    this.addLabels(group, ix, iz, data.labels ?? []);
    this.addTrees(group, ix, iz, trees);
    return group;
  }

  private async loadTile(ix: number, iz: number): Promise<void> {
    const key = `${ix},${iz}`, file = this.available.get(key);
    if (!file || this.active.has(key)) return;
    const pending = this.loading.get(key);
    if (pending) return pending;
    const promise = (async () => {
      const response = await fetch(`${BASE}data/city/${file}`);
      if (!response.ok) throw new Error(`city tile ${key} HTTP ${response.status}`);
      const tile = await response.json() as TileData;
      const treeFile = this.treeAvailable.get(key);
      let trees: Tree[] = [];
      if (treeFile) {
        const treeResponse = await fetch(`${BASE}data/trees/${treeFile}`);
        if (!treeResponse.ok) throw new Error(`street trees ${key} HTTP ${treeResponse.status}`);
        trees = await treeResponse.json() as Tree[];
      }
      const signalFile = this.signalAvailable.get(key);
      let signals: CitySignalRecord[] = [];
      if (signalFile) {
        const signalResponse = await fetch(`${BASE}data/signals/${signalFile}`);
        if (!signalResponse.ok) throw new Error(`city signals ${key} HTTP ${signalResponse.status}`);
        signals = await signalResponse.json() as CitySignalRecord[];
      }
      const group = this.buildTile(ix, iz, tile, trees);
      this.active.set(key, group);
      this.activeRoads.set(key, tile.roads);
      this.group.add(group);
      await this.signalLayer.addTile(key, signals);
    })().finally(() => this.loading.delete(key));
    this.loading.set(key, promise);
    return promise;
  }

  async ensureAround(x: number, z: number, ring = 1) {
    const ix = Math.floor(x / CORE), iz = Math.floor(z / CORE);
    const tasks: Promise<void>[] = [];
    for (let a = ix - ring; a <= ix + ring; a++) for (let b = iz - ring; b <= iz + ring; b++) {
      if (Math.abs(a - ix) + Math.abs(b - iz) > ring + 1) continue;
      tasks.push(this.loadTile(a, b));
    }
    await Promise.all(tasks);
  }

  update(x: number, z: number) {
    this.signalLayer.update();
    const ix = Math.floor(x / CORE), iz = Math.floor(z / CORE);
    for (let a = ix - LOAD_RING; a <= ix + LOAD_RING; a++) for (let b = iz - LOAD_RING; b <= iz + LOAD_RING; b++) {
      if (Math.max(Math.abs(a - ix), Math.abs(b - iz)) <= LOAD_RING) void this.loadTile(a, b).catch(console.warn);
    }
    for (const [key, group] of this.active) {
      const [a, b] = key.split(',').map(Number);
      if (Math.max(Math.abs(a - ix), Math.abs(b - iz)) <= KEEP_RING) continue;
      this.group.remove(group);
      group.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || object.userData.sharedGeometry) return;
        object.geometry.dispose();
        if (object.userData.areaMaterial) (object.material as THREE.Material).dispose();
        if (object.userData.cityLabel) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            const texture = (material as THREE.MeshBasicMaterial).map;
            if (texture) texture.dispose();
            material.dispose();
          }
        }
      });
      this.world.collision.removeWallsByTag(`city:${key}`);
      this.signalLayer.removeTile(key);
      this.active.delete(key);
      this.activeRoads.delete(key);
    }
    // Only nearby massing enters the sun's shadow pass. Each tile combines all
    // its buildings into two meshes, so distant casters add a lot of triangles.
    for (const [key, group] of this.active) {
      const [a, b] = key.split(',').map(Number);
      const dx = Math.max(a * CORE - x, 0, x - (a + 1) * CORE);
      const dz = Math.max(b * CORE - z, 0, z - (b + 1) * CORE);
      const cast = dx * dx + dz * dz < SHADOW_REACH * SHADOW_REACH;
      for (const child of group.children) {
        if (child instanceof THREE.Mesh && (child.name === 'buildings' || child.name === 'roofs' || child.name.startsWith('street-tree-'))) child.castShadow = cast;
        if (child instanceof THREE.Mesh && child.name === 'street-tree-canopy-2') child.geometry = cast ? this.treeShapes[2] : this.distantPalmShape;
      }
    }
  }

  roadsNear(x: number, z: number, radius: number): CityRoad[] {
    const roads: CityRoad[] = [];
    for (const tileRoads of this.activeRoads.values()) for (const road of tileRoads) {
      if (road[3].some(([px, pz]) => Math.abs(px - x) < radius && Math.abs(pz - z) < radius)) roads.push(road);
    }
    return roads;
  }

  stats() { return { cityTiles: this.active.size, cityLoading: this.loading.size, ...this.signalLayer.stats() }; }
}
