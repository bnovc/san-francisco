// QA-E re-test: cinematic tour (setMode('tour') + T key), Tiffany prompt probe, time-select sync.
import { launch, opts } from './qae_lib.mjs';
const opt = opts();
const c = await launch({ out: opt('out', 'qa/shots/qae'), prefix: 'tour_', life: '1' });
const { check, tp, look, T, page, prompt } = c;
// clean time-of-day triplet in walk mode (the earlier ones were shot while the tour was running)
for (const t of ['day', 'sunset', 'night']) { await T(() => window.__twin.setMode('walk')); await tp(-58, 40, 45); await look(45, 6); await check(`6.9 setTime(${t}) from the plaza SW corner (walk mode)`, async () => { await T((t) => window.__twin.setTime(t), t); await page.waitForTimeout(1500); return { ok: true, night: await T(() => +window.__twin.app.time.nightFactor.toFixed(2)), sel: await T(() => document.getElementById('time-select').value) }; }); }
await check('6.11 Night inside Apple (ground floor looking north)', async () => { await tp(43.3, -70, 351); await look(351, 5); await page.waitForTimeout(1200); return { ok: true }; });
await check('6.12 Night on Powell looking at the Nintendo corner', async () => { await tp(-70, 46, 300); await look(300, 4); await page.waitForTimeout(800); return { ok: true }; });
await check('6.12b Night at Powell & Geary crosswalk (signal lamps, headlights)', async () => { await tp(-64.5, 57.5, 300); await look(300, 2); await page.waitForTimeout(800); return { ok: true }; });
await T(() => window.__twin.setTime('day')); await page.waitForTimeout(500);
await check('6.5 Tour: setMode(tour) starts, title shown', async () => { await T(() => window.__twin.setMode('tour')); await page.waitForTimeout(1500); const s = await T(() => ({ title: document.getElementById('tour-title').innerText.replace(/\n/g, ' / '), active: document.querySelector('#toolbar button.active')?.textContent, cam: window.__twin.app.camera.position.toArray().map((v) => +v.toFixed(1)) })); return { ok: /Union Square/.test(s.title), ...s }; });
const stops = [];
const titleNow = () => T(() => ({ title: document.getElementById('tour-title').innerText.replace(/\n/g, ' / '), cam: window.__twin.app.camera.position.toArray().map((v) => +v.toFixed(1)), night: +window.__twin.app.time.nightFactor.toFixed(2) }));
// stop 1 hold at ~6-9 s; stop 2 at ~16-19 s; stop 3 at ~26-29 s; stop 4 (Nintendo) at ~35-39 s
for (const [wait, name] of [[5500, 'stop1 aerial'], [10000, 'stop2 monument'], [10000, 'stop3 powell'], [9500, 'stop4 nintendo']]) { await page.waitForTimeout(wait); const s = await titleNow(); stops.push(s); await check(`6.6 Tour ${name}: ${s.title}`, async () => ({ ok: !!s.title, ...s })); }
await check('6.7 Tour camera above ground at the sampled stops', async () => { const r = await T((cams) => cams.map(([x, y, z]) => ({ x, y, z, terr: +window.__twin.world.terrain.heightAt(x, z).toFixed(2), floorHi: +window.__twin.world.collision.floorAt(x, z, y - 1.7, 100).toFixed(2) })), stops.map((s) => s.cam)); return { ok: r.every((b) => b.y > b.terr + 0.2), r }; }, { shot: false });
await check('6.8 Tour: T key stops the tour and returns to walk mode on the ground', async () => { await page.keyboard.press('KeyT'); await page.waitForTimeout(700); const s = await T(() => ({ active: document.querySelector('#toolbar button.active')?.textContent, title: document.getElementById('tour-title').style.display })); const p = await c.probe(); return { ok: s.active === 'Walk' && s.title === 'none' && Math.abs(p.foot - p.floorStep) < 0.6, ...s, p }; });
await check('6.8b Tour via T key from walk: starts; full run ends back in walk mode (wait 70 s)', async () => { await page.keyboard.press('KeyT'); await page.waitForTimeout(1000); const a = await T(() => document.querySelector('#toolbar button.active')?.textContent); await page.waitForTimeout(70000); const b = await T(() => ({ active: document.querySelector('#toolbar button.active')?.textContent, night: +window.__twin.app.time.nightFactor.toFixed(2), sel: document.getElementById('time-select').value })); const p = await c.probe(); return { ok: a === 'Tour' && b.active === 'Walk', during: a, after: b, p }; });
await check('6.10b Toolbar time-select follows setTime/keys? (select value after key 3)', async () => { await page.keyboard.press('Digit3'); await page.waitForTimeout(400); const s = await T(() => ({ sel: document.getElementById('time-select').value, night: +window.__twin.app.time.nightFactor.toFixed(2) })); return { ok: s.sel === 'night', ...s }; }, { shot: false });
await T(() => window.__twin.setTime('day'));
// Tiffany prompt probe from several spots on the Post St north sidewalk
for (const [x, z, h, p] of [[-2.2, -55, 351, 4], [-2.2, -57.5, 351, 8], [-6, -56, 330, 6], [2, -56, 10, 6], [-2.2, -50, 351, 6]]) {
  await tp(x, z, h); await look(h, p); await page.waitForTimeout(400);
  const pr = await prompt();
  await check(`5.6b Tiffany prompt @ (${x},${z},h${h},p${p}) -> "${pr.prompt}"`, async () => ({ ok: /Tiffany/.test(pr.prompt), ...pr }));
}
await check('5.6c Tiffany storefront registry position vs building face', async () => { const s = await T(() => { const sf = window.__twin.storefronts().find((s) => /Tiffany/.test(s.name)); const full = window.__twin.hero.storefronts.find((s) => /Tiffany/.test(s.name)); const b = window.__twin.buildingAt(-2.2, -61); return { sf, pos: full && full.position.toArray().map((v) => +v.toFixed(2)), facing: full && full.facing.toArray(), bld: b && { name: b.name, address: b.address, fp: b.fp.slice(0, 4) } }; }); return { ok: true, ...s }; }, { shot: false });
await c.finish('tour');
