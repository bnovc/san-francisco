// Performance audit: headed Chromium (real GPU) walks through key locations and samples fps / draw calls / triangles / frame time.
// Usage: node tools/qa/perf.mjs [--time=day] [--headed=1] [--seconds=4]
import { chromium } from 'playwright';
import fs from 'node:fs';
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const headed = opt('headed', '1') === '1', seconds = Number(opt('seconds', 4)), time = opt('time', 'day');
const browser = await chromium.launch({ headless: !headed, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--disable-frame-rate-limit', '--disable-gpu-vsync'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`http://localhost:5173/?time=${time}&qa=1&debug=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__twin?.ready || window.__twinError, null, { timeout: 180000 });
const spots = [
  ['plaza centre', -18, 1.7, 6, 351, 2], ['Powell & Geary', -66, -1.0, 62, 20, 2], ['Post & Stockton', 62, 0, -46, 215, 2], ['Powell north', -68, 1.7, -120, 171, 2],
  ['Geary east', 40, -3.0, 60, 81, 2], ['inside Nintendo', -86, -1.0, 36, 275, 0], ['inside Apple', 44, 0.3, -66, 351, 0], ['aerial', 0, 150, 250, 351, -30],
];
const rows = [];
for (const [name, x, y, z, h, p] of spots) {
  await page.evaluate(([x, y, z, h, p]) => window.__twin.setCamera(x, y, z, h, p, 65), [x, y, z, h, p]);
  await page.waitForTimeout(600);
  const r = await page.evaluate(async (seconds) => {
    const app = window.__twin.app; const frames = []; let last = performance.now(); const t0 = last;
    await new Promise((res) => { const tick = () => { const now = performance.now(); frames.push(now - last); last = now; if (now - t0 < seconds * 1000) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
    frames.shift(); frames.sort((a, b) => a - b);
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length, p95 = frames[Math.floor(frames.length * 0.95)];
    const s = app.stats(); const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
    return { fps: +(1000 / avg).toFixed(1), fpsP95: +(1000 / p95).toFixed(1), frameMs: +avg.toFixed(2), calls: s.calls, triangles: s.triangles, textures: s.textures, geometries: s.geometries, programs: s.programs, heapMB: mem, life: window.__twin.lifeStats() };
  }, seconds);
  rows.push({ name, ...r });
  console.log(name.padEnd(16), `fps ${r.fps} (p95 ${r.fpsP95})  ${r.frameMs} ms  calls ${r.calls}  tris ${(r.triangles / 1e6).toFixed(2)}M  tex ${r.textures}  heap ${r.heapMB}MB`);
}
fs.mkdirSync('qa/perf', { recursive: true });
fs.writeFileSync(`qa/perf/${time}.json`, JSON.stringify(rows, null, 1));
await browser.close();
