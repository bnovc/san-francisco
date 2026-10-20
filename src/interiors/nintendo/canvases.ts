// Canvas painters for Nintendo SAN FRANCISCO: window vinyl parade, in-window SF panel, animated game wall, kiosk screens.
import * as THREE from 'three';

export const NRED = '#E60012';

export function canvas(w: number, h: number): HTMLCanvasElement { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export function texOf(c: HTMLCanvasElement): THREE.CanvasTexture { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }

function ellipse(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) { g.beginPath(); g.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2); g.fill(); }
function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); }
function tri(g: CanvasRenderingContext2D, a: [number, number], b: [number, number], c: [number, number]) { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.closePath(); g.fill(); }

// ---- mascots (simple rounded silhouettes in franchise colours; drawn facing +x, baseline at y=0) ----
export type MascotKind = 'mario' | 'luigi' | 'toad' | 'yoshi' | 'kirby' | 'isabelle' | 'link' | 'inkling' | 'pikmin' | 'dk';
export const PARADE: MascotKind[] = ['mario', 'luigi', 'toad', 'yoshi', 'dk', 'link', 'isabelle', 'inkling', 'kirby', 'pikmin'];

export function mascot(g: CanvasRenderingContext2D, kind: MascotKind, x: number, yBase: number, h: number, dir: 1 | -1 = 1) {
  g.save(); g.translate(x, yBase); g.scale(dir, 1);
  const r = h * 0.2;
  const eyes = (cx: number, cy: number, s: number) => { g.fillStyle = '#fff'; ellipse(g, cx, cy, s * 0.55, s * 0.75); ellipse(g, cx + s * 1.1, cy, s * 0.55, s * 0.75); g.fillStyle = '#111'; ellipse(g, cx + s * 0.18, cy + s * 0.05, s * 0.26, s * 0.4); ellipse(g, cx + s * 1.28, cy + s * 0.05, s * 0.26, s * 0.4); };
  if (kind === 'kirby') {
    g.fillStyle = '#e8748f'; ellipse(g, -h * 0.22, -h * 0.1, h * 0.2, h * 0.1); ellipse(g, h * 0.22, -h * 0.1, h * 0.2, h * 0.1);
    g.fillStyle = '#F7A8C4'; ellipse(g, 0, -h * 0.5, h * 0.42, h * 0.4);
    g.fillStyle = '#F7A8C4'; ellipse(g, -h * 0.42, -h * 0.55, h * 0.12, h * 0.16); ellipse(g, h * 0.4, -h * 0.6, h * 0.12, h * 0.16);
    g.fillStyle = '#e8748f'; ellipse(g, -h * 0.2, -h * 0.4, h * 0.07, h * 0.04); ellipse(g, h * 0.28, -h * 0.4, h * 0.07, h * 0.04);
    eyes(h * 0.02, -h * 0.58, h * 0.09); g.restore(); return;
  }
  if (kind === 'pikmin') {
    g.fillStyle = '#E4000F'; ellipse(g, 0, -h * 0.3, h * 0.12, h * 0.2); ellipse(g, 0, -h * 0.6, h * 0.17, h * 0.17);
    g.fillStyle = '#7a3a2a'; g.fillRect(-h * 0.06, -h * 0.14, h * 0.05, h * 0.14); g.fillRect(h * 0.02, -h * 0.14, h * 0.05, h * 0.14);
    g.strokeStyle = '#5a8a2a'; g.lineWidth = h * 0.025; g.beginPath(); g.moveTo(0, -h * 0.76); g.lineTo(0, -h * 0.92); g.stroke();
    g.fillStyle = '#7ACB6C'; ellipse(g, h * 0.07, -h * 0.95, h * 0.09, h * 0.05);
    g.fillStyle = '#111'; ellipse(g, h * 0.1, -h * 0.62, h * 0.03, h * 0.03); g.restore(); return;
  }
  const body: Record<string, string> = { mario: '#2a4fb5', luigi: '#2a4fb5', toad: '#E4000F', yoshi: '#43B047', isabelle: '#7ACB6C', link: '#2E6B3A', inkling: '#1A1A1A', dk: '#6b3f1e' };
  const head: Record<string, string> = { mario: '#f2c9a0', luigi: '#f2c9a0', toad: '#f7e6d8', yoshi: '#43B047', isabelle: '#f7d96b', link: '#f2c9a0', inkling: '#f2c9a0', dk: '#8B4513' };
  const shoe: Record<string, string> = { mario: '#5a3a1a', luigi: '#5a3a1a', toad: '#6b4a2a', yoshi: '#e8742a', isabelle: '#7a5a3a', link: '#5a3a1a', inkling: '#f0f0f0', dk: '#4a2a12' };
  // legs / shoes
  g.fillStyle = shoe[kind]; rr(g, -h * 0.2, -h * 0.12, h * 0.17, h * 0.12, h * 0.05); rr(g, h * 0.04, -h * 0.12, h * 0.17, h * 0.12, h * 0.05);
  // body
  g.fillStyle = body[kind]; ellipse(g, 0, -h * 0.37, h * 0.27, h * 0.27);
  if (kind === 'mario' || kind === 'luigi') { g.fillStyle = kind === 'mario' ? '#E4000F' : '#43B047'; ellipse(g, -h * 0.3, -h * 0.44, h * 0.08, h * 0.14); ellipse(g, h * 0.31, -h * 0.4, h * 0.08, h * 0.14); g.fillStyle = '#f7d000'; ellipse(g, -h * 0.07, -h * 0.4, h * 0.03, h * 0.03); ellipse(g, h * 0.09, -h * 0.4, h * 0.03, h * 0.03); }
  else if (kind === 'dk') { g.fillStyle = '#E4000F'; rr(g, -h * 0.2, -h * 0.5, h * 0.4, h * 0.13, h * 0.04); g.fillStyle = '#8B4513'; ellipse(g, -h * 0.33, -h * 0.4, h * 0.1, h * 0.18); ellipse(g, h * 0.34, -h * 0.4, h * 0.1, h * 0.18); }
  else if (kind === 'yoshi') { g.fillStyle = '#E4000F'; ellipse(g, -h * 0.24, -h * 0.44, h * 0.14, h * 0.16); g.fillStyle = '#f5f0d8'; ellipse(g, h * 0.06, -h * 0.34, h * 0.16, h * 0.2); }
  else if (kind === 'inkling') { g.fillStyle = '#E5007F'; rr(g, -h * 0.2, -h * 0.28, h * 0.4, h * 0.12, h * 0.03); g.fillStyle = '#1A1A1A'; ellipse(g, -h * 0.3, -h * 0.42, h * 0.07, h * 0.13); ellipse(g, h * 0.31, -h * 0.38, h * 0.07, h * 0.13); }
  else { g.fillStyle = body[kind]; ellipse(g, -h * 0.3, -h * 0.42, h * 0.08, h * 0.13); ellipse(g, h * 0.31, -h * 0.38, h * 0.08, h * 0.13); }
  // head
  g.fillStyle = head[kind];
  if (kind === 'yoshi') { ellipse(g, 0, -h * 0.72, r * 0.9, r); ellipse(g, r * 0.9, -h * 0.66, r * 0.75, r * 0.5); g.fillStyle = '#fff'; ellipse(g, r * 0.35, -h * 0.8, r * 0.28, r * 0.4); g.fillStyle = '#111'; ellipse(g, r * 0.45, -h * 0.8, r * 0.12, r * 0.2); g.fillStyle = '#E4000F'; ellipse(g, -r * 0.8, -h * 0.5, r * 0.6, r * 0.45); }
  else { ellipse(g, 0, -h * 0.72, r, r); eyes(r * 0.15, -h * 0.74, r * 0.28); }
  if (kind === 'mario' || kind === 'luigi') { g.fillStyle = '#3a2a1a'; ellipse(g, r * 0.55, -h * 0.66, r * 0.4, r * 0.12); g.fillStyle = kind === 'mario' ? '#E4000F' : '#43B047'; g.beginPath(); g.arc(0, -h * 0.78, r * 1.02, Math.PI, 0); g.fill(); rr(g, r * 0.2, -h * 0.8, r * 1.2, r * 0.22, r * 0.1); g.fillStyle = '#fff'; ellipse(g, 0, -h * 0.87, r * 0.22, r * 0.22); g.fillStyle = kind === 'mario' ? '#E4000F' : '#43B047'; g.font = `bold ${Math.round(r * 0.36)}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(kind === 'mario' ? 'M' : 'L', 0, -h * 0.87); }
  else if (kind === 'toad') { g.fillStyle = '#fff'; ellipse(g, 0, -h * 0.86, r * 1.35, r * 0.85); g.fillStyle = '#E4000F'; ellipse(g, 0, -h * 0.93, r * 0.42, r * 0.36); ellipse(g, -r * 0.95, -h * 0.84, r * 0.3, r * 0.3); ellipse(g, r * 0.95, -h * 0.84, r * 0.3, r * 0.3); }
  else if (kind === 'link') { g.fillStyle = '#2E6B3A'; tri(g, [-r * 1.05, -h * 0.78], [r * 1.05, -h * 0.78], [-r * 1.4, -h * 1.02]); g.fillStyle = '#f2c9a0'; tri(g, [r * 0.9, -h * 0.7], [r * 1.35, -h * 0.72], [r * 0.9, -h * 0.62]); g.fillStyle = '#e8c860'; ellipse(g, -r * 0.4, -h * 0.84, r * 0.6, r * 0.2); }
  else if (kind === 'isabelle') { g.fillStyle = '#f7d96b'; ellipse(g, -r * 1.0, -h * 0.68, r * 0.3, r * 0.5); ellipse(g, r * 1.0, -h * 0.68, r * 0.3, r * 0.5); g.fillStyle = '#e8c04a'; ellipse(g, 0, -h * 0.95, r * 0.45, r * 0.3); g.fillStyle = '#E4000F'; ellipse(g, r * 0.25, -h * 0.98, r * 0.16, r * 0.14); g.fillStyle = '#111'; ellipse(g, r * 0.95, -h * 0.7, r * 0.12, r * 0.1); }
  else if (kind === 'inkling') { g.fillStyle = '#E5007F'; ellipse(g, -r * 0.2, -h * 0.9, r * 1.1, r * 0.4); ellipse(g, -r * 1.1, -h * 0.66, r * 0.28, r * 0.6); ellipse(g, r * 0.95, -h * 0.62, r * 0.25, r * 0.55); g.fillStyle = '#E5007F'; tri(g, [r * 0.3, -h * 0.64], [r * 1.0, -h * 0.64], [r * 0.65, -h * 0.56]); }
  else if (kind === 'dk') { g.fillStyle = '#c99a6a'; ellipse(g, r * 0.5, -h * 0.66, r * 0.6, r * 0.32); g.fillStyle = '#8B4513'; ellipse(g, -r * 0.6, -h * 0.9, r * 0.35, r * 0.3); }
  g.restore();
}

/** Paints one window-vinyl parade (mascots marching in direction `dir` = +1 toward +u, plus confetti) into the W x H region at the current origin of `g`. */
export interface ParadeSpec { widthM: number; heightM: number; kinds: MascotKind[]; dir: 1 | -1 }
function paradeInto(g: CanvasRenderingContext2D, W: number, H: number, spec: ParadeSpec, floorFrac = 0.62) {
  const { widthM, kinds, dir } = spec;
  const pxPerM = W / widthM;
  const n = kinds.length, step = W / n;
  g.save();
  for (let i = 0; i < n; i++) {
    const h = pxPerM * (kinds[i] === 'pikmin' ? 0.75 : kinds[i] === 'kirby' ? 0.9 : kinds[i] === 'toad' || kinds[i] === 'isabelle' ? 1.1 : 1.35);
    const x = step * (i + 0.5), y = H * floorFrac - Math.abs(Math.sin(i * 1.7)) * pxPerM * 0.12;
    g.globalAlpha = 0.92; mascot(g, kinds[i], x, y, h, dir);
  }
  // confetti stars
  g.globalAlpha = 0.8;
  const cols = ['#E4000F', '#049CD8', '#FBD000', '#43B047', '#E5007F'];
  for (let i = 0; i < 26; i++) { const sx = (i * 197) % W, sy = ((i * 131) % Math.round(H * 0.5)) + H * 0.05; g.fillStyle = cols[i % cols.length]; ellipse(g, sx, sy, 6, 6); }
  g.restore();
}
const PARADE_W = 1024;
/** Transparent window vinyl: a row of mascots marching in direction `dir` (+1 = toward +u of the texture). */
export function paradeTexture(widthM: number, heightM: number, kinds: MascotKind[], dir: 1 | -1, floorFrac = 0.62): THREE.CanvasTexture {
  const W = PARADE_W, H = Math.round(W * heightM / widthM);
  const c = canvas(W, H), g = c.getContext('2d')!;
  paradeInto(g, W, H, { widthM, heightM, kinds, dir }, floorFrac);
  return texOf(c);
}
/** Every window vinyl in one texture (each parade at exactly the pixel size paradeTexture would use, packed into two columns
 *  so the atlas stays under 4096 px) → all vinyls can share one material/mesh. rects[i] = [u0, v0, u1, v1] of spec i. */
export function paradeAtlas(specs: ParadeSpec[]): { texture: THREE.CanvasTexture; rects: [number, number, number, number][] } {
  const W = PARADE_W, cols = [{ x: 0, y: 0 }, { x: W, y: 0 }];
  const place = specs.map((s) => { const h = Math.round(W * s.heightM / s.widthM); const c = cols[0].y <= cols[1].y ? cols[0] : cols[1]; const r = { x: c.x, y: c.y, h }; c.y += h; return r; });
  const H = Math.max(1, cols[0].y, cols[1].y), AW = W * 2;
  const c = canvas(AW, H), g = c.getContext('2d')!;
  specs.forEach((s, i) => { const p = place[i]; g.save(); g.translate(p.x, p.y); paradeInto(g, W, p.h, s); g.restore(); });
  const rects = place.map((p) => [p.x / AW, 1 - (p.y + p.h) / H, (p.x + W) / AW, 1 - p.y / H] as [number, number, number, number]);
  return { texture: texOf(c), rects };
}

/** Nintendo "racetrack" wordmark drawn on ctx inside box (x,y,w,h), white on whatever background. */
export function racetrack(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color = '#ffffff') {
  const lw = h * 0.07;
  g.strokeStyle = color; g.lineWidth = lw; g.beginPath(); g.roundRect(x + lw, y + lw, w - 2 * lw, h - 2 * lw, h / 2); g.stroke();
  g.fillStyle = color; g.font = `bold ${Math.round(h * 0.52)}px "Helvetica Neue", Helvetica, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('Nintendo', x + w / 2, y + h / 2 + h * 0.02);
}

/** Red square window panel "Nintendo / SAN FRANCISCO". */
export function sfPanelTexture(): THREE.CanvasTexture {
  const S = 512, c = canvas(S, S), g = c.getContext('2d')!;
  g.fillStyle = NRED; g.fillRect(0, 0, S, S);
  racetrack(g, S * 0.1, S * 0.24, S * 0.8, S * 0.3);
  g.fillStyle = '#fff'; g.font = `bold ${Math.round(S * 0.085)}px Helvetica, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.letterSpacing = '6px'; g.fillText('SAN FRANCISCO', S / 2, S * 0.68);
  g.font = `${Math.round(S * 0.04)}px Helvetica, Arial, sans-serif`; g.letterSpacing = '2px'; g.fillText('331 POWELL STREET', S / 2, S * 0.8);
  return texOf(c);
}

// ---- animated game wall ----
export const GAME_SCENES = ['Mario Kart World', 'Super Mario Bros. Wonder', 'The Legend of Zelda', 'Splatoon Raiders'];

export class GameWall {
  canvas = canvas(1024, 576);
  texture: THREE.CanvasTexture;
  scene = 0;
  private g = this.canvas.getContext('2d')!;
  private acc = 0;
  private splats: { x: number; y: number; r: number; c: string }[] = [];
  constructor() { this.texture = texOf(this.canvas); this.paint(0); }
  next() { this.scene = (this.scene + 1) % GAME_SCENES.length; this.splats = []; this.paint(0); }
  update(dt: number, t: number) { this.acc += dt; if (this.acc < 1 / 15) return; this.acc = 0; this.paint(t); }
  private title(txt: string) { const g = this.g; g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, 0, 1024, 64); g.fillStyle = '#fff'; g.font = 'bold 36px Helvetica, Arial, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.letterSpacing = '1px'; g.fillText(txt, 24, 32); g.fillStyle = NRED; g.beginPath(); g.roundRect(860, 14, 140, 36, 18); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 22px Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.fillText('DEMO', 930, 33); }
  private paint(t: number) {
    const g = this.g, W = 1024, H = 576;
    if (this.scene === 0) { // Mario Kart: road perspective with scrolling stripes
      const sky = g.createLinearGradient(0, 0, 0, H * 0.55); sky.addColorStop(0, '#2b7bd6'); sky.addColorStop(1, '#9fd6ff'); g.fillStyle = sky; g.fillRect(0, 0, W, H);
      g.fillStyle = '#5ab24c'; g.fillRect(0, H * 0.5, W, H * 0.5);
      g.fillStyle = '#3a3a44'; tri(g, [W * 0.47, H * 0.5], [W * 0.53, H * 0.5], [W, H]); g.beginPath(); g.moveTo(W * 0.47, H * 0.5); g.lineTo(W * 0.53, H * 0.5); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();
      for (let i = 0; i < 12; i++) { const f = ((i / 12 + t * 0.6) % 1); const y = H * 0.5 + f * f * H * 0.5, hw = 6 + f * f * 40; g.fillStyle = i % 2 ? '#f5f5f5' : '#f2c41a'; g.fillRect(W / 2 - hw / 2, y, hw, 6 + f * 24); }
      const karts = [['#E4000F', 0.35], ['#43B047', 0.62], ['#049CD8', 0.5]] as const;
      karts.forEach(([col, kx], i) => { const b = Math.sin(t * 6 + i) * 4; const y = H * 0.72 + i * 40 + b; g.fillStyle = col; rr(g, W * kx - 50, y, 100, 44, 14); g.fillStyle = '#111'; ellipse(g, W * kx - 36, y + 46, 16, 16); ellipse(g, W * kx + 36, y + 46, 16, 16); });
      g.fillStyle = 'rgba(255,255,255,0.9)'; for (let i = 0; i < 4; i++) { const cx = ((i * 260 + t * 25) % (W + 200)) - 100; ellipse(g, cx, 100 + i * 30, 60, 26); ellipse(g, cx + 40, 90 + i * 30, 44, 22); }
      this.title(GAME_SCENES[0]);
    } else if (this.scene === 1) { // Super Mario: side-scroller
      g.fillStyle = '#5c94fc'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#7ACB6C'; for (let i = 0; i < 5; i++) { const cx = ((i * 300 - t * 60) % (W + 300) + W + 300) % (W + 300) - 150; ellipse(g, cx, H * 0.78, 160, 90); }
      g.fillStyle = '#c86a2e'; g.fillRect(0, H * 0.82, W, H * 0.18); g.strokeStyle = '#7a3a12'; g.lineWidth = 3; for (let x = 0; x < W; x += 64) { g.strokeRect(x - ((t * 60) % 64), H * 0.82, 64, 52); g.strokeRect(x - ((t * 60) % 64) + 32, H * 0.82 + 52, 64, 52); }
      for (let i = 0; i < 3; i++) { const bx = ((i * 340 + 200 - t * 60) % (W + 300) + W + 300) % (W + 300) - 150; g.fillStyle = '#f2b41a'; rr(g, bx, H * 0.42, 64, 64, 6); g.fillStyle = '#7a3a12'; g.font = 'bold 44px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', bx + 32, H * 0.42 + 34); }
      const jump = Math.abs(Math.sin(t * 2.2)) * 120;
      mascot(g, 'mario', W * 0.3, H * 0.82 - jump, 150, 1);
      mascot(g, 'luigi', W * 0.18, H * 0.82 - Math.abs(Math.sin(t * 2.2 + 1)) * 90, 160, 1);
      g.fillStyle = '#fff'; for (let i = 0; i < 3; i++) { const cx = ((i * 380 + 100 - t * 20) % (W + 200) + W + 200) % (W + 200) - 100; ellipse(g, cx, 120 + i * 40, 56, 24); ellipse(g, cx + 44, 108 + i * 40, 40, 20); }
      this.title(GAME_SCENES[1]);
    } else if (this.scene === 2) { // Zelda: triforce glow
      const bg = g.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 620); bg.addColorStop(0, '#1e3d2a'); bg.addColorStop(1, '#06110a'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
      const p = 0.75 + 0.25 * Math.sin(t * 1.5), s = 150, cx = W / 2, cy = H / 2 + 40;
      g.shadowColor = `rgba(255,215,80,${p})`; g.shadowBlur = 40 * p; g.fillStyle = `rgb(${Math.round(200 + 55 * p)},${Math.round(170 + 40 * p)},60)`;
      tri(g, [cx, cy - s * 1.6], [cx - s * 0.9, cy], [cx + s * 0.9, cy]); tri(g, [cx - s * 0.9, cy], [cx - s * 1.8, cy + s * 1.6], [cx, cy + s * 1.6]); tri(g, [cx + s * 0.9, cy], [cx, cy + s * 1.6], [cx + s * 1.8, cy + s * 1.6]);
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,0.5)'; for (let i = 0; i < 40; i++) { const sx = (i * 173) % W, sy = ((i * 97) % H); const tw = 0.5 + 0.5 * Math.sin(t * 2 + i); ellipse(g, sx, sy, 2 * tw, 2 * tw); }
      this.title(GAME_SCENES[2]);
    } else { // Splatoon: ink splats
      g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, W, H);
      if (this.splats.length < 60 && Math.random() < 0.6) this.splats.push({ x: Math.random() * W, y: 70 + Math.random() * (H - 70), r: 30 + Math.random() * 90, c: Math.random() < 0.5 ? '#E5007F' : '#B7E200' });
      for (const s of this.splats) { g.fillStyle = s.c; ellipse(g, s.x, s.y, s.r, s.r * 0.8); for (let k = 0; k < 5; k++) { const a = k * 1.3 + s.x; ellipse(g, s.x + Math.cos(a) * s.r * 1.1, s.y + Math.sin(a) * s.r * 0.9, s.r * 0.22, s.r * 0.22); } }
      mascot(g, 'inkling', W * 0.5 + Math.sin(t) * 120, H * 0.85, 220, Math.cos(t) > 0 ? 1 : -1);
      this.title(GAME_SCENES[3]);
    }
    this.texture.needsUpdate = true;
  }
}

// ---- Switch 2 demo kiosk screen (shared by all kiosks) ----
export class KioskScreen {
  canvas = canvas(512, 288);
  texture: THREE.CanvasTexture;
  playing = 0; // seconds left
  private g = this.canvas.getContext('2d')!;
  private acc = 0;
  constructor() { this.texture = texOf(this.canvas); this.idle(); }
  play() { this.playing = 5; }
  update(dt: number, t: number) {
    if (this.playing <= 0) return;
    this.playing -= dt; this.acc += dt; if (this.acc < 1 / 15) { return; } this.acc = 0;
    if (this.playing <= 0) { this.idle(); return; }
    const g = this.g, W = 512, H = 288;
    const hue = (t * 120) % 360; g.fillStyle = `hsl(${hue},80%,45%)`; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 7; i++) { g.fillStyle = `hsla(${(hue + i * 50) % 360},90%,60%,0.8)`; g.fillRect(0, i * 42, W, 20); }
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, H * 0.3, W, H * 0.4);
    g.fillStyle = '#fff'; g.font = 'bold 72px Helvetica, Arial, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
    const x = W - ((t * 260) % (W + 700)); g.fillText('MARIO KART WORLD', x, H / 2);
    g.fillStyle = '#fff'; g.font = 'bold 22px Helvetica, Arial, sans-serif'; g.textAlign = 'right'; g.fillText(`DEMO ${Math.ceil(this.playing)}s`, W - 14, 24);
    this.texture.needsUpdate = true;
  }
  private idle() {
    const g = this.g, W = 512, H = 288;
    g.fillStyle = '#101014'; g.fillRect(0, 0, W, H);
    g.fillStyle = NRED; g.beginPath(); g.roundRect(W * 0.2, H * 0.22, W * 0.6, H * 0.3, 12); g.fill();
    racetrack(g, W * 0.24, H * 0.25, W * 0.52, H * 0.24);
    g.fillStyle = '#fff'; g.font = 'bold 34px Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('Switch 2', W / 2, H * 0.68);
    g.fillStyle = '#9ad'; g.font = '20px Helvetica, Arial, sans-serif'; g.fillText('Press E to play a demo', W / 2, H * 0.86);
    this.texture.needsUpdate = true;
  }
}

/** Static ink-splat texture for the Splatoon corner wall. */
export function splatTexture(): THREE.CanvasTexture {
  const W = 1024, H = 512, c = canvas(W, H), g = c.getContext('2d')!;
  g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, W, H);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 28; i++) { const x = rnd() * W, y = rnd() * H, r = 30 + rnd() * 80; g.fillStyle = rnd() < 0.5 ? '#E5007F' : '#B7E200'; ellipse(g, x, y, r, r * 0.8); for (let k = 0; k < 5; k++) { const a = rnd() * 6.3; ellipse(g, x + Math.cos(a) * r * 1.15, y + Math.sin(a) * r * 0.95, r * 0.2, r * 0.2); } }
  g.fillStyle = '#1A1A1A'; g.font = 'bold 90px Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('SPLATOON', W / 2, H / 2);
  return texOf(c);
}

/** Zone name label (white text on colour) for accent bands. */
export function labelTexture(text: string, bg: string, fg = '#ffffff', w = 1024, h = 128): THREE.CanvasTexture {
  const c = canvas(w, h), g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = `bold ${Math.round(h * 0.55)}px Helvetica, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.letterSpacing = '4px';
  g.fillText(text, w / 2, h / 2 + 2);
  return texOf(c);
}

/** All zone labels in one texture (one w x h row per entry, same pixels as labelTexture) so every label shares a single
 *  material; rows[i] = [v0, v1] texture-v range of entry i (rows stack from the top of the canvas). */
export function labelAtlas(entries: { text: string; bg: string; fg?: string }[], w = 1024, h = 128): { texture: THREE.CanvasTexture; rows: [number, number][] } {
  const n = Math.max(1, entries.length), c = canvas(w, h * n), g = c.getContext('2d')!;
  const rows: [number, number][] = [];
  entries.forEach((e, i) => {
    const y = i * h; g.fillStyle = e.bg; g.fillRect(0, y, w, h);
    g.fillStyle = e.fg ?? '#ffffff'; g.font = `bold ${Math.round(h * 0.55)}px Helvetica, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.letterSpacing = '4px';
    g.fillText(e.text, w / 2, y + h / 2 + 2);
    rows.push([1 - (i + 1) / n, 1 - i / n]);
  });
  return { texture: texOf(c), rows };
}
