// Evaluate JS inside the running app: node tools/qa/eval.mjs "<expression using window.__twin / window.__app>" [--url=...]
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const expr = args.filter((a) => !a.startsWith('--')).join(' ');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
if (opt('console', '0') === '1') page.on('console', (m) => console.log('[console]', m.text().slice(0, 300)));
await page.goto(`${opt('url', 'http://localhost:5173')}/?qa=1&freeze=1&life=${opt('life', '0')}&time=${opt('time', 'day')}${opt('extra', '')}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__twin?.ready || window.__twinError, null, { timeout: 180000 });
const r = await page.evaluate(async (expr) => { try { const v = await (0, eval)(expr); return JSON.stringify(v, null, 1); } catch (e) { return 'EVAL ERROR ' + e.message; } }, expr);
console.log(r);
await browser.close();
