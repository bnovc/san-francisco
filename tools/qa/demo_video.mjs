// Records the demo film: 3 s aerial sweep → pedestrian POV to the monument → into Nintendo → down to the lower level
// → jump cut back to the plaza centre → into Apple → end title. Deterministic fixed-dt stepping; ffmpeg assembles the MP4.
import { chromium } from 'playwright';
import fs from 'node:fs';
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const FPS = Number(opt('fps', 30)), OUT = opt('out', 'qa/demo/frames'), W = Number(opt('w', 1280)), H = Number(opt('h', 720));
if (!args.some((a) => a.startsWith('--from='))) fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// mode 'air': explicit eye y. mode 'walk': eye = floor + 1.68 + head bob. `cut: true` = hard re-ground (after a fade).
const KEYS = [
  { t: 0.0,  m: 'air',  eye: [150, 130, 210], look: [0, 12, 0],       cap: '' },
  { t: 1.5,  m: 'air',  eye: [-60, 120, 210], look: [0, 12, 0],       cap: '' },
  { t: 3.0,  m: 'air',  eye: [-180, 80, 90],  look: [-30, 8, 20],     cap: '' },
  { t: 3.6,  m: 'walk', pos: [28, -1],  look: [0, 14, 0], cut: true,  cap: 'Union Square' },
  { t: 6.5,  m: 'walk', pos: [22, 0],   look: [0, 13, 0],             cap: 'Union Square' },
  { t: 9.5,  m: 'walk', pos: [16, 1],   look: [0, 11, 0],             cap: 'Dewey Monument' },
  { t: 12.5, m: 'walk', pos: [10, 2],   look: [0, 8, 0],              cap: 'Dewey Monument' },
  { t: 14.0, m: 'walk', pos: [7.5, 2],  look: [0, 5, 0],              cap: '' },
  { t: 14.6, m: 'walk', pos: [-79.5, 50], look: [-84, 3, 38], cut: true, cap: 'Powell & Geary' },
  { t: 17.5, m: 'walk', pos: [-79.5, 43], look: [-84, 2.5, 36],        cap: 'Nintendo SAN FRANCISCO · 331 Powell St' },
  { t: 20.5, m: 'walk', pos: [-80.5, 36.5], look: [-85, 2, 34.6],      cap: 'Nintendo SAN FRANCISCO · 331 Powell St' },
  { t: 22.5, m: 'walk', pos: [-84.5, 34.6], look: [-91, 1.5, 33],      cap: '' },
  { t: 25.5, m: 'walk', pos: [-88, 33.4],  look: [-92, 1.2, 30.7],    cap: 'Nintendo · ground floor' },
  { t: 28.0, m: 'walk', pos: [-90.5, 34.6],look: [-95, 0.8, 36],      cap: 'Nintendo · ground floor' },
  { t: 30.0, m: 'walk', pos: [-92.6, 35.2],look: [-95, -2.5, 35.5],   cap: '' },
  { t: 33.0, m: 'walk', pos: [-95.5, 35.4],look: [-101, -4.4, 34.5],  cap: 'Nintendo · lower level' },
  { t: 35.5, m: 'walk', pos: [-97.5, 35.8],look: [-88, -3.6, 36.5],   cap: 'Nintendo · lower level' },
  { t: 37.0, m: 'walk', pos: [-96.5, 36.4],look: [-86.5, -3.6, 36.5], cap: '' },
  { t: 37.6, m: 'walk', pos: [4, -4],   look: [43, 9, -64], cut: true, cap: 'Union Square' },
  { t: 41.5, m: 'walk', pos: [11, -12], look: [43, 8, -64],           cap: 'Apple Union Square · 300 Post St' },
  { t: 45.0, m: 'walk', pos: [17, -21], look: [43, 7, -64],           cap: 'Apple Union Square · 300 Post St' },
  { t: 45.6, m: 'walk', pos: [43, -57], look: [43, 3.5, -70], cut: true, cap: 'Apple Union Square · 300 Post St' },
  { t: 48.0, m: 'walk', pos: [43, -63], look: [43.5, 2.5, -74],       cap: '' },
  { t: 50.5, m: 'walk', pos: [43, -69], look: [46, 2, -80],           cap: 'Apple · product hall' },
  { t: 53.0, m: 'walk', pos: [44, -75], look: [53, 2.2, -83],         cap: 'Apple · Genius Grove' },
  { t: 55.5, m: 'walk', pos: [44, -72], look: [41, 4.5, -58],         cap: 'Apple · the Forum' },
  { t: 57.5, m: 'walk', pos: [43.5, -68], look: [41, 5, -55],         cap: '' },
  { t: 59.0, m: 'walk', pos: [43.4, -66.5], look: [41, 5, -55],       cap: '' },
];
const DURATION = KEYS[KEYS.length - 1].t;
const FADES = [[3.0, 3.6], [14.0, 14.6], [37.0, 37.6], [45.0, 45.6]];
const TITLE_AT = 56.6;
const ease = (a, b, k) => a + (b - a) * (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
function sample(t) {
  let i = 0; while (i < KEYS.length - 2 && KEYS[i + 1].t <= t) i++;
  const A = KEYS[i], B = KEYS[i + 1], k = Math.max(0, Math.min(1, (t - A.t) / (B.t - A.t)));
  const look = A.look.map((v, j) => ease(v, B.look[j], k));
  const cap = k < 0.5 ? A.cap : B.cap;
  const cut = !!B.cut && (t - A.t) < 1.6 / FPS;
  if (A.m === 'air' && B.m === 'air') return { air: true, eye: A.eye.map((v, j) => ease(v, B.eye[j], k)), look, cap, cut };
  if (B.m === 'air') return { air: true, eye: B.eye, look, cap, cut };
  const a0 = A.pos || B.pos;
  const pos = [ease(a0[0], B.pos[0], k), ease(a0[1], B.pos[1], k)];
  return { air: false, pos, look, cap, cut, moving: Math.hypot(B.pos[0] - a0[0], B.pos[1] - a0[1]) > 0.5 };
}
const fadeAt = (t) => { for (const [a, b] of FADES) { const mid = (a + b) / 2; if (t >= a && t <= b) return t < mid ? (t - a) / (mid - a) : 1 - (t - mid) / (b - mid); } return 0; };

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await page.goto('http://localhost:5173/?qa=1&ui=0&time=day&life=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__twin?.ready || window.__twinError, null, { timeout: 180000 });
await page.evaluate(() => {
  document.querySelectorAll('#prompt,#toast,#tour-title,#crosshair,#hud,#toolbar,#help,#ref-ctl').forEach((n) => (n.style.display = 'none'));
  const mk = (id, css) => { const el = document.createElement('div'); el.id = id; el.style.cssText = css; document.body.appendChild(el); return el; };
  mk('d-cap', 'position:fixed;left:50%;bottom:7%;transform:translateX(-50%);font:500 22px/1.3 -apple-system,Inter,Helvetica,Arial,sans-serif;color:#fff;text-shadow:0 2px 14px rgba(0,0,0,.9);letter-spacing:.03em;z-index:99;pointer-events:none;opacity:0;white-space:nowrap');
  mk('d-fade', 'position:fixed;inset:0;background:#000;z-index:100;pointer-events:none;opacity:0');
  mk('d-title', 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;z-index:101;pointer-events:none;opacity:0;background:rgba(0,0,0,.35)').innerHTML =
    '<div style="font:600 46px/1.1 -apple-system,Inter,Helvetica,Arial,sans-serif;color:#fff;letter-spacing:.06em;text-shadow:0 3px 20px rgba(0,0,0,.8)">Union Square</div>' +
    '<div style="font:400 22px/1.2 -apple-system,Inter,Helvetica,Arial,sans-serif;color:#e8ecf1;letter-spacing:.32em;text-transform:uppercase">San Francisco</div>';
  const app = window.__twin.app, W2 = window.__twin.world;
  // the camera controllers (walk/orbit/tour) and the interaction ray would overwrite our keyed camera every frame
  const SKIP = new Set(['WalkControls', 'OrbitMode', 'Tour', 'Interaction']);
  const ups = app.updatables.filter((u) => !SKIP.has(u?.constructor?.name));
  app.updatables.length = 0;   // the app's own rAF loop must not touch the camera; we drive everything with a fixed dt
  window.__demo = {
    foot: 0, ups,
    frame(s, fade, capOpacity, titleOpacity, t, dt) {
      const cam = app.camera;
      if (s.air) cam.position.set(s.eye[0], s.eye[1], s.eye[2]);
      else {
        const [x, z] = s.pos;
        const target = s.cut ? W2.collision.floorAt(x, z, W2.terrain.heightAt(x, z) + 0.6, 100) : W2.collision.floorAt(x, z, this.foot);
        this.foot = s.cut ? target : this.foot + (target - this.foot) * Math.min(1, dt * 9);
        const bob = s.moving ? Math.sin(t * 5.6) * 0.035 + Math.sin(t * 11.2) * 0.012 : Math.sin(t * 1.4) * 0.008;
        cam.position.set(x + (s.moving ? Math.sin(t * 2.8) * 0.05 : 0), this.foot + 1.68 + bob, z);
      }
      cam.lookAt(s.look[0], s.look[1], s.look[2]);
      if (!s.air && s.moving) cam.rotateZ(Math.sin(t * 2.8) * 0.006);
      cam.fov = s.air ? 60 : 66; cam.updateProjectionMatrix();
      document.getElementById('d-fade').style.opacity = String(fade);
      const cap = document.getElementById('d-cap'); cap.textContent = s.cap; cap.style.opacity = String(capOpacity);
      document.getElementById('d-title').style.opacity = String(titleOpacity);
      for (const u of this.ups) u.update(dt, (app.elapsed += dt));
      app.time.update(cam.position, null, cam.position.y);
      app.renderer.render(app.scene, cam);
    },
  };
  window.__twin.setMode('orbit');
  console.log('[demo] active updatables', window.__demo.ups.length, 'of', app.updatables.length);
});
const FROM = Number(opt('from', 0)), TO = Number(opt('to', DURATION));
const total = Math.round(DURATION * FPS);
console.log(`recording ${DURATION}s @ ${FPS}fps = ${total} frames at ${W}x${H}`);
for (let f = Math.round(FROM * FPS); f < Math.min(total, Math.round(TO * FPS)); f++) {
  const t = f / FPS, s = sample(t), fade = fadeAt(t);
  const capOp = s.cap ? Math.max(0, 1 - fade * 2) * 0.95 : 0;
  const titleOp = t < TITLE_AT ? 0 : Math.min(1, (t - TITLE_AT) / 0.8);
  await page.evaluate(([s, fade, capOp, titleOp, t, dt]) => window.__demo.frame(s, fade, capOp, titleOp, t, dt), [s, fade, capOp, titleOp, t, 1 / FPS]);
  await page.screenshot({ path: `${OUT}/${String(f).padStart(5, '0')}.png` });
  if (f % 120 === 0) console.log(' frame', f, '/', total, (s.cap || '·'));
}
await browser.close();
console.log('frames done ->', OUT);
