// QA-E section 1: walk-mode basics (sidewalks, walls, stairs, plaza floor, curbs, run speed).
import { launch, opts } from './qae_lib.mjs';
const opt = opts();
const c = await launch({ out: opt('out', 'qa/shots/qae'), prefix: 'walk_', life: opt('life', '1') });
const { check, tp, walk, probe, look, T } = c;
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// --- sidewalks ---
await tp(-79, 100, 351); await check('1.1 Powell west sidewalk: walk north 5 s (expect ~12 m, foot ~ terrain)', async () => { const r = await walk(351, 5); return { ok: r.dist > 9 && near(r.b.foot, r.b.terr, 0.5), ...r }; });
await tp(-30, 59.5, 81); await check('1.2 Geary south sidewalk: walk east 5 s', async () => { const r = await walk(81, 5); return { ok: r.dist > 9 && near(r.b.foot, r.b.terr, 0.5), ...r }; });
await tp(66.5, -20, 171); await check('1.3 Stockton west sidewalk: walk south 5 s', async () => { const r = await walk(171, 5); return { ok: r.dist > 9 && near(r.b.foot, r.b.terr, 0.5), ...r }; });

// --- building walls ---
await tp(-78, 0, 261); await check('1.4 Westin wall (x=-83.7) blocks walking west from Powell sidewalk', async () => { const r = await walk(261, 4); return { ok: r.b.x > -84.0 && r.dist < 6, ...r }; });
await tp(-78, -20, 261); await check('1.5 Westin wall at z=-20 blocks (second probe)', async () => { const r = await walk(261, 4); return { ok: r.b.x > -84.0 && r.dist < 6, ...r }; });
const macy = await T(() => window.__twin.buildingAt(-9, 61));
await tp(-9, 57, 171); await check(`1.6 Macy's Geary face blocks walking south (bld ${macy?.name}, baseY ${macy?.baseY?.toFixed?.(2)})`, async () => { const r = await walk(171, 4); return { ok: r.b.z < 62.5 && r.dist < 6, fp0: macy?.fp?.slice(0, 2), ...r }; });
await tp(24, -57, 351); await check('1.7 Apple stone wing (x 20.7..27.3) blocks walking north from Post sidewalk', async () => { const r = await walk(351, 4); return { ok: r.b.z > -63.6 && r.dist < 7, ...r }; });
await tp(40, -57, 351); await check('1.8 Apple glass wall beside the doors (x=40, doors 37.35..49.25) — walking north should pass through the door opening', async () => { const r = await walk(351, 4); return { ok: r.b.z < -63.5, ...r }; });
await tp(33, -57, 351); await check('1.9 Apple glass wall west of the doors (x=33) blocks', async () => { const r = await walk(351, 4); return { ok: r.b.z > -63.6 && r.dist < 7, ...r }; });

