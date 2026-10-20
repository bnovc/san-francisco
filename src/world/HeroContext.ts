// Contract between the world and hero-building modules (Apple, Nintendo, Westin, ...).
import * as THREE from 'three';
import type { World } from './World';
import type { App } from '../app/App';

export interface Interactable {
  id: string; label: string; hint?: string;           // hint e.g. "Press E to inspect"
  position: THREE.Vector3; radius: number;            // activation radius (m)
  onActivate: () => void;                             // called when the player presses E while looking at it within radius
  object?: THREE.Object3D;                            // optional object to highlight
}
export interface StorefrontReg {
  id: string; name: string; category: string; address: string;
  position: THREE.Vector3;      // point on the sidewalk in front of the entrance
  facing: THREE.Vector3;        // outward normal of the storefront (toward the street)
  width: number;                // storefront width (m)
  enterable: boolean;           // true if the player can walk inside
  status: string;               // open | closed | vacant | unknown
  confidence: string;           // high | medium | low
  interiorTag?: string;         // collision tag used inside (for lighting/streaming)
}
export interface HeroContext {
  world: World; app: App; scene: THREE.Scene;
  group: THREE.Group;                                  // add all hero meshes here
  registerStorefront(s: StorefrontReg): void;
  registerInteractable(i: Interactable): void;
  addUpdatable(u: { update(dt: number, t: number): void }): void;
  nightFactor(): number;                               // 0 day .. 1 night (for interior lighting)
}
/** A hero module: ids of OSM buildings whose massing must be hidden (the module builds them itself). */
export interface HeroModule { id: string; excludeOsmIds: string[]; build(ctx: HeroContext): Promise<void> }
