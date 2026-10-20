// Runtime PBR material library. Names match tools/bpl/bpl_lib.py MATERIAL_LIBRARY so GLB materials are remapped by name.
import * as THREE from 'three';
import { genTexture, genNormalMap, Painters } from './Textures';

type Spec = () => THREE.Material;
const specs = new Map<string, Spec>();
const cache = new Map<string, THREE.Material>();
const emissiveMats: { m: THREE.MeshStandardMaterial; day: number; night: number }[] = [];

function std(o: THREE.MeshStandardMaterialParameters & { nightEmissive?: number }): THREE.MeshStandardMaterial {
  const { nightEmissive, ...rest } = o;
  const m = new THREE.MeshStandardMaterial(rest);
  if (nightEmissive !== undefined) emissiveMats.push({ m, day: o.emissiveIntensity ?? 0, night: nightEmissive });
  return m;
}
function phys(o: THREE.MeshPhysicalMaterialParameters): THREE.MeshPhysicalMaterial { return new THREE.MeshPhysicalMaterial(o); }

const S = 1024;
const tex = {
  asphalt: () => genTexture('asphalt', S, Painters.asphalt),
  asphaltN: () => genNormalMap('asphalt', 512, Painters.asphaltHeight, 1.2),
  sidewalk: () => genTexture('sidewalk', S, Painters.sidewalk),
  sidewalkN: () => genNormalMap('sidewalk', 512, Painters.sidewalkHeight, 2.5),
  pavers: () => genTexture('pavers', S, Painters.pavers),
  paversN: () => genNormalMap('pavers', 512, Painters.paversHeight, 3),
  limestone: () => genTexture('limestone', S, Painters.ashlar([205, 195, 175], 31)),
  sandstone: () => genTexture('sandstone', S, Painters.ashlar([185, 168, 140], 32, 8, 4, 10)),
  graniteGrey: () => genTexture('granite_grey', S, Painters.ashlar([140, 140, 140], 33, 6, 3, 6)),
  graniteDark: () => genTexture('granite_dark', 512, Painters.plaster([62, 62, 66], 34, 8)),
  granitePink: () => genTexture('granite_pink', 512, Painters.ashlar([168, 140, 128], 35, 6, 3, 8)),
  marble: () => genTexture('marble', 512, Painters.plaster([230, 228, 222], 36, 5)),
  terracotta: () => genTexture('terracotta', S, Painters.ashlar([225, 220, 205], 37, 8, 4, 5)),
  ashlarN: () => genNormalMap('ashlar', 512, Painters.ashlarHeight(8, 4), 2.2),
  ashlarN6: () => genNormalMap('ashlar6', 512, Painters.ashlarHeight(6, 3), 2.0),
  brick: () => genTexture('brick', 512, Painters.brick([150, 78, 60], 40)),
  brickN: () => genNormalMap('brick', 512, Painters.brickHeight(), 2.5),
  plasterWhite: () => genTexture('plaster_white', 512, Painters.plaster([232, 230, 224], 41)),
  plasterCream: () => genTexture('plaster_cream', 512, Painters.plaster([222, 205, 170], 42)),
  plasterGrey: () => genTexture('plaster_grey', 512, Painters.plaster([170, 170, 166], 43)),
  plasterN: () => genNormalMap('plaster', 256, Painters.plasterHeight, 0.6),
  concrete: () => genTexture('concrete', 512, Painters.plaster([160, 156, 150], 44, 9)),
  concreteDark: () => genTexture('concrete_dark', 512, Painters.plaster([105, 105, 105], 45, 9)),
  terrazzo: () => genTexture('terrazzo', S, Painters.terrazzo([190, 186, 180], 46)),
  woodOak: () => genTexture('wood_oak', 512, Painters.wood([172, 128, 82], 47)),
  woodDark: () => genTexture('wood_dark', 512, Painters.wood([85, 58, 36], 48)),
  woodLight: () => genTexture('wood_light', 512, Painters.wood([205, 175, 130], 49)),
  alu: () => genTexture('alu', 256, Painters.brushedMetal([190, 192, 196], 50)),
  steel: () => genTexture('steel', 256, Painters.brushedMetal([150, 150, 154], 51)),
  fabricRed: () => genTexture('fabric_red', 256, Painters.fabric([170, 20, 22], 52)),
  fabricGreen: () => genTexture('fabric_green', 256, Painters.fabric([26, 88, 50], 53)),
  fabricBlack: () => genTexture('fabric_black', 256, Painters.fabric([22, 22, 24], 54)),
  fabricCream: () => genTexture('fabric_cream', 256, Painters.fabric([215, 205, 180], 55)),
  grass: () => genTexture('grass', 512, Painters.grass),
  soil: () => genTexture('soil', 256, Painters.soil),
  bark: () => genTexture('bark', 512, Painters.bark),
  leaf: () => genTexture('leaf', 512, Painters.leafCard([60, 120, 40], 60)),
  leafDark: () => genTexture('leaf_dark', 512, Painters.leafCard([35, 85, 35], 61)),
  frond: () => genTexture('frond', 512, Painters.palmFrond),
};

