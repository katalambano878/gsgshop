import type { LatLng } from '@/lib/delivery-hub';

/**
 * Optional Google Geocoding + Distance Matrix.
 * Used only when GOOGLE_MAPS_API_KEY is set (server-side). No Maps JavaScript
 * SDK is loaded in the browser — that is the paid visual map the client
 * asked us to drop. Geocoding + Distance Matrix stay inside Google's
 * monthly credit at GSG volumes.
 */

const TIMEOUT_MS = 6500;

export type GooglePlace = {
  label: string;
  shortLabel: string;
  point: LatLng;
  city?: string;
  region?: string;
};

export function hasGoogleMapsKey(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY?.trim());
}

const googleFetch = (url: string) =>
  fetch(url, { next: { revalidate: 0 }, signal: AbortSignal.timeout(TIMEOUT_MS) });

function googleKey(): string | null {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  return key || null;
}

function component(components: Array<{ long_name: string; types: string[] }> | undefined, type: string) {
  return components?.find((c) => c.types.includes(type))?.long_name;
}

/** Greater Accra bias: south,west|north,east. Biases results; does not hard-clip Ghana. */
const ACCRA_BOUNDS = '5.45,-0.55|5.90,0.15';

type GoogleGeocodeResult = {
  formatted_address?: string;
  types?: string[];
  partial_match?: boolean;
  address_components?: Array<{ long_name: string; types: string[] }>;
  geometry?: { location?: { lat: number; lng: number }; location_type?: string };
};

function inGhana(lat: number, lng: number) {
  return lat >= 4.5 && lat <= 11.2 && lng >= -3.5 && lng <= 1.4;
}

/** Country / whole-region hits ("Ghana", 380 km) are not a delivery address. */
function resultScore(result: GoogleGeocodeResult): number {
  const lat = result.geometry?.location?.lat;
  const lng = result.geometry?.location?.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inGhana(lat as number, lng as number)) return -1;
  const types = new Set(result.types || []);
  if (types.has('country')) return -1;
  if (types.size > 0 && [...types].every((t) => t === 'political' || t === 'administrative_area_level_1')) {
    return -1;
  }
  let score = 0;
  if (types.has('street_address') || types.has('premise') || types.has('subpremise') || types.has('route')) score += 50;
  if (types.has('establishment') || types.has('point_of_interest') || types.has('lodging')) score += 40;
  if (types.has('neighborhood') || types.has('sublocality')) score += 8;
  if (result.partial_match) score -= 12;
  const latN = lat as number;
  const lngN = lng as number;
  if (latN > 5.45 && latN < 5.9 && lngN > -0.55 && lngN < 0.15) score += 15;
  return score;
}

function toPlace(result: GoogleGeocodeResult): GooglePlace | null {
  const lat = result.geometry?.location?.lat;
  const lng = result.geometry?.location?.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (resultScore(result) < 0) return null;
  const parts = result.address_components;
  const streetNumber = component(parts, 'street_number');
  const route = component(parts, 'route');
  const street = [streetNumber, route].filter(Boolean).join(' ');
  const area =
    component(parts, 'neighborhood') ||
    component(parts, 'sublocality_level_1') ||
    component(parts, 'sublocality');
  const city = component(parts, 'locality') || component(parts, 'administrative_area_level_2');
  const region = component(parts, 'administrative_area_level_1');
  const shortBits = [street, area, city].filter((p, i, arr): p is string => !!p && arr.indexOf(p) === i);
  const label = result.formatted_address || shortBits.join(', ') || `${lat}, ${lng}`;
  // Keep the place name Google returns ("BlueCrest University College, 28 Cola St, Accra")
  // instead of collapsing a street down to its district ("Ayawaso").
  const cleaned = label
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && !/^ghana$/i.test(part) && !/region$/i.test(part));
  const shortLabel = (cleaned.length ? cleaned : shortBits).slice(0, 3).join(', ');
  if (!shortLabel || shortLabel.toLowerCase() === 'ghana') return null;
  return {
    label,
    shortLabel,
    point: { lat: lat as number, lng: lng as number },
    city: city || area || undefined,
    region: region || undefined,
  };
}

