// Data schema for spec-driven façades (LEVEL 2/3). Sector agents author these in src/data/facades/*.json.
export type WindowModule =
  | 'win_dh_stone_1.2x2.2' | 'win_dh_stone_1.5x2.6' | 'win_arch_stone_1.5x3.0' | 'win_pair_stone_2.4x2.4'
  | 'win_punched_modern_1.8x2.0' | 'win_office_strip_3.0x1.8' | 'win_curtain_3.0x3.6' | 'win_bay_oriel_2.4x3.0' | 'none';
export type StorefrontModule =
  | 'storefront_bay_3.0x4.5' | 'storefront_bay_4.0x5.0' | 'storefront_door_double_2.0x2.8' | 'storefront_door_recessed_3.0x4.5'
  | 'door_revolving_2.4' | 'door_hotel_marquee_6.0' | 'storefront_luxury_4.0x5.0' | 'storefront_arcade_arch_4.0x5.5' | 'wall' | 'custom';
export type WallMaterial = 'limestone' | 'sandstone' | 'granite_grey' | 'granite_dark' | 'granite_pink' | 'marble_white' | 'terracotta_white' | 'brick_red' | 'plaster_white' | 'plaster_cream' | 'plaster_grey' | 'concrete_plain' | 'concrete_dark' | 'metal_alu' | 'glass_tint' | 'paint_white';

export interface TenantSign {
  name: string;                      // display text (real business name)
  brand?: string;                    // logo key for Logos.ts (e.g. 'nintendo', 'tiffany'); omit for text-only
  signType?: 'fascia' | 'blade' | 'awning' | 'letters' | 'none';
  awning?: 'red' | 'black' | 'green' | 'none';
  illuminated?: boolean;
  color?: string; bg?: string;       // css colours for text signs
  category?: string; status?: string; confidence?: string; address?: string;
  enterable?: boolean;
}
export interface StorefrontBay {
  edge: number;                      // footprint edge index (a = footprint[edge], b = footprint[edge+1])
  from: number; to: number;          // metres along the edge from `a`
  module: StorefrontModule;
  tenant?: TenantSign;
  height?: number;                   // override storefront opening height (m)
}
export interface EdgeSpec {
  edge: number | 'street';           // 'street' = auto-detect all street-facing edges
  window?: WindowModule;             // typical-floor window module
  windowFloor2?: WindowModule;       // optional different module for the first upper floor (piano nobile)
  bayW?: number;                     // target bay width (m)
  endPad?: number;                   // wall left blank at both ends of the edge (m)
  storefront?: StorefrontModule;     // default ground-floor module tiled along the edge when no `storefronts` cover it ('wall' = none)
  detail?: boolean;                  // false = keep massing (e.g. party walls)
}
export interface FacadeMass {
  // Extra volume attached to the building (projecting pavilion, tower setback, mansard): local polygon in world x,z
  polygon: [number, number][]; baseY?: number; height: number; wall?: WallMaterial; window?: WindowModule; bayW?: number; cornice?: 'heavy' | 'medium' | 'none'; roof?: 'flat' | 'mansard';
}
export interface FacadeSpec {
  osmId?: string; address?: string; name?: string;  // building match (osmId preferred; else address/name match against gis)
  wall: WallMaterial;
  base?: { material: WallMaterial; height: number; rusticated?: boolean };
  groundH?: number;                  // ground-floor height (m); default 5.5
  floorH?: number;                   // typical floor height (m); default from massing
  floors?: number;                   // override floor count above ground
  cornice?: 'heavy' | 'medium' | 'none';
  stringcourseAfterFloors?: number[];// floor indices (1 = above ground floor) that get a belt course
  parapet?: boolean; balustrade?: boolean; roof?: 'flat' | 'mansard';
  rooftop?: ('penthouse' | 'watertank' | 'none')[];
  edges: EdgeSpec[];
  storefronts?: StorefrontBay[];
  extras?: { kind: 'balcony_stone' | 'balcony_iron' | 'fire_escape' | 'flag' | 'ac' | 'column_corinthian' | 'column_doric' | 'pilaster_giant' | 'canopy_metal'; edge: number; at: number; floor?: number; count?: number }[];
  masses?: FacadeMass[];
  signs?: { brand?: string; text?: string; edge: number; at: number; y: number; widthM: number; heightM: number; color?: string; bg?: string | null; illuminated?: boolean; letterSpacing?: number; out?: number }[];  // façade-mounted signs at height y above the ground datum
  heightM?: number;                  // override building height (metres above the massing base = lowest footprint corner)
  groundLevelY?: number;             // pin the ground-floor datum (absolute local y) instead of the highest street sidewalk (use on big sloped blocks)
  notes?: string;
}
