// Print footprint edges of a building (by osmId, address or name substring) with the street each edge faces.
// Usage: node tools/geo/edges.mjs "Westin" | node tools/geo/edges.mjs way/12345 | node tools/geo/edges.mjs --near=-85,40
import fs from 'node:fs';
const gis = JSON.parse(fs.readFileSync('public/data/gis.json', 'utf8'));
const q = process.argv[2] || '';
const streets = { 'Powell Street': ['ns', -73.0], 'Stockton Street': ['ns', 73.5], 'Grant Avenue': ['ns', 219], 'Mason Street': ['ns', -220], 'Post Street': ['ew', -52], 'Geary Street': ['ew', 52], 'Sutter Street': ['ew', -157], "O'Farrell Street": ['ew', 157], 'Maiden Lane': ['ew', 0] };
function area(fp) { let a = 0; for (let i = 0; i < fp.length; i++) { const [x1, z1] = fp[i], [x2, z2] = fp[(i + 1) % fp.length]; a += x1 * z2 - x2 * z1; } return a / 2; }
function ccw(fp) { const f = fp.slice(); if (f.length > 1 && f[0][0] === f[f.length - 1][0] && f[0][1] === f[f.length - 1][1]) f.pop(); return area(f) < 0 ? f.reverse() : f; }
let list = gis.buildings;
if (q.startsWith('--near=')) { const [x, z] = q.slice(7).split(',').map(Number); list = list.filter((b) => Math.hypot(b.centroid[0] - x, b.centroid[1] - z) < 40); }
else if (q) list = list.filter((b) => b.osmId === q || (b.address || '').toLowerCase().includes(q.toLowerCase()) || (b.name || '').toLowerCase().includes(q.toLowerCase()));
for (const b of list.slice(0, 12)) {
  const fp = ccw(b.footprint);
  console.log(`\n${b.osmId}  ${b.name || ''}  ${b.address || ''}  height=${b.heightM} levels=${b.levels} centroid=${b.centroid.map((v) => v.toFixed(1))} area=${b.areaM2}`);
  for (let i = 0; i < fp.length; i++) {
    const a = fp[i], c = fp[(i + 1) % fp.length];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]); if (len < 0.3) continue;
    const t = [(c[0] - a[0]) / len, (c[1] - a[1]) / len], n = [t[1], -t[0]];
    const mid = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    const dir = Math.abs(n[0]) > Math.abs(n[1]) ? (n[0] > 0 ? 'faces EAST' : 'faces WEST') : (n[1] > 0 ? 'faces SOUTH' : 'faces NORTH');
    let street = '';
    for (const [name, [axis, cc]] of Object.entries(streets)) { const d = axis === 'ns' ? Math.abs(mid[0] + n[0] * 8 - cc) : Math.abs(mid[1] + n[1] * 8 - cc); if (d < 12 && ((axis === 'ns') === (Math.abs(n[0]) > Math.abs(n[1])))) street = name; }
    console.log(`  edge ${String(i).padStart(2)}  a=(${a[0].toFixed(1)},${a[1].toFixed(1)}) b=(${c[0].toFixed(1)},${c[1].toFixed(1)})  len=${len.toFixed(1).padStart(6)}  ${dir.padEnd(11)} ${street}`);
  }
}
if (!list.length) console.log('no match');
