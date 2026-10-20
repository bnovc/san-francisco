// Original parametric three-lantern streetlight. It evokes the documented
// Market Street lamp family; ornament and placement are approximate.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const metal = new THREE.MeshStandardMaterial({ color: 0x26302e, roughness: .7, metalness: .55 });
const lens = new THREE.MeshStandardMaterial({ color: 0xc8b78d, roughness: .3, metalness: .1, emissive: 0x8a602b, emissiveIntensity: .15 });
let shapes: [THREE.BufferGeometry, THREE.BufferGeometry] | undefined;

function lampShapes(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  if (shapes) return shapes;
  const iron: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [];
  const cylinder = (rt: number, rb: number, h: number, x: number, y: number, z: number) => iron.push(new THREE.CylinderGeometry(rt, rb, h, 8).translate(x, y, z));
  cylinder(.32, .42, .16, 0, .08, 0);
  cylinder(.23, .32, .75, 0, .53, 0);
  cylinder(.14, .23, 1.1, 0, 1.45, 0);
  cylinder(.075, .14, 6.6, 0, 5.3, 0);
  for (const [y, r] of [[.9, .25], [1.95, .17], [2.15, .16], [8.25, .15], [8.6, .18]] as [number, number][]) cylinder(r, r, .09, 0, y, 0);
  // The side branches curve upward into the lantern bases.
  for (const side of [-1, 1]) {
    const points = [new THREE.Vector3(0, 8.35, 0), new THREE.Vector3(side * .55, 8.18, 0), new THREE.Vector3(side * 1.15, 8.5, 0), new THREE.Vector3(side * 1.15, 8.8, 0)];
    iron.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 10, .065, 6, false));
  }
  for (const [x, y] of [[0, 9.35], [-1.15, 8.95], [1.15, 8.95]]) {
    cylinder(.19, .12, .18, x, y, 0);
    const points = [new THREE.Vector2(.10, 0), new THREE.Vector2(.23, .16), new THREE.Vector2(.27, .42), new THREE.Vector2(.22, .68), new THREE.Vector2(.12, .8)];
    glass.push(new THREE.LatheGeometry(points, 10).translate(x, y + .08, 0));
    cylinder(.12, .28, .15, x, y + .96, 0);
    cylinder(0, .105, .24, x, y + 1.15, 0);
    for (let k = 0; k < 4; k++) {
      const angle = k / 4 * Math.PI * 2;
      cylinder(.014, .014, .76, x + Math.cos(angle) * .225, y + .51, Math.sin(angle) * .225);
    }
  }
  shapes = [mergeGeometries(iron)!, mergeGeometries(glass)!];
  for (const geometry of [...iron, ...glass]) geometry.dispose();
  return shapes;
}

export interface LampSpot { x: number; z: number; angle: number; sourceId: string }

export function addAreaLamps(group: THREE.Group, spots: LampSpot[], heightAt: (x: number, z: number) => number) {
  if (!spots.length) return;
  const dummy = new THREE.Object3D();
  const [poleShape, glassShape] = lampShapes();
  for (const [geometry, material, name] of [[poleShape, metal, 'market-lamps-metal'], [glassShape, lens, 'market-lamps-glass']] as [THREE.BufferGeometry, THREE.Material, string][]) {
    const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
    mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.sharedGeometry = true;
    mesh.userData.inspectionInstances = spots.map((spot) => ({ title: 'Market Street lamp · approximate', kind: 'Street furniture', id: spot.sourceId,
      source: 'Original procedural three-lantern model. Placement inferred along an OSM sidewalk; not a surveyed lamp location.',
      sourceUrl: 'https://www.sfpuc.gov/about-us/news/iconic-path-gold-streetlights-get-brilliant-update' }));
    spots.forEach((spot, i) => {
      dummy.position.set(spot.x - group.position.x, heightAt(spot.x, spot.z) + .13, spot.z - group.position.z);
      dummy.rotation.y = spot.angle; dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); group.add(mesh);
  }
}
