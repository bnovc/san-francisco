// QA-E section 2: street crossing — traffic-light cycle, vehicles at red, pedestrian signal sync, player crossing.
// Reload-tolerant: the in-page sampler is re-installed after a Vite HMR reload and partial results are merged node-side.
import { launch, opts } from './qae_lib.mjs';
const opt = opts();
const c = await launch({ out: opt('out', 'qa/shots/qae'), prefix: 'street_', life: '1' });
const { check, tp, walk, look, T, page, setCam } = c;
const SEC = Number(opt('sec', 75));

const install = () => T(() => {
  if (window.__qaeS) return false;
  const S = (window.__qaeS = { lights: [], veh: new Map(), redRuns: [], stops: 0, approachMoving: 0, pedWait: 0, pedWalkCross: 0, phaseMismatch: 0, phaseSamples: 0, phaseLog: [], minVehDist: 1e9, nearHits: 0, ticks: 0 });
  S.timer = setInterval(() => {
    const L = window.__twin?.life; if (!L || !L.lights || !L.traffic || !L.pedestrians) return; S.ticks++;
    const st = L.lights.state(-73, 52); S.lights.push({ t: +L.lights.time.toFixed(1), ns: st.ns, ew: st.ew, wNS: st.walkNS, wEW: st.walkEW });
    for (const v of L.traffic.vehicles) {
      if (!v.alive) continue; const K = v.link; const node = K.endNode; if (!node || !node.signal || !node.light) { S.veh.delete(v.id); continue; }
      const col = K.axis === 'ns' ? node.light.ns : node.light.ew; const dE = K.len - v.s - v.halfLen; const prev = S.veh.get(v.id);
      if (prev && prev.link === K && prev.dE > 0.3 && dE < -0.3 && col === 'red' && prev.col === 'red' && !v.committed && !prev.committed) S.redRuns.push({ id: v.id, kind: v.kind, street: K.name, dir: K.dir, node: [Math.round(node.x), Math.round(node.z)], t: +L.lights.time.toFixed(1), v: +v.v.toFixed(1) });
      if (col === 'red' && dE > 0 && dE < 6 && !v.committed) { if (v.v < 0.3) S.stops++; else S.approachMoving++; }
      S.veh.set(v.id, { link: K, dE, col, committed: v.committed });
    }
    const P = L.pedestrians, nav = P.nav; for (const p of P.peds) { if (p.state === 'wait') S.pedWait++; if (p.edge && p.edge.crossing && p.state === 'walk' && p.cleared) S.pedWalkCross++; }
    const it = nav.intersections.find((i) => Math.hypot(i.x + 73.1, i.z - 51.8) < 2);
    if (it) { const ph = nav.signalPhase(it.id, P.time); S.phaseSamples++; const bad = (ph === 'ns' && st.ns !== 'green') || (ph === 'ew' && st.ew !== 'green'); if (bad) S.phaseMismatch++; S.phaseLog.push([+P.time.toFixed(1), ph, st.ns, st.ew]); }
    const cp = window.__twin.pos(); for (const v of L.traffic.snapshot()) { const d = Math.hypot(v.x - cp.x, v.z - cp.z); if (d < S.minVehDist) S.minVehDist = d; if (d < 1.2) S.nearHits++; }
  }, 500);
  return true;
});
const acc = { lights: [], redRuns: [], stops: 0, approachMoving: 0, pedWait: 0, pedWalkCross: 0, phaseMismatch: 0, phaseSamples: 0, phaseLog: [], ticks: 0, reinstalls: 0 };
const pull = async () => { if (await install()) acc.reinstalls++; const S = await T(() => { const S = window.__qaeS; const o = { lights: S.lights, redRuns: S.redRuns, stops: S.stops, approachMoving: S.approachMoving, pedWait: S.pedWait, pedWalkCross: S.pedWalkCross, phaseMismatch: S.phaseMismatch, phaseSamples: S.phaseSamples, phaseLog: S.phaseLog, ticks: S.ticks, minVehDist: S.minVehDist, nearHits: S.nearHits }; S.lights = []; S.redRuns = []; S.stops = 0; S.approachMoving = 0; S.pedWait = 0; S.pedWalkCross = 0; S.phaseMismatch = 0; S.phaseSamples = 0; S.phaseLog = []; S.ticks = 0; S.minVehDist = 1e9; S.nearHits = 0; return o; }); for (const k of ['lights', 'redRuns', 'phaseLog']) acc[k].push(...S[k]); for (const k of ['stops', 'approachMoving', 'pedWait', 'pedWalkCross', 'phaseMismatch', 'phaseSamples', 'ticks']) acc[k] += S[k]; return S; };
const findStopped = () => { const L = window.__twin.life; const out = []; for (const v of L.traffic.vehicles) { if (!v.alive) continue; const K = v.link, node = K.endNode; if (!node || !node.signal || !node.light) continue; if (Math.hypot(node.x + 73.1, node.z - 51.8) > 3) continue; const col = K.axis === 'ns' ? node.light.ns : node.light.ew; const dE = K.len - v.s - v.halfLen; if (col === 'red' && dE > 0 && dE < 7 && v.v < 0.3) { const s = L.traffic.snapshot().find((q) => q.id === v.id); out.push({ ...s, dE: +dE.toFixed(1), col, node: [Math.round(node.x), Math.round(node.z)] }); } } return out; };
async function waitFor(pred, maxMs) { const t0 = Date.now(); while (Date.now() - t0 < maxMs) { if (await T(pred).catch(() => false)) return true; await page.waitForTimeout(400); } return false; }

