import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';
import {
  distanceFromHubKm,
  estimateRoadKm,
  haversineKm,
  searchPopularPlaces,
  type LatLng,
} from '@/lib/delivery-hub';
import { getDeliverySettings } from '@/lib/delivery-settings';
import {
  googleDrivingKm,
  googleGeocode,
  googleReverseGeocode,
  hasGoogleMapsKey,
} from '@/lib/google-maps-delivery';

/**
 * POST /api/delivery/distance
 * Body: { query?: string; lat?: number; lng?: number; reverse?: boolean }
 *
 * Resolves a Ghana location and returns road distance (km) from the GSG East Legon hub.
 *
 * GET /api/delivery/distance?q=...
 * Returns popular + Nominatim suggestions for the picker.
 */

const NOMINATIM_UA =
  'GSGShopDelivery/1.0 (goods.gsgbrands.com.gh; delivery distance)';

/** Greater Accra-ish viewbox (west,north,east,south) for Nominatim bias */
const ACCRA_VIEWBOX = '-0.45,5.85,0.15,5.40';

type NominatimAddress = {
  amenity?: string;
  shop?: string;
  building?: string;
  road?: string;
  neighbourhood?: string;
  quarter?: string;
  residential?: string;
  suburb?: string;
  village?: string;
  town?: string;
  city?: string;
  county?: string;
  state?: string;
};

type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  type?: string;
  class?: string;
  address?: NominatimAddress;
};

type GeoHit = {
  label: string;
  shortLabel: string;
  point: LatLng;
  city?: string;
  region?: string;
};

/** External calls must never hang the customer's UI. */
const EXTERNAL_TIMEOUT_MS = 6500;
const externalFetch = (url: string, headers: Record<string, string>) =>
  fetch(url, {
    headers,
    next: { revalidate: 0 },
    signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS),
  });

/**
 * "La Road, Kaajaanor, La, Accra, La-Dade-Kotopon Municipal District, Greater
 * Accra Region, GD-110-6313, Ghana" → "La Road, La, Accra".
 */
function buildShortLabel(hit: NominatimResult, opts: { includePlace?: boolean } = {}): string {
  const a = hit.address || {};
  // For a dropped pin we skip nearby POIs (an ATM is not the customer's house).
  const place = opts.includePlace === false ? undefined : hit.name || a.amenity || a.shop || a.building;
  const street = a.road;
  const area = a.neighbourhood || a.quarter || a.residential || a.suburb || a.village;
  const city = a.city || a.town || a.county;
  const parts = [place, street, area, city].filter(
    (p, i, arr): p is string => !!p && arr.indexOf(p) === i
  );
  if (parts.length >= 2) return parts.slice(0, 3).join(', ');
  return hit.display_name.split(',').slice(0, 3).map((s) => s.trim()).join(', ');
}

function hitToGeo(hit: NominatimResult, opts: { includePlace?: boolean } = {}): GeoHit | null {
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    label: hit.display_name,
    shortLabel: buildShortLabel(hit, opts),
    point: { lat, lng },
    city: hit.address?.suburb || hit.address?.city || hit.address?.town || undefined,
    region: hit.address?.state || hit.address?.county || undefined,
  };
}

async function nominatimSearch(query: string, limit = 5): Promise<GeoHit[]> {
  const attempts = [
    { q: query, countrycodes: 'gh', viewbox: ACCRA_VIEWBOX, bounded: '0' },
    { q: `${query}, Accra, Ghana`, countrycodes: 'gh', viewbox: ACCRA_VIEWBOX, bounded: '0' },
    { q: `${query}, Ghana`, countrycodes: 'gh' },
    { q: query }, // last resort — no country filter (matches escrow behaviour)
  ];

  for (const attempt of attempts) {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', attempt.q);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('addressdetails', '1');
    if (attempt.countrycodes) url.searchParams.set('countrycodes', attempt.countrycodes);
    if (attempt.viewbox) {
      url.searchParams.set('viewbox', attempt.viewbox);
      url.searchParams.set('bounded', attempt.bounded || '0');
    }

    try {
      const res = await externalFetch(url.toString(), {
        'User-Agent': NOMINATIM_UA,
        Accept: 'application/json',
      });
      if (!res.ok) continue;
      const data = (await res.json()) as NominatimResult[];
      if (!Array.isArray(data) || data.length === 0) continue;
      const hits = data.map((h) => hitToGeo(h)).filter((h): h is GeoHit => h !== null);
      if (hits.length > 0) return hits;
    } catch {
      continue;
    }
  }
  return [];
}

