// Screenshot every reference viewpoint (or the ids passed as args) with Playwright. Usage: node tools/qa/capture.mjs [--time=day] [--out=qa/shots] [ids...]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const time = opt('time', 'day'), out = opt('out', `qa/shots/${opt('time', 'day')}`), base = opt('url', 'http://localhost:5173');
const ids = args.filter((a) => !a.startsWith('--'));
const W = Number(opt('w', 1920)), H = Number(opt('h', 1080));
fs.mkdirSync(out, { recursive: true });

async function ensureServer() {
  try { const r = await fetch(base); if (r.ok) return null; } catch {}
  const p = spawn('npx', ['vite', '--port', '5173', '--strictPort'], { stdio: 'ignore', detached: false });
  for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 500)); try { const r = await fetch(base); if (r.ok) return p; } catch {} }
  throw new Error('vite did not start');
}

const server = await ensureServer();
const browser = await chromium.launch({ headless: opt('headed', '0') !== '1', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text().slice(0, 200)); });
const url = `${base}/?qa=1&time=${time}&freeze=1&life=${opt('life', '1')}&debug=${opt('debug', '0')}${opt('extra', '')}`;
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__twin?.ready || window.__twinError, null, { timeout: 180000 });
const err = await page.evaluate(() => window.__twinError); if (err) { console.log('APP ERROR', err); process.exit(1); }
const cams = args.filter((a) => a.startsWith('--cam=')).map((a) => a.slice(6)); // name:x,y,z,heading,pitch,fov
const list = cams.length ? cams.map((c) => c.split(':')[0]) : ids.length ? ids : await page.evaluate(() => window.__twin.viewpoints());
const js = opt('js', ''); if (js) console.log('js →', JSON.stringify(await page.evaluate((code) => { try { return (0, eval)(code); } catch (e) { return 'ERR ' + e.message; } }, js)).slice(0, 400));
const hide = opt('hide', ''); if (hide) await page.evaluate((names) => { const sc = window.__twin.app.scene; sc.traverse((o) => { if (names.includes(o.name)) o.visible = false; }); }, hide.split(','));
console.log('capturing', list.length, 'viewpoints at', time, '->', out);
const report = [];
for (const id of list) {
  const cam = cams.find((c) => c.startsWith(id + ':'));
  if (cam) { const [x, y, z, h, p, f] = cam.split(':')[1].split(',').map(Number); await page.evaluate(([x, y, z, h, p, f]) => window.__twin.setCamera(x, y, z, h, p, f || 65), [x, y, z, h, p, f]); }
  else { const ok = await page.evaluate((id) => window.__twin.setView(id), id); if (!ok) { console.log('unknown viewpoint', id); continue; } }
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__twin.renderOnce());
  const stats = await page.evaluate(() => window.__twin.stats());
  const file = path.join(out, `${id}.png`);
  await page.screenshot({ path: file });
  report.push({ id, file, stats });
  console.log(id, 'calls', stats.calls, 'tris', stats.triangles, 'fps', stats.fps);
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
await browser.close();
if (server) server.kill();
