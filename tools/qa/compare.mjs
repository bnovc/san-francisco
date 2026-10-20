// Build side-by-side + 50% overlay comparison sheets: reference photo vs rendered viewpoint.
// Usage: node tools/qa/compare.mjs [--shots=qa/shots/day] [--out=qa/compare/day] [ids...]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const shots = opt('shots', 'qa/shots/day'), out = opt('out', 'qa/compare/day');
const ids = args.filter((a) => !a.startsWith('--'));
const vps = JSON.parse(fs.readFileSync('src/data/recon/viewpoints.json', 'utf8'));
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1400 } });
const rows = [];
for (const v of vps) {
  if (ids.length && !ids.includes(v.id)) continue;
  const shot = path.resolve(shots, `${v.id}.png`);
  if (!fs.existsSync(shot)) continue;
  const ref = v.photo?.file ? path.resolve(v.photo.file) : null;
  const shotUrl = 'file://' + shot, refUrl = ref && fs.existsSync(ref) ? 'file://' + ref : null;
  const html = `<html><body style="margin:0;background:#111;color:#eee;font:14px sans-serif">
  <div style="padding:8px 12px">${v.id} · ${v.title} · heading ${v.camera.headingDeg}° pitch ${v.camera.pitchDeg}° fov ${v.camera.fovDegVertical}° · ${v.notes || ''}</div>
  <div style="display:flex;gap:4px;height:640px">
    <div style="flex:1;background:#000;display:flex;align-items:center;justify-content:center">${refUrl ? `<img src="${refUrl}" style="max-width:100%;max-height:100%">` : '<div>no reference photo</div>'}</div>
    <div style="flex:1;background:#000;display:flex;align-items:center;justify-content:center"><img src="${shotUrl}" style="max-width:100%;max-height:100%"></div>
  </div>
  <div style="position:relative;height:700px;background:#000;margin-top:4px;display:flex;align-items:center;justify-content:center">
    ${refUrl ? `<img src="${refUrl}" style="position:absolute;max-width:100%;max-height:100%">` : ''}
    <img src="${shotUrl}" style="position:absolute;max-width:100%;max-height:100%;opacity:${refUrl ? 0.5 : 1}">
    <div style="position:absolute;left:8px;top:8px;background:rgba(0,0,0,.6);padding:4px 8px">50% overlay</div>
  </div></body></html>`;
  const tmp = path.resolve(out, `_${v.id}.html`); fs.writeFileSync(tmp, html);
  await page.goto('file://' + tmp, { waitUntil: 'load' });
  await page.waitForTimeout(200);
  const file = path.join(out, `${v.id}.png`);
  await page.screenshot({ path: file });
  rows.push({ id: v.id, title: v.title, ref: !!refUrl, file }); fs.unlinkSync(tmp);
}
await browser.close();
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(rows, null, 1));
console.log('wrote', rows.length, 'comparison sheets ->', out);
