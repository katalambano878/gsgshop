/**
 * Server-side loader for live delivery settings (pricing knobs + hub point).
 * Stored in `site_settings` under key `delivery_pricing` so admins can adjust
 * for fuel prices / promos without a deploy. Cached in-process for 60s.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { GSG_HUB, type DeliveryHub } from '@/lib/delivery-hub';
import {
  DEFAULT_DELIVERY_PRICING,
  normalizeDeliveryPricing,
  type DeliveryPricingConfig,
} from '@/lib/delivery-pricing';

export const DELIVERY_SETTINGS_KEY = 'delivery_pricing';

/** Personal Shopper markup on the item subtotal. 5 means 5%. */
export const DEFAULT_SHOPPER_MARKUP_PCT = 5;

export function normalizeShopperMarkupPct(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SHOPPER_MARKUP_PCT;
  return Math.min(30, Math.max(0, Math.round(n * 10) / 10));
}

export function shopperMarkupAmount(subtotal: number, pct: number): number {
  const base = Math.max(0, subtotal);
  return Math.round(base * (normalizeShopperMarkupPct(pct) / 100) * 100) / 100;
}

export type DeliverySettings = {
  pricing: DeliveryPricingConfig;
  hub: DeliveryHub;
  shopperMarkupPct: number;
};

export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = {
  pricing: DEFAULT_DELIVERY_PRICING,
  hub: GSG_HUB,
  shopperMarkupPct: DEFAULT_SHOPPER_MARKUP_PCT,
};

export function normalizeHub(raw: unknown): DeliveryHub {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const lat = Number(src.lat);
  const lng = Number(src.lng);
  const label = typeof src.label === 'string' && src.label.trim() ? src.label.trim() : GSG_HUB.label;
  // Sanity: keep the hub in/near Ghana; otherwise fall back to the default.
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 4 || lat > 12 || lng < -4 || lng > 2) {
    return GSG_HUB;
  }
  return { lat, lng, label };
}

export function normalizeDeliverySettings(raw: unknown): DeliverySettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    pricing: normalizeDeliveryPricing(src.pricing),
    hub: normalizeHub(src.hub),
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
