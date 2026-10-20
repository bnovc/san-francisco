// Directed lane graph for vehicle traffic, derived from the analytic street grid (World.streetSpecs + Streets.crossings).
// Every lane becomes a chain of terrain-draped polylines: block links (stop bar to stop bar) joined by short connectors
// through each intersection (straight, lane shift or right turn). Vehicle classes are bitmasks so a link can be
// restricted (transit lanes, cable-car tracks, Powell south of Geary = taxi/commercial only).
import type { World } from '../world/World';
import type { StreetSpec } from '../world/StreetGrid';
import { Streets } from '../world/Streets';

export const CLS = { CAR: 1, TAXI: 2, VAN: 4, BUS: 8, CABLE: 16, BIKE: 32, TOUR: 64 } as const;
export const GENERAL = CLS.CAR | CLS.TAXI | CLS.VAN | CLS.TOUR;
export type Dir = 'N' | 'S' | 'E' | 'W';
export type Axis = 'ns' | 'ew';

export interface LightState { ns: 'green' | 'amber' | 'red'; ew: 'green' | 'amber' | 'red'; walkNS: boolean; walkEW: boolean; t: number }
export interface Node {
  id: number; x: number; z: number; signal: boolean; hwNS: number; hwEW: number;
  ns: StreetSpec[]; ew: StreetSpec[];
  occ: [number, number];                 // vehicles currently inside the box, per axis (0 = ns, 1 = ew)
  light: LightState | null;              // attached by Traffic from TrafficLights
}
export interface Lane {
  spec: StreetSpec; index: number; c: number; dir: Dir; sign: 1 | -1; axis: Axis; allow: number;
  kind: 'car' | 'transit' | 'cable' | 'shared' | 'bike';
  inAt: Map<Node, Link>; outAt: Map<Node, Link>; links: Link[];
}
export interface NextRef { link: Link; allow: number; turn: boolean }
export interface Link {
  id: number; lane: Lane | null; name: string; axis: Axis; dir: Dir;
  pts: Float32Array; cum: Float32Array; len: number;
  allow: number; vmax: number;
  next: NextRef[]; preds: Link[];
  startNode: Node | null; endNode: Node | null;   // block links: the crossings at either end (endNode = stop bar)
  node: Node | null; turn: boolean;                // connectors: the crossing they pass through
  entry: boolean;                                  // starts at the modelled street end (spawn point)
  a0: number; a1: number;                          // along-axis coordinate at start/end (block links)
  vehicles: any[];                                 // runtime: sorted front-most first (by s desc)
}

const SPEED = 11.2, TURN_SPEED = 5.5, SHIFT_SPEED = 8;
const EDGE_X = 3.6, EDGE_E = 4.1;                  // distance beyond curb line of the far crosswalk edge / the stop bar

export function rightOf(d: Dir): Dir { return d === 'N' ? 'E' : d === 'E' ? 'S' : d === 'S' ? 'W' : 'N'; }
export function dirSign(d: Dir): 1 | -1 { return d === 'S' || d === 'E' ? 1 : -1; }
export function dirAxis(d: Dir): Axis { return d === 'N' || d === 'S' ? 'ns' : 'ew'; }
/** Sign of the across-coordinate that is on the driver's right for direction d (right-hand traffic). */
export function rightSign(d: Dir): 1 | -1 { return d === 'N' || d === 'E' ? 1 : -1; }

