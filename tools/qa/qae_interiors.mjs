// QA-E sections 3+4: Nintendo and Apple — approach, prompts, doors, walk in, stairs, interactables, exit.
import { launch, opts } from './qae_lib.mjs';
const opt = opts();
const c = await launch({ out: opt('out', 'qa/shots/qae'), prefix: 'int_', life: opt('life', '1') });
const { check, tp, walk, look, T, page, probe } = c;
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const ui = () => T(() => { const p = document.getElementById('prompt'); const t = document.getElementById('toast'); const a = document.getElementById('apple-toast'); const vis = (e) => e && getComputedStyle(e).display !== "none"; return { prompt: vis(p) ? p.innerText.replace(/\n/g, ' | ') : '', toast: (vis(t) ? t.textContent : '') || (a && vis(a) ? a.textContent : ''), hud: (document.getElementById('hud')?.innerText || '').split('\n').filter((l) => /look:|souvenir/i.test(l)).join(' | ') }; });
const clearToasts = () => T(() => { for (const id of ['toast', 'apple-toast']) { const e = document.getElementById(id); if (e) { e.style.display = 'none'; e.textContent = ''; } } });
const visualHash = (id) => T((id) => { const it = window.__twin.hero.interactables.find((i) => i.id === id); const o = it?.object; if (!o) return null; let h = 0; o.updateMatrixWorld(true); o.traverse((m) => { if (!m.isMesh) return; const e = m.matrixWorld.elements; for (let i = 12; i < 15; i++) h = (h * 31 + Math.round(e[i] * 1000)) | 0; const img = m.material?.map?.image; if (img && img.getContext) { const d = img.getContext('2d').getImageData(0, 0, Math.min(64, img.width), Math.min(64, img.height)).data; for (let i = 0; i < d.length; i += 53) h = (h * 31 + d[i]) | 0; } if (m.material?.emissiveIntensity !== undefined) h = (h * 31 + Math.round(m.material.emissiveIntensity * 100)) | 0; }); return h; }, id);
/** Look at an interactable from the current position, read the prompt, press E; report what changed. */
async function tryItemHere(id) {
  const it = await T((id) => { const i = window.__twin.hero.interactables.find((i) => i.id === id); return i && { id: i.id, label: i.label, x: i.position.x, y: i.position.y, z: i.position.z, r: i.radius }; }, id);
  if (!it) return { ok: false, err: 'no interactable ' + id };
  const p = await c.pos();
  const h = (Math.atan2(it.x - p.x, -(it.z - p.z)) * 180 / Math.PI + 351 + 360) % 360;
  const dist = Math.hypot(it.x - p.x, it.z - p.z, it.y - p.y);
  const pitch = Math.atan2(it.y - p.y, Math.hypot(it.x - p.x, it.z - p.z)) * 180 / Math.PI;
  await look(h, pitch); await clearToasts(); await page.waitForTimeout(400);
  const before = await ui(); const h0 = await visualHash(id);
  await T(() => window.__twin.interact()); await page.waitForTimeout(600);
  const after = await ui(); const h1 = await visualHash(id);
  const changed = h0 !== h1;
  return { ok: before.prompt.includes(it.label) && (after.toast !== '' || changed), label: it.label, dist: +dist.toFixed(1), r: it.r, prompt: before.prompt, hudLook: before.hud, toast: after.toast, objectChanged: changed, foot: +(p.y - 1.7).toFixed(2) };
}
async function tryItem(id, [x, z]) { await tp(x, z, 0); await page.waitForTimeout(150); return tryItemHere(id); }
const wallsNear = (x, z, r = 1.2) => T(([x, z, r]) => { const C = window.__twin.world.collision; return C.walls.filter((w) => { const dx = w.bx - w.ax, dz = w.bz - w.az, l2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((x - w.ax) * dx + (z - w.az) * dz) / l2)); return Math.hypot(w.ax + dx * t - x, w.az + dz * t - z) < r; }).map((w) => ({ a: [+w.ax.toFixed(1), +w.az.toFixed(1)], b: [+w.bx.toFixed(1), +w.bz.toFixed(1)], y: [+w.y0.toFixed(1), +w.y1.toFixed(1)], tag: w.tag })).slice(0, 8); }, [x, z, r]);

