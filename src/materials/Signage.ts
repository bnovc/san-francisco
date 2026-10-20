// Canvas-rendered signage & brand logos. Crisp high-res canvases (>= 256 px/m, <= 4096 px), brand vector marks from Logos.ts,
// and mesh helpers. All meshes face +z with their origin at the centre; the caller rotates/positions them.
import * as THREE from 'three';
import { Materials } from './Library';
import { LOGOS, LOGO_KEYS, findLogoKey, normalizeBrand, fitBox, inset, drawText, drawLines, resolveFont, type LogoDef, type LogoCtx, type Ctx } from './Logos';

export interface SignOptions {
  text: string; widthM: number; heightM: number;
  /** font family or a FONT key: serif | sans | condensed | script | didot | futura | rounded | brush | optima | mono ... */
  font?: string; weight?: string | number; color?: string;
  /** background colour; null / undefined = transparent */ bg?: string | null;
  align?: 'left' | 'center' | 'right';
  /** letter spacing in em (e.g. 0.2). */ letterSpacing?: number;
  /** padding as a fraction of the sign height (default 0.12). */ padding?: number;
  outline?: string; outlineWidth?: number; illuminated?: boolean; italic?: boolean; uppercase?: boolean;
  // --- extensions
  /** texture density (default 384 px/m, min 256, capped so the longest side <= maxPx). */ pxPerM?: number; maxPx?: number;
  /** fake-relief drop shadow colour + offset (em). */ shadow?: string; shadowOffset?: [number, number];
  /** neon-style glow radius in em. */ glow?: number;
  /** emissive intensity at night for illuminated signs (default 2.5). */ nightIntensity?: number;
  roughness?: number; metalness?: number;
  /** extra painter run after the text (canvas px space). */ draw?: (ctx: Ctx, w: number, h: number) => void;
}
export interface SignResult {
  texture: THREE.Texture; material: THREE.MeshStandardMaterial; widthM: number; heightM: number;
  canvas: HTMLCanvasElement; bg: string | null; fg: string; illuminated: boolean; key?: string;
}

const DEFAULT_PPM = 384, MIN_PPM = 256, MAX_PX = 4096;
// Materials.setNight() only runs on preset changes, so signs built later must start at the current night factor.
let nightNow = 0;
if (typeof document !== 'undefined') document.addEventListener('twin:time', (e: Event) => { nightNow = Number((e as CustomEvent).detail?.night ?? 0); });
function currentNight(): number { const t = (globalThis as any).__twin?.app?.time?.nightFactor; return typeof t === 'number' ? t : nightNow; }
function makeCanvas(widthM: number, heightM: number, pxPerM = DEFAULT_PPM, maxPx = MAX_PX): HTMLCanvasElement {
  let ppm = Math.max(MIN_PPM, pxPerM); const maxDim = Math.max(widthM, heightM);
  if (ppm * maxDim > maxPx) ppm = maxPx / maxDim;
  const c = document.createElement('canvas'); c.width = Math.max(8, Math.round(widthM * ppm)); c.height = Math.max(8, Math.round(heightM * ppm));
  return c;
}
function finish(canvas: HTMLCanvasElement, o: { bg: string | null; illuminated: boolean; nightIntensity?: number; roughness?: number; metalness?: number; widthM: number; heightM: number; fg: string; key?: string }): SignResult {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 16; texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
  const transparent = o.bg == null;
  const material = new THREE.MeshStandardMaterial({
    map: texture, transparent, alphaTest: transparent ? 0.02 : 0, roughness: o.roughness ?? 0.55, metalness: o.metalness ?? 0,
    emissive: o.illuminated ? 0xffffff : 0x000000, emissiveMap: o.illuminated ? texture : null, emissiveIntensity: 0,
  });
  if (o.illuminated) { const n = o.nightIntensity ?? 2.5; Materials.trackEmissive(material, 0, n); material.emissiveIntensity = currentNight() * n; }
  return { texture, material, widthM: o.widthM, heightM: o.heightM, canvas, bg: o.bg, fg: o.fg, illuminated: o.illuminated, key: o.key };
}

