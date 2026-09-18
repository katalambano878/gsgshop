'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type {
  Map as LeafletMap,
  Marker as LeafletMarker,
  Polyline as LeafletPolyline,
  LatLngExpression,
} from 'leaflet';
import { GSG_HUB } from '@/lib/delivery-hub';

/**
 * DeliveryLocationPicker
 *
 * One job: get the customer's delivery point as (lat, lng) and turn it into
 * a road distance from the GSG hub — the number the delivery fee is built on.
 *
 * Flow (kept deliberately simple):
 *   1. Type an area / landmark and pick a suggestion, OR press "Use my GPS",
 *      OR tap anywhere on the map.
 *   2. A purple pin drops there. Drag it to fine-tune. The line to the hub and
 *      the km badge update live; the parent gets the km via onDistanceChange.
 *
 * Engineering notes:
 *   - Parent callbacks are read through a ref so Leaflet listeners (bound once)
 *     never go stale and parent re-renders never touch the map (no snap-back).
 *   - Tapping / dragging never re-centers or re-zooms the map. Only a search
 *     result or GPS fix moves the viewport (fit hub + pin).
 *   - No third-party marker images: icons are inline SVG divIcons.
 */

export type DeliveryLocationResult = {
  km: number;
  label: string;
  city?: string | null;
  region?: string | null;
  lat?: number;
  lng?: number;
};

type Suggestion = {
  id: string;
  name: string;
  subtitle: string;
  city: string;
  region: string;
  lat: number;
  lng: number;
  km: number;
  source?: 'popular' | 'geocode';
};

type DeliveryLocationPickerProps = {
  valueKm: string;
  onDistanceChange: (km: string, meta?: DeliveryLocationResult) => void;
  onPlaceFill?: (fields: { city?: string; region?: string; addressHint?: string }) => void;
  error?: string;
};

type Point = { lat: number; lng: number };
type Hub = Point & { label: string };

type DistanceResponse = {
  success: boolean;
  message?: string;
  km: number;
  label: string;
  shortLabel?: string;
  city?: string | null;
  region?: string | null;
  lat: number;
  lng: number;
  method?: 'road' | 'estimated';
  hub?: string;
};

const BRAND = '#6B21A8';
const FETCH_TIMEOUT_MS = 9000;

// Leaflet is loaded once per page and shared across picker instances.
let leafletPromise: Promise<typeof import('leaflet')> | null = null;
const loadLeaflet = () => (leafletPromise ??= import('leaflet'));

const hubIconHtml = `
  <div style="display:flex;flex-direction:column;align-items:center;">
    <div style="background:${BRAND};color:#fff;font:700 10px/1 system-ui,sans-serif;letter-spacing:.04em;padding:5px 7px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.25);white-space:nowrap;">GSG HUB</div>
    <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid ${BRAND};"></div>
  </div>`;

const pinIconHtml = `
  <svg width="36" height="46" viewBox="0 0 36 46" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 3px 4px rgba(0,0,0,.35));">
    <path d="M18 1C9.2 1 2 8.1 2 16.9 2 28.6 18 45 18 45S34 28.6 34 16.9C34 8.1 26.8 1 18 1z" fill="${BRAND}" stroke="#fff" stroke-width="2"/>
    <circle cx="18" cy="17" r="6" fill="#fff"/>
  </svg>`;

function fetchWithTimeout(input: RequestInfo, init: RequestInit = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(t));
}

