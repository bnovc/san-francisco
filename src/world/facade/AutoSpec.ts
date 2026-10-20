// Derive a plausible FacadeSpec from massing info when no authored spec exists (used for every street-facing building near the square).
import type { BuildingInfo } from '../Buildings';
import type { FacadeSpec, WallMaterial, WindowModule } from './FacadeSpec';
import { Rng } from '../../util/Rng';

export function autoSpec(info: BuildingInfo, seed = 1): FacadeSpec | null {
  const r = new Rng(seed + info.id.length * 7);
  if (info.style === 'glass' && info.height > 40) return null;         // keep massing texture for glass towers
  if (info.height < 3.5) return null;                                   // kiosks
  const map: Record<string, { wall: WallMaterial; win: WindowModule; win2?: WindowModule; cornice: 'heavy' | 'medium' | 'none'; base: WallMaterial; groundH: number; bayW: number }> = {
    stone_light: { wall: 'limestone', win: 'win_dh_stone_1.2x2.2', win2: 'win_arch_stone_1.5x3.0', cornice: 'heavy', base: 'granite_grey', groundH: 5.6, bayW: 3.6 },
    stone_warm: { wall: 'sandstone', win: 'win_dh_stone_1.5x2.6', win2: 'win_arch_stone_1.5x3.0', cornice: 'heavy', base: 'granite_dark', groundH: 5.8, bayW: 4.0 },
    stone_dark: { wall: 'granite_grey', win: 'win_punched_modern_1.8x2.0', cornice: 'medium', base: 'granite_dark', groundH: 5.0, bayW: 3.6 },
    terracotta: { wall: 'plaster_cream', win: 'win_dh_stone_1.5x2.6', win2: 'win_pair_stone_2.4x2.4', cornice: 'heavy', base: 'granite_grey', groundH: 5.6, bayW: 3.8 },
    brick: { wall: 'brick_red', win: 'win_dh_stone_1.2x2.2', cornice: 'medium', base: 'granite_dark', groundH: 4.8, bayW: 3.4 },
    plaster: { wall: 'plaster_cream', win: 'win_dh_stone_1.2x2.2', cornice: 'medium', base: 'plaster_grey', groundH: 4.8, bayW: 3.4 },
    concrete: { wall: 'concrete_plain', win: 'win_punched_modern_1.8x2.0', cornice: 'none', base: 'concrete_dark', groundH: 5.0, bayW: 3.4 },
    glass: { wall: 'metal_alu', win: 'win_curtain_3.0x3.6', cornice: 'none', base: 'granite_dark', groundH: 5.0, bayW: 3.0 },
    travertine: { wall: 'sandstone', win: 'win_punched_modern_1.8x2.0', cornice: 'none', base: 'granite_grey', groundH: 6.0, bayW: 3.2 },
    blank: { wall: 'plaster_grey', win: 'none', cornice: 'none', base: 'plaster_grey', groundH: 5.0, bayW: 4.0 },
  };
  const m = map[info.style] || map.stone_light;
  const isHotel = /hotel|inn|westin|hyatt|hilton|marriott|nikko|beacon|chancellor|handlery|stratford|kensington/i.test(info.name);
  const old = !info.b.tags['start_date'] || parseInt(info.b.tags['start_date'], 10) < 1940;
  const spec: FacadeSpec = {
    osmId: info.id, name: info.name, wall: m.wall,
    base: { material: m.base, height: Math.min(m.groundH + 0.3, 6.2), rusticated: old && info.style !== 'concrete' },
    groundH: m.groundH, floorH: info.floorH, cornice: m.cornice,
    stringcourseAfterFloors: old ? [1] : [],
    parapet: !old || m.cornice === 'none',
    rooftop: info.height > 20 ? (r.chance(0.6) ? ['penthouse'] : ['penthouse', 'watertank']) : ['none'],
    edges: info.height > 30
      ? info.footprint.map((_, i) => ({ edge: i, window: m.win, windowFloor2: m.win2, bayW: m.bayW, endPad: 0.8, storefront: 'wall' as const }))   // towers: every face detailed
      : [{ edge: 'street', window: m.win, windowFloor2: m.win2, bayW: m.bayW, endPad: 0.8, storefront: isHotel ? 'storefront_arcade_arch_4.0x5.5' : 'storefront_bay_3.0x4.5' }],
    extras: [],
  };
  if (info.style === 'brick' && r.chance(0.7)) spec.extras!.push({ kind: 'fire_escape', edge: -1, at: 0.5 });
  return spec;
}
