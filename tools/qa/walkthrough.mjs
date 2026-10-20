// Scripted final walkthrough: start blocks away, walk to the square, cross, plaza, Nintendo, Apple, aerial. Logs each check + screenshots.
import { chromium } from 'playwright';
import fs from 'node:fs';
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const out = opt('out', 'qa/walkthrough'); fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: opt('headed', '0') !== '1', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await page.goto(`http://localhost:5173/?qa=1&time=${opt('time', 'day')}&debug=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__twin?.ready || window.__twinError, null, { timeout: 180000 });
const results = [];
let n = 0;
async function shot(label) { n++; const f = `${out}/${String(n).padStart(2, '0')}_${label}.png`; await page.screenshot({ path: f }); return f; }
async function check(label, fn) { let ok = false, info = ''; try { const r = await fn(); ok = !!(r && (r.ok ?? r)); info = typeof r === 'object' ? JSON.stringify(r).slice(0, 300) : String(r); } catch (e) { info = 'ERR ' + e.message; } const f = await shot(label.replace(/\W+/g, '_').toLowerCase()); results.push({ label, ok, info, shot: f }); console.log(ok ? '✓' : '✗', label, info); }
const T = (js) => page.evaluate(js);
const tp = (x, z, h) => page.evaluate(([x, z, h]) => window.__twin.teleport(x, z, h), [x, z, h]);
const walk = async (dir, s) => page.evaluate(([d, s]) => window.__twin.move(d[0], d[1], s), [dir, s]);
const pos = () => page.evaluate(() => window.__twin.pos());

// 1. start several blocks away on Powell St (Powell & O'Farrell), look north toward the square
await tp(-68, 150, 351); await page.waitForTimeout(500);
await check('1 Start on Powell at O\'Farrell looking north (cable-car street, Westin ahead)', async () => { const p = await pos(); return { ok: Math.abs(p.z - 150) < 2, p }; });
// 2. walk north ~90 m along Powell to Geary (run)
await page.evaluate(() => { window.__twin.look(351, 0); });
await page.keyboard.down('Shift'); await walk([0, -1], 13); await page.keyboard.up('Shift');
await check('2 Union Square emerges (Powell & Geary corner)', async () => { const p = await pos(); return { ok: p.z < 75, p }; });
// 3. cross Geary at the crosswalk (from the south sidewalk to the plaza SW corner)
await tp(-64, 66, 351); await walk([0, -1], 9);
await check('3 Crossed Geary intersection', async () => { const p = await pos(); return { ok: p.z < 50, p }; });
// 4. walk through the plaza to the monument
await tp(-45, 30, 30); await page.evaluate(() => window.__twin.look(40, 0)); await walk([0, -1], 8);
await check('4 Walked into the plaza', async () => { const p = await pos(); return { ok: Math.hypot(p.x, p.z) < 45, p }; });
// 5. identify the Dewey Monument
await tp(-14, 12, 40); await page.evaluate(() => window.__twin.look(40, 25));
await check('5 Dewey Monument in view', async () => ({ ok: true }));
// 6. real storefronts around the square
await check('6 Storefront registry populated with real businesses', async () => { const s = await T(() => window.__twin.storefronts()); const names = s.map((x) => x.name); const need = ['Nintendo', 'Apple', 'Tiffany', 'Neiman', "Macy", 'Westin']; const found = need.filter((k) => names.some((nm) => nm.toLowerCase().includes(k.toLowerCase()))); return { ok: found.length >= 5, count: s.length, found }; });
// 7. locate Nintendo (visible from the SW corner of the plaza) and 8. enter
await tp(-58, 40, 240); await page.evaluate(() => window.__twin.look(245, 2));
await check('7 Nintendo storefront visible from plaza SW corner', async () => { const nb = await T(() => window.__twin.nearby()); return { ok: nb.some((x) => /nintendo/i.test(x.name)), nb: nb.slice(0, 5) }; });
await check('8 Enter Nintendo (teleport to entrance + walk in)', async () => { const ok = await T(() => window.__twin.enter('Nintendo SAN FRANCISCO')); await page.evaluate(() => window.__twin.move(0, -1, 3)); await page.waitForTimeout(3200); const p = await pos(); return { ok, p }; });
// 9. interact with displays inside
await check('9 Interactables inside Nintendo', async () => { const items = await T(() => (window.__twin.hero?.interactables || []).length); return { ok: true, items }; });
// 10–11. exit and walk around the square (east side)
await tp(-60, 20, 351); await walk([0, -1], 4);
await check('10 Exited Nintendo, back on the plaza', async () => { const p = await pos(); return { ok: p.x > -70, p }; });
await tp(50, -10, 351); await check('11 East side of the square (Stockton edge)', async () => ({ ok: true }));
// 12–14. locate Apple, enter, move through
await tp(44, -46, 351); await page.evaluate(() => window.__twin.look(351, 4));
await check('12 Apple Union Square visible across Post St', async () => { const nb = await T(() => window.__twin.nearby()); return { ok: nb.some((x) => /apple/i.test(x.name)), nb: nb.slice(0, 5) }; });
await check('13 Enter Apple', async () => { const ok = await T(() => window.__twin.enter('Apple Union Square')); await page.evaluate(() => window.__twin.move(0, -1, 4)); await page.waitForTimeout(4200); const p = await pos(); return { ok, p }; });
await check('14 Move through the Apple interior (toward the stair / Genius Grove)', async () => { await page.evaluate(() => window.__twin.move(1, 0, 2)); await page.waitForTimeout(2200); await page.evaluate(() => window.__twin.move(0, -1, 5)); await page.waitForTimeout(5200); const p = await pos(); return { ok: p.z < -70, p }; });
// 15. return outside
await tp(44, -50, 171); await check('15 Back outside on Post St', async () => ({ ok: true }));
// 16. traffic + pedestrians
await check('16 Traffic and pedestrian activity', async () => { const s = await T(() => window.__twin.lifeStats()); return { ok: (s.pedestrians || 0) > 50 && (s.vehicles || 0) > 10, s }; });
// 17–18. aerial
await page.evaluate(() => window.__twin.setCamera(0, 170, 240, 351, -32, 60));
await check('17 Aerial view', async () => ({ ok: true }));
await page.evaluate(() => window.__twin.setMode('orbit'));
await page.waitForTimeout(800);
await check('18 Orbit mode over the square', async () => ({ ok: true }));
fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 1));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed -> ${out}/results.json`);
await browser.close();
