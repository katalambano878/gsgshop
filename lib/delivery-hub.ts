/**
 * GSG dispatch hub + distance helpers.
 * Default hub: GCB Bank Head Office, Thorpe Link, Accra Central —
 * primary goods-sourcing area. Admin can override in Delivery Pricing settings.
 */

export type LatLng = { lat: number; lng: number };

export type DeliveryHub = LatLng & { label: string };

export const GSG_HUB: DeliveryHub = {
  lat: 5.5434667,
  lng: -0.2054859,
  label: 'GSG Hub — GCB Bank Head Office, Thorpe Link, Accra',
};

/**
 * Outside Greater Accra we deliver to a commercial transport station in
 * Accra; the customer pays the transport company's own charge on top.
 * Admin can override in Delivery Pricing settings.
 */
export const GSG_TRANSPORT_STATION: DeliveryHub = {
  lat: 5.5717,
  lng: -0.2177,
  label: 'Kwame Nkrumah Circle transport station, Accra',
};

const OTHER_REGIONS =
  /ashanti|central|western|eastern|volta|northern|upper east|upper west|bono|ahafo|oti|savannah|north east/i;

/**
 * True when a place is outside Greater Accra. Uses the geocoder's region
 * when it names one, otherwise a rough Greater Accra bounding box.
 */
export function isOutsideGreaterAccra(region: string | null | undefined, point: LatLng): boolean {
  if (region && /greater accra/i.test(region)) return false;
  // Kasoa sits just over the Central Region line but is served as part of
  // Greater Accra (Zone 2 on the shipping page).
  const inKasoa = point.lat >= 5.47 && point.lat <= 5.6 && point.lng >= -0.5 && point.lng <= -0.38;
  if (inKasoa) return false;
  if (region && OTHER_REGIONS.test(region)) return true;
  const inGreaterAccraBox =
    point.lat >= 5.45 && point.lat <= 6.1 && point.lng >= -0.55 && point.lng <= 0.7;
  return !inGreaterAccraBox;
}

/** Straight-line km (Haversine). */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Estimate road distance when a routing API is unavailable.
 * Urban Ghana roads are rarely a straight line — ~1.35× is a practical factor.
 */
export function estimateRoadKm(straightKm: number): number {
  return Math.max(0.5, Math.round(straightKm * 1.35 * 10) / 10);
}

export type PopularPlace = {
  id: string;
  name: string;
  area: string;
  city: string;
  region: string;
  lat: number;
  lng: number;
};

