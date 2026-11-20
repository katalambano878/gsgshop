'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_DELIVERY_PRICING,
  normalizeDeliveryPricing,
  type DeliveryPricingConfig,
} from '@/lib/delivery-pricing';

type Place = { label: string; lat?: number; lng?: number };

export type LiveDeliverySettings = {
  pricing: DeliveryPricingConfig;
  hub: Place | null;
  transportStation: Place | null;
  shopperMarkupPct: number | null;
};

// One request per page load, shared by every hook below. A failed request is
// forgotten so the next caller (or a retry) asks again.
let pending: Promise<LiveDeliverySettings> | null = null;

function fetchSettings(): Promise<LiveDeliverySettings> {
  if (!pending) {
    pending = fetch('/api/delivery/settings', { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const s = data?.success ? data.settings : null;
        if (!s?.pricing) throw new Error('No delivery settings');
        const place = (p: any): Place | null =>
          p && typeof p.label === 'string' ? { label: p.label, lat: Number(p.lat), lng: Number(p.lng) } : null;
        const markup = Number(s.shopperMarkupPct);
        return {
          pricing: normalizeDeliveryPricing(s.pricing),
          hub: place(s.hub),
          transportStation: place(s.transportStation),
          shopperMarkupPct: Number.isFinite(markup) ? markup : null,
        };
      })
      .catch((err) => {
        pending = null;
        throw err;
      });
  }
  return pending;
}

/**
 * Live delivery settings with their loading state. Checkout keeps Pay
 * disabled until `loaded` is true, so the fee shown always uses the same
 * settings the server charges with.
 */
export function useDeliverySettings(): {
  settings: LiveDeliverySettings | null;
  loaded: boolean;
  failed: boolean;
  retry: () => void;
} {
  const [settings, setSettings] = useState<LiveDeliverySettings | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    fetchSettings()
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { settings, loaded: settings !== null, failed, retry };
}

/**
 * Live delivery pricing config from admin settings. Returns the published
 * defaults until the fetch resolves; callers that charge money should use
 * useDeliverySettings() and wait for `loaded`.
 */
export function useDeliveryPricing(): DeliveryPricingConfig {
  const { settings } = useDeliverySettings();
  return settings?.pricing ?? DEFAULT_DELIVERY_PRICING;
}

/**
 * Personal Shopper markup percent from admin settings, or null until the
 * live value has loaded (so no hard-coded percentage is ever shown).
 */
export function useShopperMarkupSetting(): number | null {
  const { settings } = useDeliverySettings();
  return settings?.shopperMarkupPct ?? null;
}

/**
 * Personal Shopper markup percent. Kept for existing callers: returns 0 until
 * the live value has loaded instead of a guessed default. Prefer
 * useShopperMarkupSetting() and show nothing while it is null.
 */
export function useShopperMarkupPct(): number {
  return useShopperMarkupSetting() ?? 0;
}
