// Focused regression probe for the source-derived 15th/Market supplement.
// Start an isolated Vite server first. Captures stay outside the repository.
// node tools/qa/market15_detail.mjs --url=http://127.0.0.1:5193 --out=/private/tmp/market15-detail
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const opt = (key, fallback) => process.argv.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3) || fallback;
const base = opt('url', 'http://127.0.0.1:5173');
const out = opt('out', '/private/tmp/market15-detail');
fs.mkdirSync(out, { recursive: true });
const source = JSON.parse(fs.readFileSync(new URL('../../src/data/areas/15th-and-market.generated.json', import.meta.url)));
const wings = source.buildings.filter((b) => b.id === 'relation/10963754');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(`${base}/?qa=1&time=day&freeze=1&pos=-2430,8,2055&look=100,0`);
  await page.waitForFunction(() => window.__twin?.ready || window.__twinError, null, { timeout: 180000 });
  assert.equal(await page.evaluate(() => window.__twinError || null), null);
  await page.evaluate(async () => { const t = window.__twin; await t.city.ensureAround(-2430, 2055, 2); t.walk.setThirdPerson(false); });
  const geometry = await page.evaluate((wings) => {
    const t = window.__twin, tile = t.city.group.getObjectByName('city:-6,4');
    const building = tile.getObjectByName('buildings');
    const ranges = building.userData.inspectionRanges.filter((r) => r.data.id === 'relation/10963754');
    const blockedEdges = wings.flatMap((w) => w.outer.map((a, i) => {
      const b = w.outer[(i + 1) % w.outer.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < .2) return true;
      const x = (a[0] + b[0]) / 2, z = (a[1] + b[1]) / 2;
      const body = t.walk.body.clone().set(x, t.city.heightAt(x, z), z);
      t.world.collision.resolve(body, .35, 1.7);
      return Math.hypot(body.x - x, body.z - z) >= .349;
    }));
    const trees = [];
    t.city.group.traverse((o) => { if (o.name === 'street-tree-trunks') for (const record of o.userData.inspectionInstances) trees.push(record.id); });
    const contents = ['mapped-crosswalks', 'tram-rails', 'mapped-transit-platforms', 'market-lamps-metal', 'inferred-junction-asphalt'].map((name) => ({ name, present: !!t.city.group.getObjectByName(name) }));
    const shadow = t.app.time;
    const original = shadow.sun.position.clone().sub(shadow.sun.target.position).normalize();
    const centers = [t.walk.body.clone().set(-2400, 15, 2050), t.walk.body.clone().set(3000, 100, -4500), t.walk.body.clone().set(0, 1, 0)];
    let maxDirectionError = 0;
    for (const center of centers) for (let i = 0; i < 100; i++) {
      shadow.update(center);
      maxDirectionError = Math.max(maxDirectionError, shadow.sun.position.clone().sub(shadow.sun.target.position).normalize().distanceTo(original));
    }
    return { wings: ranges.length, heights: ranges.map((r) => r.data.facts[0].value), blockedEdges, suppressedTreeIdsAbsent: Array.from({ length: 9 }, (_, i) => String(228278 + i)).every((id) => !trees.includes(id)), contents, maxDirectionError };
  }, wings);
  assert.equal(geometry.wings, 2);
  assert.deepEqual(geometry.heights, ['21.0 m', '21.0 m']);
  assert.ok(geometry.blockedEdges.every(Boolean), 'Recovered building edges must block walking');
  assert.ok(geometry.suppressedTreeIdsAbsent);
  assert.ok(geometry.contents.every((item) => item.present));
  assert.ok(geometry.maxDirectionError < 1e-10, 'Sun direction must remain fixed across distant viewer positions');
  const views = [];
  for (const view of [{ id: 'street', x: -2430, z: 2055, heading: 100, pitch: 2 }, { id: 'junction', x: -2430, z: 2073, heading: 70, pitch: 3 }]) {
    await page.evaluate((v) => { const t = window.__twin; t.setCamera(v.x, t.city.heightAt(v.x, v.z) + 1.7, v.z, v.heading, v.pitch, 60); }, view);
    await page.waitForTimeout(2000);
    views.push({ ...view, stats: await page.evaluate(() => window.__twin.stats()) });
    await page.screenshot({ path: `${out}/${view.id}.png` });
  }
  // Exercise one actual mapped crossing on foot, with collision enabled.
  const crossing = source.features.find((f) => f.id === 'way/676691698');
  assert.ok(crossing?.segments.length);
  const [a, b] = crossing.segments.find(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) > 3) || crossing.segments[0];
  const walkResult = await page.evaluate(async ([a, b]) => {
    const t = window.__twin;
    const distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const heading = 80.686 + Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
    t.teleport(a[0], a[1], heading);
    const start = t.walk.body.clone();
    t.walk.keys.add('KeyW');
    const endTime = performance.now() + (distance / t.walk.walkSpeed + .5) * 1000;
    while (performance.now() < endTime && Math.hypot(t.walk.body.x - b[0], t.walk.body.z - b[1]) > .35) await new Promise(requestAnimationFrame);
    t.walk.keys.delete('KeyW');
    return { distance, traveled: t.walk.body.distanceTo(start), residual: Math.hypot(t.walk.body.x - b[0], t.walk.body.z - b[1]), grounded: t.walk.grounded };
  }, [a, b]);
  assert.ok(walkResult.residual < .6 && walkResult.grounded, 'Mapped crossing must be traversable on foot');
  const streaming = await page.evaluate(async () => {
    const t = window.__twin;
    t.app.paused = true;
    const count = () => t.world.collision.walls.filter((w) => w.tag === 'city:-6,4').length;
    const before = count();
    t.city.update(-5000, 3000); await t.city.ensureAround(-5000, 3000);
    const unloaded = count();
    t.city.update(-2430, 2055); await t.city.ensureAround(-2430, 2055, 2);
    const after = count();
    t.teleport(-2430, 2055, 100);
    t.app.paused = false;
    return { before, unloaded, after };
  });
  assert.equal(streaming.unloaded, 0);
  assert.equal(streaming.after, streaming.before, 'Reloading must not duplicate collision walls');
  await page.evaluate(() => window.__twin.setMode('orbit'));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${out}/aerial.png` });
  views.push({ id: 'aerial', stats: await page.evaluate(() => window.__twin.stats()) });
  assert.deepEqual(errors, []);
  const report = { browser: browser.version(), viewport: { width: 1440, height: 900 }, geometry, walkResult, streaming, views, errors };
  fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
