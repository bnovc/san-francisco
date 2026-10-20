// Traffic system QA: boots the app (life=0), instantiates TrafficLights + Traffic inside the page, steps the simulation
// deterministically, audits the fleet (overlaps, off-road, wheels on ground, lane sides) and screenshots three cameras.
// Usage: node tools/qa/traffic_test.mjs [--steps=400] [--dt=0.05] [--time=day] [--out=qa/shots/traffic] [--count=110] [--rounds=2]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const out = opt('out', 'qa/shots/traffic'), steps = Number(opt('steps', 400)), dt = Number(opt('dt', 0.05)), rounds = Number(opt('rounds', 2));
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text().slice(0, 300)); });
await page.route(/\/@vite\/client/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'export const createHotContext = () => ({ on() {}, accept() {}, dispose() {} });' }));   // no HMR: file edits elsewhere must not reload the page mid-run
await page.goto(`${opt('url', 'http://localhost:5173')}/?qa=1&freeze=1&life=0&time=${opt('time', 'day')}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__twin?.ready || window.__twinError, null, { timeout: 180000 });

const built = await page.evaluate(async (count) => {
  const { TrafficLights } = await import('/src/life/TrafficLights.ts');
  const { Traffic } = await import('/src/life/Traffic.ts');
  const { world, app } = window.__twin;
  const lights = new TrafficLights(world, app);
  const traffic = new Traffic(world, app, null, lights, { count });
  const t0 = performance.now();
  await traffic.build();
  lights.frozen = true; traffic.frozen = true;
  app.add(lights); app.add(traffic);
  window.__traffic = traffic; window.__lights = lights;
  return { buildMs: Math.round(performance.now() - t0), lights: lights.stats(), traffic: traffic.stats(), models: [...traffic.models.keys()] };
}, Number(opt('count', 110)));
console.log('built', JSON.stringify(built));

const step = (n, dt) => page.evaluate(([n, dt]) => {
  const { __traffic: tr, __lights: li } = window;
  tr.frozen = false; li.frozen = false;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) { li.update(dt, 0); tr.update(dt, 0); }
  const ms = (performance.now() - t0) / n;
  tr.frozen = true; li.frozen = true;
  return { msPerStep: +ms.toFixed(3), stats: tr.stats(), lightT: li.stats().t };
}, [n, dt]);

const audit = () => page.evaluate(() => {
  const tr = window.__traffic, w = window.__twin.world, li = window.__lights;
  const snap = tr.snapshot();
  const issues = [];
  let offRoad = 0, ground = 0;
  for (const a of snap) {
    if (!w.isRoad(a.x, a.z)) offRoad++;
    const gy = w.terrain.heightAt(a.x, a.z) + 0.02; if (Math.abs(a.y - gy) > 0.35) ground++;
  }
  for (let i = 0; i < snap.length; i++) for (let j = i + 1; j < snap.length; j++) {
    const a = snap[i], b = snap[j]; const dx = Math.abs(a.x - b.x), dz = Math.abs(a.z - b.z);
    const ns = a.dir === 'N' || a.dir === 'S'; const along = ns ? dz : dx, across = ns ? dx : dz;
    if (along < (a.halfLen + b.halfLen) * 0.8 && across < 1.7 && Math.abs(a.y - b.y) < 3) issues.push(`overlap ${a.kind}#${a.id}@(${a.x},${a.z},${a.dir}) ${b.kind}#${b.id}@(${b.x},${b.z},${b.dir}) along=${along.toFixed(1)} across=${across.toFixed(1)}`);
  }
  // lane side check: on two-way Powell, N-bound vehicles must be east of the centreline, S-bound west
  const powell = w.streetSpecs.find((s) => s.name === 'Powell Street').c;
  let sideBad = 0; for (const a of snap) if (a.street === 'Powell Street' && !a.conn) { if ((a.dir === 'N' && a.x < powell) || (a.dir === 'S' && a.x > powell)) sideBad++; }
  const byStreet = {}; for (const a of snap) { const k = `${a.street} ${a.dir}`; byStreet[k] = (byStreet[k] || 0) + 1; }
  // stopped-at-red check: vehicles stopped near a red signal
  let stoppedAtRed = 0, runningRed = 0;
  for (const a of snap) {
    if (a.conn) continue;
    const rem = a.len - a.s; if (rem > 12) continue;
    const n = tr.graph.links[0] && null; void n;
    const node = li.nearest(a.x + (a.dir === 'E' ? rem : a.dir === 'W' ? -rem : 0), a.z + (a.dir === 'S' ? rem : a.dir === 'N' ? -rem : 0));
    if (!node) continue;
    const axis = a.dir === 'N' || a.dir === 'S' ? 'ns' : 'ew'; const col = node.state[axis];
    if (col === 'red' && a.v < 0.3 && rem < 6) stoppedAtRed++;
    if (col === 'red' && a.v > 3 && rem < 2) runningRed++;
  }
  return { n: snap.length, offRoad, groundBad: ground, overlaps: issues.length, overlapSample: issues.slice(0, 6), sideBad, stoppedAtRed, runningRed, byStreet, cable: snap.filter((a) => a.kind === 'cable_car_powell'), buses: snap.filter((a) => a.kind === 'bus_muni') };
});

