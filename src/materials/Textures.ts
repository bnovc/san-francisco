// Procedural texture generation (canvas). All textures are generated at load time — no external images.
import * as THREE from 'three';
import { Rng } from '../util/Rng';

export function makeCanvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

/** Tileable value-noise generator on a lattice of `period` cells. */
export function makeNoise(seed: number, period = 16) {
  const rng = new Rng(seed);
  const lat = new Float32Array(period * period);
  for (let i = 0; i < lat.length; i++) lat[i] = rng.next();
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (u: number, v: number): number => {
    // u,v in [0,1) tile space
    const x = ((u % 1) + 1) % 1 * period, y = ((v % 1) + 1) % 1 * period;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const fx = fade(x - x0), fy = fade(y - y0);
    const a = lat[y0 * period + x0], b = lat[y0 * period + x1];
    const c = lat[y1 * period + x0], d = lat[y1 * period + x1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
}
export function makeFbm(seed: number, octaves = 4, basePeriod = 4) {
  const layers = Array.from({ length: octaves }, (_, i) => makeNoise(seed + i * 101, basePeriod << i));
  return (u: number, v: number) => {
    let s = 0, amp = 0.5, tot = 0;
    for (const n of layers) { s += n(u, v) * amp; tot += amp; amp *= 0.5; }
    return s / tot;
  };
}

export type Painter = (ctx: CanvasRenderingContext2D, size: number) => void;

const cache = new Map<string, THREE.Texture>();

export function genTexture(key: string, size: number, painter: Painter, opts: { srgb?: boolean; repeat?: [number, number]; anisotropy?: number } = {}): THREE.CanvasTexture {
  const k = `${key}:${size}`;
  if (cache.has(k)) return cache.get(k) as THREE.CanvasTexture;
  const [c, ctx] = makeCanvas(size);
  painter(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.anisotropy = opts.anisotropy ?? 8;
  if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  cache.set(k, tex);
  return tex;
}

/** Build a normal map from a grayscale height painter (Sobel). */
export function genNormalMap(key: string, size: number, heightPainter: Painter, strength = 2): THREE.CanvasTexture {
  const k = `${key}:n:${size}`;
  if (cache.has(k)) return cache.get(k) as THREE.CanvasTexture;
  const [hc, hctx] = makeCanvas(size);
  heightPainter(hctx, size);
  const h = hctx.getImageData(0, 0, size, size).data;
  const [nc, nctx] = makeCanvas(size);
  const out = nctx.createImageData(size, size);
  const H = (x: number, y: number) => h[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
    const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
    let nx = -dx * strength, ny = -dy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * size + x) * 4;
    out.data[i] = (nx * 0.5 + 0.5) * 255; out.data[i + 1] = (ny * 0.5 + 0.5) * 255; out.data[i + 2] = (nz * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  nctx.putImageData(out, 0, 0);
  const tex = new THREE.CanvasTexture(nc);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  cache.set(k, tex);
  return tex;
}

// ---------- pixel helpers ----------
function fillNoise(ctx: CanvasRenderingContext2D, size: number, base: [number, number, number], amp: number, seed: number, octaves = 4, period = 4, speckle = 0) {
  const fbm = makeFbm(seed, octaves, period);
  const rng = new Rng(seed);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = (fbm(x / size, y / size) - 0.5) * 2 * amp;
    let sp = 0;
    if (speckle > 0 && rng.next() < speckle) sp = rng.range(-40, 60);
    const i = (y * size + x) * 4;
    img.data[i] = clamp(base[0] + n + sp); img.data[i + 1] = clamp(base[1] + n + sp); img.data[i + 2] = clamp(base[2] + n + sp); img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
const clamp = (v: number) => Math.max(0, Math.min(255, v));
function rgb(c: [number, number, number], d = 0) { return `rgb(${clamp(c[0] + d)},${clamp(c[1] + d)},${clamp(c[2] + d)})`; }

// ---------- painters ----------
export const Painters = {
  asphalt: (ctx: CanvasRenderingContext2D, s: number) => {
    fillNoise(ctx, s, [52, 52, 55], 10, 11, 5, 8, 0.012);
    // faint patch / crack lines
    ctx.strokeStyle = 'rgba(30,30,32,0.35)'; ctx.lineWidth = s / 512;
    const r = new Rng(5);
    for (let i = 0; i < 6; i++) { ctx.beginPath(); let x = r.range(0, s), y = r.range(0, s); ctx.moveTo(x, y); for (let k = 0; k < 8; k++) { x += r.range(-s / 8, s / 8); y += r.range(-s / 8, s / 8); ctx.lineTo(x, y); } ctx.stroke(); }
  },
  asphaltHeight: (ctx: CanvasRenderingContext2D, s: number) => fillNoise(ctx, s, [128, 128, 128], 60, 11, 5, 8, 0.02),

  /** Sidewalk concrete: tile = 3 m x 3 m with score lines every 1.5 m */
  sidewalk: (ctx: CanvasRenderingContext2D, s: number) => {
    fillNoise(ctx, s, [146, 143, 137], 9, 21, 4, 6, 0.004);
    ctx.strokeStyle = 'rgba(70,70,68,0.55)'; ctx.lineWidth = Math.max(1, s / 256);
    for (let i = 0; i <= 2; i++) { const p = (i * s) / 2; ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, s); ctx.moveTo(0, p); ctx.lineTo(s, p); ctx.stroke(); }
    // stains
    const r = new Rng(3);
    for (let i = 0; i < 14; i++) { ctx.fillStyle = `rgba(60,55,50,${r.range(0.03, 0.12)})`; ctx.beginPath(); ctx.ellipse(r.range(0, s), r.range(0, s), r.range(s / 40, s / 10), r.range(s / 40, s / 12), r.range(0, 3), 0, 7); ctx.fill(); }
  },
  sidewalkHeight: (ctx: CanvasRenderingContext2D, s: number) => {
    fillNoise(ctx, s, [128, 128, 128], 18, 21, 4, 6);
    ctx.strokeStyle = 'rgb(40,40,40)'; ctx.lineWidth = Math.max(2, s / 200);
    for (let i = 0; i <= 2; i++) { const p = (i * s) / 2; ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, s); ctx.moveTo(0, p); ctx.lineTo(s, p); ctx.stroke(); }
  },

  /** Plaza granite pavers: tile = 2.4 m, 4 x 4 pavers, two tones in bands */
  pavers: (ctx: CanvasRenderingContext2D, s: number) => {
    const n = 4, cell = s / n, r = new Rng(7);
    ctx.fillStyle = 'rgb(95,92,90)'; ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dark = r.next() < 0.12;
      const base: [number, number, number] = dark ? [96, 94, 90] : [128, 125, 118];
      ctx.fillStyle = rgb(base, r.range(-10, 10));
      const g = Math.max(1, s / 200);
      ctx.fillRect(x * cell + g, y * cell + g, cell - 2 * g, cell - 2 * g);
      // speckle
      for (let k = 0; k < 60; k++) { ctx.fillStyle = `rgba(${dark ? 200 : 60},${dark ? 200 : 60},${dark ? 200 : 60},0.12)`; ctx.fillRect(x * cell + r.range(g, cell - g), y * cell + r.range(g, cell - g), 1, 1); }
    }
  },
  paversHeight: (ctx: CanvasRenderingContext2D, s: number) => {
    const n = 4, cell = s / n;
    ctx.fillStyle = 'rgb(60,60,60)'; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = 'rgb(140,140,140)';
    const g = Math.max(1, s / 200);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) ctx.fillRect(x * cell + g, y * cell + g, cell - 2 * g, cell - 2 * g);
  },

  /** Ashlar stone blocks: tile = 4 m x 4 m, courses 0.5 m, blocks 1.0 m, running bond */
  ashlar: (base: [number, number, number], seed: number, courses = 8, blocksPerCourse = 4, amp = 8) => (ctx: CanvasRenderingContext2D, s: number) => {
    fillNoise(ctx, s, base, amp, seed, 4, 4, 0.002);
    const ch = s / courses, bw = s / blocksPerCourse, r = new Rng(seed);
    for (let c = 0; c < courses; c++) {
      const off = c % 2 ? bw / 2 : 0;
      for (let b = -1; b < blocksPerCourse + 1; b++) {
        const x = b * bw + off, y = c * ch;
        ctx.fillStyle = `rgba(${r.int(0, 1) ? 255 : 0},${r.int(0, 1) ? 255 : 0},${r.int(0, 1) ? 255 : 0},${r.range(0.015, 0.05)})`;
        ctx.fillRect(x, y, bw, ch);
      }
    }
    ctx.strokeStyle = `rgba(35,30,25,0.55)`; ctx.lineWidth = Math.max(1, s / 340);
    for (let c = 0; c <= courses; c++) { ctx.beginPath(); ctx.moveTo(0, c * ch); ctx.lineTo(s, c * ch); ctx.stroke(); }
    for (let c = 0; c < courses; c++) { const off = c % 2 ? bw / 2 : 0; for (let b = 0; b <= blocksPerCourse; b++) { ctx.beginPath(); ctx.moveTo(b * bw + off, c * ch); ctx.lineTo(b * bw + off, (c + 1) * ch); ctx.stroke(); } }
  },
  ashlarHeight: (courses = 8, blocksPerCourse = 4) => (ctx: CanvasRenderingContext2D, s: number) => {
    fillNoise(ctx, s, [150, 150, 150], 12, 99, 3, 4);
    const ch = s / courses, bw = s / blocksPerCourse;
    ctx.strokeStyle = 'rgb(30,30,30)'; ctx.lineWidth = Math.max(2, s / 170);
    for (let c = 0; c <= courses; c++) { ctx.beginPath(); ctx.moveTo(0, c * ch); ctx.lineTo(s, c * ch); ctx.stroke(); }
    for (let c = 0; c < courses; c++) { const off = c % 2 ? bw / 2 : 0; for (let b = 0; b <= blocksPerCourse; b++) { ctx.beginPath(); ctx.moveTo(b * bw + off, c * ch); ctx.lineTo(b * bw + off, (c + 1) * ch); ctx.stroke(); } }
  },

  /** Brick running bond: tile = 1 m x 1 m (≈ 13 courses, 4 bricks) */
  brick: (base: [number, number, number], seed: number) => (ctx: CanvasRenderingContext2D, s: number) => {
    const courses = 13, per = 4, ch = s / courses, bw = s / per, r = new Rng(seed);
    ctx.fillStyle = 'rgb(150,140,130)'; ctx.fillRect(0, 0, s, s);
    const g = Math.max(1, s / 120);
    for (let c = 0; c < courses; c++) { const off = c % 2 ? bw / 2 : 0; for (let b = -1; b <= per; b++) { ctx.fillStyle = rgb(base, r.range(-22, 22)); ctx.fillRect(b * bw + off + g / 2, c * ch + g / 2, bw - g, ch - g); } }
  },
  brickHeight: () => (ctx: CanvasRenderingContext2D, s: number) => {
    const courses = 13, per = 4, ch = s / courses, bw = s / per;
    ctx.fillStyle = 'rgb(40,40,40)'; ctx.fillRect(0, 0, s, s);
    const g = Math.max(1, s / 120);
    ctx.fillStyle = 'rgb(160,160,160)';
    for (let c = 0; c < courses; c++) { const off = c % 2 ? bw / 2 : 0; for (let b = -1; b <= per; b++) ctx.fillRect(b * bw + off + g / 2, c * ch + g / 2, bw - g, ch - g); }
  },

  plaster: (base: [number, number, number], seed: number, amp = 6) => (ctx: CanvasRenderingContext2D, s: number) => fillNoise(ctx, s, base, amp, seed, 4, 3, 0.001),
  plasterHeight: (ctx: CanvasRenderingContext2D, s: number) => fillNoise(ctx, s, [128, 128, 128], 14, 44, 4, 6),

  /** Polished terrazzo / stone floor: tile 2 m with 2x2 slabs */
  terrazzo: (base: [number, number, number], seed: number) => (ctx: CanvasRenderingContext2D, s: number) => {
    fillNoise(ctx, s, base, 4, seed, 3, 3, 0.03);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = Math.max(1, s / 400);
    ctx.beginPath(); ctx.moveTo(s / 2, 0); ctx.lineTo(s / 2, s); ctx.moveTo(0, s / 2); ctx.lineTo(s, s / 2); ctx.stroke();
  },

  /** Wood planks / grain: tile 1 m */
  wood: (base: [number, number, number], seed: number) => (ctx: CanvasRenderingContext2D, s: number) => {
    const n = makeFbm(seed, 3, 2);
    const img = ctx.createImageData(s, s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const g = Math.sin((x / s) * 40 + n(x / s, y / s) * 12) * 0.5 + 0.5;
      const d = (g - 0.5) * 30 + (n(y / s, x / s) - 0.5) * 20;
      const i = (y * s + x) * 4;
      img.data[i] = clamp(base[0] + d); img.data[i + 1] = clamp(base[1] + d * 0.8); img.data[i + 2] = clamp(base[2] + d * 0.6); img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo((i * s) / 6, 0); ctx.lineTo((i * s) / 6, s); ctx.stroke(); }
  },

  brushedMetal: (base: [number, number, number], seed: number) => (ctx: CanvasRenderingContext2D, s: number) => {
    const r = new Rng(seed);
    ctx.fillStyle = rgb(base); ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < s * 3; i++) { ctx.strokeStyle = `rgba(255,255,255,${r.range(0, 0.08)})`; const y = r.range(0, s); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke(); ctx.strokeStyle = `rgba(0,0,0,${r.range(0, 0.08)})`; const y2 = r.range(0, s); ctx.beginPath(); ctx.moveTo(0, y2); ctx.lineTo(s, y2); ctx.stroke(); }
  },

  /** Road marking strip (white dashed) — tile 6 m: 3 m dash + 3 m gap along X, width in V */
  laneDash: (ctx: CanvasRenderingContext2D, s: number) => {
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(235,235,225,0.92)'; ctx.fillRect(0, s * 0.42, s / 2, s * 0.16);
  },

  fabric: (base: [number, number, number], seed: number) => (ctx: CanvasRenderingContext2D, s: number) => {
    fillNoise(ctx, s, base, 5, seed, 2, 32);
    ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 1;
    for (let i = 0; i < s; i += 3) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, s); ctx.stroke(); }
  },

  grass: (ctx: CanvasRenderingContext2D, s: number) => fillNoise(ctx, s, [70, 110, 40], 18, 77, 5, 6, 0.03),
  soil: (ctx: CanvasRenderingContext2D, s: number) => fillNoise(ctx, s, [60, 45, 30], 12, 78, 4, 8, 0.02),
  bark: (ctx: CanvasRenderingContext2D, s: number) => {
    fillNoise(ctx, s, [90, 72, 55], 14, 79, 4, 3);
    ctx.strokeStyle = 'rgba(30,20,10,0.35)'; const r = new Rng(80);
    for (let i = 0; i < 30; i++) { ctx.lineWidth = r.range(1, 3); ctx.beginPath(); const x = r.range(0, s); ctx.moveTo(x, 0); ctx.lineTo(x + r.range(-20, 20), s); ctx.stroke(); }
  },
  /** Generic leaf card: a rounded leaf cluster silhouette with alpha */
  leafCard: (tint: [number, number, number], seed: number) => (ctx: CanvasRenderingContext2D, s: number) => {
    ctx.clearRect(0, 0, s, s);
    const r = new Rng(seed);
    for (let i = 0; i < 90; i++) {
      const x = s / 2 + r.range(-s * 0.4, s * 0.4), y = s / 2 + r.range(-s * 0.4, s * 0.4);
      const dd = Math.hypot(x - s / 2, y - s / 2) / (s * 0.5);
      if (dd > 0.95) continue;
      ctx.fillStyle = rgb(tint, r.range(-30, 35));
      ctx.beginPath(); ctx.ellipse(x, y, r.range(s / 26, s / 12), r.range(s / 40, s / 18), r.range(0, 3.14), 0, 7); ctx.fill();
    }
  },
  palmFrond: (ctx: CanvasRenderingContext2D, s: number) => {
    ctx.clearRect(0, 0, s, s);
    const r = new Rng(12);
    ctx.strokeStyle = 'rgb(70,95,40)'; ctx.lineWidth = s / 60; ctx.beginPath(); ctx.moveTo(0, s / 2); ctx.lineTo(s, s / 2); ctx.stroke();
    for (let i = 0; i < 70; i++) {
      const x = (i / 70) * s, len = s * 0.42 * (1 - Math.pow(i / 70, 2)) + s * 0.05;
      ctx.strokeStyle = rgb([60, 115, 45], r.range(-25, 25)); ctx.lineWidth = s / 90;
      ctx.beginPath(); ctx.moveTo(x, s / 2); ctx.lineTo(x + s * 0.06, s / 2 - len); ctx.moveTo(x, s / 2); ctx.lineTo(x + s * 0.06, s / 2 + len); ctx.stroke();
    }
  },
};
