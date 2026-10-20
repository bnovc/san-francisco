import * as THREE from 'three';
import type { World } from './World';

/** A hand-built, lightweight interpretation of the three-portal Dragon Gate at Grant and Bush. */
export function buildDragonGate(world: World): THREE.Group {
  const poi = world.gis.pois.find((p) => p.name === 'Dragon Gate');
  const group = new THREE.Group();
  group.name = 'landmark:dragon-gate';
  if (!poi) return group;
  const x = poi.x as number, z = poi.z as number;
  const base = world.collision.floorAt(x, z, world.terrain.heightAt(x, z) + 0.5, 100);
  group.position.set(x, base, z);
  const stone = new THREE.MeshStandardMaterial({ color: 0xbcb6a7, roughness: 0.88 });
  const darkStone = new THREE.MeshStandardMaterial({ color: 0x8e8980, roughness: 0.88 });
  const green = new THREE.MeshStandardMaterial({ color: 0x247f68, roughness: 0.54, metalness: 0.03 });
  const jade = new THREE.MeshStandardMaterial({ color: 0x64aa8c, roughness: 0.55 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xbfa360, roughness: 0.45, metalness: 0.35 });
  const red = new THREE.MeshStandardMaterial({ color: 0x8d302b, roughness: 0.64 });
  const box = (w: number, h: number, d: number, px: number, py: number, pz: number, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(px, py, pz); mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh); return mesh;
  };
  // The broad middle portal carries Grant Avenue; the two smaller portals serve the sidewalks.
  for (const px of [-9.5, -5.3, 5.3, 9.5]) {
    const h = Math.abs(px) < 7 ? 6.2 : 5.1;
    box(0.92, h, 0.92, px, h / 2, 0, stone);
    box(1.35, 0.32, 1.35, px, 0.16, 0, darkStone);
    box(1.25, 0.34, 1.25, px, h - 0.17, 0, darkStone);
    // Distinct paired carved bands keep the posts legible at street distance.
    for (const yy of [0.75, 1.05, h - 0.88]) box(1.0, 0.12, 1.0, px, yy, 0, jade);
    const ground = world.collision.floorAt(x + px, z, base + 0.5, 100);
    world.collision.addBox(x + px, z, 1.1, 1.1, Math.min(base, ground) - 0.4, base + h, 0, 'dragon-gate');
  }
  box(11.4, 0.72, 1.1, 0, 5.85, 0, stone);
  for (const px of [-7.4, 7.4]) box(4.9, 0.54, 1.1, px, 4.73, 0, stone);
  for (const px of [-5.3, 5.3]) {
    box(0.56, 0.8, 1.3, px, 6.53, 0, red);
    box(0.56, 0.6, 1.3, px, 7.18, 0, gold);
  }
  const roof = (points: [number, number][], depth: number) => {
    const shape = new THREE.Shape();
    points.forEach(([px, py], i) => i ? shape.lineTo(px, py) : shape.moveTo(px, py));
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    geo.translate(0, 0, -depth / 2);
    const mesh = new THREE.Mesh(geo, green);
    mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  };
  roof([[-7.1, 7.74], [-6.3, 7.26], [-4.2, 7.12], [0, 8.18], [4.2, 7.12], [6.3, 7.26], [7.1, 7.74], [6.6, 6.85], [0, 7.72], [-6.6, 6.85]], 2.25);
  for (const cx of [-7.65, 7.65]) roof([[cx - 3, 6.35], [cx - 2.4, 5.9], [cx, 6.6], [cx + 2.4, 5.9], [cx + 3, 6.35], [cx + 2.55, 5.55], [cx, 6.12], [cx - 2.55, 5.55]], 1.75);
  // Roof ridges, finials, and hanging lanterns.
  for (const px of [-6.3, 0, 6.3, -10.3, -5, 5, 10.3]) {
    const yy = Math.abs(px) < 0.1 ? 8.22 : Math.abs(px) > 7 ? 6.35 : 7.36;
    const finial = new THREE.Mesh(new THREE.SphereGeometry(px === 0 ? 0.25 : 0.16, 10, 8), gold);
    finial.position.set(px, yy, 0); group.add(finial);
  }
  for (const px of [-7.65, 7.65]) {
    box(0.04, 0.4, 0.04, px, 4.2, 1.05, gold);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.31, 10, 8), red);
    lamp.position.set(px, 3.85, 1.05); group.add(lamp);
    box(0.35, 0.12, 0.35, px, 3.55, 1.05, gold);
  }
  // Bilingual plaque faces the approach from the south. Canvas is generated locally at runtime.
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#163b36'; ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = '#cfb66d'; ctx.lineWidth = 15; ctx.strokeRect(11, 11, 1002, 234);
  ctx.fillStyle = '#e7d49d'; ctx.font = 'bold 142px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('天下為公', 512, 132);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 1.08), new THREE.MeshStandardMaterial({ map: texture, side: THREE.DoubleSide, roughness: 0.65 }));
  plaque.position.set(0, 6.52, 0.59); group.add(plaque);
  return group;
}
