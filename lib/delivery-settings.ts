/**
 * Server-side loader for live delivery settings (pricing knobs + hub point).
 * Stored in `site_settings` under key `delivery_pricing` so admins can adjust
 * for fuel prices / promos without a deploy. Cached in-process for 60s.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { GSG_HUB, GSG_TRANSPORT_STATION, type DeliveryHub } from '@/lib/delivery-hub';
import {
  DEFAULT_DELIVERY_PRICING,
  normalizeDeliveryPricing,
  type DeliveryPricingConfig,
} from '@/lib/delivery-pricing';

export const DELIVERY_SETTINGS_KEY = 'delivery_pricing';

/** Personal Shopper markup on the item subtotal. 5 means 5%. The site promises "15% or less", so 15 is the ceiling. */
export const DEFAULT_SHOPPER_MARKUP_PCT = 5;

export const SHOPPER_MARKUP_MAX_PCT = 15;

export function normalizeShopperMarkupPct(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SHOPPER_MARKUP_PCT;
  return Math.min(SHOPPER_MARKUP_MAX_PCT, Math.max(0, Math.round(n * 10) / 10));
}

export function shopperMarkupAmount(subtotal: number, pct: number): number {
  const base = Math.max(0, subtotal);
  return Math.round(base * (normalizeShopperMarkupPct(pct) / 100) * 100) / 100;
}

export type DeliverySettings = {
  pricing: DeliveryPricingConfig;
  hub: DeliveryHub;
  /** Where outside-Greater-Accra orders are dropped for commercial transport. */
  transportStation: DeliveryHub;
  shopperMarkupPct: number;
};

export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = {
  pricing: DEFAULT_DELIVERY_PRICING,
  hub: GSG_HUB,
  transportStation: GSG_TRANSPORT_STATION,
  shopperMarkupPct: DEFAULT_SHOPPER_MARKUP_PCT,
};

export function normalizeHub(raw: unknown, fallback: DeliveryHub = GSG_HUB): DeliveryHub {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const lat = Number(src.lat);
  const lng = Number(src.lng);
  const label = typeof src.label === 'string' && src.label.trim() ? src.label.trim() : fallback.label;
  // Sanity: keep the hub in/near Ghana; otherwise fall back to the default.
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 4 || lat > 12 || lng < -4 || lng > 2) {
    return fallback;
  }
  return { lat, lng, label };
}

export function normalizeDeliverySettings(raw: unknown): DeliverySettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    pricing: normalizeDeliveryPricing(src.pricing),
    hub: normalizeHub(src.hub),
    transportStation: normalizeHub(src.transportStation, GSG_TRANSPORT_STATION),
    shopperMarkupPct: normalizeShopperMarkupPct(src.shopperMarkupPct),
  };
}

let cache: { value: DeliverySettings; expires: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function getDeliverySettings(): Promise<DeliverySettings> {
  if (cache && cache.expires > Date.now()) return cache.value;

  try {
    const { data, error } = await supabaseAdmin
      .from('site_settings')
      .select('value')
      .eq('key', DELIVERY_SETTINGS_KEY)
      .maybeSingle();

    const value = error || !data ? DEFAULT_DELIVERY_SETTINGS : normalizeDeliverySettings(data.value);
    cache = { value, expires: Date.now() + CACHE_TTL_MS };
    return value;
  } catch {
    return cache?.value ?? DEFAULT_DELIVERY_SETTINGS;
  }
}

export async function saveDeliverySettings(raw: unknown): Promise<DeliverySettings> {
  const value = normalizeDeliverySettings(raw);
  const { error } = await supabaseAdmin
    .from('site_settings')
    .upsert(
      { key: DELIVERY_SETTINGS_KEY, value, category: 'delivery', updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
  if (error) throw new Error(error.message);
  cache = { value, expires: Date.now() + CACHE_TTL_MS };
  return value;
}