/** Crisp text sign. Multi-line text ('\n') shares one font size. */
export function makeTextSign(o: SignOptions): SignResult {
  const canvas = makeCanvas(o.widthM, o.heightM, o.pxPerM, o.maxPx); const ctx = canvas.getContext('2d')!; const W = canvas.width, H = canvas.height;
  const bg = o.bg ?? null; if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); }
  const pad = (o.padding ?? 0.12) * H; const box = { x: pad, y: pad, w: W - 2 * pad, h: H - 2 * pad };
  const fg = o.color || '#111';
  const style = { font: o.font, weight: o.weight ?? 600, italic: o.italic, spacing: o.letterSpacing, upper: o.uppercase, color: fg, outline: o.outline, outlineW: o.outlineWidth, align: o.align, shadow: o.shadow, shadowDx: o.shadowOffset?.[0], shadowDy: o.shadowOffset?.[1], glow: o.glow };
  const lines = o.text.split('\n');
  if (lines.length > 1) drawLines(ctx, lines, box, style, 0.18); else drawText(ctx, o.text, box, style);
  if (o.draw) o.draw(ctx, W, H);
  return finish(canvas, { bg, illuminated: !!o.illuminated, nightIntensity: o.nightIntensity, roughness: o.roughness, metalness: o.metalness, widthM: o.widthM, heightM: o.heightM, fg });
}

/** Resolve a brand / storefront name to a logo key (null when unknown). */
export function logoKey(brand: string): string | null { return findLogoKey(brand); }
export function hasLogo(brand: string): boolean { return findLogoKey(brand) !== null; }
export function logoDef(brand: string): LogoDef | null { const k = findLogoKey(brand); return k ? LOGOS[k] : null; }
/** Natural aspect (w/h) of a brand mark; falls back to a text-length estimate. */
export function logoAspect(brand: string): number {
  const d = logoDef(brand); if (d?.aspect) return d.aspect;
  const n = (d?.name || brand).length; return Math.max(1.5, Math.min(8, n * 0.62));
}
export { LOGO_KEYS, LOGOS, normalizeBrand, resolveFont };

/** Brand logo sign: vector mark from Logos.ts, content letterboxed to its natural aspect, brand colours unless overridden. */
export function makeLogoSign(brand: string, widthM: number, heightM: number, opts: Partial<SignOptions> = {}): SignResult {
  const key = findLogoKey(brand);
  if (!key) return makeFallbackSign(brand, widthM, heightM, opts);
  const def = LOGOS[key];
  const bg = opts.bg !== undefined ? opts.bg : def.bg; const fg = opts.color || def.fg; const accent = def.accent || fg;
  const canvas = makeCanvas(widthM, heightM, opts.pxPerM, opts.maxPx); const ctx = canvas.getContext('2d')!; const W = canvas.width, H = canvas.height;
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); }
  const pad = opts.padding ?? def.pad ?? 0.1;
  const padPx = pad * Math.min(W, H);
  const full = { x: padPx, y: padPx, w: W - 2 * padPx, h: H - 2 * padPx };
  const box = def.aspect ? (() => { const b = fitBox(full.w, full.h, def.aspect); b.x += full.x; b.y += full.y; return b; })() : full;
  const punch = (fn: (g: Ctx) => void) => { ctx.save(); if (bg) ctx.fillStyle = bg; else ctx.globalCompositeOperation = 'destination-out'; if (!bg) ctx.fillStyle = '#000'; fn(ctx); ctx.restore(); };
  const c: LogoCtx = { ctx, box, w: W, h: H, fg, bg, accent, punch };
  ctx.save(); def.draw(c); ctx.restore();
  if (opts.draw) opts.draw(ctx, W, H);
  const illuminated = opts.illuminated ?? !!def.illuminated;
  return finish(canvas, { bg, illuminated, nightIntensity: opts.nightIntensity, roughness: opts.roughness, metalness: opts.metalness, widthM, heightM, fg, key });
}
/** Unknown brand: a tasteful text sign whose style is guessed from the name. */
function makeFallbackSign(brand: string, widthM: number, heightM: number, opts: Partial<SignOptions>): SignResult {
  const name = brand.replace(/\([^)]*\)/g, '').trim() || 'SIGN';
  const hospitality = /hotel|caf|restaurant|lounge|bar|grill|bistro|kitchen|bakery|patisserie|gallery|salon/i.test(name);
  const font = opts.font ?? (hospitality ? 'serif' : 'sans');
  const r = makeTextSign({ widthM, heightM, font, weight: opts.weight ?? (hospitality ? 400 : 700), letterSpacing: opts.letterSpacing ?? (hospitality ? 0.12 : 0.06), uppercase: opts.uppercase ?? !hospitality, color: opts.color ?? '#111', bg: opts.bg ?? null, ...opts, text: name });
  r.key = 'generic'; return r;
}

// ---- meshes ---------------------------------------------------------------------------------------------------
let edgeMat: THREE.MeshStandardMaterial | null = null;
function edge(): THREE.MeshStandardMaterial { return edgeMat ??= new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.6, metalness: 0.3 }); }
function tag(m: THREE.Mesh | THREE.Group, r: SignResult, kind: string) { m.name = `sign:${kind}:${r.key || r.fg}`; m.userData.sign = r; return m; }

