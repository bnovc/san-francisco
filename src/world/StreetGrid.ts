// Analytic street grid derived from OSM centrelines: each street is axis-aligned in the local frame.
import { P2 } from '../util/Geometry2D';

export interface StreetSpec {
  name: string; axis: 'ns' | 'ew'; c: number; // constant coordinate: x for ns, z for ew
  from: number; to: number;                    // extent along the other axis
  width: number;                               // curb-to-curb (m)
  sidewalk: number;                            // sidewalk width each side (m)
  lanes: number; oneway: null | 'N' | 'S' | 'E' | 'W';
  parking: { left: boolean; right: boolean };  // left = west/north side
  cableCar?: boolean; pedestrian?: boolean; transitLane?: 'min' | 'max' | 'center'; surface?: 'asphalt' | 'brick'; centerLine?: 'double_yellow' | 'none' | 'single_yellow';
}
export interface Intersection { a: StreetSpec; b: StreetSpec; x: number; z: number; signal: boolean }

export function streetLine(s: StreetSpec): [P2, P2] { return s.axis === 'ns' ? [[s.c, s.from], [s.c, s.to]] : [[s.from, s.c], [s.to, s.c]]; }

/** Compute all crossings between ns and ew streets whose extents overlap. */
export function intersections(streets: StreetSpec[]): Intersection[] {
  const out: Intersection[] = [];
  for (const a of streets) if (a.axis === 'ns') for (const b of streets) if (b.axis === 'ew') {
    if (b.c >= Math.min(a.from, a.to) - 1 && b.c <= Math.max(a.from, a.to) + 1 && a.c >= Math.min(b.from, b.to) - 1 && a.c <= Math.max(b.from, b.to) + 1) {
      // collinear specs of one street (e.g. Powell's three character segments) meet at the same point: keep the widest pair
      const dup = out.find((o) => Math.abs(o.x - a.c) < 0.5 && Math.abs(o.z - b.c) < 0.5);
      if (dup) { if (a.width > dup.a.width) dup.a = a; if (b.width > dup.b.width) dup.b = b; continue; }
      out.push({ a, b, x: a.c, z: b.c, signal: !(a.pedestrian || b.pedestrian) });
    }
  }
  return out;
}
