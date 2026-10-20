// Hero buildings (Apple, Nintendo, ...) + storefront/interactable registry.
import * as THREE from 'three';
import type { World } from './World';
import type { App } from '../app/App';
import type { HeroContext, HeroModule, Interactable, StorefrontReg } from './HeroContext';
import { AppleModule } from '../interiors/Apple';
import { NintendoModule } from '../interiors/Nintendo';

export type Storefront = StorefrontReg & { source: 'hero' | 'facade' };

export const HERO_MODULES: HeroModule[] = [AppleModule, NintendoModule];
export function heroExcludeIds(): string[] { return HERO_MODULES.flatMap((m) => m.excludeOsmIds); }

export class Hero {
  group = new THREE.Group();
  storefronts: Storefront[] = [];
  interactables: Interactable[] = [];
  constructor(public world: World, public app: App) { this.group.name = 'hero'; }
  async build() {
    this.app.scene.add(this.group);
    for (const s of this.world.storefronts) this.storefronts.push({ ...s, source: 'facade' });
    for (const m of HERO_MODULES) {
      const g = new THREE.Group(); g.name = `hero:${m.id}`; this.group.add(g);
      g.userData.inspection = {
        title: m.id === 'apple' ? 'Apple Union Square' : m.id === 'nintendo' ? 'Nintendo SAN FRANCISCO' : m.id,
        kind: 'Building',
        id: m.id,
        facts: [{ label: 'Address', value: m.id === 'apple' ? '300 Post St' : '331 Powell St' }, { label: 'Enterable', value: 'Yes' }],
        source: 'Locally authored landmark scene. Interior and façade details are a project interpretation.',
      };
      const ctx: HeroContext = {
        world: this.world, app: this.app, scene: this.app.scene, group: g,
        registerStorefront: (s) => { this.storefronts = this.storefronts.filter((x) => x.id !== s.id); this.storefronts.push({ ...s, source: 'hero' }); },
        registerInteractable: (i) => { this.interactables.push(i); },
        addUpdatable: (u) => this.app.add(u),
        nightFactor: () => this.app.time.nightFactor,
      };
      try { await m.build(ctx); } catch (e) { console.error('hero module failed', m.id, e); }
    }
  }
  storefrontList() { return this.storefronts.map((s) => ({ id: s.id, name: s.name, category: s.category, address: s.address, x: +s.position.x.toFixed(1), z: +s.position.z.toFixed(1), enterable: s.enterable, status: s.status, confidence: s.confidence, source: s.source })); }
}
