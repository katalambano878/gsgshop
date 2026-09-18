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

/** Driving kilometres from origin → destination via Distance Matrix. */
export async function googleDrivingKm(origin: LatLng, dest: LatLng): Promise<number | null> {
  const key = googleKey();
  if (!key) return null;
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
    const meters = el.distance?.value;
    if (!Number.isFinite(meters) || meters <= 0) return null;
    return Math.max(0.5, Math.round((meters / 1000) * 10) / 10);
  } catch {
    return null;
  }
}
