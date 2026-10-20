// Address lines for named labels on exact OSM building ways near 15th & Market.
// From the 2026-10-18 BBBike OSM snapshot (SHA-256 2a4c97087e7f04bef0a92aec0c702894b7400f2abba8233466e77cecc050cd7a).
// ODbL data; these are snapshot observations, not a current tenancy check.
export const market15AddressLabels: Readonly<Record<string, {
  name: string; address: string; osmEditedAt: string;
  frontage?: { x: number; z: number; length: number; angle: number };
}>> = {
  // The generic centroid edge falls on a shared party wall. This 15th Street
  // edge is inferred from the same OSM footprint and adjacent mapped footway.
  'way/261145414': {
    name: 'Chase', address: '2112 15th Street', osmEditedAt: '2024-09-17',
    frontage: { x: -2477.2, z: 2053.45, length: 12.5, angle: .088 },
  },
  'way/121024973': {
    name: 'Cafe du Nord', address: '2170 Market Street', osmEditedAt: '2022-07-04',
    frontage: { x: -2374.9, z: 2012.5, length: 8.6, angle: 2.505 },
  },
  'way/226430925': {
    name: 'Century', address: '2200 Market Street', osmEditedAt: '2024-09-23',
    frontage: { x: -2479.1, z: 2087.3, length: 41.6, angle: 2.536 },
  },
  'way/97167357': {
    name: 'Duboce Apartments', address: '181 Sanchez Street', osmEditedAt: '2020-04-06',
    frontage: { x: -2421.5, z: 2016.6, length: 64.4, angle: 1.661 },
  },
};
