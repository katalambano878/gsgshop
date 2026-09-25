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

function toPlace(result: {
  formatted_address?: string;
  address_components?: Array<{ long_name: string; types: string[] }>;
  geometry?: { location?: { lat: number; lng: number } };
}): GooglePlace | null {
  const lat = result.geometry?.location?.lat;
  const lng = result.geometry?.location?.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const parts = result.address_components;
  const city =
    component(parts, 'sublocality') ||
    component(parts, 'sublocality_level_1') ||
    component(parts, 'locality') ||
    component(parts, 'administrative_area_level_2');
  const region = component(parts, 'administrative_area_level_1');
  const neighbourhood = component(parts, 'neighborhood') || component(parts, 'sublocality');
  const route = component(parts, 'route');
  const shortBits = [neighbourhood || route, city].filter((p, i, arr): p is string => !!p && arr.indexOf(p) === i);
  const label = result.formatted_address || shortBits.join(', ') || `${lat}, ${lng}`;
  return {
    label,
    shortLabel: shortBits.length ? shortBits.join(', ') : label.split(',').slice(0, 2).map((s) => s.trim()).join(', '),
    point: { lat: lat as number, lng: lng as number },
    city: city || undefined,
    region: region || undefined,
  };
}

export async function googleGeocode(query: string, limit = 5): Promise<GooglePlace[]> {
  const key = googleKey();
  if (!key || !query.trim()) return [];
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', query);
  url.searchParams.set('region', 'gh');
  url.searchParams.set('components', 'country:GH');
  url.searchParams.set('key', key);
  try {
    const res = await googleFetch(url.toString());
    if (!res.ok) return [];
    const data = await res.json();
    if (data.status !== 'OK' || !Array.isArray(data.results)) return [];
    return data.results.map(toPlace).filter((p: GooglePlace | null): p is GooglePlace => p !== null).slice(0, limit);
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