function rep(t: THREE.Texture, x: number, y = x) { const c = t.clone(); c.repeat.set(x, y); c.needsUpdate = true; return c; }

// texture scale: painters describe a tile of N metres; repeat = 1/N per metre when geometry UVs are in metres.
const defs: Record<string, Spec> = {
  asphalt: () => std({ map: rep(tex.asphalt(), 1 / 6), normalMap: rep(tex.asphaltN(), 1 / 6), roughness: 0.95, color: 0xffffff }),
  concrete: () => std({ map: rep(tex.sidewalk(), 1 / 3), normalMap: rep(tex.sidewalkN(), 1 / 3), roughness: 0.9 }),
  concrete_plain: () => std({ map: rep(tex.concrete(), 1 / 2), roughness: 0.9 }),
  concrete_dark: () => std({ map: rep(tex.concreteDark(), 1 / 2), roughness: 0.9 }),
  curb: () => std({ color: 0xb9b6b0, roughness: 0.85 }),
  pavers: () => std({ map: rep(tex.pavers(), 1 / 2.4), normalMap: rep(tex.paversN(), 1 / 2.4), roughness: 0.6 }),
  granite_grey: () => std({ map: rep(tex.graniteGrey(), 1 / 3), normalMap: rep(tex.ashlarN6(), 1 / 3), roughness: 0.82 }),
  granite_dark: () => std({ map: rep(tex.graniteDark(), 1 / 2), roughness: 0.4, color: 0xffffff }),
  granite_pink: () => std({ map: rep(tex.granitePink(), 1 / 3), normalMap: rep(tex.ashlarN6(), 1 / 3), roughness: 0.5 }),
  limestone: () => std({ map: rep(tex.limestone(), 1 / 4), normalMap: rep(tex.ashlarN(), 1 / 4), roughness: 0.85 }),
  sandstone: () => std({ map: rep(tex.sandstone(), 1 / 4), normalMap: rep(tex.ashlarN(), 1 / 4), roughness: 0.85 }),
  marble_white: () => std({ map: rep(tex.marble(), 1 / 2), roughness: 0.3 }),
  terracotta_white: () => std({ map: rep(tex.terracotta(), 1 / 4), normalMap: rep(tex.ashlarN(), 1 / 4), roughness: 0.5 }),
  brick_red: () => std({ map: rep(tex.brick(), 1), normalMap: rep(tex.brickN(), 1), roughness: 0.9 }),
  plaster_white: () => std({ map: rep(tex.plasterWhite(), 1 / 3), normalMap: rep(tex.plasterN(), 1 / 3), roughness: 0.8 }),
  plaster_cream: () => std({ map: rep(tex.plasterCream(), 1 / 3), normalMap: rep(tex.plasterN(), 1 / 3), roughness: 0.8 }),
  plaster_grey: () => std({ map: rep(tex.plasterGrey(), 1 / 3), normalMap: rep(tex.plasterN(), 1 / 3), roughness: 0.8 }),
  glass_clear: () => phys({ color: 0xdfeef5, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.32, envMapIntensity: 1.2, side: THREE.DoubleSide, depthWrite: false }),
  glass_tint: () => phys({ color: 0x6d8a96, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.72, envMapIntensity: 1.4, depthWrite: false }),
  glass_dark: () => std({ color: 0x14202a, roughness: 0.06, metalness: 0.5, envMapIntensity: 1.5 }),
  window_lit: () => std({ color: 0x223040, roughness: 0.08, metalness: 0.3, emissive: 0xffd79a, emissiveIntensity: 0.0, nightEmissive: 1.6, envMapIntensity: 1.2 }),
  metal_black: () => std({ color: 0x141416, roughness: 0.45, metalness: 0.8 }),
  metal_alu: () => std({ map: rep(tex.alu(), 2), color: 0xffffff, roughness: 0.35, metalness: 0.9 }),
  steel: () => std({ map: rep(tex.steel(), 2), roughness: 0.4, metalness: 0.9 }),
  chrome: () => std({ color: 0xe8e8ec, roughness: 0.12, metalness: 1.0 }),
  brass: () => std({ color: 0xc9a24a, roughness: 0.35, metalness: 0.95 }),
  bronze: () => std({ color: 0x5a4025, roughness: 0.5, metalness: 0.85 }),
  bronze_green: () => std({ color: 0x4f7a68, roughness: 0.6, metalness: 0.6 }),
  iron_painted: () => std({ color: 0x1c1c1e, roughness: 0.6, metalness: 0.5 }),
  wood_oak: () => std({ map: rep(tex.woodOak(), 1), roughness: 0.55 }),
  wood_dark: () => std({ map: rep(tex.woodDark(), 1), roughness: 0.55 }),
  wood_light: () => std({ map: rep(tex.woodLight(), 1), roughness: 0.5 }),
  fabric_red: () => std({ map: rep(tex.fabricRed(), 2), roughness: 0.95, side: THREE.DoubleSide }),
  fabric_green: () => std({ map: rep(tex.fabricGreen(), 2), roughness: 0.95, side: THREE.DoubleSide }),
  fabric_black: () => std({ map: rep(tex.fabricBlack(), 2), roughness: 0.95, side: THREE.DoubleSide }),
  fabric_cream: () => std({ map: rep(tex.fabricCream(), 2), roughness: 0.95, side: THREE.DoubleSide }),
  paint_red: () => std({ color: 0xc41218, roughness: 0.5 }),
  paint_white: () => std({ color: 0xeeeeee, roughness: 0.5 }),
  paint_yellow: () => std({ color: 0xf2c41a, roughness: 0.5 }),
  paint_green: () => std({ color: 0x1f6a2e, roughness: 0.5 }),
  paint_blue: () => std({ color: 0x1d3f96, roughness: 0.5 }),
  paint_grey: () => std({ color: 0x808286, roughness: 0.5 }),
  paint_maroon: () => std({ color: 0x6a1420, roughness: 0.45 }),
  paint_cream: () => std({ color: 0xe6d8b3, roughness: 0.45 }),
  paint_silver: () => std({ color: 0xb4b4b8, roughness: 0.35, metalness: 0.6 }),
  car_paint: () => std({ color: 0x9a9a9e, roughness: 0.3, metalness: 0.6, envMapIntensity: 1.3 }),
  plastic_black: () => std({ color: 0x0a0a0a, roughness: 0.7 }),
  plastic_white: () => std({ color: 0xf0f0f0, roughness: 0.6 }),
  plastic_grey: () => std({ color: 0x707074, roughness: 0.7 }),
  rubber: () => std({ color: 0x0c0c0c, roughness: 0.92 }),
  emissive_white: () => std({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4, nightEmissive: 4.0, roughness: 0.5 }),
  emissive_warm: () => std({ color: 0xffe2b0, emissive: 0xffd08a, emissiveIntensity: 0.3, nightEmissive: 4.5, roughness: 0.5 }),
  emissive_red: () => std({ color: 0xff2020, emissive: 0xff1010, emissiveIntensity: 1.5, roughness: 0.5 }),
  emissive_green: () => std({ color: 0x20ff40, emissive: 0x10ff30, emissiveIntensity: 1.5, roughness: 0.5 }),
  emissive_amber: () => std({ color: 0xffa020, emissive: 0xff9010, emissiveIntensity: 1.5, roughness: 0.5 }),
  screen: () => std({ color: 0x0a0a0c, roughness: 0.3, emissive: 0x000000 }),
  leaf_green: () => std({ map: tex.leaf(), transparent: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, color: 0xffffff }),
  leaf_dark: () => std({ map: tex.leafDark(), transparent: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85 }),
  palm_frond: () => std({ map: tex.frond(), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.85 }),
  bark: () => std({ map: rep(tex.bark(), 1, 2), roughness: 0.95 }),
  bark_palm: () => std({ map: rep(tex.bark(), 2, 3), color: 0xc9b89a, roughness: 0.95 }),
  soil: () => std({ map: rep(tex.soil(), 1), roughness: 0.95 }),
  grass: () => std({ map: rep(tex.grass(), 1 / 2), roughness: 0.9 }),
  skin: () => std({ color: 0xcf9f80, roughness: 0.7 }),
  cardboard: () => std({ color: 0xb08a5a, roughness: 0.9 }),
  terrazzo: () => std({ map: rep(tex.terrazzo(), 1 / 2), roughness: 0.25, metalness: 0.05, envMapIntensity: 0.8 }),
  polished_stone_floor: () => std({ map: rep(tex.graniteGrey(), 1 / 3), roughness: 0.2, metalness: 0.05, envMapIntensity: 1.0 }),
  ceiling_white: () => std({ color: 0xf4f4f2, roughness: 0.9 }),
  road_marking_white: () => std({ color: 0xe6e6dc, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  road_marking_yellow: () => std({ color: 0xe8c02a, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
};
for (const [k, v] of Object.entries(defs)) specs.set(k, v);

export const Materials = {
  get(name: string): THREE.Material {
    let m = cache.get(name);
    if (!m) {
      const s = specs.get(name);
      if (!s) { console.warn('[Materials] unknown material', name); m = this.get('plaster_grey'); cache.set(name, m); return m; }
      m = s(); m.name = name; cache.set(name, m);
    }
    return m;
  },
  std(name: string) { return this.get(name) as THREE.MeshStandardMaterial; },
  has(name: string) { return specs.has(name); },
  register(name: string, spec: Spec) { specs.set(name, spec); },
  /** Set emissive intensity of "night" materials: t in [0..1] (0 = day, 1 = night). */
  setNight(t: number) { for (const e of emissiveMats) e.m.emissiveIntensity = e.day + (e.night - e.day) * t; },
  trackEmissive(m: THREE.MeshStandardMaterial, day: number, night: number) { emissiveMats.push({ m, day, night }); },
  /** Replace materials of a loaded GLB by name. */
  remap(root: THREE.Object3D) {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const out = mats.map((mm) => {
        const base = (mm.name || '').replace(/\.\d+$/, '');
        return specs.has(base) ? this.get(base) : mm;
      });
      mesh.material = Array.isArray(mesh.material) ? out : out[0];
      mesh.castShadow = true; mesh.receiveShadow = true;
    });
  },
  /** Environment lighting comes from scene.environment (scaled by scene.environmentIntensity); materials keep envMap = null. */
  setEnvMap(env: THREE.Texture) { (this as any)._env = env; },
  env(): THREE.Texture | null { return (this as any)._env || null; },
};
Materials.register('transit_red', () => new THREE.MeshStandardMaterial({ color: 0x8a2a24, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
Materials.register('roof', () => new THREE.MeshStandardMaterial({ map: (() => { const t = genTexture('roof_gravel', 512, Painters.plaster([92, 90, 86], 93, 14)); const c = t.clone(); c.repeat.set(1 / 6, 1 / 6); c.needsUpdate = true; return c; })(), normalMap: (() => { const t = genNormalMap('asphalt', 512, Painters.asphaltHeight, 1.0); const c = t.clone(); c.repeat.set(1 / 6, 1 / 6); c.needsUpdate = true; return c; })(), roughness: 0.95 }));
Materials.register('roof_light', () => new THREE.MeshStandardMaterial({ color: 0x9a9894, roughness: 0.95 }));
Materials.register('window_back', () => new THREE.MeshStandardMaterial({ color: 0x1b2129, roughness: 0.9 }));
Materials.register('window_lit', () => { const m = new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.9, emissive: 0xffd9a0, emissiveIntensity: 0 }); Materials.trackEmissive(m, 0, 1.4); return m; });
Materials.register('shop_lit', () => { const m = new THREE.MeshStandardMaterial({ color: 0x4a4640, roughness: 0.9, emissive: 0xfff0d6, emissiveIntensity: 0 }); Materials.trackEmissive(m, 0, 2.6); return m; });
Materials.register('road_brick', () => new THREE.MeshStandardMaterial({ map: (() => { const t = genTexture('road_brick', 512, Painters.brick([128, 82, 66], 91)); const c = t.clone(); c.repeat.set(1 / 1.2, 1 / 1.2); c.needsUpdate = true; return c; })(), roughness: 0.9 }));
Materials.register('colusa', () => new THREE.MeshStandardMaterial({ map: (() => { const t = genTexture('colusa', 1024, Painters.ashlar([132, 124, 108], 61, 8, 4, 9)); const c = t.clone(); c.repeat.set(1 / 4, 1 / 4); c.needsUpdate = true; return c; })(), normalMap: (() => { const t = genNormalMap('ashlar', 512, Painters.ashlarHeight(8, 4), 2.2); const c = t.clone(); c.repeat.set(1 / 4, 1 / 4); c.needsUpdate = true; return c; })(), roughness: 0.9 }));
Materials.register('colusa_base', () => new THREE.MeshStandardMaterial({ map: (() => { const t = genTexture('colusa_base', 1024, Painters.ashlar([112, 104, 90], 62, 6, 3, 8)); const c = t.clone(); c.repeat.set(1 / 3, 1 / 3); c.needsUpdate = true; return c; })(), normalMap: (() => { const t = genNormalMap('ashlar6', 512, Painters.ashlarHeight(6, 3), 2.0); const c = t.clone(); c.repeat.set(1 / 3, 1 / 3); c.needsUpdate = true; return c; })(), roughness: 0.9 }));