export default function DeliveryLocationPicker({
  valueKm,
  onDistanceChange,
  onPlaceFill,
  error,
}: DeliveryLocationPickerProps) {
  const listId = useId();

  // ---- UI state -----------------------------------------------------------
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [locating, setLocating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [hub, setHub] = useState<Hub>(GSG_HUB);
  const [selected, setSelected] = useState<{
    point: Point;
    label: string;
    shortLabel: string;
    km: number;
    method: 'road' | 'estimated';
  } | null>(null);

  // ---- refs (Leaflet objects + latest callbacks) ---------------------------
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapElRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const pinRef = useRef<LeafletMarker | null>(null);
  const lineRef = useRef<LeafletPolyline | null>(null);
  const hubMarkerRef = useRef<LeafletMarker | null>(null);
  const hubRef = useRef<Hub>(GSG_HUB);
  const reqIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const callbacksRef = useRef({ onDistanceChange, onPlaceFill });
  useEffect(() => {
    callbacksRef.current = { onDistanceChange, onPlaceFill };
  });

  // ---- close suggestions on outside click ----------------------------------
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // ---- live suggestions ----------------------------------------------------
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setSuggesting(false);
      return;
    }
    setSuggesting(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetchWithTimeout(`/api/delivery/distance?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (data.success) {
          setSuggestions(data.suggestions || []);
          setOpen(true);
        }
      } catch {
        // suggestions are optional — map / GPS still work
      } finally {
        setSuggesting(false);
      }
    }, 260);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // ---- map drawing helpers (imperative, never trigger React re-renders) ----
  const drawRoute = async (point: Point) => {
    const L = await loadLeaflet();
    const map = mapRef.current;
    if (!map) return;
    const hubPt: LatLngExpression = [hubRef.current.lat, hubRef.current.lng];
    const pinPt: LatLngExpression = [point.lat, point.lng];
    if (!lineRef.current) {
      lineRef.current = L.polyline([hubPt, pinPt], {
        color: BRAND,
        weight: 3,
        opacity: 0.75,
        dashArray: '6 8',
        lineCap: 'round',
      }).addTo(map);
    } else {
      lineRef.current.setLatLngs([hubPt, pinPt]);
    }
  };

  const setRouteLabel = (text: string | null) => {
    const line = lineRef.current;
    if (!line) return;
    line.unbindTooltip();
    if (text) {
      line.bindTooltip(text, {
        permanent: true,
        direction: 'center',
        className: 'gsg-route-tooltip',
        opacity: 1,
      });
    }
  };

  const fitHubAndPin = async (point: Point) => {
    const L = await loadLeaflet();
    const map = mapRef.current;
    if (!map) return;
    const bounds = L.latLngBounds(
      [hubRef.current.lat, hubRef.current.lng],
      [point.lat, point.lng]
    );
    // Far away (out-of-town) → just focus the pin; else show hub + pin together.
    const farKm = map.distance(bounds.getNorthEast(), bounds.getSouthWest()) / 1000;
    if (farKm > 70) {
      map.flyTo([point.lat, point.lng], 13, { duration: 0.6 });
    } else {
      map.flyToBounds(bounds, { padding: [48, 48], maxZoom: 15, duration: 0.6 });
    }
  };

  /** Place or move the delivery pin. Never moves the viewport unless asked. */
  const placePin = async (point: Point, opts: { fit?: boolean } = {}) => {
    const L = await loadLeaflet();
    const map = mapRef.current;
    if (!map) return;
    if (!pinRef.current) {
      pinRef.current = L.marker([point.lat, point.lng], {
        draggable: true,
        autoPan: true,
        icon: L.divIcon({
          html: pinIconHtml,
          className: 'gsg-pin-icon',
          iconSize: [36, 46],
          iconAnchor: [18, 45],
        }),
        zIndexOffset: 1000,
        keyboard: false,
      }).addTo(map);
      pinRef.current.on('dragstart', () => setRouteLabel(null));
      pinRef.current.on('drag', () => {
        const p = pinRef.current!.getLatLng();
        void drawRoute({ lat: p.lat, lng: p.lng });
      });
      pinRef.current.on('dragend', () => {
        const p = pinRef.current!.getLatLng();
        void resolvePoint({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) });
      });
    } else {
      pinRef.current.setLatLng([point.lat, point.lng]);
    }
    await drawRoute(point);
    if (opts.fit) await fitHubAndPin(point);
  };

  const applyResult = (data: DistanceResponse) => {
    const km = Math.round(data.km * 10) / 10;
    const shortLabel = data.shortLabel || data.label.split(',').slice(0, 2).join(',').trim();
    setSelected({
      point: { lat: data.lat, lng: data.lng },
      label: data.label,
      shortLabel,
      km,
      method: data.method === 'estimated' ? 'estimated' : 'road',
    });
    setStatus(null);
    setRouteLabel(`${km.toFixed(1)} km`);
    callbacksRef.current.onDistanceChange(km.toString(), {
      km,
      label: data.label,
      city: data.city,
      region: data.region,
      lat: data.lat,
      lng: data.lng,
    });
    callbacksRef.current.onPlaceFill?.({
      city: data.city || undefined,
      region: data.region || undefined,
      addressHint: shortLabel,
    });
  };

  /** Ask the server for road km (and a friendly address) for a pin. */
  const resolvePoint = async (point: Point, labelHint?: string) => {
    const reqId = ++reqIdRef.current;
    setCalculating(true);
    setStatus(null);
    try {
      const res = await fetchWithTimeout('/api/delivery/distance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: point.lat, lng: point.lng, reverse: true, query: labelHint }),
      });
      const data = (await res.json()) as DistanceResponse;
      if (reqId !== reqIdRef.current) return;
      if (!res.ok || !data.success) {
        setStatus(data.message || 'Could not calculate the distance for this spot. Try again.');
        return;
      }
      applyResult(data);
    } catch {
      if (reqId === reqIdRef.current) {
        setStatus('Network hiccup while calculating. Please try again.');
      }
    } finally {
      if (reqId === reqIdRef.current) setCalculating(false);
    }
  };

  const dropPinAt = (point: Point, opts: { fit?: boolean; labelHint?: string } = {}) => {
    setOpen(false);
    void placePin(point, { fit: opts.fit });
    void resolvePoint(point, opts.labelHint);
  };

  // ---- map boot (once) -----------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let resizeObs: ResizeObserver | null = null;

    (async () => {
      // 1) live hub from admin settings (falls back to compiled default)
      try {
        const res = await fetchWithTimeout('/api/delivery/settings');
        const data = await res.json();
        const h = data?.settings?.hub;
        if (Number.isFinite(h?.lat) && Number.isFinite(h?.lng)) {
          hubRef.current = { lat: h.lat, lng: h.lng, label: h.label || GSG_HUB.label };
          if (!cancelled) setHub(hubRef.current);
        }
      } catch {
        /* keep default */
      }
      if (cancelled || !mapElRef.current || mapRef.current) return;

      // 2) Leaflet
      const L = await loadLeaflet();
      if (cancelled || !mapElRef.current || mapRef.current) return;

      const map = L.map(mapElRef.current, {
        center: [hubRef.current.lat, hubRef.current.lng],
        zoom: 12,
        zoomControl: false,
        attributionControl: true,
        scrollWheelZoom: false, // don't hijack page scrolling
        doubleClickZoom: true,
        tap: true,
      } as any);
      L.control.zoom({ position: 'topright' }).addTo(map);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);

      hubMarkerRef.current = L.marker([hubRef.current.lat, hubRef.current.lng], {
        icon: L.divIcon({
          html: hubIconHtml,
          className: 'gsg-hub-icon',
          iconSize: [64, 28],
          iconAnchor: [32, 28],
        }),
        interactive: false,
        keyboard: false,
      }).addTo(map);

      map.on('click', (e: { latlng: { lat: number; lng: number } }) => {
        dropPinAt({ lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) });
      });

      mapRef.current = map;
      setMapReady(true);
      setTimeout(() => map.invalidateSize(), 80);

      resizeObs = new ResizeObserver(() => map.invalidateSize());
      resizeObs.observe(mapElRef.current);
    })();

    return () => {
      cancelled = true;
      resizeObs?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      pinRef.current = null;
      lineRef.current = null;
      hubMarkerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once; handlers use refs
  }, []);

  // ---- user actions --------------------------------------------------------
  const pickSuggestion = (s: Suggestion) => {
    setQuery(s.name);
    dropPinAt({ lat: s.lat, lng: s.lng }, { fit: true, labelHint: `${s.name}, ${s.city}` });
  };

  const searchByText = async () => {
    const q = query.trim();
    if (!q) {
      setStatus('Type an area or landmark, or tap the map to drop your pin.');
      return;
    }
    if (suggestions[0]) {
      pickSuggestion(suggestions[0]);
      return;
    }
    setOpen(false);
    const reqId = ++reqIdRef.current;
    setCalculating(true);
    setStatus(null);
    try {
      const res = await fetchWithTimeout('/api/delivery/distance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      const data = (await res.json()) as DistanceResponse;
      if (reqId !== reqIdRef.current) return;
      if (!res.ok || !data.success) {
        setStatus(data.message || "We couldn't find that name. Tap your spot on the map instead.");
        return;
      }
      await placePin({ lat: data.lat, lng: data.lng }, { fit: true });
      applyResult(data);
    } catch {
      if (reqId === reqIdRef.current) setStatus('Network hiccup. Please try again.');
    } finally {
      if (reqId === reqIdRef.current) setCalculating(false);
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setStatus('GPS is not available on this device. Search or tap the map instead.');
      return;
    }
    setLocating(true);
    setStatus(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        dropPinAt(
          { lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6) },
          { fit: true }
        );
      },
      (err) => {
        setLocating(false);
        setStatus(
          err.code === err.PERMISSION_DENIED
            ? 'Location access was blocked. Allow it in your browser, or tap the map instead.'
            : 'Could not read your location. Tap your spot on the map instead.'
        );
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  };

  const reset = () => {
    reqIdRef.current++;
    setSelected(null);
    setQuery('');
    setStatus(null);
    setCalculating(false);
    pinRef.current?.remove();
    pinRef.current = null;
    lineRef.current?.remove();
    lineRef.current = null;
    mapRef.current?.flyTo([hubRef.current.lat, hubRef.current.lng], 12, { duration: 0.5 });
    callbacksRef.current.onDistanceChange('');
  };

  const kmNum = parseFloat(valueKm);
  const hasDistance = Number.isFinite(kmNum) && kmNum > 0;
  const hubShort = hub.label.replace(/^GSG Hub\s*[—-]\s*/i, '');

  // ---- render --------------------------------------------------------------
  return (
    <div ref={wrapRef} className="space-y-3">
      <div>
        <label htmlFor={`${listId}-input`} className="block text-sm font-bold text-gray-700 mb-1">
          Delivery location <span className="text-red-500">*</span>
        </label>
        <p className="text-xs text-gray-500 mb-3 text-pretty">
          Search your area, use GPS, or tap the map — then drag the pin to your exact spot.
        </p>

        <div
          className={`overflow-hidden rounded-2xl border bg-white shadow-[0_8px_30px_rgba(107,33,168,0.08)] ${
            error ? 'border-red-300' : 'border-purple-100'
          }`}
        >
          {/* Step 1 — find it */}
          <div className="p-3 sm:p-4 space-y-2.5 bg-gradient-to-b from-purple-50/70 to-white">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <i className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-gsg-purple text-lg pointer-events-none" />
                <input
                  id={`${listId}-input`}
                  type="text"
                  role="combobox"
                  aria-expanded={open}
                  aria-controls={listId}
                  aria-autocomplete="list"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onFocus={() => suggestions.length > 0 && setOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void searchByText();
                    } else if (e.key === 'Escape') {
                      setOpen(false);
                    }
                  }}
                  className={`w-full pl-11 pr-10 py-3 border rounded-xl bg-white focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple transition-all outline-none text-sm ${
                    error ? 'border-red-400' : 'border-gray-200'
                  }`}
                  placeholder="Search area or landmark"
                  autoComplete="off"
                  inputMode="search"
                />
                {suggesting && (
                  <i className="ri-loader-4-line animate-spin absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                )}
                {open && suggestions.length > 0 && (
                  <ul
                    id={listId}
                    role="listbox"
                    className="absolute z-30 mt-1.5 max-h-64 w-full overflow-auto rounded-xl border border-gray-100 bg-white shadow-xl shadow-purple-500/10"
                  >
                    {suggestions.map((s) => (
                      <li key={s.id} role="option" aria-selected={false}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pickSuggestion(s)}
                          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-purple-50 transition-colors"
                        >
                          <span className="min-w-0 flex items-start gap-2.5">
                            <i className="ri-map-pin-2-line text-gsg-purple mt-0.5" />
                            <span className="min-w-0">
                              <span className="block font-semibold text-gsg-black truncate">{s.name}</span>
                              <span className="block text-xs text-gray-500 truncate">{s.subtitle}</span>
                            </span>
                          </span>
                          <span className="shrink-0 tabular-nums text-xs font-bold text-gray-500">
                            ~{s.km} km
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                type="button"
                onClick={useMyLocation}
                disabled={locating || calculating}
                title="Use my current location"
                className="shrink-0 inline-flex items-center gap-1.5 px-3.5 sm:px-4 py-3 rounded-xl border border-gsg-purple/30 bg-white text-gsg-purple font-bold text-sm hover:bg-purple-50 transition-colors disabled:opacity-60"
              >
                {locating ? (
                  <i className="ri-loader-4-line animate-spin" />
                ) : (
                  <i className="ri-crosshair-2-line" />
                )}
                <span className="hidden sm:inline">Use my GPS</span>
                <span className="sm:hidden">GPS</span>
              </button>
            </div>

            {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
            {status && (
              <p className="text-xs text-amber-900 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 flex items-start gap-2">
                <i className="ri-error-warning-line mt-px" />
                <span>{status}</span>
              </p>
            )}
          </div>

          {/* Step 2 — the map */}
          <div className="relative border-t border-purple-100/80">
            <div
              ref={mapElRef}
              className="h-64 sm:h-72 w-full bg-gray-100 z-0 cursor-crosshair"
              aria-label="Delivery map. Tap to drop your pin, drag the pin to adjust."
            />

            {!mapReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-purple-50 to-gray-100 text-sm text-gray-500 z-10">
                <span className="inline-flex items-center gap-2">
                  <i className="ri-loader-4-line animate-spin text-gsg-purple" />
                  Loading map…
                </span>
              </div>
            )}

            {/* Guidance chip — bottom-left so it never covers the zoom control */}
            {mapReady && (
              <div className="pointer-events-none absolute left-3 bottom-8 z-[500] max-w-[75%]">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-white/95 backdrop-blur px-3 py-1.5 text-[11px] font-semibold text-gray-700 shadow-md border border-gray-100">
                  {calculating ? (
                    <>
                      <i className="ri-loader-4-line animate-spin text-gsg-purple" />
                      Calculating road distance…
                    </>
                  ) : selected ? (
                    <>
                      <i className="ri-drag-move-2-line text-gsg-purple" />
                      Drag the pin to fine-tune
                    </>
                  ) : (
                    <>
                      <i className="ri-map-pin-add-line text-gsg-purple" />
                      Tap the map to drop your pin
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Step 3 — result */}
          {hasDistance && selected ? (
            <div className="border-t border-green-100 bg-green-50/90 px-4 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex items-start gap-3">
                  <div className="shrink-0 w-9 h-9 rounded-full bg-green-600 text-white flex items-center justify-center">
                    <i className="ri-check-line text-lg" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-green-900 tabular-nums">
                      {kmNum.toFixed(1)} km from {hubShort.split(',')[0]}
                      {selected.method === 'estimated' && (
                        <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-green-800/70">
                          approx.
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-green-800/80 mt-0.5 line-clamp-2 text-pretty">
                      {selected.shortLabel}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${selected.point.lat},${selected.point.lng}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] font-semibold text-green-900 underline underline-offset-2"
                      >
                        Check pin in Google Maps
                      </a>
                      <button
                        type="button"
                        onClick={reset}
                        className="text-[11px] font-semibold text-green-900 underline underline-offset-2"
                      >
                        Start over
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            hasDistance && (
              <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-700 tabular-nums">
                Distance set manually: <strong>{kmNum.toFixed(1)} km</strong>
              </div>
            )
          )}
        </div>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowManual((v) => !v)}
          className="text-xs font-semibold text-gray-500 hover:text-gsg-purple"
        >
          {showManual ? 'Hide manual distance' : "Can't find it? Enter distance manually"}
        </button>
        {showManual && (
          <div className="mt-2 flex items-center gap-2">
            <label htmlFor={`${listId}-manual`} className="sr-only">
              Distance in km
            </label>
            <input
              id={`${listId}-manual`}
              type="number"
              min={0.1}
              step={0.1}
              inputMode="decimal"
              value={valueKm}
              onChange={(e) => {
                setSelected(null);
                setRouteLabel(null);
                callbacksRef.current.onDistanceChange(e.target.value);
              }}
              className="w-32 px-3 py-2.5 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple outline-none tabular-nums"
              placeholder="km"
            />
            <span className="text-xs text-gray-500">km from {hubShort.split(',')[0]}</span>
          </div>
        )}
      </div>
    </div>
  );
}
