export type P2 = [number, number];

export function polygonArea(pts: P2[]): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}
export function ensureCCW(pts: P2[]): P2[] { return polygonArea(pts) < 0 ? [...pts].reverse() : pts; }
export function centroid(pts: P2[]): P2 {
  let x = 0, z = 0;
  for (const p of pts) { x += p[0]; z += p[1]; }
  return [x / pts.length, z / pts.length];
}
export function pointInPolygon(x: number, z: number, pts: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
export function offsetPolygon(pts: P2[], d: number): P2[] {
  // simple miter offset (d>0 grows a CCW polygon outward)
  const n = pts.length, out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const d1 = norm([p1[0] - p0[0], p1[1] - p0[1]]), d2 = norm([p2[0] - p1[0], p2[1] - p1[1]]);
    const n1: P2 = [d1[1], -d1[0]], n2: P2 = [d2[1], -d2[0]];
    const bis: P2 = [n1[0] + n2[0], n1[1] + n2[1]];
    const bl = Math.hypot(bis[0], bis[1]) || 1;
    const cosHalf = Math.max(0.3, (n1[0] * bis[0] + n1[1] * bis[1]) / bl);
    const len = d / cosHalf;
    out.push([p1[0] + (bis[0] / bl) * len, p1[1] + (bis[1] / bl) * len]);
  }
  return out;
}
export function norm(v: P2): P2 { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }
export function dist(a: P2, b: P2) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
export function lerp2(a: P2, b: P2, t: number): P2 { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
export function segClosest(px: number, pz: number, a: P2, b: P2): { x: number; z: number; t: number } {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - a[0]) * dx + (pz - a[1]) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return { x: a[0] + dx * t, z: a[1] + dz * t, t };
}
export function rectPoly(cx: number, cz: number, w: number, d: number, rotY = 0): P2[] {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const hw = w / 2, hd = d / 2;
  const corners: P2[] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  return corners.map(([x, z]) => [cx + x * c - z * s, cz + x * s + z * c]);
}