async function geocodeOnce(query: string, key: string, withBounds: boolean): Promise<GoogleGeocodeResult[]> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', query);
  url.searchParams.set('region', 'gh');
  url.searchParams.set('components', 'country:GH');
  if (withBounds) url.searchParams.set('bounds', ACCRA_BOUNDS);
  url.searchParams.set('key', key);
  const res = await googleFetch(url.toString());
  if (!res.ok) return [];
  const data = await res.json();
  if (data.status !== 'OK' || !Array.isArray(data.results)) return [];
  return data.results as GoogleGeocodeResult[];
}

function rankPlaces(results: GoogleGeocodeResult[], limit: number): GooglePlace[] {
  return results
    .map((result) => ({ result, score: resultScore(result) }))
    .filter((row) => row.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((row) => toPlace(row.result))
    .filter((place): place is GooglePlace => place !== null)
    .slice(0, limit);
}

export async function googleGeocode(query: string, limit = 5): Promise<GooglePlace[]> {
  const key = googleKey();
  const q = query.trim();
  if (!key || !q) return [];
  try {
    const mentionsCity = /accra|tema|kumasi|takoradi|kasoa|cape coast|legon|madina|spintex/i.test(q);
    const primary = await geocodeOnce(q, key, true);
    let pool = primary;
    const best = primary.reduce((max, result) => Math.max(max, resultScore(result)), -1);
    // A weak or country-level hit (e.g. "Bluecrest Hostel" → Ghana) gets a second
    // pass pinned to Accra before we give up.
    if (best < 45 && !mentionsCity) {
      pool = [...primary, ...(await geocodeOnce(`${q}, Accra, Ghana`, key, true))];
    }
    let ranked = rankPlaces(pool, limit);
    if (ranked.length === 0 && !mentionsCity) {
      ranked = rankPlaces(await geocodeOnce(`${q}, Ghana`, key, false), limit);
    }
    return ranked;
  } catch {
    return [];
  }
}

export async function googleReverseGeocode(lat: number, lng: number): Promise<GooglePlace | null> {
  const key = googleKey();
  if (!key) return null;
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('latlng', `${lat},${lng}`);
  url.searchParams.set('result_type', 'street_address|route|neighborhood|sublocality|locality');
  url.searchParams.set('key', key);
  try {
    const res = await googleFetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 'OK' || !Array.isArray(data.results) || !data.results[0]) return null;
    return toPlace(data.results[0]);
  } catch {
    return null;
  }
}

function metersToKm(meters: number): number | null {
  if (!Number.isFinite(meters) || meters <= 0) return null;
  return Math.max(0.5, Math.round((meters / 1000) * 10) / 10);
}

/** Legacy Distance Matrix — many new Google projects no longer enable this. */
async function drivingKmViaDistanceMatrix(origin: LatLng, dest: LatLng, key: string): Promise<number | null> {
  const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
  url.searchParams.set('origins', `${origin.lat},${origin.lng}`);
  url.searchParams.set('destinations', `${dest.lat},${dest.lng}`);
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('units', 'metric');
  url.searchParams.set('region', 'gh');
  url.searchParams.set('key', key);
  try {
    const res = await googleFetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    const el = data?.rows?.[0]?.elements?.[0];
    if (data.status !== 'OK' || el?.status !== 'OK') return null;
    return metersToKm(Number(el.distance?.value));
  } catch {
    return null;
  }
}

/**
 * Routes API (current Google product). Used when Distance Matrix legacy is off.
 * Needs Routes API enabled on the Cloud project and allowed on the key.
 */
async function drivingKmViaRoutes(origin: LatLng, dest: LatLng, key: string): Promise<number | null> {
  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'routes.distanceMeters',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: { location: { latLng: { latitude: dest.lat, longitude: dest.lng } } },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return metersToKm(Number(data?.routes?.[0]?.distanceMeters));
  } catch {
    return null;
  }
}

/** Driving kilometres from origin → destination (Google, then null for OSRM fallback). */
export async function googleDrivingKm(origin: LatLng, dest: LatLng): Promise<number | null> {
  const key = googleKey();
  if (!key) return null;
  return (
    (await drivingKmViaDistanceMatrix(origin, dest, key)) ??
    (await drivingKmViaRoutes(origin, dest, key))
  );
}
