// Streamed city traffic signals sourced from the SFMTA/DataSF inventory.
// The first city pass renders signalized intersections and uses the same
// generic 60-second cycle as the detailed Union Square slice. It does not
// claim to reproduce the City's controller timing plans.
import * as THREE from 'three';
import { Assets, type InstancedModel } from '../assets/Assets';

export type CitySignalRecord = [number, number, number, number, number, number, number];

interface SignalSpot {
  x: number;
  y: number;
  z: number;
  rotation: number;
  axis: 'ns' | 'ew';
  offset: number;
  ped: boolean;
}

interface SignalBatch {
  model: InstancedModel;
  spots: SignalSpot[];
  last: string[];
}

type LampName = 'lamp_red' | 'lamp_amber' | 'lamp_green' | 'ped_walk' | 'ped_stop';

const CYCLE = 60, GREEN = 25, AMBER = 3, ALL_RED = 2, WALK_CLEAR = 6;
const DARK: Record<LampName, THREE.Color> = {
  lamp_red: new THREE.Color(0x2a0404), lamp_amber: new THREE.Color(0x2a1a02), lamp_green: new THREE.Color(0x032a08),
  ped_walk: new THREE.Color(0x0a0a0a), ped_stop: new THREE.Color(0x2a0404),
};
const LIT: Record<LampName, THREE.Color> = {
  lamp_red: new THREE.Color(0xff1a1a), lamp_amber: new THREE.Color(0xffa020), lamp_green: new THREE.Color(0x22ff55),
  ped_walk: new THREE.Color(0xf4f4f4), ped_stop: new THREE.Color(0xff3a1a),
};
const LAMPS = Object.keys(DARK) as LampName[];

function hash(id: number, corner: number) {
  let h = Math.imul((id ^ (corner * 0x9e3779b9)) | 0, 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function phase(t: number) {
  const ns = t < GREEN ? 'green' : t < GREEN + AMBER ? 'amber' : 'red';
  const t2 = t - (GREEN + AMBER + ALL_RED);
  const ew = t2 < 0 ? 'red' : t2 < GREEN ? 'green' : t2 < GREEN + AMBER ? 'amber' : 'red';
  return { ns, ew, walkNS: t < GREEN - WALK_CLEAR, walkEW: t2 >= 0 && t2 < GREEN - WALK_CLEAR };
}

export class CitySignals {
  readonly group = new THREE.Group();
  private batches = new Map<string, SignalBatch>();
  private loaded = false;
  private time = 0;

  constructor(private readonly groundY: (x: number, z: number) => number) {
    this.group.name = 'city-signals';
  }

  async load() {
    if (!Assets.has('street/traffic_signal_post')) {
      console.warn('city signals: traffic signal asset is not in the street manifest');
      return;
    }
    try {
      await Assets.load('street/traffic_signal_post');
      this.loaded = true;
    } catch (error) {
      console.warn('city signals: traffic signal asset failed to load', error);
    }
  }

  async addTile(key: string, records: CitySignalRecord[]) {
    if (!this.loaded || this.batches.has(key) || !records.length) return;
    const spots: SignalSpot[] = [];
    // DataSF points identify the signalized intersection. Four corner posts
    // make the coarse layer read correctly at street level; exact mast layouts
    // and diagonal-road alignment remain a later streetscape refinement.
    for (const [id, x, z, , ped] of records) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const corner = (sx < 0 ? 0 : 1) * 2 + (sz < 0 ? 0 : 1);
        spots.push({
          x: x + sx * 6.3,
          y: this.groundY(x + sx * 6.3, z + sz * 6.3),
          z: z + sz * 6.3,
          rotation: sx < 0 ? (sz < 0 ? Math.PI : Math.PI / 2) : sz < 0 ? -Math.PI / 2 : 0,
          axis: sx * sz < 0 ? 'ns' : 'ew',
          offset: hash(id, corner) * 8,
          ped: ped === 1,
        });
      }
    }
    const model = await Assets.instanced('street/traffic_signal_post', spots.length, { castShadow: true, receiveShadow: true });
    for (const mesh of model.meshes) {
      if (!LAMPS.includes(mesh.name as LampName)) continue;
      mesh.material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, vertexColors: true });
      mesh.userData.citySignalLampMaterial = true;
    }
    for (const spot of spots) model.add([spot.x, spot.y, spot.z], spot.rotation);
    const batch: SignalBatch = { model, spots, last: [] };
    this.batches.set(key, batch);
    model.group.name = `city-signals:${key}`;
    this.apply(batch, true);
    model.finalize();
    this.group.add(model.group);
  }

  removeTile(key: string) {
    const batch = this.batches.get(key);
    if (!batch) return;
    this.group.remove(batch.model.group);
    for (const mesh of batch.model.meshes) {
      mesh.geometry.dispose();
      if (mesh.userData.citySignalLampMaterial) (mesh.material as THREE.Material).dispose();
    }
    this.batches.delete(key);
  }

  update(dt = 0.5) {
    this.time = (this.time + dt) % CYCLE;
    for (const batch of this.batches.values()) this.apply(batch, false);
  }

  stats() {
    let heads = 0;
    for (const batch of this.batches.values()) heads += batch.spots.length;
    return { citySignalTiles: this.batches.size, citySignalHeads: heads };
  }

  private apply(batch: SignalBatch, force: boolean) {
    let dirty = false;
    batch.spots.forEach((spot, i) => {
      const t = ((this.time + spot.offset) % CYCLE + CYCLE) % CYCLE;
      const p = phase(t);
      const colour = spot.axis === 'ns' ? p.ns : p.ew;
      const walk = spot.axis === 'ns' ? p.walkNS : p.walkEW;
      const key = `${colour}:${walk ? 'walk' : 'stop'}`;
      if (!force && batch.last[i] === key) return;
      batch.last[i] = key;
      batch.model.setColorAt(i, colour === 'red' ? LIT.lamp_red : DARK.lamp_red, 'lamp_red');
      batch.model.setColorAt(i, colour === 'amber' ? LIT.lamp_amber : DARK.lamp_amber, 'lamp_amber');
      batch.model.setColorAt(i, colour === 'green' ? LIT.lamp_green : DARK.lamp_green, 'lamp_green');
      batch.model.setColorAt(i, spot.ped && walk ? LIT.ped_walk : DARK.ped_walk, 'ped_walk');
      batch.model.setColorAt(i, spot.ped && !walk ? LIT.ped_stop : DARK.ped_stop, 'ped_stop');
      dirty = true;
    });
    if (dirty) for (const mesh of batch.model.meshes) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}