/** Box sign: face on +z, dark edges. Transparent-background signs get a plane instead (no visible frame). */
export function signMesh(r: SignResult, depth = 0.05): THREE.Mesh {
  if (r.bg == null) { const p = new THREE.Mesh(new THREE.PlaneGeometry(r.widthM, r.heightM), r.material); return tag(p, r, 'plane') as THREE.Mesh; }
  const e = edge(); const m = new THREE.Mesh(new THREE.BoxGeometry(r.widthM, r.heightM, depth), [e, e, e, e, r.material, e]);
  m.castShadow = true; return tag(m, r, 'box') as THREE.Mesh;
}
/** Thin fascia panel (2 cm) for shopfront fascias. */
export function fasciaSign(r: SignResult, depth = 0.02): THREE.Mesh { return tag(signMesh(r, depth), r, 'fascia') as THREE.Mesh; }
/** Double-sided projecting blade with a wall bracket on its -x edge (wall side). +z shows the sign; -z shows a mirrored copy. */
export function bladeSign(r: SignResult, depth = 0.06, bracketM = 0.25): THREE.Group {
  const g = new THREE.Group(); const e = edge();
  const back = r.material.clone(); const t = r.texture.clone(); t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1; t.offset.x = 1; t.needsUpdate = true;
  back.map = t; if (back.emissiveMap) back.emissiveMap = t; if (r.illuminated) { Materials.trackEmissive(back, 0, 2.5); back.emissiveIntensity = currentNight() * 2.5; }
  const panel = new THREE.Mesh(new THREE.BoxGeometry(r.widthM, r.heightM, depth), [e, e, e, e, r.material, back]); panel.castShadow = true; g.add(panel);
  const bar = new THREE.MeshStandardMaterial({ color: 0x232326, roughness: 0.5, metalness: 0.7 });
  for (const y of [r.heightM * 0.4, -r.heightM * 0.4]) { const b = new THREE.Mesh(new THREE.BoxGeometry(bracketM, 0.04, 0.04), bar); b.position.set(-r.widthM / 2 - bracketM / 2, y, 0); g.add(b); }
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, r.heightM * 0.8 + 0.04, 0.04), bar); post.position.set(-r.widthM / 2 - bracketM + 0.02, 0, 0); g.add(post);
  return tag(g, r, 'blade') as THREE.Group;
}
/** Individual-letter look: transparent text with an offset drop shadow that fakes relief. Returns a plane mesh (mesh.userData.sign = SignResult). */
export function letterSign(text: string, opts: Partial<SignOptions> & { widthM: number; heightM: number }): THREE.Mesh {
  const r = makeLetterSign(text, opts);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r.widthM, r.heightM), r.material); return tag(m, r, 'letters') as THREE.Mesh;
}
export function makeLetterSign(text: string, opts: Partial<SignOptions> & { widthM: number; heightM: number }): SignResult {
  const dark = /^#?(0|1|2)/.test(opts.color || '#111');
  return makeTextSign({ text, font: 'sans', weight: 700, letterSpacing: 0.08, uppercase: true, color: '#e8e4d8', shadow: dark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.55)', shadowOffset: [0.035, 0.05], padding: 0.1, ...opts, bg: null } as SignOptions);
}
/** Text on an awning valance: fabric strip (colour) + transparent text decal. */
export function awningSign(r: SignResult, fabricColor: THREE.ColorRepresentation = 0x1d4a2e): THREE.Group {
  const g = new THREE.Group();
  const fabric = new THREE.Mesh(new THREE.BoxGeometry(r.widthM, r.heightM, 0.012), new THREE.MeshStandardMaterial({ color: fabricColor, roughness: 0.95, side: THREE.DoubleSide }));
  fabric.castShadow = true; g.add(fabric);
  r.material.polygonOffset = true; r.material.polygonOffsetFactor = -1; r.material.polygonOffsetUnits = -1;
  const text = new THREE.Mesh(new THREE.PlaneGeometry(r.widthM, r.heightM), r.material); text.position.z = 0.007; g.add(text);
  return tag(g, r, 'awning') as THREE.Group;
}
/** Transparent vinyl decal for glass: draw slightly in front of the pane (polygon offset, no depth write). */
export function windowVinyl(r: SignResult, opacity = 0.95): THREE.Mesh {
  const m = r.material; m.transparent = true; m.opacity = opacity; m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; m.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(r.widthM, r.heightM), m); mesh.renderOrder = 2; return tag(mesh, r, 'vinyl') as THREE.Mesh;
}
/** Free the GPU resources of a sign. */
export function disposeSign(r: SignResult) { r.texture.dispose(); r.material.dispose(); }
export { inset };
