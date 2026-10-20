// QA-E section 7: failure hunting — random sidewalk points x 4 directions, plaza corners, garage portal, subway headhouse, stage; stair descent tracking.
import { launch, opts } from './qae_lib.mjs';
const opt = opts();
const c = await launch({ out: opt('out', 'qa/shots/qae'), prefix: 'hunt_', life: opt('life', '0') });
const { check, tp, walk, look, T, page, probe } = c;

// deterministic "random" sidewalk points (LCG) drawn from the 8 sidewalk bands around the square + 2 blocks out
let seed = 20260901; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const bands = [
  { name: 'Powell W sidewalk', x: () => -79 + rnd() * 3, z: () => -140 + rnd() * 280 }, { name: 'Powell E sidewalk', x: () => -68 + rnd() * 3, z: () => -140 + rnd() * 280 },
  { name: 'Geary S sidewalk', x: () => -200 + rnd() * 400, z: () => 58.5 + rnd() * 3 }, { name: 'Geary N sidewalk', x: () => -200 + rnd() * 400, z: () => 43.5 + rnd() * 3 },
  { name: 'Post N sidewalk', x: () => -200 + rnd() * 400, z: () => -59 + rnd() * 3 }, { name: 'Post S sidewalk', x: () => -200 + rnd() * 400, z: () => -46 + rnd() * 3 },
  { name: 'Stockton W sidewalk', x: () => 64.5 + rnd() * 3, z: () => -140 + rnd() * 280 }, { name: 'Stockton E sidewalk', x: () => 81 + rnd() * 3, z: () => -140 + rnd() * 280 },
];
const pts = []; for (let i = 0; i < 15; i++) { const b = bands[i % bands.length]; pts.push({ name: b.name, x: +b.x().toFixed(1), z: +b.z().toFixed(1) }); }
const issues = [];
async function tryPoint(pt, label) {
  const out = { pt, dirs: {} };
  for (const [dn, h] of [['N', 351], ['E', 81], ['S', 171], ['W', 261]]) {
    await tp(pt.x, pt.z, h); await page.waitForTimeout(120);
    const start = await probe();
    if (start.push > 0.05) issues.push({ where: label, pt, issue: 'spawn embedded in wall', push: start.push });
    await c.trackStart(); const r = await walk(h, 10 / 2.4 + 0.2); const t = await c.trackStop();
    const sink = t.filter((s) => s.foot < s.terr - 0.5 && s.floorStep < s.terr - 0.5 && !(s.x > -105 && s.x < -83 && s.z > 27 && s.z < 42));
    const float = t.filter((s) => s.foot - s.floorStep > 1.0);
    const below = t.filter((s) => s.foot < s.floorStep - 0.3);
    out.dirs[dn] = { dist: r.dist, dy: r.dy, end: [r.b.x, r.b.z, r.b.foot], sink: sink.length, float: float.length, below: below.length, push: r.b.push };
    if (sink.length) issues.push({ where: label, pt, dir: dn, issue: 'foot below terrain (>0.5 m)', sample: sink[0] });
    if (float.length) issues.push({ where: label, pt, dir: dn, issue: 'airborne >1 m above walk floor', sample: float[0], n: float.length });
    if (below.length) issues.push({ where: label, pt, dir: dn, issue: 'foot below walk floor', sample: below[0] });
    if (r.b.push > 0.05) issues.push({ where: label, pt, dir: dn, issue: 'ends embedded in a wall (resolve push)', push: r.b.push, end: [r.b.x, r.b.z] });
    if (r.dist < 0.5) out.dirs[dn].blocked = true;
  }
  return out;
}
for (let i = 0; i < pts.length; i++) { const p = pts[i]; const r = await tryPoint(p, `7.${i + 1} ${p.name}`); await check(`7.${i + 1} ${p.name} (${p.x},${p.z}) walk 10 m N/E/S/W`, async () => ({ ok: !issues.some((x) => x.where.startsWith(`7.${i + 1} `)), ...r.dirs }), { shot: false }); }

