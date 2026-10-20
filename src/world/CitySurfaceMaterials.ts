import * as THREE from 'three';
import { Materials } from '../materials/Library';

// Reuse the existing procedural asphalt/concrete library with metre-based UVs.
// Clones own their render settings while sharing the cached source textures.
export function citySurfaceMaterial(name: 'asphalt' | 'concrete' | 'road_marking_white'): THREE.MeshStandardMaterial {
  const material = Materials.std(name).clone();
  material.side = THREE.DoubleSide;
  return material;
}

export function groundUvs(vertices: number[], originX = 0, originZ = 0): number[] {
  const uv: number[] = [];
  for (let i = 0; i < vertices.length; i += 3) uv.push(vertices[i] + originX, vertices[i + 2] + originZ);
  return uv;
}
