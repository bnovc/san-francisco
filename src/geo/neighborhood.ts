import { geoToLocal } from './geo';

// Representative points keep the location cue lightweight. The City’s SF Find
// neighborhood map describes its boundaries as general locations, not hard edges:
// https://data.sf.gov/Geographic-Locations-and-Boundaries/SF-Find-Neighborhoods/pty2-tcw4/about
// This deliberately reports the nearest area as an approximation.
const anchors = [
  ['Union Square', 37.787935, -122.40752],
  ['Theater District', 37.787156, -122.409889],
  ['Financial District', 37.7916, -122.3994],
  ['Chinatown', 37.7945, -122.4065],
  ['North Beach', 37.8002, -122.4089],
  ['Telegraph Hill', 37.8022, -122.4052],
  ['Fisherman’s Wharf', 37.8080, -122.4177],
  ['Yerba Buena Island', 37.8105, -122.3664],
  ['Treasure Island', 37.8200, -122.3702],
  ['Russian Hill', 37.7990, -122.4192],
  ['Nob Hill', 37.7935, -122.4150],
  ['Tenderloin', 37.7848, -122.4147],
  ['Civic Center', 37.7793, -122.4165],
  ['SoMa', 37.7770, -122.4057],
  ['South Beach', 37.7818, -122.3926],
  ['Mission Bay', 37.7702, -122.3913],
  ['Dogpatch', 37.7585, -122.3883],
  ['Mission District', 37.7595, -122.4148],
  ['Castro', 37.7625, -122.4350],
  ['Noe Valley', 37.7514, -122.4338],
  ['Bernal Heights', 37.7399, -122.4148],
  ['Potrero Hill', 37.7589, -122.4008],
  ['Lower Haight', 37.7728, -122.4315],
  ['Hayes Valley', 37.7765, -122.4235],
  ['Western Addition', 37.7790, -122.4325],
  ['Japantown', 37.7855, -122.4317],
  ['Pacific Heights', 37.7925, -122.4351],
  ['Cow Hollow', 37.7990, -122.4342],
  ['Marina', 37.8020, -122.4382],
  ['Presidio', 37.7983, -122.4660],
  ['Inner Richmond', 37.7800, -122.4686],
  ['Outer Richmond', 37.7780, -122.4950],
  ['Haight-Ashbury', 37.7692, -122.4480],
  ['Cole Valley', 37.7656, -122.4503],
  ['Golden Gate Park', 37.7684, -122.4820],
  ['Inner Sunset', 37.7625, -122.4630],
  ['Outer Sunset', 37.7500, -122.4945],
  ['Ocean Beach', 37.7600, -122.5100],
  ['Twin Peaks', 37.7548, -122.4473],
  ['West Portal', 37.7408, -122.4655],
  ['Sunnyside', 37.7318, -122.4384],
  ['Ingleside', 37.7214, -122.4551],
  ['Lakeshore', 37.7215, -122.4843],
  ['Portola', 37.7332, -122.4070],
  ['Bayview', 37.7295, -122.3928],
  ['Excelsior', 37.7248, -122.4320],
  ['Visitacion Valley', 37.7137, -122.4045],
].map(([name, lat, lon]) => {
  const point = geoToLocal(lat as number, lon as number);
  return { name: name as string, x: point.x, z: point.z };
});

const MAX_NEIGHBORHOOD_DISTANCE_M = 2600;

/** Return a nearby SF neighborhood cue, or null when the position is outside the labeled areas. */
export function neighborhoodAt(x: number, z: number): string | null {
  let nearest: (typeof anchors)[number] | null = null;
  let nearestDistanceSq = Infinity;
  for (const anchor of anchors) {
    const dx = x - anchor.x;
    const dz = z - anchor.z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < nearestDistanceSq) {
      nearest = anchor;
      nearestDistanceSq = distanceSq;
    }
  }
  return nearest && nearestDistanceSq <= MAX_NEIGHBORHOOD_DISTANCE_M ** 2 ? nearest.name : null;
}