// named hotspots
const hot = [
  ['plaza NW corner', -58, -37], ['plaza NE corner', 58, -37], ['plaza SW corner', -58, 37], ['plaza SE corner', 58, 37], ['plaza SE corner plaza (near SE stair)', 52, 28],
  ['garage portal W', -8, 42], ['garage portal mid', 2, 42], ['garage portal E', 12, 42], ['garage deck above portal', 2, 34],
  ['subway headhouse', 31, 35], ['stage', 0, -21], ['stage front', 0, -15], ['monument plinth', 0, 6], ['Apple rear plaza', 43, -98], ['Apple Stockton stair head', 57, -96],
];
for (const [name, x, z] of hot) { const p = { name, x, z }; const r = await tryPoint(p, `7h ${name}`); await check(`7h ${name} (${x},${z}) walk 10 m N/E/S/W`, async () => ({ ok: !issues.some((i) => i.where === `7h ${name}`), ...r.dirs })); }

// stair descents with tracking (float-over-stairs check)
const stairs = [
  ['east central stair down (x 54->64, z 0)', 50, 0, 81, 7], ['west stair down (x -56->-66, z 3)', -52, 3, 261, 6], ['NE stair down (z -34)', 50, -34, 81, 7], ['SE stair down from promenade (x 57, z 18->36)', 57, 18, 171, 8],
  ['Geary lawn stair down x=-19.3', -19.3, 20, 171, 11], ['SW corner stair down (x -41 -> -50)', -39, 31, 261, 6], ['central stair down (z 12->24)', 0, 12, 171, 6], ['Apple Stockton stair down', 55, -96.1, 81, 5], ['Nintendo stair down', -90, 34.45, 261, 5],
];
for (const [name, x, z, h, sec] of stairs) {
  await tp(x, z, h); await c.trackStart(); const r = await walk(h, sec); const t = await c.trackStop();
  const air = t.filter((s) => s.foot - s.floorStep > 0.8); const maxDrop = Math.max(...t.map((s, i) => i ? t[i - 1].foot - s.foot : 0));
  await check(`7s ${name}`, async () => ({ ok: air.length === 0 && maxDrop < 0.5, airborneSamples: air.length, maxFrameDrop: +maxDrop.toFixed(2), firstAir: air[0], ...r }));
}
// what blocks at (-22.5,59.5) [walk 1.2] and (-58.4,0.1) [walk 1.17]?
await check('7x collision walls within 1.2 m of (-22.5,59.5) and (-58.4,0.1)', async () => { const w = await T(() => { const C = window.__twin.world.collision; const near = (x, z) => C.walls.filter((w) => { const dx = w.bx - w.ax, dz = w.bz - w.az, l2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((x - w.ax) * dx + (z - w.az) * dz) / l2)); return Math.hypot(w.ax + dx * t - x, w.az + dz * t - z) < 1.2; }).map((w) => ({ a: [+w.ax.toFixed(1), +w.az.toFixed(1)], b: [+w.bx.toFixed(1), +w.bz.toFixed(1)], y: [+w.y0.toFixed(1), +w.y1.toFixed(1)], tag: w.tag })); return { geary: near(-22.5, 59.5).slice(0, 8), west: near(-58.4, 0.1).slice(0, 8) }; }); return { ok: true, ...w }; }, { shot: false });
await check('7y vegetation/props inside the west stair rect (x -60..-56, z -8..8) and east stairs', async () => { const v = await T(() => { const out = []; for (const n of ['vegetation', 'props']) { const g = window.__twin.app.scene.getObjectByName(n); if (!g) continue; g.traverse((o) => { if (o.isInstancedMesh) { const m = new THREE.Matrix4(); for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); const x = m.elements[12], z = m.elements[14]; if ((x > -61 && x < -55 && z > -9 && z < 9) || (x > 53 && x < 61.5 && ((z > -40 && z < -29) || (z > -11 && z < 11) || (z > 22 && z < 34)))) out.push({ grp: n, mesh: o.name, x: +x.toFixed(1), z: +z.toFixed(1) }); } } else if (o.isMesh && o.parent === g) { const x = o.position.x, z = o.position.z; if ((x > -61 && x < -55 && z > -9 && z < 9)) out.push({ grp: n, mesh: o.name, x: +x.toFixed(1), z: +z.toFixed(1) }); } }); } return out.slice(0, 12); }).catch((e) => [{ err: e.message }]); return { ok: true, v }; }, { shot: false });
await c.results.push({ label: 'issues', ok: issues.length === 0, info: JSON.stringify(issues).slice(0, 6000) });
console.log('ISSUES', JSON.stringify(issues, null, 0).slice(0, 3000));
await c.finish('hunt');