const cams = { powell_north: [-66, -2.3, 62, 351, 2, 60], geary_east: [-60, -2.7, 58, 81, 2, 60], aerial: [0, 90, 120, 351, -35, 60], aerial_high: [-20, 150, 170, 348, -42, 55] };
const extra = args.filter((a) => a.startsWith('--cam=')).map((a) => a.slice(6));
for (const c of extra) { const [name, v] = c.split(':'); cams[name] = v.split(',').map(Number); }

for (let r = 0; r < rounds; r++) {
  const s = await step(steps, dt);
  console.log(`round ${r} after ${steps} steps:`, JSON.stringify(s));
  const a = await audit();
  console.log('audit', JSON.stringify({ ...a, cable: undefined, buses: undefined }));
  console.log('cable', JSON.stringify(a.cable.map((c) => [c.id, c.x, c.z, c.v, c.dir, c.s, c.len, c.served])));
  console.log('buses', JSON.stringify(a.buses.map((c) => [c.id, c.x, c.z, c.v, c.dir, c.street, c.s, c.len, c.served])));
  const chase = await page.evaluate(() => { const tr = window.__traffic, w = window.__twin.world; const out = {}; for (const [name, kind] of [['chase_cable', 'cable_car_powell'], ['chase_bus', 'bus_muni']]) { const c = tr.snapshot().filter((v) => v.kind === kind && Math.hypot(v.x, v.z) < 320).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0]; if (!c) continue; const back = c.dir === 'N' ? [5.5, -13] : c.dir === 'S' ? [-5.5, 13] : c.dir === 'E' ? [13, 5.5] : [-13, -5.5]; const cx = c.x + back[0], cz = c.z + back[1]; const y = w.terrain.heightAt(cx, cz) + 2.6; const h = (Math.atan2(c.x - cx, -(c.z - cz)) * 180) / Math.PI; out[name] = [cx, y, cz, h, -8, 50]; } return out; });
  Object.assign(cams, chase);
  for (const [name, [x, y, z, h, p, f]] of Object.entries(cams)) {
    await page.evaluate(([x, y, z, h, p, f]) => window.__twin.setCamera(x, y, z, h, p, f), [x, y, z, h, p, f]);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__twin.renderOnce());
    await page.waitForTimeout(100);
    const file = path.join(out, `${name}_r${r}.png`);
    await page.screenshot({ path: file });
    console.log('shot', file);
  }
}
const perf = await page.evaluate(() => { const tr = window.__traffic, li = window.__lights; tr.frozen = false; li.frozen = false; let worst = 0, sum = 0; const N = 300; for (let i = 0; i < N; i++) { const t0 = performance.now(); li.update(1 / 60, 0); tr.update(1 / 60, 0); const ms = performance.now() - t0; sum += ms; worst = Math.max(worst, ms); } tr.frozen = true; li.frozen = true; return { avgMs: +(sum / N).toFixed(3), worstMs: +worst.toFixed(3), stats: tr.stats() }; });
console.log('perf', JSON.stringify(perf));
await browser.close();