// --- stairs ---
await tp(-19.3, 46, 351); await check('1.10 Geary lawn stair (x=-19.3): up from Geary sidewalk to the promenade (-1.0)', async () => { const r = await walk(351, 9); return { ok: r.b.z < 23.4 && near(r.b.foot, -1.0, 0.25), ...r }; });
await check('1.11 Geary lawn stair: back down to Geary sidewalk', async () => { const r = await walk(171, 9); return { ok: r.b.z > 40 && near(r.b.foot, r.b.terr, 0.5), ...r }; });
await tp(-31.7, 46, 351); await check('1.12 Geary lawn stair (x=-31.7) up', async () => { const r = await walk(351, 9); return { ok: r.b.z < 23.4 && near(r.b.foot, -1.0, 0.25), ...r }; });
await tp(16.1, 46, 351); await check('1.13 Geary lawn stair (x=16.1) up', async () => { const r = await walk(351, 9); return { ok: r.b.z < 23.4 && near(r.b.foot, -1.0, 0.25), ...r }; });
await tp(-50, 31, 81); await check('1.14 SW corner stair (x -44..-41) from corner plaza up to promenade', async () => { const r = await walk(81, 5); return { ok: r.b.x > -41 && near(r.b.foot, -1.0, 0.25), ...r }; });
await tp(0, 22.5, 351); await check('1.15 Central stair (x -6..6, z 15..21) promenade -> central deck (0)', async () => { const r = await walk(351, 5); return { ok: r.b.z < 15 && near(r.b.foot, 0, 0.2), ...r }; });
await tp(-30, -5, 351); await check('1.16 North seat-steps (z -12..-9.6) central deck -> north terrace (+0.9)', async () => { const r = await walk(351, 5); return { ok: r.b.z < -12 && near(r.b.foot, 0.9, 0.2), ...r }; });
await tp(-66, 0, 81); await check('1.17 West stair (x -60..-56) Powell sidewalk -> central deck', async () => { const r = await walk(81, 5); return { ok: r.b.x > -56 && near(r.b.foot, 0, 0.2), ...r }; });
await tp(50, 0, 81); await check('1.18 East stair (x 54..60.5, z -10..10) down to Stockton sidewalk', async () => { const r = await walk(81, 6); return { ok: r.b.x > 61 && near(r.b.foot, r.b.terr, 0.5), ...r }; });
await check('1.19 East stair back up to the central deck', async () => { const r = await walk(261, 6); return { ok: r.b.x < 54 && near(r.b.foot, 0, 0.2), ...r }; });
await tp(50, -34, 81); await check('1.20 NE stair (z -39..-30) down to Post & Stockton', async () => { const r = await walk(81, 6); return { ok: r.b.x > 61 && near(r.b.foot, r.b.terr, 0.5), ...r }; });
await tp(50, 28, 81); await check('1.21 SE stair (z 23.4..33) down to Geary & Stockton', async () => { const r = await walk(81, 6); return { ok: r.b.x > 61 && near(r.b.foot, r.b.terr, 0.5), ...r }; });

// --- plaza floor continuity: lawnmower sweep, sampled every 60 ms ---
const anomalies = [];
for (const [z, h] of [[-35, 81], [-20, 261], [-5, 81], [10, 261], [20, 81], [30, 261]]) {
  await tp(h === 81 ? -58 : 58, z, h); await c.trackStart(); await walk(h, 17, true); const t = await c.trackStop();
  for (const s of t) { const d = s.foot - s.floorStep; if (d < -0.3 || d > 1.0 || (s.foot < s.terr - 0.5 && s.floorStep < s.terr - 0.5)) anomalies.push({ z, ...s, d: +d.toFixed(2) }); }
}
await check('1.22 Plaza sweep (6 rows, run): no foot below floor (-0.3) / above floor (+1.0) samples', async () => ({ ok: anomalies.length === 0, samples: anomalies.length, first: anomalies.slice(0, 6) }));

// --- curbs ---
await tp(-73, 20, 261); await check('1.23 Curb: from Powell roadway centre west onto the sidewalk (no block)', async () => { await c.trackStart(); const r = await walk(261, 4); const t = await c.trackStop(); const jump = Math.max(...t.map((s, i) => i ? Math.abs(s.foot - t[i - 1].foot) : 0)); return { ok: r.b.x < -77 && r.dist > 7, maxStep: +jump.toFixed(2), ...r }; });
await tp(-50, 52, 351); await check('1.24 Curb: Geary roadway north onto the SW corner plaza (no block)', async () => { const r = await walk(351, 5); return { ok: r.b.z < 41 && r.dist > 8, ...r }; });
await tp(0, 46, 351); await check('1.25 Garage portal headwall (x -11.5..15.5, z 39.5) blocks walking north from Geary sidewalk', async () => { const r = await walk(351, 4); return { ok: r.b.z > 39.2, ...r }; });
await tp(-73, -52, 81); await check('1.26 Powell & Post intersection: walk east across Powell', async () => { const r = await walk(81, 6); return { ok: r.dist > 10, ...r }; });

// --- speeds ---
await tp(-79, 110, 351); await check('1.27 Walk speed 3 s (expect ~7.2 m @2.4 m/s)', async () => { const r = await walk(351, 3); return { ok: near(r.dist, 7.2, 1.2), speed: +(r.dist / 3).toFixed(2), ...r }; });
await tp(-79, 110, 351); await check('1.28 Run speed 3 s (expect ~21 m @7.0 m/s)', async () => { const r = await walk(351, 3, true); return { ok: near(r.dist, 21, 3), speed: +(r.dist / 3).toFixed(2), ...r }; });
const fps = await T(() => window.__twin.stats().fps);
console.log('fps during test', fps);
await c.finish('walk');
