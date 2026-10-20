// Vector brand marks + canvas text primitives used by Signage.ts. Everything is drawn with canvas paths/text (no images).
// A logo is a LogoDef: brand colours, a natural aspect (w/h; omitted = fill the sign) and a draw(c) that paints into c.box.

export type Ctx = CanvasRenderingContext2D;
export interface Box { x: number; y: number; w: number; h: number }
export interface TextStyle {
  font?: string; weight?: string | number; italic?: boolean;
  /** letter spacing in em; when defined text is drawn per-glyph (script fonts should leave it undefined). */
  spacing?: number; upper?: boolean; color?: string;
  outline?: string; outlineW?: number; align?: 'left' | 'center' | 'right';
  /** max glyph height as a fraction of the box height (default 1). */
  maxH?: number; /** explicit font size in px (skips fitting). */ size?: number;
  shadow?: string; shadowDx?: number; shadowDy?: number; /** neon-style blur radius in em. */ glow?: number;
}
export interface TextMetrics2 { w: number; asc: number; desc: number }
export interface DrawnText { size: number; w: number; x: number; y: number; chars: number[] }

/** Font stacks (macOS-first, with generic fallbacks). Keys are accepted anywhere a `font` is requested. */
export const FONT: Record<string, string> = {
  serif: 'Georgia, "Times New Roman", Times, serif',
  didot: 'Didot, "Bodoni 72", "Bodoni MT", Georgia, "Times New Roman", serif',
  bodoni: '"Bodoni 72", Didot, "Bodoni MT", Georgia, serif',
  baskerville: 'Baskerville, "Libre Baskerville", Georgia, serif',
  sans: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  futura: 'Futura, "Avenir Next", "Century Gothic", "Helvetica Neue", Helvetica, Arial, sans-serif',
  condensed: '"Arial Narrow", "Helvetica Neue Condensed", "Roboto Condensed", Impact, sans-serif',
  impact: 'Impact, "Arial Black", "Helvetica Neue", sans-serif',
  rounded: '"Arial Rounded MT Bold", "Helvetica Neue", Helvetica, Arial, sans-serif',
  script: '"Snell Roundhand", "Brush Script MT", "Apple Chancery", "Segoe Script", cursive',
  brush: '"Brush Script MT", "Snell Roundhand", "Segoe Script", cursive',
  optima: 'Optima, "Gill Sans", "Helvetica Neue", Helvetica, sans-serif',
  gill: '"Gill Sans", Optima, "Helvetica Neue", Helvetica, sans-serif',
  copperplate: 'Copperplate, "Copperplate Gothic", Georgia, serif',
  mono: 'Menlo, Consolas, "Courier New", monospace',
};
export function resolveFont(f?: string): string { return f ? (FONT[f] || f) : FONT.sans; }
function fontStr(size: number, s: TextStyle) { return `${s.italic ? 'italic ' : ''}${s.weight ?? 600} ${size}px ${resolveFont(s.font)}`; }

export function measureText(ctx: Ctx, str: string, size: number, s: TextStyle): TextMetrics2 {
  ctx.font = fontStr(size, s);
  const m = ctx.measureText(str);
  let w = m.width;
  if (s.spacing !== undefined) { w = 0; const sp = s.spacing * size; for (const ch of str) w += ctx.measureText(ch).width + sp; w -= sp; }
  return { w, asc: m.actualBoundingBoxAscent, desc: m.actualBoundingBoxDescent };
}
/** Font size at which `str` fits inside `box` (both width and glyph height). */
export function fitTextSize(ctx: Ctx, str: string, box: Box, s: TextStyle): number {
  const ref = 100; const m = measureText(ctx, str, ref, s);
  const hh = Math.max(1, m.asc + m.desc);
  return Math.min(box.w / Math.max(1, m.w), (box.h * (s.maxH ?? 1)) / hh) * ref;
}
/** Draw `str` at an explicit size, centred on (x,y) unless align says otherwise. Returns per-glyph centre x positions. */
export function drawTextAt(ctx: Ctx, str: string, x: number, y: number, size: number, s: TextStyle): DrawnText {
  if (s.upper) str = str.toUpperCase();
  ctx.font = fontStr(size, s); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const m = measureText(ctx, str, size, s);
  const baseY = y + (m.asc - m.desc) / 2;
  const x0 = s.align === 'left' ? x : s.align === 'right' ? x - m.w : x - m.w / 2;
  const perChar = s.spacing !== undefined; const sp = (s.spacing || 0) * size;
  const glyphs = [...str]; const chars: number[] = [];
  { let cx = x0; for (const ch of glyphs) { const cw = ctx.measureText(ch).width; chars.push(cx + cw / 2); cx += cw + sp; } }
  const paint = (dx: number, dy: number, stroke: boolean) => {
    if (!perChar) { stroke ? ctx.strokeText(str, x0 + dx, baseY + dy) : ctx.fillText(str, x0 + dx, baseY + dy); return; }
    let cx = x0 + dx;
    for (const ch of glyphs) { const cw = ctx.measureText(ch).width; stroke ? ctx.strokeText(ch, cx, baseY + dy) : ctx.fillText(ch, cx, baseY + dy); cx += cw + sp; }
  };
  if (s.shadow) { ctx.fillStyle = s.shadow; paint((s.shadowDx ?? 0.04) * size, (s.shadowDy ?? 0.05) * size, false); }
  if (s.outline) { ctx.strokeStyle = s.outline; ctx.lineWidth = (s.outlineW ?? 0.08) * size; ctx.lineJoin = 'round'; ctx.miterLimit = 2; paint(0, 0, true); }
  ctx.fillStyle = s.color || '#111';
  if (s.glow) { ctx.save(); ctx.shadowColor = s.color || '#fff'; ctx.shadowBlur = s.glow * size; paint(0, 0, false); paint(0, 0, false); ctx.restore(); }
  paint(0, 0, false);
  return { size, w: m.w, x: x0, y: baseY, chars };
}
/** Fit + draw `str` centred in `box`. */
export function drawText(ctx: Ctx, str: string, box: Box, s: TextStyle = {}): DrawnText {
  if (s.upper) str = str.toUpperCase();
  const size = s.size ?? fitTextSize(ctx, str, box, s);
  const x = s.align === 'left' ? box.x : s.align === 'right' ? box.x + box.w : box.x + box.w / 2;
  return drawTextAt(ctx, str, x, box.y + box.h / 2, size, { ...s, upper: false });
}
/** Draw several lines sharing one font size (largest that fits every line in its row). */
export function drawLines(ctx: Ctx, lines: string[], box: Box, s: TextStyle = {}, gap = 0.15): DrawnText[] {
  const rowsB = rows(box, ...lines.map(() => 1));
  const size = Math.min(...lines.map((l, i) => fitTextSize(ctx, s.upper ? l.toUpperCase() : l, inset(rowsB[i], 0, gap / 2), s)));
  return lines.map((l, i) => drawText(ctx, l, rowsB[i], { ...s, size }));
}
/** Vertical stack: one glyph per row (blade signs). */
export function drawStack(ctx: Ctx, str: string, box: Box, s: TextStyle = {}): void {
  const g = [...(s.upper ? str.toUpperCase() : str)]; const r = rows(box, ...g.map(() => 1));
  const size = Math.min(...g.map((ch, i) => fitTextSize(ctx, ch === ' ' ? 'I' : ch, inset(r[i], 0.05, 0.12), { ...s, spacing: undefined })));
  g.forEach((ch, i) => { if (ch !== ' ') drawText(ctx, ch, r[i], { ...s, size, spacing: undefined, upper: false }); });
}

