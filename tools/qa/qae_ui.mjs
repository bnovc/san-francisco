// QA-E sections 5+6: storefront info prompts around the square; orbit / tour / time-of-day / reference overlay.
import { launch, opts } from './qae_lib.mjs';
const opt = opts();
const c = await launch({ out: opt('out', 'qa/shots/qae'), prefix: 'ui_', life: '1' });
const { check, tp, look, T, page, prompt, setCam } = c;

// ---- 5. storefront prompts: stand on the sidewalk 6-8 m in front of 10 storefronts, look at the facade, read the prompt ----
const spots = [
  // [name expected, stand x, stand z, compass heading toward the shop]
  ['Nintendo SAN FRANCISCO', -76, 34.5, 261], ['Swarovski', -57.7, 55, 171], ['Dyson', -45, 55, 171], ["Macy's Union Square", -8.9, 55, 171], ['Louis Vuitton', 41.3, 55, 171],
  ['Tiffany & Co.', -2.2, -55, 351], ['Apple Union Square', 43.3, -54, 351], ['Nike San Francisco', 76, -60.4, 81], ['Gucci', 76, -11.7, 81], ['Tory Burch', 76, 10, 81],
  ['Moncler', 76, 29.7, 81], ['Vacant (ex-Williams-Sonoma; Chanel fit-out)', 14.8, -55, 351], ['Saks Fifth Avenue', -47.9, -54, 351], ['Neiman Marcus', 80.2, 68.8, 81], ['CK Contemporary', -70, 72.7, 81],
];
const bad = [];
for (const [name, x, z, h] of spots) {
  await tp(x, z, h); await look(h, 4); await page.waitForTimeout(350);
  const pr = await prompt(); const hit = pr.prompt.includes(name.split(' ')[0]);
  if (!hit) bad.push({ name, prompt: pr.prompt, cam: [x, z, h] });
  await check(`5.x prompt @ (${x},${z},h${h}) expect "${name}" -> "${pr.prompt}"`, async () => ({ ok: hit, prompt: pr.prompt, hud: pr.hud }));
  if (hit && /E · info/.test(pr.prompt)) { await T(() => window.__twin.interact()); await page.waitForTimeout(300); const t = (await prompt()).toast; c.results[c.results.length - 1].info += ' | E toast: ' + t; console.log('   E ->', t); }
}
await check('5.16 Storefront prompt summary', async () => ({ ok: bad.length <= 2, wrong: bad }), { shot: false });
await check('5.17 Prompt hidden when looking at a blank wall / sky', async () => { await tp(0, 0, 351); await look(351, 60); await page.waitForTimeout(300); const pr = await prompt(); return { ok: pr.prompt === '', prompt: pr.prompt }; });
await check('5.18 Prompt while inside Nintendo (should show interior items, not outside shops)', async () => { await tp(-88, 34.45, 261); await look(261, 0); await page.waitForTimeout(300); const pr = await prompt(); return { ok: !/Swarovski|Dyson|Shoe Palace/.test(pr.prompt), prompt: pr.prompt }; });

// ---- 6. modes ----
await tp(-40, 20, 40);
await check('6.1 Orbit mode via Tab: camera reframes to an aerial orbit, walk HUD off', async () => { await page.keyboard.press('Tab'); await page.waitForTimeout(900); const s = await T(() => ({ cam: window.__twin.app.camera.position.toArray().map((v) => +v.toFixed(0)), active: document.querySelector('#toolbar button.active')?.textContent, crosshair: document.getElementById('crosshair').style.display })); return { ok: s.active === 'Orbit' && s.cam[1] > 50, ...s }; });
await check('6.2 Orbit: mouse drag rotates the view (camera position changes)', async () => { const a = await T(() => window.__twin.app.camera.position.toArray().map((v) => +v.toFixed(1))); await page.mouse.move(800, 450); await page.mouse.down(); await page.mouse.move(600, 430, { steps: 12 }); await page.mouse.up(); await page.waitForTimeout(700); const b = await T(() => window.__twin.app.camera.position.toArray().map((v) => +v.toFixed(1))); return { ok: JSON.stringify(a) !== JSON.stringify(b), a, b }; });
await check('6.3 Orbit: wheel zooms', async () => { const a = await T(() => window.__twin.app.camera.position.length()); await page.mouse.wheel(0, -1200); await page.waitForTimeout(700); const b = await T(() => window.__twin.app.camera.position.length()); return { ok: Math.abs(a - b) > 5, a: +a.toFixed(0), b: +b.toFixed(0) }; });
await check('6.4 Tab back to walk: player lands on the ground at the orbit camera x/z (not floating)', async () => { await page.keyboard.press('Tab'); await page.waitForTimeout(600); const p = await c.probe(); return { ok: Math.abs(p.foot - p.floorStep) < 0.6, p }; });

