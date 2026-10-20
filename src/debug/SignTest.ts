// QA page: a wall of every brand logo in front of the camera. Driven by tools/qa/signtest.mjs.
import * as THREE from 'three';
import { makeLogoSign, makeTextSign, signMesh, fasciaSign, bladeSign, letterSign, awningSign, windowVinyl, logoAspect, LOGO_KEYS, type SignResult } from '../materials/Signage';
import { yawToCompass } from './Viewpoints';

export interface SignTestLayout {
  count: number; cols: number; rows: number; cellW: number; cellH: number; width: number; height: number;
  center: [number, number, number]; normal: [number, number, number]; heading: number; keys: string[];
  cells: { key: string; x: number; y: number; z: number; row: number; col: number }[];
}
interface AppLike { scene: THREE.Scene; camera: THREE.Camera }
let current: THREE.Group | null = null;

/** Build the logo wall `distance` m in front of the camera, facing it. Returns the layout (world positions per cell). */
export function runSignTest(app: AppLike, opts: { cols?: number; cellW?: number; cellH?: number; distance?: number; extras?: boolean; fill?: number } = {}): SignTestLayout {
  if (current) { app.scene.remove(current); current = null; }
  const cols = opts.cols ?? 6, cellW = opts.cellW ?? 4, cellH = opts.cellH ?? 2.4, distance = opts.distance ?? 30;
  const keys = [...LOGO_KEYS];
  const extras: { key: string; build: () => THREE.Object3D }[] = opts.extras === false ? [] : [
    { key: 'helper:letterSign', build: () => letterSign('RAISED LETTERS', { widthM: 3.8, heightM: 0.8, color: '#e8e4d8' }) },
    { key: 'helper:bladeSign', build: () => bladeSign(makeLogoSign('chancellor', 0.5, 1.8)) },
    { key: 'helper:awningSign', build: () => awningSign(makeTextSign({ text: 'Café Encore', widthM: 3.8, heightM: 0.6, font: 'script', color: '#fff', weight: 700 }), 0x7a1f1f) },
    { key: 'helper:windowVinyl', build: () => windowVinyl(makeTextSign({ text: 'OPEN 10–8', widthM: 2.4, heightM: 0.5, font: 'sans', color: '#ffffff', letterSpacing: 0.2, weight: 500, illuminated: true })) },
    { key: 'helper:fascia+night', build: () => fasciaSign(makeTextSign({ text: 'LIT FASCIA', widthM: 3.8, heightM: 0.9, font: 'condensed', color: '#fff2c0', bg: '#101012', letterSpacing: 0.2, illuminated: true })) },
  ];
  const total = keys.length + extras.length; const rows = Math.ceil(total / cols);
  const width = cols * cellW, height = rows * cellH;
  const g = new THREE.Group(); g.name = 'SignTest';
  // backing wall + ground line so transparent signs read
  const wall = new THREE.Mesh(new THREE.BoxGeometry(width + 1, height + 1, 0.2), new THREE.MeshStandardMaterial({ color: 0x8c8c90, roughness: 0.9 }));
  wall.position.set(0, height / 2, -0.15); g.add(wall);
  const cellAt = (i: number) => { const row = Math.floor(i / cols), col = i % cols; return { row, col, x: -width / 2 + (col + 0.5) * cellW, y: height - (row + 0.5) * cellH }; };
  const cellsLocal: { key: string; x: number; y: number; row: number; col: number }[] = [];
  const label = (text: string, x: number, y: number) => {
    const r = makeTextSign({ text, widthM: cellW - 0.2, heightM: 0.22, font: 'mono', color: '#ffffff', bg: null, weight: 500, padding: 0.1 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r.widthM, r.heightM), r.material); m.position.set(x, y, 0.01); g.add(m);
  };
  keys.forEach((key, i) => {
    const { row, col, x, y } = cellAt(i); const a = logoAspect(key);
    const maxH = cellH - 0.5; let w = cellW - 0.3, h = w / a; if (h > maxH) { h = maxH; w = h * a; }
    const res: SignResult = makeLogoSign(key, w, h);
    const mesh = signMesh(res, 0.04); mesh.position.set(x, y + 0.12, 0.02); g.add(mesh);
    label(`${key}${res.illuminated ? ' *' : ''}`, x, y - cellH / 2 + 0.16);
    cellsLocal.push({ key, x, y, row, col });
  });
  extras.forEach((e, j) => {
    const i = keys.length + j; const { row, col, x, y } = cellAt(i); const o = e.build(); o.position.set(x, y + 0.12, 0.03); g.add(o); label(e.key, x, y - cellH / 2 + 0.16); cellsLocal.push({ key: e.key, x, y, row, col });
  });
  // place in front of the camera, facing it, bottom on the camera's floor
  const cam = app.camera; const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const base = cam.position.clone().addScaledVector(fwd, distance); base.y = cam.position.y - 1.7;
  g.position.copy(base); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), fwd.clone().negate());
  // fill light from the viewer so the wall reads regardless of sun direction
  const light = new THREE.DirectionalLight(0xffffff, opts.fill ?? 1.6); light.position.copy(fwd.clone().negate().multiplyScalar(40)).add(new THREE.Vector3(0, 30, 0)); light.target.position.set(0, height / 2, 0); g.add(light); g.add(light.target);
  app.scene.add(g); current = g; g.updateMatrixWorld(true);
  const normal = fwd.clone().negate();
  const cells = cellsLocal.map((c) => { const p = new THREE.Vector3(c.x, c.y, 0).applyMatrix4(g.matrixWorld); return { key: c.key, x: p.x, y: p.y, z: p.z, row: c.row, col: c.col }; });
  const yaw = Math.atan2(-fwd.x, -fwd.z);
  return { count: total, cols, rows, cellW, cellH, width, height, center: [base.x, base.y + height / 2, base.z], normal: [normal.x, normal.y, normal.z], heading: yawToCompass(yaw), keys: cellsLocal.map((c) => c.key), cells };
}
/** Camera spec (for window.__twin.setCamera) that frames the whole wall, or one row up close. */
export function signTestCamera(l: SignTestLayout, row?: number, fov = 60): { x: number; y: number; z: number; heading: number; pitch: number; fov: number; targetY: number } {
  const n = new THREE.Vector3(...l.normal);
  if (row === undefined) {
    const d = Math.max(l.width * 0.9, l.height) / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2))) * 1.05;
    const p = new THREE.Vector3(...l.center).addScaledVector(n, d); return { x: p.x, y: l.center[1], z: p.z, heading: l.heading, pitch: 0, fov, targetY: l.center[1] };
  }
  const rc = l.cells.filter((c) => c.row === row); const cy = rc.reduce((a, c) => a + c.y, 0) / rc.length;
  const cx = l.center[0], cz = l.center[2];
  const d = (l.width / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)) * (16 / 9))) * 1.02;
  const p = new THREE.Vector3(cx, cy, cz).addScaledVector(n, d);
  return { x: p.x, y: cy, z: p.z, heading: l.heading, pitch: 0, fov, targetY: cy };
}
export function clearSignTest(app: AppLike) { if (current) { app.scene.remove(current); current = null; } }