// ---- box helpers ------------------------------------------------------------------------------------------
export function fitBox(w: number, h: number, aspect: number, pad = 0): Box {
  const pw = w * (1 - 2 * pad), ph = h * (1 - 2 * pad);
  let cw = pw, ch = pw / aspect; if (ch > ph) { ch = ph; cw = ph * aspect; }
  return { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch };
}
export function inset(b: Box, fx: number, fy = fx): Box { return { x: b.x + b.w * fx, y: b.y + b.h * fy, w: b.w * (1 - 2 * fx), h: b.h * (1 - 2 * fy) }; }
export function rows(b: Box, ...fr: number[]): Box[] { const t = fr.reduce((a, c) => a + c, 0); let y = b.y; return fr.map((f) => { const h = b.h * f / t; const r = { x: b.x, y, w: b.w, h }; y += h; return r; }); }
export function cols(b: Box, ...fr: number[]): Box[] { const t = fr.reduce((a, c) => a + c, 0); let x = b.x; return fr.map((f) => { const w = b.w * f / t; const r = { x, y: b.y, w, h: b.h }; x += w; return r; }); }
/** Run `fn` in a 100 × (100/aspect) unit space fitted inside `region` (uniform scale). */
export function mark(ctx: Ctx, region: Box, aspect: number, fn: (ctx: Ctx) => void): Box {
  const b = fitBox(region.w, region.h, aspect); b.x += region.x; b.y += region.y;
  ctx.save(); ctx.translate(b.x, b.y); ctx.scale(b.w / 100, b.w / 100); fn(ctx); ctx.restore(); return b;
}
export function circle(ctx: Ctx, x: number, y: number, r: number, fill?: string | null, stroke?: string, lw = 1) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
export function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill?: string | null, stroke?: string, lw = 1) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
export function star(ctx: Ctx, cx: number, cy: number, ro: number, ri: number, n: number, fill: string, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) { const r = i % 2 ? ri : ro; const a = rot + (i * Math.PI) / n; ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
}
export function poly(ctx: Ctx, pts: number[][], fill: string) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); }
export function stroke(ctx: Ctx, pts: number[][], color: string, lw: number, cap: CanvasLineCap = 'round') {
  ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = cap; ctx.lineJoin = 'round'; ctx.stroke();
}

// ---- logo definitions -------------------------------------------------------------------------------------
export interface LogoCtx {
  ctx: Ctx; box: Box; w: number; h: number; fg: string; bg: string | null; accent: string;
  /** Knock a region out (paint bg colour, or erase when transparent). */ punch: (fn: (ctx: Ctx) => void) => void;
}
export interface LogoDef {
  /** natural content aspect (w/h). Omit to fill the whole padded sign. */ aspect?: number;
  fg: string; bg: string | null; accent?: string; pad?: number; illuminated?: boolean;
  /** brand display name (used for fallbacks / labels). */ name?: string;
  draw: (c: LogoCtx) => void;
}

const T = (c: LogoCtx, s: string, st: TextStyle = {}, b: Box = c.box) => drawText(c.ctx, s, b, { color: c.fg, ...st });
const L = (c: LogoCtx, lines: string[], st: TextStyle = {}, b: Box = c.box, gap?: number) => drawLines(c.ctx, lines, b, { color: c.fg, ...st }, gap);
const rule = (c: LogoCtx, b: Box, color: string, frac = 0.6, thick = 0.08) => { c.ctx.fillStyle = color; c.ctx.fillRect(b.x + b.w * (1 - frac) / 2, b.y + b.h * (0.5 - thick / 2), b.w * frac, Math.max(1, b.h * thick)); };
/** Text-only wordmark definition. */
const wm = (text: string, st: TextStyle, def: Partial<LogoDef> = {}): LogoDef => ({ fg: '#111', bg: null, name: text, ...def, draw: (c) => T(c, text, st) });
/** Two-line wordmark (shared font size unless sizes differ via rows). */
const wm2 = (a: string, sa: TextStyle, b: string, sb: TextStyle, fr: [number, number], def: Partial<LogoDef> = {}): LogoDef => ({
  fg: '#111', bg: null, name: `${a} ${b}`, ...def, draw: (c) => { const [r1, r2] = rows(c.box, fr[0], fr[1]); T(c, a, sa, inset(r1, 0, 0.06)); T(c, b, sb, inset(r2, 0, 0.1)); },
});

