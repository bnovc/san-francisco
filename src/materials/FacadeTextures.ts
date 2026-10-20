// Procedural façade tile textures for massing-level buildings (mid/far LOD): 4 bays x 4 floors per tile.
import * as THREE from 'three';
import { genTexture } from './Textures';
import { Rng } from '../util/Rng';

export type FacadeStyle = 'stone_light' | 'stone_dark' | 'stone_warm' | 'brick' | 'glass' | 'concrete' | 'terracotta' | 'plaster' | 'travertine' | 'blank';

interface StyleDef { wall: [number, number, number]; win: [number, number, number]; frame: [number, number, number]; winW: number; winH: number; sill: boolean; courses: boolean; arch?: boolean; grid?: boolean }
const STYLES: Record<FacadeStyle, StyleDef> = {
  stone_light: { wall: [204, 196, 178], win: [70, 84, 96], frame: [70, 60, 50], winW: 0.42, winH: 0.55, sill: true, courses: true },
  stone_warm:  { wall: [186, 168, 138], win: [66, 78, 88], frame: [80, 68, 56], winW: 0.42, winH: 0.58, sill: true, courses: true },
  stone_dark:  { wall: [140, 138, 132], win: [60, 70, 80], frame: [50, 50, 50], winW: 0.44, winH: 0.55, sill: true, courses: true },
  brick:       { wall: [150, 84, 66], win: [70, 84, 96], frame: [230, 226, 216], winW: 0.4, winH: 0.55, sill: true, courses: false },
  glass:       { wall: [110, 122, 132], win: [96, 122, 140], frame: [40, 44, 48], winW: 0.92, winH: 0.72, sill: false, courses: false, grid: true },
  concrete:    { wall: [172, 170, 166], win: [64, 76, 86], frame: [60, 62, 64], winW: 0.62, winH: 0.5, sill: false, courses: false },
  terracotta:  { wall: [226, 220, 206], win: [70, 84, 96], frame: [90, 80, 70], winW: 0.44, winH: 0.6, sill: true, courses: true },
  plaster:     { wall: [222, 208, 176], win: [70, 84, 96], frame: [250, 248, 240], winW: 0.4, winH: 0.58, sill: true, courses: false },
  travertine:  { wall: [196, 176, 150], win: [60, 70, 80], frame: [120, 100, 80], winW: 0.5, winH: 0.45, sill: false, courses: true },
  blank:       { wall: [160, 158, 154], win: [0, 0, 0], frame: [0, 0, 0], winW: 0, winH: 0, sill: false, courses: false },
};
const N = 4; // bays and floors per tile
const rgb = (c: [number, number, number], d = 0) => `rgb(${c[0] + d},${c[1] + d},${c[2] + d})`;

function paintTile(style: FacadeStyle, seed: number, lit: boolean) {
  return (ctx: CanvasRenderingContext2D, s: number) => {
    const d = STYLES[style], r = new Rng(seed), cell = s / N;
    if (lit) { ctx.fillStyle = 'rgb(0,0,0)'; ctx.fillRect(0, 0, s, s); }
    else {
      ctx.fillStyle = rgb(d.wall); ctx.fillRect(0, 0, s, s);
      // subtle noise
      for (let i = 0; i < s * 4; i++) { ctx.fillStyle = `rgba(0,0,0,${r.range(0, 0.06)})`; ctx.fillRect(r.range(0, s), r.range(0, s), r.range(1, 4), r.range(1, 3)); }
      if (d.courses) { ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1; for (let y = 0; y < s; y += cell / 3) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke(); } }
      if (d.grid) { ctx.strokeStyle = rgb(d.frame); ctx.lineWidth = Math.max(2, s / 128); for (let i = 0; i <= N; i++) { ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, s); ctx.moveTo(0, i * cell); ctx.lineTo(s, i * cell); ctx.stroke(); } }
    }
    if (d.winW === 0) return;
    for (let fy = 0; fy < N; fy++) for (let bx = 0; bx < N; bx++) {
      const w = cell * d.winW, h = cell * d.winH;
      const x = bx * cell + (cell - w) / 2, y = fy * cell + (cell - h) * 0.55;
      if (lit) {
        if (r.next() < 0.38) { ctx.fillStyle = `rgba(255,${200 + r.int(0, 40)},${140 + r.int(0, 60)},${r.range(0.6, 1)})`; ctx.fillRect(x, y, w, h); }
        continue;
      }
      // frame
      ctx.fillStyle = rgb(d.frame); ctx.fillRect(x - s / 200, y - s / 200, w + s / 100, h + s / 100);
      // glass with vertical gradient (sky reflection)
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, rgb(d.win, 40)); g.addColorStop(1, rgb(d.win, -15));
      ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
      // mullion
      if (!d.grid) { ctx.fillStyle = rgb(d.frame); ctx.fillRect(x + w / 2 - 1, y, 2, h); ctx.fillRect(x, y + h * 0.45, w, 2); }
      else { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x, y + h, w, cell - h); }
      if (d.sill) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x - s / 100, y + h, w + s / 50, s / 150); ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x - s / 100, y + h + s / 150, w + s / 50, s / 300); }
    }
  };
}

const cache = new Map<string, THREE.MeshStandardMaterial>();
/** Material for a façade with the given style, bay width and floor height (UVs in metres). */
export function facadeMaterial(style: FacadeStyle, bayW: number, floorH: number, seed = 1): THREE.MeshStandardMaterial {
  const key = `${style}|${bayW}|${floorH}|${seed}`;
  let m = cache.get(key);
  if (m) return m;
  const map = genTexture(`facade_${style}_${seed}`, 1024, paintTile(style, seed, false));
  const emis = genTexture(`facade_${style}_${seed}_lit`, 512, paintTile(style, seed, true));
  const mk = (t: THREE.Texture) => { const c = t.clone(); c.repeat.set(1 / (N * bayW), 1 / (N * floorH)); c.needsUpdate = true; return c; };
  m = new THREE.MeshStandardMaterial({ map: mk(map), emissiveMap: mk(emis), emissive: 0xffffff, emissiveIntensity: 0, roughness: style === 'glass' ? 0.35 : 0.85, metalness: style === 'glass' ? 0.3 : 0, envMapIntensity: style === 'glass' ? 1.0 : 0.3 });
  m.name = `facade:${key}`;
  cache.set(key, m);
  return m;
}
export function allFacadeMaterials() { return [...cache.values()]; }
