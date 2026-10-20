// Runs the cinematic tour and screenshots each stop. Usage: node tools/qa/tour_test.mjs [--out=qa/shots/tour]
import { chromium } from 'playwright';
import fs from 'node:fs';
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const out = opt('out', 'qa/shots/tour'); fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await page.goto('http://localhost:5173/?qa=1&mode=tour&freeze=0', { waitUntil: 'load' });
await page.waitForFunction(() => window.__twin?.ready || window.__twinError, null, { timeout: 180000 });
for (let i = 0; i < 8; i++) {
  // wait until the tour reaches stop i (title element text changes) — poll the tour index via the title
  await page.waitForTimeout(i === 0 ? 5500 : 9500);
  const title = await page.evaluate(() => document.getElementById('tour-title')?.textContent || '');
  await page.screenshot({ path: `${out}/stop${i + 1}.png` });
  console.log('stop', i + 1, title.slice(0, 60));
}
await browser.close();