await check('6.5 Tour: setMode(tour) starts, title shown', async () => { await T(() => window.__twin.setMode('tour')); await page.waitForTimeout(1500); const s = await T(() => ({ title: document.getElementById('tour-title').innerText.replace(/\n/g, ' / '), active: document.querySelector('#toolbar button.active')?.textContent })); return { ok: /Union Square/.test(s.title), ...s }; });
const stopsSeen = [];
for (let i = 0; i < 3; i++) {
  await page.waitForTimeout(i === 0 ? 5500 : 9500);
  const s = await T(() => ({ title: document.getElementById('tour-title').innerText.replace(/\n/g, ' / '), cam: window.__twin.app.camera.position.toArray().map((v) => +v.toFixed(1)), time: window.__twin.app.time?.preset || window.__twin.app.time?.current || '' }));
  stopsSeen.push(s);
  await check(`6.6 Tour stop ${i + 1}: ${s.title}`, async () => ({ ok: !!s.title, ...s }));
}
await check('6.7 Tour camera never below the ground/floor at the stops', async () => { const cams = stopsSeen.map((s) => s.cam); const below = await T((cams) => cams.map(([x, y, z]) => ({ x, y, z, floor: +window.__twin.world.collision.floorAt(x, z, y - 1.7, 100).toFixed(2), terr: +window.__twin.world.terrain.heightAt(x, z).toFixed(2) })), cams); return { ok: below.every((b) => b.y > b.terr + 0.3), below }; }, { shot: false });
await check('6.8 Tour: T key stops the tour and returns to walk mode', async () => { await page.keyboard.press('KeyT'); await page.waitForTimeout(600); const s = await T(() => ({ active: document.querySelector('#toolbar button.active')?.textContent, title: document.getElementById('tour-title').style.display })); const p = await c.probe(); return { ok: s.active === 'Walk' && s.title === 'none', ...s, p }; });

// time of day
await tp(-58, 40, 45); await look(45, 6);
for (const t of ['day', 'sunset', 'night']) {
  await check(`6.9 setTime(${t}) — screenshot from the plaza SW corner`, async () => { await T((t) => window.__twin.setTime(t), t); await page.waitForTimeout(1500); const s = await T(() => ({ sel: document.getElementById('time-select').value, night: +window.__twin.app.time.nightFactor.toFixed(2), exposure: +window.__twin.app.renderer.toneMappingExposure.toFixed(2) })); return { ok: true, ...s }; });
}
await check('6.10 Keyboard 1/2/3 switch time (HUD/select follows)', async () => { await page.keyboard.press('Digit2'); await page.waitForTimeout(500); const a = await T(() => window.__twin.app.time.nightFactor); await page.keyboard.press('Digit1'); await page.waitForTimeout(500); const b = await T(() => window.__twin.app.time.nightFactor); return { ok: a !== b, sunsetNight: +a.toFixed(2), dayNight: +b.toFixed(2) }; });
await check('6.11 Night inside Apple (lights on)', async () => { await T(() => window.__twin.setTime('night')); await tp(43.3, -70, 351); await look(351, 5); await page.waitForTimeout(1200); return { ok: true }; });
await check('6.12 Night on Powell looking at Nintendo (sign lit)', async () => { await tp(-70, 44, 300); await look(300, 4); await page.waitForTimeout(800); return { ok: true }; });
await T(() => window.__twin.setTime('day'));

// reference overlay via reload
await page.goto('http://localhost:5173/?qa=1&ref=1&view=vp05&life=1&freeze=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__twin?.ready || window.__twinError, null, { timeout: 180000 });
await page.waitForTimeout(1500);
await check('6.13 Reference overlay ?ref=1&view=vp05: ref layer visible with an image, control bar shown', async () => { const s = await T(() => { const l = document.getElementById('ref-layer'); const ctl = document.getElementById('ref-ctl'); return { layer: l.style.display, bg: l.style.backgroundImage.slice(0, 80), ctl: ctl.style.display, opacity: document.getElementById('ref-opacity').value, label: document.getElementById('ref-label').textContent, hud: (document.getElementById('hud').innerText || '').split('\n')[0] }; }); return { ok: s.layer !== 'none' && s.bg.includes('url'), ...s }; });
await check('6.14 Reference overlay: opacity slider to 100% (photo only) then R toggles off', async () => { await T(() => { const r = document.getElementById('ref-opacity'); r.value = 100; r.dispatchEvent(new Event('input')); }); await page.waitForTimeout(300); const a = await T(() => document.getElementById('ref-layer').style.opacity); await c.shot('6.14a ref 100pct'); await page.keyboard.press('KeyR'); await page.waitForTimeout(300); const b = await T(() => document.getElementById('ref-layer').style.display); return { ok: b === 'none', opacityAt100: a, afterR: b }; });
await check('6.15 Reference "next" button advances to vp06', async () => { await page.keyboard.press('KeyR'); await page.waitForTimeout(200); await page.click('#ref-next'); await page.waitForTimeout(800); const s = await T(() => ({ sel: document.getElementById('view-select').value, hud: (document.getElementById('hud').innerText || '').split('\n').find((l) => /vp\d\d/.test(l)) || '' })); return { ok: s.sel === 'vp06' || /vp06/.test(s.hud), ...s }; });
await c.finish('ui');