/** Common Accra / Greater Accra delivery areas for instant lookup. */
export const POPULAR_DELIVERY_PLACES: PopularPlace[] = [
  { id: 'east-legon', name: 'East Legon', area: 'East Legon', city: 'Accra', region: 'Greater Accra', lat: 5.6355, lng: -0.1538 },
  { id: 'osu', name: 'Osu', area: 'Osu', city: 'Accra', region: 'Greater Accra', lat: 5.5557, lng: -0.1745 },
  { id: 'labone', name: 'Labone', area: 'Labone', city: 'Accra', region: 'Greater Accra', lat: 5.5665, lng: -0.1665 },
  { id: 'airport', name: 'Airport Residential', area: 'Airport Residential', city: 'Accra', region: 'Greater Accra', lat: 5.6055, lng: -0.1715 },
  { id: 'dzorwulu', name: 'Dzorwulu', area: 'Dzorwulu', city: 'Accra', region: 'Greater Accra', lat: 5.6085, lng: -0.1935 },
  { id: 'cantonments', name: 'Cantonments', area: 'Cantonments', city: 'Accra', region: 'Greater Accra', lat: 5.5785, lng: -0.1705 },
  { id: 'adabraka', name: 'Adabraka', area: 'Adabraka', city: 'Accra', region: 'Greater Accra', lat: 5.5655, lng: -0.2085 },
  { id: 'tema', name: 'Tema', area: 'Tema', city: 'Tema', region: 'Greater Accra', lat: 5.6698, lng: -0.0166 },
  { id: 'madina', name: 'Madina', area: 'Madina', city: 'Accra', region: 'Greater Accra', lat: 5.6831, lng: -0.1669 },
  { id: 'legon', name: 'Legon / University of Ghana', area: 'Legon', city: 'Accra', region: 'Greater Accra', lat: 5.6505, lng: -0.1870 },
  { id: 'haatso', name: 'Haatso', area: 'Haatso', city: 'Accra', region: 'Greater Accra', lat: 5.6685, lng: -0.1925 },
  { id: 'achimota', name: 'Achimota', area: 'Achimota', city: 'Accra', region: 'Greater Accra', lat: 5.6275, lng: -0.2265 },
  { id: 'dansoman', name: 'Dansoman', area: 'Dansoman', city: 'Accra', region: 'Greater Accra', lat: 5.5455, lng: -0.2655 },
  { id: 'spintex', name: 'Spintex', area: 'Spintex', city: 'Accra', region: 'Greater Accra', lat: 5.6355, lng: -0.0885 },
  { id: 'teshie', name: 'Teshie', area: 'Teshie', city: 'Accra', region: 'Greater Accra', lat: 5.5835, lng: -0.1045 },
  { id: 'kasoa', name: 'Kasoa', area: 'Kasoa', city: 'Kasoa', region: 'Central', lat: 5.5345, lng: -0.4165 },
  { id: 'accra-central', name: 'Accra Central', area: 'Accra Central', city: 'Accra', region: 'Greater Accra', lat: 5.5560, lng: -0.1969 },
  { id: 'kaneshie', name: 'Kaneshie', area: 'Kaneshie', city: 'Accra', region: 'Greater Accra', lat: 5.5705, lng: -0.2375 },
  { id: 'lapaz', name: 'Lapaz', area: 'Lapaz', city: 'Accra', region: 'Greater Accra', lat: 5.6055, lng: -0.2485 },
  { id: 'ashaiman', name: 'Ashaiman', area: 'Ashaiman', city: 'Ashaiman', region: 'Greater Accra', lat: 5.6885, lng: -0.0355 },
  { id: 'nungua', name: 'Nungua', area: 'Nungua', city: 'Accra', region: 'Greater Accra', lat: 5.6015, lng: -0.0775 },
  { id: 'westhills', name: 'Weija / West Hills', area: 'Weija', city: 'Accra', region: 'Greater Accra', lat: 5.5655, lng: -0.3335 },
  { id: 'sakumono', name: 'Sakumono', area: 'Sakumono', city: 'Tema', region: 'Greater Accra', lat: 5.6225, lng: -0.0555 },
  { id: 'kwabenya', name: 'Kwabenya', area: 'Kwabenya', city: 'Accra', region: 'Greater Accra', lat: 5.7055, lng: -0.2055 },
  { id: 'adjiringanor', name: 'Adjiringanor', area: 'Adjiringanor', city: 'Accra', region: 'Greater Accra', lat: 5.6485, lng: -0.1355 },
  { id: 'trasacco', name: 'Trasacco Valley', area: 'Trasacco', city: 'Accra', region: 'Greater Accra', lat: 5.6225, lng: -0.1285 },
  { id: 'kumasi', name: 'Kumasi (city centre)', area: 'Kumasi', city: 'Kumasi', region: 'Ashanti', lat: 6.6885, lng: -1.6244 },
  { id: 'takoradi', name: 'Takoradi', area: 'Takoradi', city: 'Takoradi', region: 'Western', lat: 4.8845, lng: -1.7554 },
  { id: 'cape-coast', name: 'Cape Coast', area: 'Cape Coast', city: 'Cape Coast', region: 'Central', lat: 5.1053, lng: -1.2466 },
];

export function searchPopularPlaces(query: string, limit = 8): PopularPlace[] {
  const q = query.trim().toLowerCase();
  if (!q) return POPULAR_DELIVERY_PLACES.slice(0, limit);
  return POPULAR_DELIVERY_PLACES.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.area.toLowerCase().includes(q) ||
      p.city.toLowerCase().includes(q)
  ).slice(0, limit);
}

export function distanceFromHubKm(dest: LatLng, hub: LatLng = GSG_HUB): number {
  return estimateRoadKm(haversineKm(hub, dest));
}
