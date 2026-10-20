// QA-E: runtime agreement between the pedestrian signal (NavGraph.signalPhase) and the vehicle signal (TrafficLights.state) at every intersection over one cycle.
// Reload-tolerant: sampler re-installed and pulled every 5 s.
import { launch, opts } from './qae_lib.mjs';
const opt = opts();
const c = await launch({ out: opt('out', 'qa/shots/qae'), prefix: 'sync_', life: '1' });
const { check, T, page } = c;
const install = () => T(() => { if (window.__qaeSync) return false; const L = window.__twin.life; const nav = L.pedestrians.nav; window.__qaeSync = { n: 0, per: {} }; window.__qaeSyncT = setInterval(() => { const S = window.__qaeSync; S.n++; for (const it of nav.intersections) { if (!it.signal) continue; const st = L.lights.state(it.x, it.z); const ph = nav.signalPhase(it.id, L.pedestrians.time); const k = `${Math.round(it.x)},${Math.round(it.z)}`; const p = (S.per[k] ||= { n: 0, mismatch: 0, walkOnCrossGreen: 0 }); p.n++; if ((ph === 'ns' && st.ns !== 'green') || (ph === 'ew' && st.ew !== 'green')) p.mismatch++; if ((ph === 'ns' && st.ew === 'green') || (ph === 'ew' && st.ns === 'green')) p.walkOnCrossGreen++; } S.clockDelta = +(L.pedestrians.time - L.lights.time).toFixed(1); }, 500); return true; });
const acc = { n: 0, per: {}, clockDelta: null, reinstalls: 0 };
const pull = async () => { if (await install()) acc.reinstalls++; const S = await T(() => { const S = window.__qaeSync; const o = { n: S.n, per: S.per, clockDelta: S.clockDelta }; S.n = 0; S.per = {}; return o; }); acc.n += S.n; acc.clockDelta = S.clockDelta; for (const [k, p] of Object.entries(S.per)) { const a = (acc.per[k] ||= { n: 0, mismatch: 0, walkOnCrossGreen: 0 }); a.n += p.n; a.mismatch += p.mismatch; a.walkOnCrossGreen += p.walkOnCrossGreen; } };
const t0 = Date.now(); while (Date.now() - t0 < Number(opt('sec', 62)) * 1000) { await page.waitForTimeout(5000); await pull(); }
const rows = Object.entries(acc.per).map(([k, p]) => ({ at: k, mismatch: +(p.mismatch / p.n).toFixed(2), walkWhileCrossTrafficGreen: +(p.walkOnCrossGreen / p.n).toFixed(2) })).sort((a, b) => b.walkWhileCrossTrafficGreen - a.walkWhileCrossTrafficGreen);
await check('2.9b Ped/vehicle signal agreement per intersection over ' + Math.round(acc.n / 2) + ' s (walkWhileCrossTrafficGreen = pedestrians shown WALK while the conflicting vehicle phase is green)', async () => ({ ok: rows.every((r) => r.walkWhileCrossTrafficGreen < 0.05), clockDelta: acc.clockDelta, reinstalls: acc.reinstalls, rows }), { shot: false });
await c.finish('sync');
