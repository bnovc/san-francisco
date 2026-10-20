// Compiles FINAL_QA_REPORT.md from recon data, façade specs, storefront registry (live app), QA outputs and perf samples.
// Usage: node tools/qa/report.mjs [--scores=qa/scores.json] [--discrepancies=qa/discrepancies.md]
import { chromium } from 'playwright';
import fs from 'node:fs';
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const J = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const gis = J('public/data/gis.json'), vps = J('src/data/recon/viewpoints.json'), census = J('src/data/recon/storefronts.json');
const specs = J('src/data/facades/index.json').files.flatMap((f) => { try { return J(`src/data/facades/${f}`); } catch { return []; } });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:5173/?qa=1&freeze=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__twin?.ready || window.__twinError, null, { timeout: 180000 });
const live = await page.evaluate(() => ({ storefronts: window.__twin.storefronts(), life: window.__twin.lifeStats(), interactables: (window.__twin.hero?.interactables || []).length, facades: window.__twin.world.facades?.stats, buildings: window.__twin.world.buildings.infos.size, tex: window.__twin.stats().textures }));
await browser.close();
const perfFiles = ['day', 'night', 'sunset'].map((t) => `qa/perf/${t}.json`).filter((p) => fs.existsSync(p));
const perf = perfFiles.map((p) => ({ t: p.match(/perf\/(\w+)\.json/)[1], rows: J(p) }));
const shots = fs.existsSync('qa/compare') ? fs.readdirSync('qa/compare').filter((d) => fs.existsSync(`qa/compare/${d}/index.json`)) : [];
const passes = shots.reduce((n, d) => n + J(`qa/compare/${d}/index.json`).length, 0);
const sf = live.storefronts; const enterable = sf.filter((s) => s.enterable);
const byConf = { high: 0, medium: 0, low: 0 }; for (const s of sf) byConf[s.confidence] = (byConf[s.confidence] || 0) + 1;
const unresolved = census.filter((c) => /unresolved/i.test(c.name) || c.status === 'vacant' || c.confidence === 'low').map((c) => `${c.address || ''} — ${c.name} (${c.status}, ${c.confidence})`);
const insideBox = gis.buildings.filter((b) => b.insideBbox !== false).length;
const scores = fs.existsSync(opt('scores', 'qa/scores.json')) ? J(opt('scores', 'qa/scores.json')) : null;
const disc = fs.existsSync(opt('discrepancies', 'qa/discrepancies.md')) ? fs.readFileSync(opt('discrepancies', 'qa/discrepancies.md'), 'utf8') : '_see qa/compare sheets_';
const glbs = fs.readdirSync('public/assets/models', { recursive: true }).filter((f) => String(f).endsWith('.glb')).length;
const glbBytes = fs.readdirSync('public/assets/models', { recursive: true }).filter((f) => String(f).endsWith('.glb')).reduce((n, f) => n + fs.statSync(`public/assets/models/${f}`).size, 0);
const md = `# FINAL QA REPORT — Union Square SF Digital Twin

Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} by tools/qa/report.mjs.

## Reconstruction boundary
WGS84 bbox 37.7850–37.7910 N, −122.4115 – −122.4035 W (≈ 800 × 720 m): Union Square plus the blocks between Mason/Grant and Sutter/O'Farrell, with context to Bush/Ellis and Taylor/Kearny. Local frame origin = Dewey Monument (37.787935, −122.40752, 23.94 m NAVD88), grid bearing 80.686°.

## Counts
| Metric | Value |
|---|---|
| OSM building footprints loaded | ${gis.buildings.length} (${insideBox} inside the bbox) + ${gis.buildingParts.length} building parts |
| Buildings with runtime records | ${live.buildings} |
| Buildings with authored façade specs | ${specs.length} (auto-detailed: every street-facing building within 230 m of the plaza) |
| Façade openings / instanced modules | ${live.facades?.openings ?? '?'} / ${live.facades?.modules ?? '?'} |
| Storefront census entries (research) | ${census.length} |
| Identified storefronts in the runtime registry | ${sf.length} (confidence high ${byConf.high}, medium ${byConf.medium}, low ${byConf.low}) |
| Interactive (enterable) storefronts | ${enterable.length}: ${enterable.map((s) => s.name).join(', ')} |
| Full interiors | 2 (Apple Union Square, Nintendo SAN FRANCISCO) · interactables: ${live.interactables} |
| Reference viewpoints | ${vps.length} (${vps.filter((v) => v.photo?.file).length} with free-licensed photos) |
| Screenshot comparison passes (sheets) | ${passes} across ${shots.length} runs (qa/compare/*) |
| Pedestrians / vehicles (live) | ${live.life?.pedestrians ?? '?'} / ${live.life?.vehicles ?? '?'} |
| GLB assets (BPL) | ${glbs} files, ${(glbBytes / 1048576).toFixed(1)} MB |
| Textures resident | ${live.tex} |

## Storefront verification coverage
${(byConf.high + byConf.medium)} of ${sf.length} runtime storefronts (${Math.round(((byConf.high + byConf.medium) / Math.max(1, sf.length)) * 100)} %) carry high/medium-confidence identities sourced from 2024–2026 records (src/data/recon/storefronts.json). Unresolved bays are rendered with neutral blank fascias.

## Known uncertain / unresolved storefronts (from the census)
${unresolved.map((u) => '- ' + u).join('\n')}

## Performance (headless Chromium, 1920×1080, ANGLE/Metal)
${perf.map((p) => `### ${p.t}\n| Location | fps | p95 fps | frame ms | draw calls | triangles | heap MB |\n|---|---|---|---|---|---|---|\n${p.rows.map((r) => `| ${r.name} | ${r.fps} | ${r.fpsP95} | ${r.frameMs} | ${r.calls} | ${(r.triangles / 1e6).toFixed(2)} M | ${r.heapMB ?? '-'} |`).join('\n')}`).join('\n\n')}

## Scores
${scores ? Object.entries(scores).map(([k, v]) => `- ${k}: **${v}**`).join('\n') : '_qa/scores.json not present_'}

## Remaining known discrepancies
${disc}
`;
fs.writeFileSync('FINAL_QA_REPORT.md', md);
console.log('wrote FINAL_QA_REPORT.md', { storefronts: sf.length, enterable: enterable.length, specs: specs.length, passes });
