// Structural audit for bundled tier-0 tiles. This does not certify source or visual accuracy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/data/city');
const fail = (message) => { throw new Error(`City base: ${message}`); };
const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
if (index.schemaVersion !== 2 || index.tileSizeM !== 420 || index.coordinateFrame !== 'union-square-local-v1') fail('index schema/frame mismatch');
if (!Array.isArray(index.tiles) || !index.tiles.length) fail('no tiles');
const demSize = fs.statSync(path.join(dir, index.dem.file)).size;
if (demSize !== index.dem.width * index.dem.height * 2) fail('DEM byte length mismatch');
const finitePoint = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const expected = { roadSegments: 0, buildings: 0, labels: 0, park: 0, water: 0 };
const seen = new Set();
for (const [ix, iz, filename, roads, buildings, areas, labels] of index.tiles) {
  if (!Number.isInteger(ix) || !Number.isInteger(iz) || seen.has(`${ix},${iz}`)) fail(`bad or duplicate tile ${ix},${iz}`);
  seen.add(`${ix},${iz}`);
  if ([-1, 0].includes(ix) && [-1, 0].includes(iz)) fail(`legacy core tile generated ${ix},${iz}`);
  if (filename !== `${ix}_${iz}.json`) fail(`unexpected tile filename ${filename}`);
  const tile = JSON.parse(fs.readFileSync(path.join(dir, filename), 'utf8'));
  if (tile.roads.length !== roads || tile.buildings.length !== buildings || tile.areas.length !== areas || (tile.labels?.length ?? 0) !== labels) fail(`index count mismatch ${filename}`);
  expected.roadSegments += roads;
  expected.buildings += buildings;
  expected.labels += labels;
  for (const road of tile.roads) {
    if (!/^way\/\d+$/.test(road[0]) || !(road[2] > 0) || !Array.isArray(road[3]) || road[3].length < 2 || !road[3].every(finitePoint)) fail(`invalid road in ${filename}`);
    for (const [x, z] of road[3]) if (x < ix * 420 - .11 || x > (ix + 1) * 420 + .11 || z < iz * 420 - .11 || z > (iz + 1) * 420 + .11) fail(`road outside ${filename}`);
  }
  for (const building of tile.buildings) {
    if (!/^way\/\d+$/.test(building[0]) || !Array.isArray(building[1]) || building[1].length < 3 || !building[1].every(finitePoint) || !(building[2] >= 2) || !building[3]) fail(`invalid building in ${filename}`);
  }
  for (const label of tile.labels ?? []) {
    if (!/^\w+\/\d+$/.test(label[0]) || typeof label[1] !== 'string' || !label[1].length ||
        !Number.isFinite(label[2]) || !Number.isFinite(label[3]) || !(label[4] >= 2) || !Number.isFinite(label[5]) ||
        ![0, 1].includes(label[6]) || ![-1, 1].includes(label[7])) fail(`invalid label in ${filename}`);
    if (label[2] < ix * 420 - 45 || label[2] > (ix + 1) * 420 + 45 || label[3] < iz * 420 - 45 || label[3] > (iz + 1) * 420 + 45) fail(`label outside ${filename}`);
  }
  for (const area of tile.areas) {
    if (!/^way\/\d+$/.test(area[0]) || !['park', 'water'].includes(area[1]) || area[2].length < 3 || !area[2].every(finitePoint)) fail(`invalid area in ${filename}`);
    expected[area[1]]++;
  }
}
for (const [key, count] of Object.entries(expected)) if (index.counts[key] !== count) fail(`${key} count mismatch: ${index.counts[key]} vs ${count}`);
console.log(`Validated ${index.tiles.length} city tiles, ${expected.roadSegments} road segments, ${expected.buildings} buildings, ${expected.labels} sourced labels, and DEM bytes. Geometry/visual fidelity still needs in-game QA.`);

const signalDir = path.resolve(dir, '../signals');
const signalIndex = JSON.parse(fs.readFileSync(path.join(signalDir, 'index.json'), 'utf8'));
if (signalIndex.schemaVersion !== 1 || signalIndex.tileSizeM !== index.tileSizeM || signalIndex.coordinateFrame !== index.coordinateFrame) fail('traffic signal index frame mismatch');
const signalIds = new Set();
let signalCount = 0;
for (const [ix, iz, filename, count] of signalIndex.tiles) {
  const key = `${ix},${iz}`;
  if (!seen.has(key) || filename !== `${key.replace(',', '_')}.json`) fail(`invalid traffic signal tile ${key}`);
  const signals = JSON.parse(fs.readFileSync(path.join(signalDir, filename), 'utf8'));
  if (signals.length !== count) fail(`traffic signal count mismatch ${filename}`);
  for (const [id, x, z, kind, ped, aps, rlcam] of signals) {
    if (!Number.isInteger(id) || signalIds.has(id) || !Number.isFinite(x) || !Number.isFinite(z) ||
        x < ix * 420 || x >= (ix + 1) * 420 || z < iz * 420 || z >= (iz + 1) * 420 ||
        ![0, 1].includes(kind) || ![0, 1].includes(ped) || ![0, 1].includes(aps) || ![0, 1].includes(rlcam)) {
      fail(`invalid traffic signal ${id} in ${filename}`);
    }
    signalIds.add(id);
  }
  signalCount += count;
}
if (signalCount !== signalIndex.counts.placed) fail(`traffic signal total mismatch ${signalCount}`);
console.log(`Validated ${signalIndex.tiles.length} traffic signal tiles and ${signalCount} signal locations. Exact mast layout and timing remain approximate.`);

const treeDir = path.resolve(dir, '../trees');
const treeIndex = JSON.parse(fs.readFileSync(path.join(treeDir, 'index.json'), 'utf8'));
if (treeIndex.schemaVersion !== 1 || treeIndex.tileSizeM !== index.tileSizeM || treeIndex.coordinateFrame !== index.coordinateFrame) fail('street tree index frame mismatch');
const treeTiles = new Set();
const treeIds = new Set();
let treeCount = 0;
for (const [ix, iz, filename, count] of treeIndex.tiles) {
  const key = `${ix},${iz}`;
  if (!seen.has(key) || treeTiles.has(key) || filename !== `${key.replace(',', '_')}.json`) fail(`invalid tree tile ${key}`);
  treeTiles.add(key);
  const trees = JSON.parse(fs.readFileSync(path.join(treeDir, filename), 'utf8'));
  if (trees.length !== count) fail(`tree count mismatch ${filename}`);
  for (const [id, x, z, kind, size] of trees) {
    if (!Number.isInteger(id) || treeIds.has(id) || !Number.isFinite(x) || !Number.isFinite(z) ||
        x < ix * 420 || x >= (ix + 1) * 420 || z < iz * 420 || z >= (iz + 1) * 420 ||
        ![0, 1, 2].includes(kind) || ![0, 1, 2, 3].includes(size)) fail(`invalid street tree ${id} in ${filename}`);
    treeIds.add(id);
  }
  treeCount += count;
}
if (treeCount !== treeIndex.counts.placed) fail(`street tree total mismatch ${treeCount}`);
console.log(`Validated ${treeTiles.size} street tree tiles and ${treeCount} unique DataSF tree IDs. Placement remains approximate.`);
