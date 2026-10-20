// Trees, palms, hedges: instanced GLBs from the BPL vegetation set, placed from recon data + street tree spots.
import * as THREE from 'three';
import { Assets, InstancedModel } from '../assets/Assets';
import type { World } from './World';
import type { App } from '../app/App';
import { PLAZA } from './Plaza';
import { Rng } from '../util/Rng';
import type { Updatable } from '../app/App';

export class Vegetation implements Updatable {
  group = new THREE.Group();
  rng = new Rng(31);
  constructor(public world: World, public app: App) { this.group.name = 'vegetation'; }
  async build() {
    const inst = async (n: string, cap: number) => (Assets.has(n) ? Assets.instanced(n, cap, { castShadow: true, receiveShadow: false }) : null);
    const palm = await inst('veg/palm_canary', 40), palmShort = await inst('veg/palm_canary_short', 20);
    const streetTreeCapacity = Math.max(1, this.world.treeSpots.length);
    const plane = await inst('veg/tree_plane', streetTreeCapacity), small = await inst('veg/tree_street_small', streetTreeCapacity), olive = await inst('veg/tree_olive', 40);
    const hedge = await inst('veg/hedge_1m', 600), hedgeLow = await inst('veg/hedge_1m_low', 400), shrub = await inst('veg/shrub_box', 200), flowers = await inst('veg/flowerbed_1m', 120);
    const t = this.world.terrain;
    // --- plaza palms (Phoenix canariensis) at recon positions (u = x, v = -z) ---
    const palmsUV: [number, number][] = [[-43.4, 28.9], [-49, 21.5], [-57.8, 13.9], [42.3, 37.5], [42.8, 29.1], [48.5, 23], [56.8, 22.7], [56, -20.4], [48.6, -20.4], [42.6, -27.1], [42.6, -34.9], [-57.4, -20.6], [-48.7, -21.3], [-43.1, -26.9], [-42.6, -35.7], [-57.5, 0], [-57.5, -8]];
    for (const [u, v] of palmsUV) {
      const x = u, z = -v; const y = this.world.collision.floorAt(x, z, t.heightAt(x, z) + 0.5, 100);
      const r = this.rng.range(0.85, 1.1);
      (this.rng.chance(0.7) ? palm : palmShort)?.add([x, y, z], this.rng.range(0, 6.28), r);
    }
    // --- broadleaf trees in the SW/SE lawns and on the north terrace ---
    const trees: [number, number][] = [[-25.5, -34.3], [-15.1, -34], [-26.1, -26.5], [-15.7, -26.6], [25.5, -34.3], [15.1, -34], [26.1, -26.5], [15.7, -26.6], [-9.4, 31.1], [8.5, 31.2], [21.8, 31], [-21.8, 31], [-35, 31], [35, 31]];
    for (const [u, v] of trees) { const x = u, z = -v; const y = this.world.collision.floorAt(x, z, t.heightAt(x, z) + 0.5, 100); olive?.add([x, y, z], this.rng.range(0, 6.28), this.rng.range(0.9, 1.2)); }
    // --- hedges: planted bands north (z -12.4) and south (z 15.6) of the central deck, plaza perimeter planters ---
    for (let x = -58; x <= 58; x += 1) { if (Math.abs(x) < 7 && true) { /* central stair gap on the south band */ } if (Math.abs(x) >= 7) hedgeLow?.add([x, PLAZA.central + 0.45, 15.9], 0); if (Math.abs(x) > 12) hedgeLow?.add([x, PLAZA.north, -12.4], 0); }
    for (let z = -37; z <= 22; z += 1) { const y = z < -12 ? PLAZA.north : z < 15 ? PLAZA.central : PLAZA.southPromenade; if (Math.abs(z) > 9 || z > 15) { hedge?.add([-59.3, y, z], Math.PI / 2); hedge?.add([59.6, y, z], Math.PI / 2); } }
    for (const [x0, x1] of [[-41, -33.2], [-30.2, -20.8], [-17.8, -11.5], [17.6, 41]] as [number, number][]) for (let x = x0 + 0.5; x < x1; x += 1) hedgeLow?.add([x, PLAZA.southPromenade + 0.5, 23.6], 0);
    // monument bed flowers + NW lawn panel beds
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; flowers?.add([Math.cos(a) * 7, 0.42, Math.sin(a) * 7], a); }
    for (let x = -50; x <= -24; x += 2) flowers?.add([x, PLAZA.north + 0.06, -33], 0);
    for (const [x, z] of [[-54, -30], [54, -30]]) shrub?.add([x, this.world.collision.floorAt(x, z, t.heightAt(x, z) + 0.5, 100), z], 0);
    // --- street trees (from Props tree grates) ---
    for (const [x, y, z] of this.world.treeSpots) { const big = this.rng.chance(0.4); (big ? plane : small)?.add([x, y, z], this.rng.range(0, 6.28), this.rng.range(0.8, 1.15)); }
    for (const im of [palm, palmShort, plane, small, olive, hedge, hedgeLow, shrub, flowers]) if (im) { im.finalize(); this.group.add(im.group); }
    this.app.scene.add(this.group);
    // tree trunks block the player (approximate)
    for (const [u, v] of palmsUV) this.world.collision.addBox(u, -v, 1.0, 1.0, -6, 3);
    for (const [u, v] of trees) this.world.collision.addBox(u, -v, 0.6, 0.6, -6, 3);
    for (const [x, y, z] of this.world.treeSpots) this.world.collision.addBox(x, z, 0.45, 0.45, y - 0.3, y + 3.5, 0, 'tree');
  }
  update() {}
}
