import * as THREE from 'three';
import { geoToLocal, GRID_NORTH_BEARING_DEG } from '../geo/geo';
import type { CollisionWorld } from '../player/Collision';
import { pointInPolygon } from '../util/Geometry2D';
import type { Buildings } from '../world/Buildings';

export interface Viewpoint { id: string; title: string; camera: { lat: number; lon: number; heightM: number; headingDeg: number; pitchDeg: number; fovDegVertical: number; absoluteY?: number }; photo?: { file: string | null; sourceUrl?: string; author?: string; license?: string } | null; notes?: string; confidence?: string; local?: { x: number; z: number } }

/** Convert compass heading (deg cw from true north) to local yaw for WalkControls (yaw=0 looks toward -z = grid north, positive yaw turns left/ccw). */
export function compassToYaw(headingDeg: number): number {
  const local = headingDeg - GRID_NORTH_BEARING_DEG; // cw from grid north
  return -THREE.MathUtils.degToRad(local);
}
export function yawToCompass(yaw: number): number {
  return ((-yaw * 180 / Math.PI + GRID_NORTH_BEARING_DEG) % 360 + 360) % 360;
}

export class Viewpoints {
  list: Viewpoint[] = [];
  async load(url: string) {
    try { const r = await fetch(url); if (r.ok) { const j = await r.json(); this.list = Array.isArray(j) ? j : j.viewpoints || []; } } catch (e) { console.warn('viewpoints load failed', e); }
    for (const v of this.list) { const l = geoToLocal(v.camera.lat, v.camera.lon); v.local = { x: l.x, z: l.z }; }
    return this.list;
  }
  get(id: string) { return this.list.find((v) => v.id === id); }
  /** Resolve camera placement (eye position + yaw/pitch/fov) for a viewpoint. */
  place(v: Viewpoint, world: CollisionWorld, buildings?: Buildings) {
    const { x, z } = v.local!;
    const ground = world.floorAt(x, z, world.terrain(x, z) + 0.5, 100);
    let y = v.camera.absoluteY !== undefined ? v.camera.absoluteY : ground + v.camera.heightM;
    // elevated viewpoints taken from a roof/terrace: lift the camera above the building it falls inside
    if (buildings && v.camera.heightM > 3) for (const b of buildings.infos.values()) { if (y < b.topY && y > b.baseY && pointInPolygon(x, z, b.footprint)) { y = Math.max(y, b.topY + 1.7); break; } }
    return { x, y, z, yaw: compassToYaw(v.camera.headingDeg), pitch: THREE.MathUtils.degToRad(v.camera.pitchDeg), fov: v.camera.fovDegVertical || 60, ground };
  }
}
