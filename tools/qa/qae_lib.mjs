// QA-E shared helpers: launch the app under Playwright, walk/teleport/probe, screenshots + JSON log.
import { chromium } from 'playwright';
import fs from 'node:fs';

export function opts() { const args = process.argv.slice(2); return (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; }; }

export async function launch({ out, prefix, time = 'day', life = '1', freeze = '0', extra = '', headed = false, w = 1600, h = 900 }) {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: !headed, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle'] });
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log('PAGE ERROR', e.message); });
  page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('console.error', m.text().slice(0, 200)); } });
  await page.goto(`http://localhost:5173/?qa=1&time=${time}&freeze=${freeze}&life=${life}&debug=1${extra}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__twin?.ready || window.__twinError, null, { timeout: 180000 });
  const err = await page.evaluate(() => window.__twinError); if (err) throw new Error('APP ERROR ' + err);
  const results = []; let n = 0;
  const ctx = {
    browser, page, results, errors, out,
    reloads: 0,
    T: async (fn, arg) => {
      for (let i = 0; ; i++) {
        try { const ok = await page.evaluate(() => !!window.__twin?.ready); if (!ok) throw new Error('app not ready (reload?)'); return await page.evaluate(fn, arg); }
        catch (e) { const transient = /destroyed|navigation|not ready|__twin/.test(String(e.message)); if (!transient || i >= 3) throw e; ctx.reloads++; console.log('!! page reload / context lost — waiting for the app:', String(e.message).slice(0, 70)); await page.waitForFunction(() => window.__twin?.ready, null, { timeout: 180000 }).catch(() => {}); await page.waitForTimeout(600); }
      }
    },
    async shot(label) { n++; const f = `${out}/${prefix}${String(n).padStart(2, '0')}_${label.replace(/\W+/g, '_').toLowerCase().slice(0, 60)}.png`; await page.screenshot({ path: f }); return f; },
    async check(label, fn, { shot = true } = {}) {
      let ok = false, info = ''; let r;
      try { r = await fn(); ok = !!(r && (r.ok ?? r)); info = typeof r === 'object' ? JSON.stringify(r) : String(r); } catch (e) { info = 'ERR ' + (e.stack || e.message); }
      const f = shot ? await ctx.shot(label) : null;
      results.push({ label, ok, info: info.slice(0, 1200), shot: f });
      console.log(ok ? 'PASS' : 'FAIL', label, info.slice(0, 260));
      return r;
    },
    tp: (x, z, h) => ctx.T(([x, z, h]) => window.__twin.teleport(x, z, h), [x, z, h]),
    look: (h, p) => ctx.T(([h, p]) => window.__twin.look(h, p), [h, p]),
    setCam: (x, y, z, h, p, fov) => ctx.T((a) => window.__twin.setCamera(...a), [x, y, z, h, p, fov]),
    pos: () => ctx.T(() => window.__twin.pos()),
    /** probe: eye pos, foot height, terrain, walk-floor, highest floor, wall embedding (resolve displacement). */
    probe: () => ctx.T(() => {
      const p = window.__twin.pos(); const w = window.__twin.world; const foot = p.y - 1.7;
      const terr = w.terrain.heightAt(p.x, p.z); const floorStep = w.collision.floorAt(p.x, p.z, foot, 0.6); const floorHi = w.collision.floorAt(p.x, p.z, foot, 100);
      const q = { x: p.x, y: foot, z: p.z }; w.collision.resolve(q, 0.35, 1.7); const push = Math.hypot(q.x - p.x, q.z - p.z);
      return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), foot: +foot.toFixed(2), terr: +terr.toFixed(2), floorStep: +floorStep.toFixed(2), floorHi: +floorHi.toFixed(2), push: +push.toFixed(3), heading: Math.round(p.heading) };
    }),
    /** Face compass heading and hold W for `sec` seconds (Shift held if run). Returns start/end probes + distance. */
    async walk(heading, sec, run = false) {
      await ctx.look(heading, 0);
      const a = await ctx.probe();
      if (run) await page.keyboard.down('Shift');
      await ctx.T(([s]) => window.__twin.move(0, -1, s), [sec]);
      if (run) await page.keyboard.up('Shift');
      await page.waitForTimeout(250);
      const b = await ctx.probe();
      return { a, b, dist: +Math.hypot(b.x - a.x, b.z - a.z).toFixed(2), dy: +(b.foot - a.foot).toFixed(2) };
    },
    /** Sample the player's foot vs floor/terrain every 60 ms while walking (for sink/float detection). */
    trackStart: () => ctx.T(() => { window.__qaeTrack = []; window.__qaeTimer = setInterval(() => { const p = window.__twin.pos(); const w = window.__twin.world; const foot = p.y - 1.7; window.__qaeTrack.push({ x: +p.x.toFixed(2), z: +p.z.toFixed(2), foot: +foot.toFixed(2), terr: +w.terrain.heightAt(p.x, p.z).toFixed(2), floorStep: +w.collision.floorAt(p.x, p.z, foot, 0.6).toFixed(2) }); }, 60); }),
    trackStop: () => ctx.T(() => { clearInterval(window.__qaeTimer); const t = window.__qaeTrack || []; window.__qaeTrack = []; return t; }),
    prompt: () => ctx.T(() => { const p = document.getElementById('prompt'); const t = document.getElementById('toast'); return { prompt: p.style.display !== 'none' ? p.innerText.replace(/\n/g, ' | ') : '', toast: t.style.display !== 'none' ? t.textContent : '', hud: (document.getElementById('hud')?.innerText || '').split('\n').filter((l) => /look:|souvenir|E |mode/i.test(l)).join(' | ') }; }),
    async finish(name) { fs.writeFileSync(`${out}/${prefix}results.json`, JSON.stringify({ name, errors, results }, null, 1)); console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed -> ${out}/${prefix}results.json (page errors: ${errors.length})`); await browser.close(); },
  };
  return ctx;
}