export class LaneGraph {
  nodes: Node[] = [];
  lanes: Lane[] = [];
  links: Link[] = [];
  private nodeKey = new Map<string, Node>();
  constructor(public world: World) {
    this.buildNodes();
    this.buildLanes();
    for (const lane of this.lanes) this.buildBlockLinks(lane);
    for (const n of this.nodes) this.buildConnectors(n);
    for (const l of this.links) for (const nx of l.next) nx.link.preds.push(l);
  }
  private h(x: number, z: number) { return this.world.terrain.heightAt(x, z) + Streets.ROAD_Y; }
  nodeAt(x: number, z: number): Node | null { return this.nodeKey.get(`${Math.round(x)},${Math.round(z)}`) ?? null; }
  nearestNode(x: number, z: number): Node | null { let best: Node | null = null, bd = 1e9; for (const n of this.nodes) { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n; } } return best; }

  private buildNodes() {
    for (const c of this.world.streets.crossings) {
      const key = `${Math.round(c.x)},${Math.round(c.z)}`;
      let n = this.nodeKey.get(key);
      if (!n) { n = { id: this.nodes.length, x: c.x, z: c.z, signal: false, hwNS: 0, hwEW: 0, ns: [], ew: [], occ: [0, 0], light: null }; this.nodeKey.set(key, n); this.nodes.push(n); }
      if (c.signal) n.signal = true;
      if (!n.ns.includes(c.a)) n.ns.push(c.a);
      if (!n.ew.includes(c.b)) n.ew.push(c.b);
      n.hwNS = Math.max(n.hwNS, c.a.width / 2); n.hwEW = Math.max(n.hwEW, c.b.width / 2);
    }
  }
  private buildLanes() {
    for (const s of this.world.streetSpecs) {
      if (s.pedestrian) continue;
      const hw = s.width / 2, park = (s.parking.left ? 1 : 0) + (s.parking.right ? 1 : 0);
      const laneW = (s.width - park * 2.4) / Math.max(1, s.lanes), leftEdge = s.c - hw + (s.parking.left ? 2.4 : 0);
      const powellSouth = s.name === 'Powell Street' && Math.min(s.from, s.to) > 40;  // Market–Geary block: transit/taxi/commercial only
      const mk = (index: number, c: number, dir: Dir, allow: number, kind: Lane['kind']) => {
        this.lanes.push({ spec: s, index, c, dir, sign: dirSign(dir), axis: s.axis, allow, kind, inAt: new Map(), outAt: new Map(), links: [] });
      };
      for (let l = 0; l < s.lanes; l++) {
        let c = leftEdge + (l + 0.5) * laneW;
        let dir: Dir;
        if (s.oneway) dir = s.oneway; else dir = s.axis === 'ns' ? (c < s.c ? 'S' : 'N') : (c < s.c ? 'W' : 'E');
        if (s.transitLane === 'center' && s.cableCar && Math.abs(c - s.c) < 3.3) {
          c = s.c + (c < s.c ? -1.75 : 1.75);   // on the rails
          mk(l, c, dir, powellSouth ? CLS.CABLE | CLS.TAXI | CLS.VAN : CLS.CABLE, powellSouth ? 'shared' : 'cable');
        } else if ((s.transitLane === 'min' && l === 0) || (s.transitLane === 'max' && l === s.lanes - 1)) mk(l, c, dir, CLS.BUS, 'transit');
        else mk(l, c, dir, GENERAL | CLS.BUS, 'car');   // buses may use general lanes (2 Clement on Post has no red lane)
      }
      // bicycles ride the (empty) parking strip on the right-hand curb of one-way streets that have one
      if (s.oneway) {
        const rs = rightSign(s.oneway);
        const hasPark = rs < 0 ? s.parking.left : s.parking.right;
        if (hasPark) mk(-1, s.c + rs * (hw - 1.2), s.oneway, CLS.BIKE, 'bike');
      }
    }
  }
  private makeLink(pts: number[], o: Partial<Link> & { axis: Axis; dir: Dir; allow: number; vmax: number; name: string }): Link {
    const cum = new Float32Array(pts.length / 3); let len = 0;
    for (let i = 1; i < cum.length; i++) { len += Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2], pts[i * 3 + 2] - pts[i * 3 - 1]); cum[i] = len; }
    const l: Link = { id: this.links.length, lane: null, pts: new Float32Array(pts), cum, len, next: [], preds: [], startNode: null, endNode: null, node: null, turn: false, entry: false, a0: 0, a1: 0, vehicles: [], ...o };
    this.links.push(l); return l;
  }
  private straight(axis: Axis, c: number, a: number, b: number): number[] {
    const n = Math.max(1, Math.ceil(Math.abs(b - a) / 4)), pts: number[] = [];
    for (let i = 0; i <= n; i++) { const t = a + ((b - a) * i) / n; const x = axis === 'ns' ? c : t, z = axis === 'ns' ? t : c; pts.push(x, this.h(x, z), z); }
    return pts;
  }
  private bezier(p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number], n = 16): number[] {
    const pts: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
      const z = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
      pts.push(x, this.h(x, z), z);
    }
    return pts;
  }
  private buildBlockLinks(lane: Lane) {
    const s = lane.spec, lo = Math.min(s.from, s.to), hi = Math.max(s.from, s.to);
    const onStreet = this.nodes.filter((n) => (s.axis === 'ns' ? n.ns.includes(s) : n.ew.includes(s))).map((n) => ({ t: s.axis === 'ns' ? n.z : n.x, n })).sort((a, b) => a.t - b.t);
    const bounds: { t: number; n: Node | null }[] = [];
    if (!onStreet.length || onStreet[0].t > lo + 1) bounds.push({ t: lo, n: null });
    for (const o of onStreet) bounds.push(o);
    if (!onStreet.length || onStreet[onStreet.length - 1].t < hi - 1) bounds.push({ t: hi, n: null });
    const hwOther = (n: Node) => (s.axis === 'ns' ? n.hwEW : n.hwNS);
    const sg = lane.sign;
    for (let k = 0; k < bounds.length - 1; k++) {
      const i = sg > 0 ? k : bounds.length - 2 - k;                                             // walk the bounds in travel order
      const b0 = sg > 0 ? bounds[i] : bounds[i + 1], b1 = sg > 0 ? bounds[i + 1] : bounds[i];   // b0 = upstream bound, b1 = downstream
      const a = b0.n ? b0.t + sg * (hwOther(b0.n) + EDGE_X) : b0.t;
      const b = b1.n ? b1.t - sg * (hwOther(b1.n) + EDGE_E) : b1.t;
      if ((b - a) * sg < 2) continue;
      const vmax = lane.kind === 'bike' ? 5 : lane.kind === 'cable' || lane.kind === 'shared' ? 6 : SPEED;
      const link = this.makeLink(this.straight(s.axis, lane.c, a, b), { lane, name: s.name, axis: s.axis, dir: lane.dir, allow: lane.allow, vmax, startNode: b0.n, endNode: b1.n, entry: !b0.n, a0: a, a1: b });
      lane.links.push(link);
      if (b0.n) lane.outAt.set(b0.n, link);
      if (b1.n) lane.inAt.set(b1.n, link);
    }
  }
  private endPoint(link: Link, atEnd: boolean): [number, number] { const p = link.pts, i = atEnd ? p.length - 3 : 0; return [p[i], p[i + 2]]; }
  private buildConnectors(n: Node) {
    const incoming = this.lanes.filter((l) => l.inAt.has(n));
    for (const L of incoming) {
      const inLink = L.inAt.get(n)!;
      const [ex, ez] = this.endPoint(inLink, true);
      const dA = L.dir, sgA = L.sign, axisA = L.axis;
      // 1) continue on the same street (same lane index if it exists, otherwise the nearest lane that admits the class)
      const conts = this.lanes.filter((T) => T.outAt.has(n) && T.spec.name === L.spec.name && T.axis === L.axis && T.dir === L.dir).sort((p, q) => Math.abs(p.c - L.c) - Math.abs(q.c - L.c));
      let covered = 0;
      for (const T of conts) {
        const mask = L.allow & T.allow & ~covered; if (!mask) continue;
        covered |= mask;
        const outLink = T.outAt.get(n)!;
        const [xx, xz] = this.endPoint(outLink, false);
        const shift = Math.abs(T.c - L.c) > 0.3;
        let pts: number[];
        if (!shift) pts = this.straight(axisA, L.c, axisA === 'ns' ? ez : ex, axisA === 'ns' ? xz : xx);
        else { const k = 0.45 * Math.hypot(xx - ex, xz - ez); const dx = axisA === 'ew' ? sgA * k : 0, dz = axisA === 'ns' ? sgA * k : 0; pts = this.bezier([ex, ez], [ex + dx, ez + dz], [xx - dx, xz - dz], [xx, xz], 12); }
        const c = this.makeLink(pts, { lane: null, name: L.spec.name, axis: axisA, dir: dA, allow: mask, vmax: shift ? SHIFT_SPEED : (L.kind === 'cable' || L.kind === 'shared') ? 6 : SPEED, node: n, turn: false });
        c.next.push({ link: outLink, allow: mask, turn: false });
        inLink.next.push({ link: c, allow: mask, turn: false });
      }
      // 2) right turn from the rightmost general lane onto the rightmost general lane of the cross street
      if (!(L.allow & GENERAL) || !n.signal) continue;
      const rsA = rightSign(dA);
      const siblings = this.lanes.filter((T) => T.spec === L.spec && T.dir === L.dir && (T.allow & GENERAL));
      const rightmost = siblings.reduce((a, b) => (rsA * b.c > rsA * a.c ? b : a));
      if (rightmost !== L) continue;
      const dB = rightOf(dA), rsB = rightSign(dB);
      const targets = this.lanes.filter((T) => T.outAt.has(n) && T.axis !== axisA && T.dir === dB && (T.allow & GENERAL));
      if (!targets.length) continue;
      const T = targets.reduce((a, b) => (rsB * b.c > rsB * a.c ? b : a));
      const outLink = T.outAt.get(n)!;
      const [xx, xz] = this.endPoint(outLink, false);
      const sgB = T.sign;
      const kA = 1.2 * Math.abs(axisA === 'ns' ? xz - ez : xx - ex), kB = 1.2 * Math.abs(axisA === 'ns' ? xx - ex : xz - ez);
      const p1: [number, number] = axisA === 'ns' ? [ex, ez + sgA * kA] : [ex + sgA * kA, ez];
      const p2: [number, number] = axisA === 'ns' ? [xx - sgB * kB, xz] : [xx, xz - sgB * kB];
      const mask = L.allow & T.allow & GENERAL;
      const c = this.makeLink(this.bezier([ex, ez], p1, p2, [xx, xz], 16), { lane: null, name: `${L.spec.name}>${T.spec.name}`, axis: axisA, dir: dA, allow: mask, vmax: TURN_SPEED, node: n, turn: true });
      c.next.push({ link: outLink, allow: mask, turn: false });
      inLink.next.push({ link: c, allow: mask, turn: true });
    }
  }
  /** Find the block link of a lane (by street name, direction, lane kind/index) that contains the along-axis coordinate `t`. */
  findLink(street: string, dir: Dir, t: number, pick: (l: Lane) => boolean): { link: Link; s: number } | null {
    for (const lane of this.lanes) {
      if (lane.spec.name !== street || lane.dir !== dir || !pick(lane)) continue;
      for (const link of lane.links) { const lo = Math.min(link.a0, link.a1), hi = Math.max(link.a0, link.a1); if (t >= lo && t <= hi) return { link, s: Math.abs(t - link.a0) }; }
    }
    return null;
  }
  /** Position & tangent along a link (writes into out: x,y,z,tx,ty,tz). `cursor` caches the segment index. */
  static sample(link: Link, s: number, out: Float64Array, cursor: { i: number }) {
    const cum = link.cum, p = link.pts, n = cum.length - 1;
    let i = Math.min(Math.max(cursor.i, 0), n - 1);
    if (s <= 0) i = 0; else if (s >= link.len) i = n - 1; else { while (i > 0 && cum[i] > s) i--; while (i < n - 1 && cum[i + 1] < s) i++; }
    cursor.i = i;
    const segLen = cum[i + 1] - cum[i], f = segLen > 0 ? Math.min(1, Math.max(0, (s - cum[i]) / segLen)) : 0;
    const k = i * 3;
    out[0] = p[k] + (p[k + 3] - p[k]) * f; out[1] = p[k + 1] + (p[k + 4] - p[k + 1]) * f; out[2] = p[k + 2] + (p[k + 5] - p[k + 2]) * f;
    const tx = p[k + 3] - p[k], ty = p[k + 4] - p[k + 1], tz = p[k + 5] - p[k + 2], tl = Math.hypot(tx, ty, tz) || 1;
    out[3] = tx / tl; out[4] = ty / tl; out[5] = tz / tl;
  }
}
