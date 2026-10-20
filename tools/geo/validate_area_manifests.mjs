// Read-only provenance/coverage check. Area manifests are not consumed by the runtime yet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultDir = path.join(root, 'data/areas');
const args = process.argv.slice(2);
const files = args.length
  ? args.map((arg) => path.resolve(process.cwd(), arg))
  : fs.readdirSync(defaultDir).filter((name) => name.endsWith('.json')).map((name) => path.join(defaultDir, name)).sort();
const errors = [];
const ids = new Set();

function fail(file, message) {
  errors.push(`${path.relative(root, file)}: ${message}`);
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function insideRoot(relative) {
  if (!nonempty(relative) || path.isAbsolute(relative)) return null;
  const resolved = path.resolve(root, relative);
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

for (const file of files) {
  let area;
  try {
    area = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(file, `cannot read JSON (${error.message})`);
    continue;
  }
  if (!area || typeof area !== 'object' || Array.isArray(area)) {
    fail(file, 'manifest must be a JSON object');
    continue;
  }
  if (area.schemaVersion !== 1) fail(file, 'schemaVersion must be 1');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(area.id ?? '')) fail(file, 'id must be kebab-case');
  else if (ids.has(area.id)) fail(file, `duplicate id ${area.id}`);
  else ids.add(area.id);
  if (!['planned', 'legacy', 'prototype', 'verified'].includes(area.status)) fail(file, 'invalid status');
  if (!['base', 'neighborhood', 'hero'].includes(area.fidelity)) fail(file, 'invalid fidelity');
  if (!nonempty(area.coordinateFrame)) fail(file, 'coordinateFrame is required');

  const bounds = area.bboxWgs84;
  if (!bounds || typeof bounds !== 'object' ||
      !Number.isFinite(bounds.south) || !Number.isFinite(bounds.north) ||
      !Number.isFinite(bounds.west) || !Number.isFinite(bounds.east) ||
      bounds.south < -90 || bounds.north > 90 || bounds.west < -180 || bounds.east > 180 ||
      bounds.south >= bounds.north || bounds.west >= bounds.east) {
    fail(file, 'bboxWgs84 needs ordered, finite WGS84 south/west/north/east values');
  }

  if (!Array.isArray(area.dataFiles)) fail(file, 'dataFiles must be an array');
  else {
    if (area.status !== 'planned' && area.dataFiles.length === 0) fail(file, 'non-planned area needs dataFiles');
    for (const relative of area.dataFiles) {
      const target = insideRoot(relative);
      if (!target) fail(file, `invalid or out-of-repo dataFiles path: ${String(relative)}`);
      else if (area.status !== 'planned' && !fs.existsSync(target)) fail(file, `missing dataFile: ${relative}`);
    }
  }

  if (!Array.isArray(area.sourceRefs)) fail(file, 'sourceRefs must be an array');
  else {
    if (area.status !== 'planned' && area.sourceRefs.length === 0) fail(file, 'non-planned area needs sourceRefs');
    const sourceIds = new Set();
    for (const source of area.sourceRefs) {
      if (!source || !nonempty(source.id) || !nonempty(source.role) || !nonempty(source.license) ||
          !nonempty(source.url) || !/^https?:\/\//.test(source.url)) {
        fail(file, 'each sourceRef needs id, role, licence, and an HTTP(S) URL');
        continue;
      }
      if (sourceIds.has(source.id)) fail(file, `duplicate sourceRef id ${source.id}`);
      sourceIds.add(source.id);
    }
  }
}

if (files.length === 0) errors.push('No area manifests found.');
if (errors.length) {
  for (const error of errors) console.error(`ERROR ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${files.length} area manifest(s). Metadata only; no runtime tile loading is implied.`);
}
