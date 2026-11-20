'use client';

/**
 * Small browser helpers shared by the Personal Shopper pages (shopping list,
 * track, pay, payment-complete). Server contracts live in the API routes under
 * /api/shopper/*; this file only calls them.
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  DEFAULT_DELIVERY_PRICING,
  normalizeDeliveryPricing,
  type DeliveryPricingConfig,
} from '@/lib/delivery-pricing';

export { FINAL_AMOUNT_NOTE, PAYMENT_MODEL_NOTE, REFUND_NOTE } from './copy';

export function ghs(amount: number | null | undefined): string {
  const n = Number(amount);
  return `GH₵${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Proof of ownership for guests: the phone used on the request.
// Kept for the browser tab only (sessionStorage), never in a URL we build.
// ---------------------------------------------------------------------------

const PHONE_KEY = (ref: string) => `gsg-shopper-phone:${ref.trim().toUpperCase()}`;

export function rememberShopperPhone(phone: string, ...refs: Array<string | null | undefined>): void {
  try {
    for (const ref of refs) {
      if (ref) window.sessionStorage.setItem(PHONE_KEY(ref), phone);
    }
  } catch {
    // Storage blocked (private mode): the page will ask for the phone instead.
  }
}

export function recallShopperPhone(ref: string | null | undefined): string {
  if (!ref) return '';
  try {
    return window.sessionStorage.getItem(PHONE_KEY(ref)) || '';
  } catch {
    return '';
  }
}

/** Access token of the signed-in customer, or null for a guest. */
export async function getAccessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Reads a JSON body without throwing on an empty or non-JSON response. */
export async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Live settings (same endpoint and normaliser the goods checkout uses).
// ---------------------------------------------------------------------------

export type ShopperSettings = {
  loaded: boolean;
  pricing: DeliveryPricingConfig;
  markupPct: number | null;
  hubLabel: string | null;
};

let settingsPromise: Promise<any> | null = null;

/** One request per page load, shared by every component that needs the settings. */
function loadSettingsOnce(): Promise<any> {
  if (!settingsPromise) {
    settingsPromise = fetch('/api/delivery/settings')
      .then((res) => res.json())
      .catch((err) => {
        settingsPromise = null;
        throw err;
      });
  }
  return settingsPromise;
}

export function useShopperSettings(): ShopperSettings {
  const [state, setState] = useState<ShopperSettings>({
    loaded: false,
    pricing: DEFAULT_DELIVERY_PRICING,
    markupPct: null,
    hubLabel: null,
  });

  useEffect(() => {
    let cancelled = false;
    loadSettingsOnce()
      .then((data) => {
        if (cancelled || !data?.success || !data.settings) return;
        const pct = Number(data.settings.shopperMarkupPct);
        setState({
          loaded: true,
          pricing: normalizeDeliveryPricing(data.settings.pricing),
          markupPct: Number.isFinite(pct) ? pct : null,
          hubLabel: typeof data.settings.hub?.label === 'string' ? data.settings.hub.label : null,
        });
      })
      .catch(() => {
        // Leave loaded=false: pages show "—" rather than a guessed figure.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

// ---------------------------------------------------------------------------
// Request status helpers
// ---------------------------------------------------------------------------

export function isRequestPaid(paymentStatus: string | null | undefined): boolean {
  return (paymentStatus || '').toLowerCase() === 'paid';
}

/** Unpaid, not cancelled/delivered/refunded, and has an amount to pay. */
export function isRequestPayable(req: {
  status?: string | null;
  payment_status?: string | null;
  total_final?: unknown;
}): boolean {
  const pay = (req.payment_status || '').toLowerCase();
  if (pay === 'paid' || pay === 'refunded' || pay === 'partially_refunded') return false;
  const status = (req.status || '').toUpperCase();
  if (status === 'CANCELLED' || status === 'DELIVERED') return false;
  const total = toNumber(req.total_final);
  return total !== null && total > 0;
}

export function statusLabel(status: string | null | undefined): string {
  const s = (status || '').replace(/_/g, ' ').toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Unknown';
}