function applePath(ctx: Ctx) { // 100 × 120 unit space
  ctx.beginPath(); ctx.moveTo(52, 30); ctx.bezierCurveTo(52, 16, 62, 6, 75, 4); ctx.bezierCurveTo(76, 17, 66, 30, 52, 30); ctx.fill();
  ctx.beginPath(); ctx.moveTo(50, 37); ctx.bezierCurveTo(42, 30, 26, 28, 16, 41); ctx.bezierCurveTo(2, 58, 10, 94, 25, 110);
  ctx.bezierCurveTo(31, 117, 41, 119, 50, 112); ctx.bezierCurveTo(59, 119, 69, 117, 75, 110); ctx.bezierCurveTo(90, 94, 98, 58, 84, 41);
  ctx.bezierCurveTo(74, 28, 58, 30, 50, 37); ctx.closePath(); ctx.fill();
}
const apple = (c: LogoCtx, region = c.box) => {
  c.ctx.fillStyle = c.fg;
  const b = mark(c.ctx, region, 100 / 120, applePath);
  const s = b.w / 100; c.punch((ctx) => { ctx.beginPath(); ctx.arc(b.x + 96 * s, b.y + 60 * s, 17 * s, 0, Math.PI * 2); ctx.fill(); });
};
const swoosh = (ctx: Ctx) => { // 100 × 36
  ctx.beginPath(); ctx.moveTo(100, 0); ctx.bezierCurveTo(74, 14, 44, 30, 24, 34); ctx.bezierCurveTo(13, 36, 5, 34, 3, 27);
  ctx.bezierCurveTo(1, 20, 7, 12, 19, 5); ctx.bezierCurveTo(11, 12, 9, 19, 12, 23); ctx.bezierCurveTo(15, 27, 23, 27, 36, 22);
  ctx.bezierCurveTo(56, 14, 80, 6, 100, 0); ctx.closePath(); ctx.fill();
};
const crown = (ctx: Ctx, color: string) => { // 100 × 70 rolex-style crown
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineCap = 'round';
  const tips = [[10, 26], [30, 12], [50, 6], [70, 12], [90, 26]]; const base = [[24, 54], [37, 54], [50, 54], [63, 54], [76, 54]];
  tips.forEach((t, i) => { ctx.beginPath(); ctx.moveTo(base[i][0], base[i][1]); ctx.lineTo(t[0], t[1]); ctx.lineWidth = 6; ctx.stroke(); circle(ctx, t[0], t[1], 6.5, color); });
  ctx.beginPath(); ctx.moveTo(14, 52); ctx.quadraticCurveTo(50, 44, 86, 52); ctx.lineTo(80, 68); ctx.quadraticCurveTo(50, 62, 20, 68); ctx.closePath(); ctx.fill();
};
const siren = (ctx: Ctx, green: string, white: string) => { // 100 × 100
  circle(ctx, 50, 50, 50, green);
  circle(ctx, 50, 50, 44, null, white, 2.5);
  ctx.fillStyle = white; ctx.strokeStyle = white; ctx.lineCap = 'round';
  // crown + star
  ctx.beginPath(); ctx.moveTo(30, 34); ctx.quadraticCurveTo(50, 24, 70, 34); ctx.lineTo(67, 40); ctx.quadraticCurveTo(50, 32, 33, 40); ctx.closePath(); ctx.fill();
  star(ctx, 50, 20, 6, 2.6, 5, white);
  // face
  ctx.beginPath(); ctx.ellipse(50, 50, 12, 14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = green; ctx.beginPath(); ctx.ellipse(45, 48, 2.2, 1.6, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(55, 48, 2.2, 1.6, 0, 0, Math.PI * 2); ctx.fill();
  poly(ctx, [[50, 50], [47.5, 56], [52.5, 56]], green); stroke(ctx, [[46, 59.5], [54, 59.5]], green, 1.4);
  // hair
  ctx.strokeStyle = white; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(38, 36); ctx.quadraticCurveTo(22, 52, 30, 80); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(62, 36); ctx.quadraticCurveTo(78, 52, 70, 80); ctx.stroke();
  // twin tails
  ctx.lineWidth = 4.5;
  ctx.beginPath(); ctx.moveTo(30, 80); ctx.quadraticCurveTo(16, 84, 14, 66); ctx.quadraticCurveTo(12, 80, 24, 88); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(70, 80); ctx.quadraticCurveTo(84, 84, 86, 66); ctx.quadraticCurveTo(88, 80, 76, 88); ctx.stroke();
};
const flag = (ctx: Ctx, red: string, blue: string) => { // 100 × 70 bank-of-america style flagscape
  for (let k = 0; k < 4; k++) { const x = 4 + k * 18, w = 11, sk = 34; poly(ctx, [[x, 70], [x + w, 70], [x + w + sk, 0], [x + sk, 0]], k % 2 ? blue : red); }
};
const octagon = (ctx: Ctx, color: string) => { // 100 × 100 chase-style pinwheel
  for (let i = 0; i < 4; i++) { ctx.save(); ctx.translate(50, 50); ctx.rotate((i * Math.PI) / 2); ctx.translate(-50, -50); poly(ctx, [[22, 0], [78, 0], [62, 36], [36, 36]], color); ctx.restore(); }
};
const bottle = (ctx: Ctx, color: string) => { // 100 × 130
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(40, 4); ctx.lineTo(60, 4); ctx.lineTo(60, 22); ctx.bezierCurveTo(60, 32, 78, 36, 78, 52); ctx.lineTo(78, 118);
  ctx.quadraticCurveTo(78, 130, 66, 130); ctx.lineTo(34, 130); ctx.quadraticCurveTo(22, 130, 22, 118); ctx.lineTo(22, 52); ctx.bezierCurveTo(22, 36, 40, 32, 40, 22); ctx.closePath(); ctx.fill();
  rrect(ctx, 36, 0, 28, 7, 2, color);
};
const flame = (ctx: Ctx, c: LogoCtx, region: Box) => { // sephora flame
  ctx.fillStyle = c.fg;
  const b = mark(ctx, region, 0.6, (g) => { g.beginPath(); g.moveTo(50, 166); g.bezierCurveTo(5, 130, 15, 60, 50, 0); g.bezierCurveTo(85, 60, 95, 130, 50, 166); g.closePath(); g.fill(); });
  const s = b.w / 100; c.punch((g) => { g.beginPath(); g.moveTo(b.x + 50 * s, b.y + 146 * s); g.bezierCurveTo(b.x + 28 * s, b.y + 120 * s, b.x + 34 * s, b.y + 80 * s, b.x + 50 * s, b.y + 44 * s); g.bezierCurveTo(b.x + 66 * s, b.y + 80 * s, b.x + 72 * s, b.y + 120 * s, b.x + 50 * s, b.y + 146 * s); g.closePath(); g.fill(); });
};
const apeHead = (ctx: Ctx, fg: string) => { // 100 × 100
  circle(ctx, 50, 52, 42, '#c9a266', fg, 5);
  ctx.fillStyle = '#efd9a6'; ctx.beginPath(); ctx.ellipse(50, 66, 28, 22, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(50, 42, 22, 12, 0, 0, Math.PI * 2); ctx.fill();
  circle(ctx, 40, 46, 4, fg); circle(ctx, 60, 46, 4, fg); circle(ctx, 41.5, 44.5, 1.3, '#fff'); circle(ctx, 61.5, 44.5, 1.3, '#fff');
  circle(ctx, 46, 62, 2, fg); circle(ctx, 54, 62, 2, fg);
  ctx.strokeStyle = fg; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(38, 74); ctx.quadraticCurveTo(50, 84, 62, 74); ctx.stroke();
  poly(ctx, [[44, 12], [50, 2], [56, 12]], fg); poly(ctx, [[36, 16], [38, 6], [46, 14]], fg); poly(ctx, [[64, 16], [62, 6], [54, 14]], fg);
};
const calatrava = (ctx: Ctx, color: string) => { // 100 × 100 flared cross
  ctx.fillStyle = color; for (let i = 0; i < 4; i++) { ctx.save(); ctx.translate(50, 50); ctx.rotate((i * Math.PI) / 2); ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(6, -4); ctx.lineTo(16, -46); ctx.quadraticCurveTo(0, -38, -16, -46); ctx.closePath(); ctx.fill(); ctx.restore(); }
  circle(ctx, 50, 50, 8, color);
};
const coral = (ctx: Ctx, color: string) => { // 100 × 100 coral branch
  ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(50, 98); ctx.quadraticCurveTo(48, 70, 42, 50); ctx.quadraticCurveTo(36, 34, 24, 22); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(45, 58); ctx.quadraticCurveTo(58, 42, 72, 14); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(66, 26); ctx.quadraticCurveTo(78, 24, 88, 34); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(38, 40); ctx.quadraticCurveTo(24, 40, 14, 50); ctx.stroke();
};
const muniWorm = (c: LogoCtx) => {
  const st: TextStyle = { font: 'sans', weight: 900, italic: true, spacing: -0.04, color: c.fg, maxH: 0.9 };
  const size = fitTextSize(c.ctx, 'muni', inset(c.box, 0.06, 0.05), st) * 0.92;
  c.ctx.lineJoin = 'round'; c.ctx.lineCap = 'round';
  drawTextAt(c.ctx, 'muni', c.box.x + c.box.w / 2, c.box.y + c.box.h / 2, size, { ...st, outline: c.fg, outlineW: 0.05 });
};

const RED = '#e21a2c', GOLD = '#c9a24a', INK = '#111';
export const LOGOS: Record<string, LogoDef> = {
  // ---- vector marks
  apple: { aspect: 1, fg: '#f4f4f4', bg: null, name: 'Apple', illuminated: true, pad: 0.08, draw: (c) => apple(c) },
  appledark: { aspect: 1, fg: INK, bg: null, name: 'Apple', pad: 0.08, draw: (c) => apple(c) },
  appleplazadoor: { aspect: 1, fg: '#f4f4f4', bg: null, name: 'Apple Union Square', pad: 0.2, illuminated: true, draw: (c) => apple(c) },
  nintendo: { aspect: 3.2, fg: '#e60012', bg: '#ffffff', name: 'Nintendo', illuminated: true, pad: 0.06, draw: (c) => {
    const b = c.box, lw = b.h * 0.085; rrect(c.ctx, b.x + lw / 2, b.y + lw / 2, b.w - lw, b.h - lw, (b.h - lw) / 2, null, c.fg, lw);
    T(c, 'Nintendo', { font: 'rounded', weight: 800, spacing: -0.01 }, inset(b, 0.08, 0.27)); } },
  nintendobox: { aspect: 1, fg: '#ffffff', bg: '#e60012', name: 'Nintendo', illuminated: true, pad: 0.1, draw: (c) => {
    const b = fitBox(c.box.w, c.box.h, 3.2); b.x += c.box.x; b.y += c.box.y; const lw = b.h * 0.085;
    rrect(c.ctx, b.x + lw / 2, b.y + lw / 2, b.w - lw, b.h - lw, (b.h - lw) / 2, null, c.fg, lw);
    T(c, 'Nintendo', { font: 'rounded', weight: 800, spacing: -0.01 }, inset(b, 0.08, 0.27)); } },
  nintendosf: { aspect: 3, fg: '#e60012', bg: '#ffffff', name: 'Nintendo SAN FRANCISCO', illuminated: true, pad: 0.06, draw: (c) => {
    const [r1, r2] = rows(c.box, 0.66, 0.34); const b = fitBox(r1.w, r1.h, 3.2); b.x += r1.x; b.y += r1.y; const lw = b.h * 0.085;
    rrect(c.ctx, b.x + lw / 2, b.y + lw / 2, b.w - lw, b.h - lw, (b.h - lw) / 2, null, c.fg, lw);
    T(c, 'Nintendo', { font: 'rounded', weight: 800, spacing: -0.01 }, inset(b, 0.08, 0.27));
    T(c, 'SAN FRANCISCO', { font: 'sans', weight: 700, spacing: 0.22, color: INK }, inset(r2, 0.1, 0.18)); } },
  tiffany: { aspect: 4.4, fg: INK, bg: '#ffffff', accent: '#0ABAB5', name: 'Tiffany & Co.', draw: (c) => {
    const [r1, r2] = rows(c.box, 0.8, 0.2); T(c, 'TIFFANY & CO.', { font: 'didot', weight: 500, spacing: 0.14 }, inset(r1, 0.03, 0.1)); rule(c, r2, c.accent, 0.5, 0.18); } },
  saks: { aspect: 2.8, fg: INK, bg: '#ffffff', name: 'Saks Fifth Avenue', draw: (c) => {
    const [r1, r2] = rows(c.box, 0.64, 0.36); T(c, 'Saks', { font: 'script', weight: 700, maxH: 0.95 }, inset(r1, 0.05, 0.02)); T(c, 'FIFTH AVENUE', { font: 'didot', weight: 400, spacing: 0.3 }, inset(r2, 0.06, 0.2)); } },
  macys: { aspect: 3.6, fg: INK, bg: null, accent: RED, name: "macy's", illuminated: true, draw: (c) => {
    const [a, b] = cols(c.box, 0.24, 0.76); const r = Math.min(a.w, a.h) * 0.46; star(c.ctx, a.x + a.w / 2, a.y + a.h / 2, r, r * 0.42, 5, c.accent);
    T(c, "macy's", { font: 'sans', weight: 700, spacing: -0.02, maxH: 0.92 }, inset(b, 0.02, 0.04)); } },
  macysred: { aspect: 3.6, fg: RED, bg: null, accent: RED, name: "macy's", illuminated: true, draw: (c) => LOGOS.macys.draw(c) },
  neiman: { aspect: 5.4, fg: '#5a4630', bg: null, name: 'Neiman Marcus', draw: (c) => T(c, 'Neiman Marcus', { font: 'bodoni', weight: 400, spacing: 0.06 }) },
  louisvuitton: { aspect: 6, fg: INK, bg: null, name: 'Louis Vuitton', draw: (c) => {
    const [a, b] = cols(c.box, 0.14, 0.86); const s = fitTextSize(c.ctx, 'V', inset(a, 0.05, 0.05), { font: 'didot', weight: 500 });
    drawTextAt(c.ctx, 'L', a.x + a.w * 0.4, a.y + a.h * 0.55, s * 0.9, { font: 'didot', weight: 500, color: c.fg });
    drawTextAt(c.ctx, 'V', a.x + a.w * 0.56, a.y + a.h * 0.45, s * 0.9, { font: 'didot', weight: 500, color: c.fg });
    T(c, 'LOUIS VUITTON', { font: 'futura', weight: 500, spacing: 0.24 }, inset(b, 0.03, 0.2)); } },
  chanel: { aspect: 2.6, fg: INK, bg: null, name: 'Chanel', draw: (c) => {
    const [r1, r2] = rows(c.box, 0.56, 0.44); const r = r1.h * 0.4, cx = r1.x + r1.w / 2, cy = r1.y + r1.h / 2; c.ctx.strokeStyle = c.fg; c.ctx.lineWidth = r * 0.28; c.ctx.lineCap = 'butt';
    c.ctx.beginPath(); c.ctx.arc(cx - r * 0.5, cy, r, Math.PI * 0.25, Math.PI * 1.75); c.ctx.stroke();
    c.ctx.beginPath(); c.ctx.arc(cx + r * 0.5, cy, r, Math.PI * 1.25, Math.PI * 2.75); c.ctx.stroke();
    T(c, 'CHANEL', { font: 'futura', weight: 700, spacing: 0.2 }, inset(r2, 0.1, 0.16)); } },
  gucci: { aspect: 3.4, fg: INK, bg: null, name: 'Gucci', draw: (c) => T(c, 'GUCCI', { font: 'serif', weight: 700, spacing: 0.16 }) },
  cartier: { aspect: 3, fg: '#d9bb6e', bg: '#5b0f1d', name: 'Cartier', draw: (c) => T(c, 'Cartier', { font: 'script', weight: 700, maxH: 0.9 }, inset(c.box, 0.06, 0.05)) },
  rolex: { aspect: 2.4, fg: GOLD, bg: '#0f6b47', name: 'Rolex', draw: (c) => {
    const [r1, r2] = rows(c.box, 0.5, 0.5); mark(c.ctx, inset(r1, 0.1, 0.1), 100 / 70, (g) => crown(g, c.fg)); T(c, 'ROLEX', { font: 'serif', weight: 700, spacing: 0.14 }, inset(r2, 0.12, 0.14)); } },
  victoriassecret: { aspect: 5.2, fg: '#f3f3f3', bg: '#111111', accent: '#f06292', name: "Victoria's Secret", illuminated: true, draw: (c) => {
    const [r1, r2] = rows(c.box, 0.82, 0.18); T(c, "VICTORIA'S SECRET", { font: 'didot', weight: 400, spacing: 0.18 }, inset(r1, 0.03, 0.12)); rule(c, r2, c.accent, 0.3, 0.22); } },
  pandora: { aspect: 4.2, fg: '#f5f5f5', bg: '#111111', name: 'Pandora', illuminated: true, draw: (c) => {
    const d = T(c, 'PANDORA', { font: 'sans', weight: 500, spacing: 0.2, maxH: 0.62 }, inset(c.box, 0.04, 0.1));
    const ox = d.chars[4], top = d.y - d.size * 0.72, s = d.size * 0.42; poly(c.ctx, [[ox - s / 2, top], [ox - s / 2, top - s * 0.4], [ox - s / 4, top - s * 0.2], [ox, top - s * 0.5], [ox + s / 4, top - s * 0.2], [ox + s / 2, top - s * 0.4], [ox + s / 2, top]], c.fg); } },
  starbucks: { aspect: 1, fg: '#00704a', bg: null, accent: '#ffffff', name: 'Starbucks', illuminated: true, pad: 0.04, draw: (c) => { mark(c.ctx, c.box, 1, (g) => siren(g, c.fg, c.accent)); } },
  walgreens: { aspect: 4.2, fg: '#e31837', bg: '#ffffff', name: 'Walgreens', illuminated: true, draw: (c) => T(c, 'Walgreens', { font: 'brush', weight: 400, maxH: 0.92 }, inset(c.box, 0.05, 0.05)) },
  uniqlo: { aspect: 1, fg: '#ffffff', bg: '#ff0000', name: 'Uniqlo', illuminated: true, pad: 0.12, draw: (c) => L(c, ['UNI', 'QLO'], { font: 'sans', weight: 900, spacing: 0.04 }, c.box, 0.12) },
  zara: { aspect: 3, fg: INK, bg: null, name: 'Zara', draw: (c) => T(c, 'ZARA', { font: 'didot', weight: 700, spacing: -0.06 }) },
  nike: { aspect: 2.2, fg: INK, bg: null, name: 'Nike', draw: (c) => {
    const [r1, r2] = rows(c.box, 0.5, 0.5); T(c, 'NIKE', { font: 'futura', weight: 800, italic: true, spacing: 0.02 }, inset(r1, 0.14, 0.1)); c.ctx.fillStyle = c.fg; mark(c.ctx, inset(r2, 0.02, 0.08), 100 / 36, swoosh); } },
  swoosh: { aspect: 100 / 36, fg: INK, bg: null, name: 'Nike', draw: (c) => { c.ctx.fillStyle = c.fg; mark(c.ctx, c.box, 100 / 36, swoosh); } },
  moncler: { aspect: 4, fg: INK, bg: null, accent: '#c8102e', name: 'Moncler', draw: (c) => {
    const [a, b] = cols(c.box, 0.2, 0.8); mark(c.ctx, inset(a, 0.1, 0.1), 1, (g) => {
      circle(g, 50, 50, 46, '#fff', c.fg, 5); poly(g, [[50, 8], [50, 92], [8, 50]], '#1f3f8f'); poly(g, [[50, 8], [50, 92], [92, 50]], c.accent);
      g.fillStyle = '#fff'; g.beginPath(); g.ellipse(50, 56, 14, 11, 0, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(58, 42, 7, 6, 0, 0, Math.PI * 2); g.fill(); poly(g, [[54, 30], [58, 24], [62, 32], [66, 26], [68, 36]], '#fff'); });
    T(c, 'MONCLER', { font: 'futura', weight: 700, spacing: 0.22 }, inset(b, 0.03, 0.2)); } },
  bape: { aspect: 1.5, fg: INK, bg: null, name: 'A Bathing Ape', draw: (c) => {
    const [r1, r2] = rows(c.box, 0.72, 0.28); mark(c.ctx, inset(r1, 0.02, 0.02), 1, (g) => apeHead(g, c.fg)); T(c, 'A BATHING APE', { font: 'sans', weight: 900, spacing: 0.06 }, inset(r2, 0.02, 0.14)); } },
  loropiana: { aspect: 5.4, fg: INK, bg: null, name: 'Loro Piana', draw: (c) => T(c, 'LORO PIANA', { font: 'bodoni', weight: 400, spacing: 0.26 }) },
  harrywinston: { aspect: 5.4, fg: INK, bg: null, name: 'Harry Winston', draw: (c) => T(c, 'HARRY WINSTON', { font: 'didot', weight: 400, spacing: 0.22 }) },
  isaia: { aspect: 3.2, fg: '#8a6d3b', bg: null, accent: '#d4372e', name: 'Isaia', draw: (c) => {
    const [a, b] = cols(c.box, 0.26, 0.74); mark(c.ctx, inset(a, 0.08, 0.08), 1, (g) => coral(g, c.accent)); T(c, 'ISAIA', { font: 'serif', weight: 400, spacing: 0.22 }, inset(b, 0.02, 0.2)); } },
  westin: { aspect: 3.2, fg: GOLD, bg: null, name: 'The Westin St. Francis', illuminated: true, draw: (c) => L(c, ['THE WESTIN', 'ST. FRANCIS'], { font: 'serif', weight: 400, spacing: 0.26 }, c.box, 0.24) },
  grandhyatt: { aspect: 4.4, fg: '#f2f2f2', bg: null, name: 'Grand Hyatt', illuminated: true, draw: (c) => T(c, 'GRAND HYATT', { font: 'sans', weight: 400, spacing: 0.22 }) },
  beacongrand: { aspect: 3.4, fg: GOLD, bg: '#1c1a17', name: 'Beacon Grand', illuminated: true, draw: (c) => { const [r1, r2] = rows(c.box, 0.66, 0.34); T(c, 'BEACON GRAND', { font: 'serif', weight: 400, spacing: 0.22 }, inset(r1, 0.06, 0.16)); T(c, 'HOTEL', { font: 'sans', weight: 400, spacing: 0.5 }, inset(r2, 0.06, 0.28)); } },
  chancellor: { aspect: 1 / 6, fg: '#f2e6c8', bg: '#1b2a4a', name: 'Chancellor Hotel', illuminated: true, pad: 0.03, draw: (c) => { const [r1, r2] = rows(c.box, 10, 6); drawStack(c.ctx, 'CHANCELLOR', inset(r1, 0.1, 0.01), { font: 'serif', weight: 700, color: c.fg }); drawStack(c.ctx, 'HOTEL', inset(r2, 0.22, 0.03), { font: 'sans', weight: 500, color: c.fg }); } },
  handlery: { aspect: 3.4, fg: '#e9d9a8', bg: '#4a1d2a', name: 'Handlery Union Square Hotel', illuminated: true, draw: (c) => { const [r1, r2] = rows(c.box, 0.62, 0.38); T(c, 'HANDLERY', { font: 'serif', weight: 700, spacing: 0.14 }, inset(r1, 0.06, 0.14)); T(c, 'UNION SQUARE HOTEL', { font: 'sans', weight: 500, spacing: 0.2 }, inset(r2, 0.06, 0.26)); } },
  hilton: { aspect: 3, fg: '#0b3b8c', bg: null, name: 'Hilton', draw: (c) => T(c, 'Hilton', { font: 'sans', weight: 500, spacing: 0.02 }) },
  marriott: { aspect: 3.6, fg: INK, bg: null, accent: '#b8202b', name: 'Marriott', draw: (c) => { const [a, b] = cols(c.box, 0.24, 0.76); T(c, 'M', { font: 'serif', weight: 700, color: c.accent }, inset(a, 0.05, 0.05)); T(c, 'Marriott', { font: 'serif', weight: 400, spacing: 0.02 }, inset(b, 0.02, 0.12)); } },
  muni: { aspect: 2.8, fg: '#bf1e2e', bg: null, name: 'Muni', illuminated: true, draw: muniWorm },
  sfmta: { aspect: 3.2, fg: '#ffffff', bg: '#bf1e2e', name: 'SFMTA', illuminated: true, draw: (c) => T(c, 'SFMTA', { font: 'sans', weight: 700, spacing: 0.1 }, inset(c.box, 0.08, 0.16)) },
  bofa: { aspect: 4.2, fg: '#012169', bg: null, accent: '#e31837', name: 'Bank of America', illuminated: true, draw: (c) => { const [a, b] = cols(c.box, 0.26, 0.74); mark(c.ctx, inset(a, 0.06, 0.12), 100 / 70, (g) => flag(g, c.accent, c.fg)); T(c, 'BANK OF AMERICA', { font: 'sans', weight: 700, spacing: 0.03 }, inset(b, 0.02, 0.24)); } },
  chase: { aspect: 3.6, fg: '#117aca', bg: null, name: 'Chase', illuminated: true, draw: (c) => { const [a, b] = cols(c.box, 0.24, 0.76); mark(c.ctx, inset(a, 0.1, 0.1), 1, (g) => octagon(g, c.fg)); T(c, 'CHASE', { font: 'sans', weight: 700, spacing: 0.14 }, inset(b, 0.02, 0.2)); } },
  wellsfargo: { aspect: 3.2, fg: '#ffcd41', bg: '#d71e28', name: 'Wells Fargo', illuminated: true, draw: (c) => T(c, 'WELLS FARGO', { font: 'serif', weight: 700, spacing: 0.04 }, inset(c.box, 0.06, 0.2)) },
  citibank: { aspect: 2.6, fg: '#003b70', bg: null, accent: '#e0201b', name: 'citi', illuminated: true, draw: (c) => {
    const d = T(c, 'citi', { font: 'sans', weight: 400, spacing: 0.01, maxH: 0.7 }, inset(c.box, 0.05, 0.08)); const tx = d.chars[2], r = d.size * 0.5;
    c.ctx.strokeStyle = c.accent; c.ctx.lineWidth = d.size * 0.075; c.ctx.lineCap = 'round'; c.ctx.beginPath(); c.ctx.arc(tx, d.y - d.size * 0.28, r, Math.PI * 1.12, Math.PI * 1.88); c.ctx.stroke(); } },
  sees: { aspect: 3.2, fg: INK, bg: '#ffffff', name: "See's Candies", draw: (c) => { const [r1, r2] = rows(c.box, 0.64, 0.36); T(c, "See's", { font: 'script', weight: 700, maxH: 0.95 }, inset(r1, 0.05, 0.02)); T(c, 'CANDIES', { font: 'sans', weight: 700, spacing: 0.32 }, inset(r2, 0.08, 0.24)); } },
  bluebottle: { aspect: 100 / 130, fg: '#1f5ba8', bg: null, name: 'Blue Bottle Coffee', pad: 0.06, draw: (c) => { mark(c.ctx, c.box, 100 / 130, (g) => bottle(g, c.fg)); } },
  philz: { aspect: 3.4, fg: '#1d2c4a', bg: null, name: 'Philz Coffee', draw: (c) => T(c, 'Philz Coffee', { font: 'script', weight: 700, maxH: 0.92 }, inset(c.box, 0.04, 0.04)) },
  peets: { aspect: 3.2, fg: '#2b1a0f', bg: null, name: "Peet's Coffee", draw: (c) => { const [r1, r2] = rows(c.box, 0.66, 0.34); T(c, "Peet's", { font: 'serif', weight: 700, italic: true, maxH: 0.95 }, inset(r1, 0.04, 0.02)); T(c, 'COFFEE', { font: 'sans', weight: 500, spacing: 0.34 }, inset(r2, 0.1, 0.26)); } },
  sephora: { aspect: 4.2, fg: '#ffffff', bg: '#000000', name: 'Sephora', illuminated: true, draw: (c) => { const [a, b] = cols(c.box, 0.14, 0.86); flame(c.ctx, c, inset(a, 0.1, 0.12)); T(c, 'SEPHORA', { font: 'optima', weight: 700, spacing: 0.24 }, inset(b, 0.03, 0.2)); } },
  lululemon: { aspect: 1, fg: '#ffffff', bg: '#d31334', name: 'lululemon', illuminated: true, pad: 0.16, draw: (c) => { mark(c.ctx, c.box, 1, (g) => { g.strokeStyle = c.fg; g.lineWidth = 12; g.lineCap = 'round'; g.beginPath(); g.arc(50, 46, 32, Math.PI * 0.68, Math.PI * 0.32); g.stroke(); g.beginPath(); g.moveTo(50 + 32 * Math.cos(Math.PI * 0.32), 46 + 32 * Math.sin(Math.PI * 0.32)); g.lineTo(88, 88); g.moveTo(50 + 32 * Math.cos(Math.PI * 0.68), 46 + 32 * Math.sin(Math.PI * 0.68)); g.lineTo(12, 88); g.stroke(); }); } },
  levis: { aspect: 2, fg: '#ffffff', bg: null, accent: '#c41230', name: "Levi's", draw: (c) => {
    const b = mark(c.ctx, c.box, 2, (g) => { g.fillStyle = c.accent; g.beginPath(); g.moveTo(0, 0); g.lineTo(100, 0); g.lineTo(100, 32); g.bezierCurveTo(90, 50, 70, 52, 50, 40); g.bezierCurveTo(30, 52, 10, 50, 0, 32); g.closePath(); g.fill(); });
    T(c, "Levi's", { font: 'sans', weight: 700, spacing: 0.01, maxH: 0.7 }, { x: b.x + b.w * 0.08, y: b.y, w: b.w * 0.84, h: b.h * 0.68 }); } },
  burberry: { aspect: 4.6, fg: INK, bg: null, name: 'Burberry', draw: (c) => T(c, 'BURBERRY', { font: 'sans', weight: 700, spacing: 0.22 }) },
  cheesecakefactory: { aspect: 3.4, fg: '#7a1c1c', bg: '#f5eedc', name: 'The Cheesecake Factory', illuminated: true, draw: (c) => { const [r1, r2] = rows(c.box, 0.3, 0.7); T(c, 'The', { font: 'script', weight: 700 }, inset(r1, 0.4, 0.06)); T(c, 'Cheesecake Factory', { font: 'serif', weight: 700, italic: true }, inset(r2, 0.04, 0.1)); } },
  shoepalace: { aspect: 3.8, fg: '#ffffff', bg: '#111111', name: 'Shoe Palace', illuminated: true, draw: (c) => T(c, 'SHOE PALACE', { font: 'condensed', weight: 700, spacing: 0.08 }, inset(c.box, 0.06, 0.18)) },
  popmart: { aspect: 3.4, fg: INK, bg: '#ffffff', name: 'Pop Mart', illuminated: true, draw: (c) => T(c, 'POP MART', { font: 'rounded', weight: 800, spacing: 0.06 }, inset(c.box, 0.06, 0.2)) },
  dyson: { aspect: 3, fg: INK, bg: null, name: 'dyson', draw: (c) => T(c, 'dyson', { font: 'futura', weight: 500, spacing: 0.02 }) },
  sears: { aspect: 3.4, fg: '#ff3b30', bg: '#111111', name: 'Sears Fine Food', illuminated: true, draw: (c) => { const [r1, r2] = rows(c.box, 0.62, 0.38); T(c, 'Sears', { font: 'brush', weight: 400, glow: 0.18, maxH: 0.92 }, inset(r1, 0.06, 0.04)); T(c, 'FINE FOOD', { font: 'sans', weight: 700, spacing: 0.3, glow: 0.18, color: '#ffe9b0' }, inset(r2, 0.1, 0.24)); } },
  taproom: { aspect: 3, fg: '#f2e2b0', bg: '#1c1c1e', accent: GOLD, name: 'Golden Gate Tap Room', illuminated: true, draw: (c) => { const [r1, r2, r3] = rows(c.box, 0.4, 0.4, 0.2); T(c, 'GOLDEN GATE', { font: 'condensed', weight: 700, spacing: 0.12 }, inset(r1, 0.08, 0.12)); T(c, 'TAP ROOM', { font: 'condensed', weight: 700, spacing: 0.24, color: c.accent }, inset(r2, 0.08, 0.1)); rule(c, r3, c.accent, 0.5, 0.16); } },
  convene: { aspect: 4.4, fg: INK, bg: null, name: 'Convene', draw: (c) => T(c, 'CONVENE', { font: 'sans', weight: 500, spacing: 0.32 }) },
  tix: { aspect: 2.6, fg: '#ffffff', bg: '#c8102e', name: 'TIX Bay Area', illuminated: true, draw: (c) => { const [r1, r2] = rows(c.box, 0.64, 0.36); T(c, 'TIX', { font: 'sans', weight: 900, spacing: 0.06 }, inset(r1, 0.1, 0.1)); T(c, 'BAY AREA', { font: 'sans', weight: 700, spacing: 0.22 }, inset(r2, 0.1, 0.22)); } },
  unionsquaregarage: { aspect: 3.4, fg: '#ffffff', bg: '#1d4f9c', name: 'Union Square Garage', illuminated: true, draw: (c) => { const [a, b] = cols(c.box, 0.26, 0.74); const q = inset(a, 0.16, 0.16); const s = Math.min(q.w, q.h); rrect(c.ctx, q.x + (q.w - s) / 2, q.y + (q.h - s) / 2, s, s, s * 0.12, null, c.fg, s * 0.07); T(c, 'P', { font: 'sans', weight: 700 }, inset({ x: q.x + (q.w - s) / 2, y: q.y + (q.h - s) / 2, w: s, h: s }, 0.2, 0.18)); L(c, ['UNION SQUARE', 'GARAGE'], { font: 'sans', weight: 700, spacing: 0.08 }, inset(b, 0.03, 0.14), 0.2); } },
  // ---- wordmarks (text-only brands from the storefront recon)
  ugg: wm('UGG', { font: 'sans', weight: 900, spacing: 0.06 }, { aspect: 2.4 }),
  dandelion: wm2('Dandelion', { font: 'serif', weight: 400, spacing: 0.04 }, 'CHOCOLATE', { font: 'sans', weight: 500, spacing: 0.34 }, [0.6, 0.4], { aspect: 3.2, fg: '#f1e7d6', bg: '#2b1a12', name: 'Dandelion Chocolate' }),
  bourbonsteak: wm('BOURBON STEAK', { font: 'didot', weight: 300, spacing: 0.3 }, { aspect: 6, fg: '#3b2a1a' }),
  journeys: wm('Journeys', { font: 'sans', weight: 700, spacing: 0.02 }, { aspect: 3.6 }),
  stiiizy: wm('STIIIZY', { font: 'sans', weight: 900, spacing: 0.08 }, { aspect: 3.6, illuminated: true }),
  toryburch: { aspect: 4.2, fg: '#111', bg: null, accent: '#e8842a', name: 'Tory Burch', draw: (c) => { const [a, b] = cols(c.box, 0.2, 0.8); mark(c.ctx, inset(a, 0.08, 0.08), 1, (g) => { circle(g, 50, 50, 46, null, c.accent, 5); g.fillStyle = c.accent; g.fillRect(24, 26, 52, 10); g.fillRect(45, 26, 10, 26); g.fillRect(24, 64, 52, 10); g.fillRect(45, 48, 10, 26); }); T(c, 'TORY BURCH', { font: 'serif', weight: 400, spacing: 0.24 }, inset(b, 0.02, 0.2)); } },
  breitling: { aspect: 4.4, fg: '#111', bg: null, accent: '#ffcc00', name: 'Breitling', draw: (c) => { const [r1, r2] = rows(c.box, 0.78, 0.22); T(c, 'BREITLING', { font: 'sans', weight: 700, spacing: 0.2 }, inset(r1, 0.02, 0.1)); rule(c, r2, c.accent, 0.9, 0.28); } },
  bulgari: wm('BVLGARI', { font: 'serif', weight: 400, spacing: 0.18 }, { aspect: 4.2 }),
  ferragamo: wm('FERRAGAMO', { font: 'bodoni', weight: 400, spacing: 0.2 }, { aspect: 4.8 }),
  gumps: wm("Gump's", { font: 'script', weight: 700, maxH: 0.95 }, { aspect: 2.6, fg: '#0e4d3a' }),
  valentino: wm('VALENTINO', { font: 'bodoni', weight: 400, spacing: 0.22 }, { aspect: 4.8 }),
  bottegaveneta: wm('BOTTEGA VENETA', { font: 'sans', weight: 500, spacing: 0.26 }, { aspect: 6.4, fg: '#1a3c2a' }),
  vancleef: wm('Van Cleef & Arpels', { font: 'serif', weight: 400, spacing: 0.06 }, { aspect: 6, fg: '#2a2418' }),
  bangolufsen: wm('BANG & OLUFSEN', { font: 'sans', weight: 300, spacing: 0.24 }, { aspect: 6.4 }),
  hermes: { aspect: 3.4, fg: '#111', bg: null, accent: '#f37021', name: 'Hermès', draw: (c) => { const [r1, r2, r3] = rows(c.box, 0.62, 0.14, 0.24); T(c, 'HERMÈS', { font: 'serif', weight: 400, spacing: 0.24 }, inset(r1, 0.04, 0.08)); rule(c, r2, c.accent, 0.5, 0.3); T(c, 'PARIS', { font: 'serif', weight: 400, spacing: 0.4 }, inset(r3, 0.2, 0.22)); } },
  swarovski: wm('SWAROVSKI', { font: 'futura', weight: 500, spacing: 0.22 }, { aspect: 5 }),
  patek: { aspect: 4.6, fg: '#111', bg: null, name: 'Patek Philippe', draw: (c) => { const [a, b] = cols(c.box, 0.18, 0.82); mark(c.ctx, inset(a, 0.06, 0.06), 1, (g) => calatrava(g, c.fg)); T(c, 'PATEK PHILIPPE', { font: 'serif', weight: 400, spacing: 0.14 }, inset(b, 0.02, 0.22)); } },
  maxmara: wm('MaxMara', { font: 'bodoni', weight: 400, spacing: 0.02 }, { aspect: 3.6 }),
  stjohn: wm('ST. JOHN', { font: 'serif', weight: 400, spacing: 0.26 }, { aspect: 4 }),
  realreal: wm('The RealReal', { font: 'sans', weight: 700, spacing: -0.01 }, { aspect: 4.6 }),
  suitsupply: wm('SUITSUPPLY', { font: 'sans', weight: 900, spacing: 0.02 }, { aspect: 4.8, fg: '#1c2b52' }),
  margiela: wm('Maison Margiela', { font: 'sans', weight: 300, spacing: 0.12 }, { aspect: 6 }),
  sunglasshut: wm('Sunglass Hut', { font: 'sans', weight: 700, spacing: 0.01 }, { aspect: 4.4 }),
  omega: { aspect: 3.4, fg: '#111', bg: null, accent: '#c8102e', name: 'Omega', draw: (c) => { const [a, b] = cols(c.box, 0.26, 0.74); T(c, 'Ω', { font: 'serif', weight: 400, color: c.accent }, inset(a, 0.06, 0.04)); T(c, 'OMEGA', { font: 'serif', weight: 400, spacing: 0.24 }, inset(b, 0.02, 0.22)); } },
  dita: wm('DITA', { font: 'sans', weight: 700, spacing: 0.3 }, { aspect: 3 }),
  kensington: wm2('KENSINGTON PARK', { font: 'serif', weight: 400, spacing: 0.18 }, 'HOTEL', { font: 'sans', weight: 400, spacing: 0.5 }, [0.62, 0.38], { aspect: 4, fg: '#e8dcc0', bg: '#2e2a26', name: 'Kensington Park Hotel', illuminated: true }),
  bpatisserie: wm('b. patisserie', { font: 'sans', weight: 300, spacing: 0.04 }, { aspect: 4.6 }),
  sams: wm2("Sam's", { font: 'script', weight: 700, maxH: 0.95 }, 'CABLE CAR LOUNGE', { font: 'sans', weight: 700, spacing: 0.2 }, [0.62, 0.38], { aspect: 3.2, fg: '#ffd166', bg: '#7a1f1f', name: "Sam's Cable Car Lounge", illuminated: true }),
  kingofthai: wm2('King of Thai', { font: 'sans', weight: 900, spacing: 0.02 }, 'NOODLE HOUSE', { font: 'sans', weight: 700, spacing: 0.18 }, [0.6, 0.4], { aspect: 3.4, fg: '#ffd400', bg: '#b3121b', name: 'King of Thai Noodle House', illuminated: true }),
  corzetti: wm('Corzetti', { font: 'serif', weight: 400, italic: true, spacing: 0.04 }, { aspect: 3.4, fg: '#f0e6d2', bg: '#233b2a' }),
  navecafe: wm('Nave Cafe', { font: 'sans', weight: 500, spacing: 0.1 }, { aspect: 3.6, fg: '#f4efe6', bg: '#3a3a3a' }),
  cafeencore: wm('Café Encore', { font: 'script', weight: 700, maxH: 0.95 }, { aspect: 3.4, fg: '#f4efe6', bg: '#4a2a2a' }),
  latazita: wm('Cafe La Tazita', { font: 'brush', weight: 400, maxH: 0.95 }, { aspect: 3.8, fg: '#fff3d6', bg: '#8b3a1e' }),
  spectacles: wm('Spectacles', { font: 'serif', weight: 400, italic: true, spacing: 0.06 }, { aspect: 4 }),
  mcmullen: wm('McMullen', { font: 'serif', weight: 400, spacing: 0.08 }, { aspect: 4 }),
  barcelino: wm('Barcelino', { font: 'serif', weight: 400, italic: true, spacing: 0.06 }, { aspect: 4, fg: '#2a2418' }),
  ckcontemporary: wm('CK CONTEMPORARY', { font: 'sans', weight: 400, spacing: 0.3 }, { aspect: 6.4 }),
  artthou: wm('Art Thou Gallery', { font: 'serif', weight: 400, spacing: 0.06 }, { aspect: 5 }),
  souvenirs: wm2('SF SOUVENIRS', { font: 'impact', weight: 700, spacing: 0.06 }, '& LUGGAGE', { font: 'sans', weight: 700, spacing: 0.16 }, [0.58, 0.42], { aspect: 3.4, fg: '#ffd400', bg: '#c8102e', name: 'SF Souvenirs & Luggage', illuminated: true }),
  bestbookstore: wm('The Best Bookstore', { font: 'serif', weight: 700, spacing: 0.02 }, { aspect: 5, fg: '#fff', bg: '#1f4b8f' }),
  nooworks: wm('NOOWORKS', { font: 'rounded', weight: 800, spacing: 0.08 }, { aspect: 4, fg: '#ffffff', bg: '#ff5a8a' }),
  medicodental: wm('490 POST', { font: 'serif', weight: 400, spacing: 0.24 }, { aspect: 3.4, fg: '#8a6d3b' }),
  unionsquarestation: wm2('Union Square/Market St', { font: 'sans', weight: 700, spacing: 0.01 }, 'STATION', { font: 'sans', weight: 500, spacing: 0.3 }, [0.6, 0.4], { aspect: 5, fg: '#ffffff', bg: '#bf1e2e', name: 'Union Square/Market St', illuminated: true }),
  generic: { fg: '#111', bg: null, name: 'Sign', draw: (c) => T(c, c.ctx.canvas.dataset.text || 'SIGN', { font: 'sans', weight: 600, spacing: 0.06 }) },
};

/** Alternate spellings / storefront names -> logo keys. Keys here are already normalized (lowercase alnum). */
export const ALIASES: Record<string, string> = {
  applestore: 'apple', appleunionsquare: 'apple', applelogo: 'apple', applewhite: 'apple', appleblack: 'appledark',
  nintendosanfrancisco: 'nintendosf', nintendostore: 'nintendo', nintendoreverse: 'nintendobox', nintendored: 'nintendobox',
  tiffanyco: 'tiffany', tiffanyandco: 'tiffany', saksfifthavenue: 'saks', macy: 'macys', macysunionsquare: 'macys',
  neimanmarcus: 'neiman', lv: 'louisvuitton', vuitton: 'louisvuitton', vs: 'victoriassecret', victoriasecret: 'victoriassecret',
  lororpiana: 'loropiana', thewestin: 'westin', westinstfrancis: 'westin', stfrancis: 'westin', hyatt: 'grandhyatt', grandhyattsanfrancisco: 'grandhyatt',
  beacongrandhotel: 'beacongrand', sirfrancisdrake: 'beacongrand', chancellorhotel: 'chancellor', handleryhotel: 'handlery', handleryunionsquarehotel: 'handlery',
  sfmuni: 'muni', munimetro: 'muni', centralsubway: 'unionsquarestation', unionsquaremarketst: 'unionsquarestation', unionsquaremarketststation: 'unionsquarestation',
  bankofamerica: 'bofa', boa: 'bofa', jpmorganchase: 'chase', chasebank: 'chase', wells: 'wellsfargo', citi: 'citibank', citigroup: 'citibank',
  seescandies: 'sees', sees: 'sees', bluebottlecoffee: 'bluebottle', philzcoffee: 'philz', peetscoffee: 'peets', peet: 'peets',
  levistrauss: 'levis', levi: 'levis', thecheesecakefactory: 'cheesecakefactory', cheesecake: 'cheesecakefactory',
  searsfinefood: 'sears', goldengatetaproom: 'taproom', taproom: 'taproom', tixbayarea: 'tix', usgarage: 'unionsquaregarage', garage: 'unionsquaregarage',
  abathingape: 'bape', bathingape: 'bape', nikesanfrancisco: 'nike', nikesf: 'nike', dysondemostore: 'dyson',
  bulgari: 'bulgari', bvlgari: 'bulgari', salvatoreferragamo: 'ferragamo', gump: 'gumps', vancleefarpels: 'vancleef', bangolufsen: 'bangolufsen', bo: 'bangolufsen',
  hermesparis: 'hermes', patekphilippe: 'patek', maisonmargiela: 'margiela', therealreal: 'realreal', realrealpaintedleopard: 'realreal',
  sherrimcmullen: 'mcmullen', barcelinoperdonna: 'barcelino', kensingtonparkhotel: 'kensington', samscablecarlounge: 'sams', kingofthainoodle: 'kingofthai', kingofthainoodlehouse: 'kingofthai',
  cafelatazita: 'latazita', sfsouvenirsluggage: 'souvenirs', thebestbookstore: 'bestbookstore', medicodentalbuilding: 'medicodental', post490: 'medicodental',
  dandelionchocolate: 'dandelion', bourbonsteaklounge: 'bourbonsteak', michaelmina: 'bourbonsteak', ditaomega: 'omega', spectaclesofunionsquare: 'spectacles',
  bpatisserie: 'bpatisserie', stiiizyunionsquare: 'stiiizy', popmart: 'popmart', shoepalace: 'shoepalace', sunglasshut: 'sunglasshut', toryburch: 'toryburch',
  unionsquaregaragepostst: 'unionsquaregarage', unionsquareplaza: 'unionsquaregarage', williamssonoma: 'chanel', cksontemporary: 'ckcontemporary',
};

/** Lowercase, strip accents / parentheticals / punctuation. */
export function normalizeBrand(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\([^)]*\)/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
const KEYS_BY_LEN = Object.keys(LOGOS).filter((k) => k !== 'generic').sort((a, b) => b.length - a.length);
/** Resolve any brand / storefront name to a logo key (null when unknown). */
export function findLogoKey(name: string): string | null {
  const n = normalizeBrand(name); if (!n) return null;
  if (LOGOS[n]) return n; if (ALIASES[n]) return ALIASES[n];
  const t = n.replace(/^the/, ''); if (LOGOS[t]) return t; if (ALIASES[t]) return ALIASES[t];
  for (const k of KEYS_BY_LEN) if (k.length >= 4 && (n.startsWith(k) || t.startsWith(k))) return k;
  for (const a of Object.keys(ALIASES)) if (a.length >= 6 && n.startsWith(a)) return ALIASES[a];
  for (const k of KEYS_BY_LEN) if (k.length >= 5 && n.includes(k)) return k;
  return null;
}
export const LOGO_KEYS = Object.keys(LOGOS).filter((k) => k !== 'generic');
