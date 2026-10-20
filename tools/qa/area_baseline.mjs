// Repeatable P0 measurements for the planned 15th-and-Market area.
// Usage: node tools/qa/area_baseline.mjs [--url=http://127.0.0.1:5173] [--seconds=5] [--headed=1]
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (key, fallback) => {
  const value = args.find((arg) => arg.startsWith(`--${key}=`));
  return value ? value.slice(key.length + 3) : fallback;
};
const base = new URL(opt('url', 'http://127.0.0.1:5173'));
const seconds = Math.max(1, Number(opt('seconds', '5')) || 5);
const headed = opt('headed', '1') === '1';
const views = [
  { id: 'street', x: -2445, y: 14.56, z: 2044, heading: 35, pitch: 0, fov: 65 },
  { id: 'aerial', x: -2535, y: 214.23, z: 2145, heading: 351, pitch: -32, fov: 65 },
];
let priorResourceTotals = { files: 0, transfer: 0, encoded: 0 };

base.searchParams.set('qa', '1');
base.searchParams.set('debug', '1');
base.searchParams.set('freeze', '1');
base.searchParams.set('pos', '-2445,12.86,2044');
base.searchParams.set('look', '35,0');

const browser = await chromium.launch({
  headless: !headed,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  const requestFailures = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => requestFailures.push({ url: request.url(), error: request.failure()?.errorText }));
  await page.goto(base.toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__twin?.ready || window.__twinError, null, { timeout: 180000 });
  const startupError = await page.evaluate(() => window.__twinError || null);
  if (startupError) throw new Error(startupError);

  for (const view of views) {
    await page.evaluate((camera) => {
      window.__twin.setCamera(camera.x, camera.y, camera.z, camera.heading, camera.pitch, camera.fov);
    }, view);
    await page.waitForFunction(() => {
      const stats = window.__twin?.stats();
      return stats && stats.cityTiles >= 20 && stats.cityLoading === 0;
    }, null, { timeout: 90000 });
    await page.waitForTimeout(1500);

    const measurement = await page.evaluate(async (duration) => {
      const frames = [];
      let previous = performance.now();
      const end = previous + duration * 1000;
      while (performance.now() < end) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const now = performance.now();
        frames.push(now - previous);
        previous = now;
      }
      frames.sort((a, b) => a - b);
      const mean = frames.reduce((sum, value) => sum + value, 0) / frames.length;
      const p95 = frames[Math.min(frames.length - 1, Math.floor(frames.length * 0.95))];
      const resources = performance.getEntriesByType('resource').filter((entry) => /\/data\/(city|trees|signals)\//.test(entry.name));
      const stats = window.__twin.stats();
      const gl = window.__twin.app.renderer.getContext();
      return {
        frameMsMean: +mean.toFixed(2),
        frameMsP95: +p95.toFixed(2),
        fpsMean: +(1000 / mean).toFixed(1),
        fpsP95: +(1000 / p95).toFixed(1),
        drawCalls: stats.calls,
        triangles: stats.triangles,
        geometries: stats.geometries,
        textures: stats.textures,
        cityTiles: stats.cityTiles,
        cityLoading: stats.cityLoading,
        citySignalTiles: stats.citySignalTiles,
        citySignalHeads: stats.citySignalHeads,
        resourceFiles: resources.length,
        resourceTransferBytes: resources.reduce((sum, entry) => sum + entry.transferSize, 0),
        resourceEncodedBytes: resources.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
        heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
        renderer: gl.getParameter(gl.RENDERER),
      };
    }, seconds);
    const cumulativeResources = {
      files: measurement.resourceFiles,
      transferBytes: measurement.resourceTransferBytes,
      encodedBytes: measurement.resourceEncodedBytes,
    };
    measurement.resourceCumulative = cumulativeResources;
    measurement.resourceFiles -= priorResourceTotals.files;
    measurement.resourceTransferBytes -= priorResourceTotals.transfer;
    measurement.resourceEncodedBytes -= priorResourceTotals.encoded;
    priorResourceTotals = {
      files: cumulativeResources.files,
      transfer: cumulativeResources.transferBytes,
      encoded: cumulativeResources.encodedBytes,
    };
    view.measurement = measurement;
  }

  const browserInfo = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    devicePixelRatio,
    viewport: { width: innerWidth, height: innerHeight },
  }));
  console.log(JSON.stringify({ url: base.origin, secondsPerView: seconds, browser: browserInfo, pageErrors, requestFailures, views }, null, 2));
} finally {
  await browser.close();
}