/** Street-level (zoom 18) reverse geocode for a dropped pin. */
async function reverseGeocode(lat: number, lng: number): Promise<GeoHit | null> {
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('zoom', '18');

  try {
    const res = await externalFetch(url.toString(), {
      'User-Agent': NOMINATIM_UA,
      Accept: 'application/json',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as NominatimResult & { error?: string };
    if (data.error || !data.display_name) return null;
    return hitToGeo({ ...data, lat: String(lat), lon: String(lng) }, { includePlace: false });
  } catch {
    return null;
  }
}

async function roadKmViaOsrm(dest: LatLng, hub: LatLng): Promise<number | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${hub.lng},${hub.lat};${dest.lng},${dest.lat}?overview=false`;
    const res = await externalFetch(url, { Accept: 'application/json' });
    if (!res.ok) return null;
    const data = await res.json();
    const meters = data?.routes?.[0]?.distance;
    if (!Number.isFinite(meters) || meters <= 0) return null;
    return Math.max(0.5, Math.round((meters / 1000) * 10) / 10);
  } catch {
    return null;
  }
}

/** Google Distance Matrix first (when keyed), then OSRM. */
async function roadKm(dest: LatLng, hub: LatLng): Promise<number | null> {
  const googleKm = await googleDrivingKm(hub, dest);
  if (googleKm != null) return googleKm;
  return roadKmViaOsrm(dest, hub);
}

type ResolveInput = {
  point: LatLng;
  label: string;
  shortLabel?: string;
  city?: string | null;
  region?: string | null;
  source: 'popular' | 'geocode' | 'coords';
  /** Pass a pre-started routing promise to overlap it with geocoding. */
  kmPromise?: Promise<number | null>;
};

async function resolveDistance(input: ResolveInput) {
  const { hub } = await getDeliverySettings();
  const routedKm = await (input.kmPromise ?? roadKm(input.point, hub));
  const km = routedKm ?? estimateRoadKm(haversineKm(hub, input.point));
  const method = routedKm != null ? 'road' : 'estimated';

  if (km > 500) {
    return NextResponse.json(
      {
        success: false,
        message: 'That location looks too far for our delivery zones. Please check the place name.',
      },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success: true,
    km,
    label: input.label,
    shortLabel: input.shortLabel || input.label.split(',').slice(0, 2).map((s) => s.trim()).join(', '),
    city: input.city ?? null,
    region: input.region ?? null,
    lat: input.point.lat,
    lng: input.point.lng,
    source: input.source,
    method,
    hub: hub.label,
    straightKm: Math.round(haversineKm(hub, input.point) * 10) / 10,
    fallbackKm: distanceFromHubKm(input.point, hub),
  });
}

export async function POST(req: Request) {
  try {
    const clientId = getClientIdentifier(req);
    // Generous limit: every map tap / pin drag fires one request, so a
    // customer exploring the map can easily send a burst of these.
    const rate = checkRateLimit(`delivery-distance:${clientId}`, {
      maxRequests: 40,
      windowSeconds: 60,
    });
    if (!rate.success) {
      return NextResponse.json(
        { success: false, message: 'Too many requests. Please try again shortly.' },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
    const wantReverse = Boolean(body.reverse);

    if (!query && !hasCoords) {
      return NextResponse.json(
        { success: false, message: 'Enter a location name so we can calculate the delivery distance.' },
        { status: 400 }
      );
    }

    // Pin / GPS path — most reliable. Sanity-check the pin is in/near Ghana.
    if (hasCoords) {
      if (lat < 4 || lat > 12 || lng < -4 || lng > 2) {
        return NextResponse.json(
          { success: false, message: 'That location is outside our delivery area (Ghana).' },
          { status: 400 }
        );
      }
      const point = { lat, lng };
      const { hub } = await getDeliverySettings();
      // Start routing immediately; reverse-geocode in parallel.
      const kmPromise = roadKm(point, hub);
      const rev =
        wantReverse || !query
          ? (await googleReverseGeocode(lat, lng)) || (await reverseGeocode(lat, lng))
          : null;

      return resolveDistance({
        point,
        label: rev?.label || query || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        shortLabel: rev?.shortLabel || query || undefined,
        city: rev?.city || null,
        region: rev?.region || null,
        source: 'coords',
        kmPromise,
      });
    }

    // Text search: popular list → Nominatim (multi-strategy)
    const popularHits = searchPopularPlaces(query, 5);
    const qLower = query.toLowerCase();
    const exact = popularHits.find(
      (p) => p.name.toLowerCase() === qLower || p.area.toLowerCase() === qLower
    );
    const starts = popularHits.find(
      (p) =>
        p.name.toLowerCase().startsWith(qLower) ||
        p.area.toLowerCase().startsWith(qLower)
    );
    const match = exact || starts || null;

    if (match) {
      return resolveDistance({
        point: { lat: match.lat, lng: match.lng },
        label: `${match.name}, ${match.city}`,
        shortLabel: `${match.name}, ${match.city}`,
        city: match.city,
        region: match.region,
        source: 'popular',
      });
    }

    const googleHits = hasGoogleMapsKey() ? await googleGeocode(query, 1) : [];
    const geoHits = googleHits.length > 0 ? googleHits : await nominatimSearch(query, 1);
    if (geoHits.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message:
            'We could not find that name. Try a nearby area (e.g. Madina, Spintex) or use your current location.',
        },
        { status: 404 }
      );
    }

    const geo = geoHits[0];
    return resolveDistance({
      point: geo.point,
      label: geo.label,
      shortLabel: geo.shortLabel,
      city: geo.city,
      region: geo.region,
      source: 'geocode',
    });
  } catch (err: any) {
    console.error('[delivery/distance]', err?.message || err);
    return NextResponse.json({ success: false, message: 'Could not calculate distance' }, { status: 500 });
  }
}

/** GET — popular + live geocode suggestions for the location picker */
export async function GET(req: Request) {
  const clientId = getClientIdentifier(req);
  const rate = checkRateLimit(`delivery-suggest:${clientId}`, {
    maxRequests: 60,
    windowSeconds: 60,
  });
  if (!rate.success) {
    return NextResponse.json({ success: false, suggestions: [] }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').trim();
  const { hub } = await getDeliverySettings();

  type SuggestionRow = {
    id: string;
    name: string;
    subtitle: string;
    city: string;
    region: string;
    lat: number;
    lng: number;
    km: number;
    source: 'popular' | 'geocode';
  };

  const popular: SuggestionRow[] = searchPopularPlaces(q, 6).map((p) => ({
    id: p.id,
    name: p.name,
    subtitle: `${p.city}, ${p.region}`,
    city: p.city,
    region: p.region,
    lat: p.lat,
    lng: p.lng,
    km: distanceFromHubKm({ lat: p.lat, lng: p.lng }, hub),
    source: 'popular',
  }));

  let geoSuggestions: SuggestionRow[] = [];
  if (q.length >= 3) {
    const googleHits = hasGoogleMapsKey() ? await googleGeocode(q, 5) : [];
    const hits = googleHits.length > 0 ? googleHits : await nominatimSearch(q, 5);
    geoSuggestions = hits.map((h, i) => ({
      id: `geo-${i}-${h.point.lat.toFixed(4)}-${h.point.lng.toFixed(4)}`,
      name: h.shortLabel.split(',')[0]?.trim() || h.label,
      subtitle: h.shortLabel.split(',').slice(1).join(',').trim() || h.region || 'Ghana',
      city: h.city || '',
      region: h.region || '',
      lat: h.point.lat,
      lng: h.point.lng,
      km: distanceFromHubKm(h.point, hub),
      source: 'geocode',
    }));
  }

  // Dedupe by rounded lat/lng AND by place name (popular list wins),
  // so e.g. "Osu" doesn't show twice with slightly different coordinates.
  const seenPoint = new Set<string>();
  const seenName = new Set<string>();
  const suggestions = [...popular, ...geoSuggestions].filter((s) => {
    const pointKey = `${s.lat.toFixed(3)},${s.lng.toFixed(3)}`;
    const nameKey = s.name.trim().toLowerCase();
    if (seenPoint.has(pointKey) || seenName.has(nameKey)) return false;
    seenPoint.add(pointKey);
    seenName.add(nameKey);
    return true;
  }).slice(0, 10);

  return NextResponse.json({ success: true, suggestions, hub: hub.label });
}