await install();
await setCam(-64, -1.0, 44, 225, -8, 70);
await check('2.0 Signal heads bound to masts (lights.stats)', async () => { const s = await T(() => window.__twin.life.lights.stats()); return { ok: s.heads > 0 && s.signals > 0, ...s }; });

// --- observe a full cycle (pull every 5 s so a reload loses at most 5 s) ---
const t0 = Date.now();
while (Date.now() - t0 < SEC * 1000) { await page.waitForTimeout(5000); await pull(); }
const seq = []; for (const l of acc.lights) { const k = `${l.ns}/${l.ew}/${l.wNS ? 'W' : '-'}${l.wEW ? 'W' : '-'}`; if (!seq.length || seq[seq.length - 1].k !== k) seq.push({ k, t: l.t }); }
const bothGreen = acc.lights.filter((l) => l.ns === 'green' && l.ew === 'green').length;
await check(`2.7 Light cycle at Powell&Geary over ${Math.round(acc.ticks / 2)} s: NS/EW green-amber-red, all-red gaps, never both green`, async () => ({ ok: seq.length >= 6 && bothGreen === 0 && seq.some((s) => s.k.startsWith('amber')) && seq.some((s) => s.k.includes('/amber')), bothGreen, reinstalls: acc.reinstalls, transitions: seq.map((s) => `${s.t}:${s.k}`).join(' ') }), { shot: false });
await check('2.8 Vehicles stop at red: stopped-at-line samples vs moving-toward-red samples; red-light runners', async () => ({ ok: acc.stops > 0 && acc.redRuns.length === 0, stops: acc.stops, approachMoving: acc.approachMoving, redRuns: acc.redRuns.length, sample: acc.redRuns.slice(0, 6) }), { shot: false });
const mm = acc.phaseLog.filter((l) => (l[1] === 'ns' && l[2] !== 'green') || (l[1] === 'ew' && l[3] !== 'green'));
await check('2.9 Pedestrian walk phase (NavGraph) agrees with the vehicle signal (TrafficLights) at Powell&Geary', async () => ({ ok: acc.phaseSamples > 0 && acc.phaseMismatch / acc.phaseSamples < 0.1, mismatchFraction: +(acc.phaseMismatch / Math.max(1, acc.phaseSamples)).toFixed(2), samples: acc.phaseSamples, example: mm.slice(0, 5), pedWaitSamples: acc.pedWait, pedCrossingSamples: acc.pedWalkCross, phaseLogHead: acc.phaseLog.slice(0, 12) }), { shot: false });

