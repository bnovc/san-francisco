// Screenshot the signage QA wall: node tools/qa/signtest.mjs [--out=qa/shots/signs] [--time=day] [--url=http://localhost:5173] [--rows=all|0,1,2]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const out = opt('out', 'qa/shots/signs'), base = opt('url', 'http://localhost:5173'), time = opt('time', 'day');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
await page.goto(`${base}/?qa=1&freeze=1&life=0&time=${time}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__twin?.ready || window.__twinError, null, { timeout: 180000 });
const err = await page.evaluate(() => window.__twinError); if (err) { console.log('APP ERROR', err); process.exit(1); }
await page.evaluate(() => window.__twin.setCamera(-18, 1.7, 6, 351, 0, 60));
await page.evaluate((f) => { window.__signFill = f; }, time === 'night' ? Number(opt('fill', 0.12)) : Number(opt('fill', 1.6)));
const layout = await page.evaluate(async () => { const m = await import('/src/debug/SignTest.ts'); const l = m.runSignTest(window.__twin.app, { cols: 6, fill: window.__signFill }); window.__signTest = { m, l }; return l; });
console.log('signs', layout.count, 'rows', layout.rows, 'cols', layout.cols);
const shoot = async (name, row) => {
  const cam = await page.evaluate((row) => window.__signTest.m.signTestCamera(window.__signTest.l, row), row);
  await page.evaluate((c) => window.__twin.setCamera(c.x, c.y, c.z, c.heading, c.pitch, c.fov), cam);
  // walk mode may snap the eye to the floor: re-aim at the target height
  const pos = await page.evaluate(() => window.__twin.pos());
  const dx = cam.x - layout.center[0], dz = cam.z - layout.center[2]; const dist = Math.hypot(dx, dz);
  const pitch = Math.atan2(cam.targetY - pos.y, dist) * 180 / Math.PI;
  await page.evaluate(([h, p]) => window.__twin.look(h, p), [cam.heading, pitch]);
  await page.waitForTimeout(250); await page.evaluate(() => window.__twin.renderOnce());
  const file = path.join(out, `${name}.png`); await page.screenshot({ path: file }); console.log('wrote', file);
};
await shoot('logos');
const rowsArg = opt('rows', 'all'); const rows = rowsArg === 'all' ? [...Array(layout.rows).keys()] : rowsArg.split(',').map(Number);
for (const r of rows) await shoot(`row${r}`, r);
await browser.close();