// ================= NINTENDO =================
await tp(-58, 40, 240); await look(250, 2); await page.waitForTimeout(400);
await check('3.1 Nintendo: approach from the plaza SW corner — nearby() lists it, prompt shows the name', async () => { const nb = await T(() => window.__twin.nearby()); await walk(255, 3); await page.waitForTimeout(300); const pr = await ui(); const nb2 = await T(() => window.__twin.nearby()); return { ok: nb2.some((x) => /nintendo/i.test(x.name)) && /Nintendo/i.test(pr.prompt), nearbyBefore: nb.map((x) => x.name + '@' + x.d), nearbyAfter: nb2.map((x) => x.name + '@' + x.d), prompt: pr.prompt }; });
const leaves = () => T(() => { const g = window.__nintendo?.group || window.__twin.hero.group; const out = []; g?.traverse((o) => { if (/door|leaf/i.test(o.name) && Math.abs(o.position.x + 83) < 4 && Math.abs(o.position.z - 34.45) < 3) out.push(o.name + ':' + o.rotation.y.toFixed(2) + ':' + o.position.x.toFixed(2)); }); return out; });
await tp(-72, 34.45, 261); await page.waitForTimeout(1500);
await check('3.2 Nintendo Powell doors: closed at 11 m, open when within 4 m (leaf rotation changes)', async () => { const rotFar = await leaves(); await walk(261, 3.0); await page.waitForTimeout(1500); const rotNear = await leaves(); const p = await probe(); return { ok: rotFar.length > 0 && JSON.stringify(rotFar) !== JSON.stringify(rotNear), rotFar, rotNear, distToDoor: +Math.hypot(p.x + 82.98, p.z - 34.45).toFixed(2), prompt: (await ui()).prompt }; });
await check('3.3 Nintendo: walk in through the Powell doors (x < -83.7), floor at store level (-1.85)', async () => { const r = await walk(261, 3.0); return { ok: r.b.x < -83.7 && near(r.b.foot, -1.85, 0.3), ...r }; });
await check('3.4 Nintendo L0: look around (screenshot) + interactables count', async () => { await look(200, -5); await page.waitForTimeout(300); const n = await T(() => window.__twin.hero.interactables.filter((i) => i.id.startsWith('nintendo')).length); return { ok: n >= 10, n }; });
await tp(-90.0, 34.45, 261);
await check('3.5 Nintendo: walk down the central stair to the lower level (foot ~ -5.85), no drops', async () => { await c.trackStart(); const r = await walk(261, 5); const t = await c.trackStop(); const maxDrop = Math.max(...t.map((s, i) => i ? t[i - 1].foot - s.foot : 0)); return { ok: near(r.b.foot, -5.85, 0.3) && r.b.x < -98, maxStepDrop: +maxDrop.toFixed(2), ...r }; });
await check('3.6 Nintendo L1: look around (screenshot)', async () => { await look(81, 0); await page.waitForTimeout(300); const p = await probe(); return { ok: p.foot < -5.5, p }; });
// L1 items (walk, since teleport snaps to the upper floor)
await check('3.7 Nintendo activate nintendo-link-statue (L1)', async () => tryItemHere('nintendo-link-statue'));
await walk(171, 1.5); await walk(81, 4.4); // to about (-90, 38)
await check('3.7 Nintendo activate nintendo-kiosk-l1-3 (L1)', async () => { const p = await probe(); const r = await tryItemHere('nintendo-kiosk-l1-3'); return { ...r, at: [p.x, p.z, p.foot] }; });
await check('3.7 Nintendo activate nintendo-game-wall (L1)', async () => tryItemHere('nintendo-game-wall'));
await walk(351, 1.4);
await check('3.7 Nintendo activate nintendo-kiosk-l1-0 (L1)', async () => { const p = await probe(); const r = await tryItemHere('nintendo-kiosk-l1-0'); return { ...r, at: [p.x, p.z, p.foot] }; });
// L0 items
const nItems = [['nintendo-mario-statue', [-84.98, 37.05]], ['nintendo-plush-bin', [-86.78, 30.5]], ['nintendo-kiosk-l0-0', [-88.18, 32.5]], ['nintendo-kiosk-l0-3', [-91.18, 32.5]], ['nintendo-qblock-0', [-93.28, 35.9]], ['nintendo-qblock-2', [-96.28, 35.9]], ['nintendo-door-geary', [-91.77, 40.2]], ['nintendo-door-powell', [-85.3, 34.45]]];
for (const [id, at] of nItems) await check(`3.7 Nintendo activate ${id}`, async () => tryItem(id, at));
await check('3.8 Nintendo: souvenir counter — plush bin twice more (prompt shows collected: n)', async () => { await tp(-86.78, 30.5, 0); const a = await tryItemHere('nintendo-plush-bin'); const b = await tryItemHere('nintendo-plush-bin'); return { ok: /collected: [1-9]/.test(b.prompt), a: a.prompt + ' -> ' + a.toast, b: b.prompt + ' -> ' + b.toast }; });
await tp(-99, 34.45, 81);
await check('3.9 Nintendo: walk back up the stair (foot ~ -1.85) and out of the Powell doors to the sidewalk', async () => { const up = await walk(81, 5); await page.waitForTimeout(500); const out = await walk(81, 4); return { ok: near(up.b.foot, -1.85, 0.3) && out.b.x > -83.5, up: up.b, out: out.b }; });
await check('3.10 Nintendo: exit via the Geary doors (from inside at x=-91.77 walk south to z > 41.6)', async () => { await tp(-91.77, 36, 171); await page.waitForTimeout(1500); const r = await walk(171, 4); const walls = await wallsNear(r.b.x, r.b.z + 0.4, 1.0); return { ok: r.b.z > 41.6, wallsAtStop: walls, ...r }; });
await check('3.11 Nintendo: enter via the Geary doors from the Geary sidewalk (z 46 -> < 41)', async () => { await tp(-91.77, 47, 351); await page.waitForTimeout(1500); const r = await walk(351, 4); return { ok: r.b.z < 41.0, ...r }; });

