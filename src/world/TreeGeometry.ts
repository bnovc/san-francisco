import * as THREE from 'three';

/** Generic feather palm, suitable for instancing. Dimensions remain inferred. */
export function featherPalmCrown(fronds = 40, segments = 10): THREE.BufferGeometry {
  const vertices: number[] = [], uvs: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, uv: number[]) => {
    vertices.push(...a.toArray(), ...b.toArray(), ...c.toArray()); uvs.push(...uv);
  };
  for (let i = 0; i < fronds; i++) {
    const layer = i % 3;
    const angle = i * 2.3999632297;
    const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const lateral = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
    const length = [1, .88, .66][layer] * (1 + .06 * Math.sin(i * 2.3));
    const point = (t: number) => radial.clone().multiplyScalar(.035 + length * t).add(new THREE.Vector3(0,
      .08 + [.45, .75, 1.1][layer] * Math.sin(t * Math.PI * .78) - [.85, .55, .12][layer] * t * t, 0));
    for (let k = 0; k < segments; k++) {
      const t0 = k / segments, t1 = (k + 1) / segments, a = point(t0), b = point(t1);
      // Use the upstream procedural feather mask on folded, curved cards.
      // Leaflet cutouts keep a soft silhouette without thousands of little
      // overlapping opaque triangles that read as torn polygons at distance.
      const width = (t: number) => .19 * Math.min(1, .2 + 3.5 * t) * Math.pow(Math.max(.025, 1 - t), .5);
      const row = (p: THREE.Vector3, t: number) => [-1, 0, 1].map((side) => p.clone().addScaledVector(lateral, side * width(t)).add(new THREE.Vector3(0, Math.abs(side) * width(t) * .35, 0)));
      const r0 = row(a, t0), r1 = row(b, t1);
      for (let j = 0; j < 2; j++) {
        tri(r0[j], r1[j], r1[j + 1], [t0, j / 2, t1, j / 2, t1, (j + 1) / 2]);
        tri(r0[j], r1[j + 1], r0[j + 1], [t0, j / 2, t1, (j + 1) / 2, t0, (j + 1) / 2]);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}
