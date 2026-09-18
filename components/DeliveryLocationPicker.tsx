'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { GSG_HUB, POPULAR_DELIVERY_PLACES } from '@/lib/delivery-hub';

/**
 * Delivery location — name only, no visual map.
 *
 * Customer types an area / landmark (or taps a common Accra area, or GPS).
 * The server geocodes it and returns driving km from the GSG hub, which
 * the parent uses for Sole / Joint Express fees.
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
};

type DeliveryLocationPickerProps = {
  valueKm: string;
  onDistanceChange: (km: string, meta?: DeliveryLocationResult) => void;
  onPlaceFill?: (fields: { city?: string; region?: string; addressHint?: string }) => void;
  error?: string;
};

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

const FETCH_TIMEOUT_MS = 9000;
const QUICK_AREAS = POPULAR_DELIVERY_PLACES.filter((p) =>
  ['east-legon', 'osu', 'madina', 'spintex', 'tema', 'kasoa', 'dansoman', 'achimota', 'airport', 'accra-central'].includes(p.id)
);

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
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [locating, setLocating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [hubLabel, setHubLabel] = useState(GSG_HUB.label);
  const [selected, setSelected] = useState<{
    label: string;
    shortLabel: string;
    km: number;
    lat: number;
    lng: number;
    method: 'road' | 'estimated';
  } | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const reqIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef({ onDistanceChange, onPlaceFill });
  useEffect(() => {
    callbacksRef.current = { onDistanceChange, onPlaceFill };
  });

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

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
          if (data.hub) setHubLabel(data.hub);
        }
      } catch {
        /* suggestions are optional */
      } finally {
        setSuggesting(false);
      }
    }, 260);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const applyResult = (data: DistanceResponse) => {
    const km = Math.round(data.km * 10) / 10;
    const shortLabel = data.shortLabel || data.label.split(',').slice(0, 2).join(',').trim();
    setSelected({
      label: data.label,
      shortLabel,
      km,
      lat: data.lat,
      lng: data.lng,
      method: data.method === 'estimated' ? 'estimated' : 'road',
    });
    setStatus(null);
    if (data.hub) setHubLabel(data.hub);
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

  const resolve = async (body: Record<string, unknown>) => {
    const reqId = ++reqIdRef.current;
    setCalculating(true);
    setStatus(null);
    setOpen(false);
    try {
      const res = await fetchWithTimeout('/api/delivery/distance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as DistanceResponse;
      if (reqId !== reqIdRef.current) return;
      if (!res.ok || !data.success) {
        setStatus(data.message || 'We could not find that location. Try a nearby area name.');
        return;
      }
      applyResult(data);
      setQuery(data.shortLabel || data.label.split(',')[0]?.trim() || query);
    } catch {
      if (reqId === reqIdRef.current) setStatus('Network hiccup. Please try again.');
    } finally {
      if (reqId === reqIdRef.current) setCalculating(false);
    }
  };

  const pickSuggestion = (s: Suggestion) => {
    setQuery(s.name);
    void resolve({ lat: s.lat, lng: s.lng, query: `${s.name}, ${s.city}`, reverse: false });
  };

  const searchByText = async () => {
    const q = query.trim();
    if (!q) {
      setStatus('Type your area or landmark — for example East Legon, Spintex, or Accra Mall.');
      return;
    }
    if (suggestions[0]) {
      pickSuggestion(suggestions[0]);
      return;
    }
    await resolve({ query: q });
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setStatus('GPS is not available on this device. Type your area name instead.');
      return;
    }
    setLocating(true);
    setStatus(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        void resolve({
          lat: +pos.coords.latitude.toFixed(6),
          lng: +pos.coords.longitude.toFixed(6),
          reverse: true,
        });
      },
      (err) => {
        setLocating(false);
        setStatus(
          err.code === err.PERMISSION_DENIED
            ? 'Location access was blocked. Type your area name instead.'
            : 'Could not read your location. Type your area name instead.'
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
    callbacksRef.current.onDistanceChange('');
  };

  const kmNum = parseFloat(valueKm);
  const hasDistance = Number.isFinite(kmNum) && kmNum > 0;
  const hubShort = hubLabel.replace(/^GSG Hub\s*[—-]\s*/i, '');

  return (
    <div ref={wrapRef} className="space-y-3">
      <div>
        <label htmlFor={`${listId}-input`} className="block text-sm font-bold text-gray-700 mb-1">
          Delivery location <span className="text-red-500">*</span>
        </label>
        <p className="text-xs text-gray-500 mb-3 text-pretty">
          Type your area or landmark. We&apos;ll work out the driving distance from our Accra hub.
        </p>

        <div
          className={`overflow-hidden rounded-2xl border bg-white shadow-[0_8px_30px_rgba(107,33,168,0.08)] ${
            error ? 'border-red-300' : 'border-purple-100'
          }`}
        >
          <div className="p-3 sm:p-4 space-y-3">
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
                  placeholder="e.g. East Legon, Spintex, Accra Mall"
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
                          <span className="shrink-0 tabular-nums text-xs font-bold text-gray-500">~{s.km} km</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                type="button"
                onClick={() => void searchByText()}
                disabled={calculating}
                className="shrink-0 px-4 py-3 rounded-xl bg-gsg-purple text-white font-bold text-sm hover:bg-gsg-purple-dark transition-colors disabled:opacity-60"
              >
                {calculating ? <i className="ri-loader-4-line animate-spin" /> : 'Find'}
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {QUICK_AREAS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setQuery(p.name);
                    void resolve({ lat: p.lat, lng: p.lng, query: `${p.name}, ${p.city}`, reverse: false });
                  }}
                  className="px-2.5 py-1 rounded-full border border-purple-100 bg-purple-50/70 text-[11px] font-semibold text-gsg-purple hover:bg-purple-100 transition-colors"
                >
                  {p.name}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={useMyLocation}
              disabled={locating || calculating}
              className="text-xs font-semibold text-gsg-purple hover:underline disabled:opacity-60 inline-flex items-center gap-1"
            >
              {locating ? <i className="ri-loader-4-line animate-spin" /> : <i className="ri-crosshair-2-line" />}
              Use my current location
            </button>

            {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
            {status && (
              <p className="text-xs text-amber-900 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 flex items-start gap-2">
                <i className="ri-error-warning-line mt-px" />
                <span>{status}</span>
              </p>
            )}
          </div>

          {hasDistance && selected ? (
            <div className="border-t border-green-100 bg-green-50/90 px-4 py-3.5">
              <div className="flex items-start gap-3">
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
                  <p className="text-xs text-green-800/80 mt-0.5 text-pretty">{selected.shortLabel}</p>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${selected.lat},${selected.lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] font-semibold text-green-900 underline underline-offset-2"
                    >
                      Open in Google Maps
                    </a>
                    <button
                      type="button"
                      onClick={reset}
                      className="text-[11px] font-semibold text-green-900 underline underline-offset-2"
                    >
                      Change location
                    </button>
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