// ================= APPLE =================
await tp(44, -46, 351); await look(351, 4); await page.waitForTimeout(500);
await check('4.1 Apple: approach across Post St — nearby() lists it, prompt shows the name', async () => { const nb = await T(() => window.__twin.nearby()); const pr = await ui(); return { ok: nb.some((x) => /apple/i.test(x.name)) && /Apple/.test(pr.prompt), nearby: nb.map((x) => x.name + '@' + x.d), prompt: pr.prompt }; });
await tp(43.3, -52, 351); await page.waitForTimeout(1500);
await check('4.2 Apple sliding doors: closed at 11 m, open when within 6 m (leaf x offset changes)', async () => { const leaf = () => T(() => { const it = window.__twin.hero.interactables.find((i) => i.id === 'apple-door'); return it?.object ? +it.object.position.x.toFixed(2) : null; }); const far = await leaf(); await walk(351, 2.5); await page.waitForTimeout(2500); const nearX = await leaf(); const p = await probe(); return { ok: far !== null && far !== nearX, leafFar: far, leafNear: nearX, distToDoor: +Math.hypot(p.x - 43.3, p.z + 63.1).toFixed(1), prompt: (await ui()).prompt }; });
await check('4.3 Apple: walk in through the doors to the product hall (z < -66)', async () => { const r = await walk(351, 4); return { ok: r.b.z < -66, ...r }; });
await check('4.4 Apple: straight in from the doors along x=43.3 — blocked by the first table? (walkthrough stuck at z=-65.85)', async () => { await tp(43.3, -64.3, 351); const r = await walk(351, 5); const walls = await wallsNear(43.3, r.b.z - 0.5, 1.0); return { ok: r.b.z < -74, wallsAhead: walls, ...r }; });
await check('4.5 Apple ground floor: walk-height vs store floor y0 along x=41 (terrain leaking into the store?)', async () => { await tp(41.0, -64.5, 351); await c.trackStart(); const r = await walk(351, 8); const t = await c.trackStop(); const y0 = await T(() => window.__twin.hero.interactables.find((i) => i.id === 'apple-iphone').position.y - 1.0); const maxAbove = Math.max(...t.map((s) => s.foot - y0)); const back = await probe(); return { ok: maxAbove < 0.3, storeFloorY0: +y0.toFixed(2), maxFootAboveFloor: +maxAbove.toFixed(2), terrainAtEnd: back.terr, endFoot: back.foot, samples: t.filter((_, i) => i % 20 === 0).map((s) => [s.z, s.foot, s.terr]), ...r }; });
await tp(28.7, -68.5, 351);
await check('4.6 Apple: up the west glass stair to the mezzanine (foot reaches y1 = y0+4.9)', async () => { await c.trackStart(); const r = await walk(351, 6); const t = await c.trackStop(); const gaps = t.filter((s) => s.foot - s.floorStep > 1.0).length; return { ok: near(r.b.foot, 4.62, 0.3) && r.b.z < -78.4, airborneSamples: gaps, ...r }; });
await check('4.7 Apple mezzanine: east along z=-80.2 toward the Forum video wall (x → 55+); what blocks?', async () => { const r = await walk(81, 10); const walls = await wallsNear(r.b.x + 0.5, r.b.z, 1.0); return { ok: r.b.x > 50, wallsAtStop: walls, ...r }; });
await check('4.7b Apple mezzanine: east along z=-84 (Genius Grove row)', async () => { await tp(30, -84, 81); const r = await walk(81, 10); return { ok: r.b.x > 50, ...r }; });
await check('4.8 Apple mezzanine: walk south to the edge at ZE=-78.4 (balustrade blocks walking off)', async () => { await tp(43, -82, 171); const r = await walk(171, 4); return { ok: r.b.z < -78.0 && r.dy > -1, ...r }; });
const aItems = [['apple-iphone', [43.3, -65.0]], ['apple-macbook', [38.5, -73.0]], ['apple-ipad', [48.1, -73.0]], ['apple-door', [43.3, -66.5]]];
for (const [id, at] of aItems) await check(`4.9 Apple activate ${id}`, async () => tryItem(id, at));
await tp(28.7, -68.5, 351); await walk(351, 6); await walk(81, 4.2); // up the stair, then east to x~38 on the mezz
await check('4.9 Apple activate apple-grove-seat (mezz, walked)', async () => { await walk(171, 0); await tp(36.0, -83.4, 0); const p = await probe(); const r = await tryItemHere('apple-grove-seat'); return { ...r, at: [p.x, p.z, p.foot] }; });
await check('4.9 Apple activate apple-forum-screen (mezz, from x=54)', async () => { await tp(28.7, -68.5, 351); await walk(351, 6); await tp(54, -75, 81); const p = await probe(); const r = await tryItemHere('apple-forum-screen'); return { ...r, at: [p.x, p.z, p.foot] }; });
await check('4.10 Apple: exit through the north doors (z -88.4) onto the door-level terrace', async () => { await tp(28.7, -68.5, 351); await walk(351, 6); await tp(43.3, -84, 351); await page.waitForTimeout(2500); const r = await walk(351, 3); return { ok: r.b.z < -88.6 && near(r.b.foot, 4.62, 0.3), ...r }; });
await check('4.11 Apple rear terrace: down the 6 terrace steps to the plaza (foot drops ~1.1 to yP=3.52)', async () => { await c.trackStart(); const r = await walk(351, 3); const t = await c.trackStop(); const maxDrop = Math.max(...t.map((s, i) => i ? t[i - 1].foot - s.foot : 0)); return { ok: r.b.z < -91.6 && near(r.b.foot, 3.52, 0.3), maxFrameDrop: +maxDrop.toFixed(2), ...r }; });
await check('4.12 Apple plaza: east past the Asawa fountain to the Stockton stair and down to the sidewalk', async () => { await tp(50, -99.3, 81); await c.trackStart(); const r = await walk(81, 7); const t = await c.trackStop(); const air = t.filter((s) => s.foot - s.floorStep > 1.0).length; const maxDrop = Math.max(...t.map((s, i) => i ? t[i - 1].foot - s.foot : 0)); return { ok: r.b.x > 62.6 && near(r.b.foot, r.b.terr, 0.6), airborneSamples: air, maxFrameDrop: +maxDrop.toFixed(2), ...r }; });
await check('4.13 Apple plaza: west along z=-100 toward the green wall; what blocks?', async () => { await tp(50, -100, 261); await c.trackStart(); const r = await walk(261, 8); const t = await c.trackStop(); const bad = t.filter((s) => s.foot - s.floorStep < -0.3 || s.foot - s.floorStep > 1.0); const walls = await wallsNear(r.b.x - 0.5, r.b.z, 1.0); return { ok: bad.length === 0 && r.b.x < 32, bad: bad.slice(0, 3), wallsAtStop: walls, ...r }; });
await check('4.14 Apple plaza: west along z=-94 (terrace-step row)', async () => { await tp(52, -94, 261); const r = await walk(261, 9); return { ok: r.b.x < 32, ...r }; });
await c.finish('interiors');
