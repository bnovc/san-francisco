// Copies runtime data from src/data/recon to public/data (trimming the big GIS file). Run before dev/build.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(new URL('.', import.meta.url).pathname, '..', '..');
const src = path.join(root, 'src/data/recon'), dst = path.join(root, 'public/data');
fs.mkdirSync(dst, { recursive: true });
const keepTags = new Set(['building', 'building:levels', 'height', 'name', 'addr:housenumber', 'addr:street', 'start_date', 'building:material', 'roof:shape', 'shop', 'amenity', 'tourism', 'brand', 'min_height', 'building:min_level', 'building:part']);
const gis = JSON.parse(fs.readFileSync(path.join(src, 'gis.json')));
for (const list of [gis.buildings, gis.buildingParts]) for (const b of list) {
  const t = {}; for (const k of Object.keys(b.tags || {})) if (keepTags.has(k)) t[k] = b.tags[k]; b.tags = t;
  delete b.centroidGeo;
  b.footprint = b.footprint.map(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100]);
}
for (const s of gis.streets) { delete s.tags; s.points = s.points.map(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100]); }
for (const p of gis.pois) { const t = {}; for (const k of ['shop', 'amenity', 'tourism', 'office', 'brand', 'addr:housenumber', 'addr:street', 'level']) if (p.tags?.[k]) t[k] = p.tags[k]; p.tags = t; }
fs.writeFileSync(path.join(dst, 'gis.json'), JSON.stringify(gis));
for (const f of ['elevation.json', 'viewpoints.json', 'storefronts.json', 'streets.json', 'plaza.json', 'apple.json', 'nintendo.json', 'west_powell.json', 'east_stockton.json', 'north_post.json', 'south_geary.json']) {
  const p = path.join(src, f); if (fs.existsSync(p)) fs.copyFileSync(p, path.join(dst, f));
}
// façade specs
const fdir = path.join(src, '..', 'facades'), fout = path.join(dst, 'facades'); fs.mkdirSync(fout, { recursive: true });
if (fs.existsSync(fdir)) for (const f of fs.readdirSync(fdir)) if (f.endsWith('.json')) { const txt = fs.readFileSync(path.join(fdir, f), 'utf8'); try { JSON.parse(txt); fs.writeFileSync(path.join(fout, f), txt); } catch (e) { console.error('INVALID JSON', f, e.message); } }
console.log('synced data ->', dst, 'gis', (fs.statSync(path.join(dst, 'gis.json')).size / 1024).toFixed(0) + 'KB');