// --- screenshots: stopped vehicles at red, waiting pedestrians ---
await waitFor(() => window.__twin.life.lights.state(-73, 52).ns === 'red', 40000);
await check('2.1 NS red at Powell&Geary: vehicle stopped at the line (screenshot)', async () => { const st = await T(() => window.__twin.life.lights.state(-73, 52)); const stopped = await T(findStopped); if (stopped[0]) { const s = stopped[0]; const side = s.dir === 'N' || s.dir === 'S'; await setCam(s.x + (side ? 7 : 0), 2.4, s.z + (side ? 0 : 7), side ? 261 : 351, -8, 70); await page.waitForTimeout(300); } return { ok: stopped.length > 0, state: st, stopped: stopped.slice(0, 4) }; });
await waitFor(() => { const s = window.__twin.life.lights.state(-73, 52); return s.ew === 'red' && s.ns === 'green'; }, 40000);
await check('2.2 EW red / NS green at Powell&Geary: Geary vehicle held at the line (screenshot)', async () => { const st = await T(() => window.__twin.life.lights.state(-73, 52)); const stopped = await T(findStopped); const g = stopped.find((s) => /Geary/.test(s.street)); if (g) { await setCam(g.x, 2.4, g.z + (g.dir === 'W' ? 0 : 0) + 7, 351, -8, 70); await page.waitForTimeout(300); } else await setCam(-64, -1.0, 44, 225, -8, 70); return { ok: !!g, state: st, stopped: stopped.slice(0, 4) }; });
await check('2.3 Pedestrians wait at the curb (ped in state wait near Powell&Geary)', async () => { const w = await T(() => { const P = window.__twin.life.pedestrians; return P.peds.filter((p) => p.state === 'wait' && Math.hypot(p.x + 73, p.z - 52) < 16).map((p) => ({ x: +p.x.toFixed(1), z: +p.z.toFixed(1), role: p.role })).slice(0, 6); }); if (w[0]) { await setCam(w[0].x + 4, 1.6, w[0].z + 4, 305, -8, 70); await page.waitForTimeout(300); } return { ok: w.length > 0, waiting: w }; });

// --- player crossing Powell at Geary on WALK, then on DON'T WALK; standing in the roadway ---
await tp(-64.5, 57.5, 261);
const gotWalk = await waitFor(() => window.__twin.life.lights.state(-73, 52).walkEW, 45000);
await install(); await pull();
await check('2.4 Player crosses Powell on WALK (EW walk phase): reaches the west sidewalk; vehicles through the player?', async () => { const r = await walk(261, 7); const s = await pull(); return { ok: gotWalk && r.b.x < -78, gotWalk, minVehDist: +s.minVehDist.toFixed(2), nearHits: s.nearHits, ...r }; });
await tp(-64.5, 57.5, 261);
await waitFor(() => { const s = window.__twin.life.lights.state(-73, 52); return s.ns === 'green' && !s.walkEW; }, 45000);
await install(); await pull();
await check('2.5 Player crosses Powell on DON\'T WALK (NS green): vehicles through the player? (informational)', async () => { const r = await walk(261, 7); const s = await pull(); return { ok: true, minVehDist: +s.minVehDist.toFixed(2), nearHits: s.nearHits, ...r }; });
await tp(-40, 55, 261); await install(); await pull();
await page.waitForTimeout(15000);
await check('2.6 Standing in the Geary roadway 15 s: vehicles drive through the player? (informational)', async () => { const s = await pull(); return { ok: true, minVehDist: +s.minVehDist.toFixed(2), nearHits: s.nearHits }; });
await c.finish('street');
