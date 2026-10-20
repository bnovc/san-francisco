import type { BuildingInfo } from '../world/Buildings';

export interface InspectionFact {
  label: string;
  value: string;
}

export interface InspectionData {
  title: string;
  kind: string;
  id?: string;
  facts?: InspectionFact[];
  source?: string;
  sourceUrl?: string;
}

export function buildingInspection(info: BuildingInfo): InspectionData {
  const address = info.address || info.b.address || '';
  return {
    title: info.name || address || 'Building',
    kind: 'Building',
    id: info.id,
    facts: [
      ...(address ? [{ label: 'Address', value: address }] : []),
      { label: 'Approx. height', value: `${info.height.toFixed(1)} m` },
      { label: 'Approx. floors', value: String(info.floors) },
      { label: 'Footprint area', value: `${Math.round(info.b.areaM2).toLocaleString()} m²` },
    ],
    source: 'OpenStreetMap footprint; rendered height and façade details may be inferred.',
    sourceUrl: osmFeatureUrl(info.id),
  };
}

export function osmFeatureUrl(id: string): string | undefined {
  const match = /^(node|way|relation)\/(\d+)$/.exec(id);
  return match ? `https://www.openstreetmap.org/${match[1]}/${match[2]}` : undefined;
}
