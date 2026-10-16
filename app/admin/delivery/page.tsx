'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  calculateDeliveryFee,
  normalizeDeliveryPricing,
  type DeliveryPricingConfig,
} from '@/lib/delivery-pricing';
import { GSG_HUB } from '@/lib/delivery-hub';

type FormState = {
  ratePerKm: string;
  soleMultiplier: string;
  jointMultiplier: string;
  freeMultiplier: string;
  /** Stored as percent (1.5 = 1.5%) for friendlier editing. */
  expressPurchasePct: string;
  freePurchasePct: string;
  promoDiscount: string;
  hubLabel: string;
  hubLat: string;
  hubLng: string;
  shopperMarkupPct: string;
};

const EMPTY_FORM: FormState = {
  ratePerKm: '',
  soleMultiplier: '',
  jointMultiplier: '',
  freeMultiplier: '',
  expressPurchasePct: '',
  freePurchasePct: '',
  promoDiscount: '',
  hubLabel: '',
  hubLat: '',
  hubLng: '',
  shopperMarkupPct: '5',
};

function toForm(
  pricing: DeliveryPricingConfig,
  hub: { label: string; lat: number; lng: number },
  shopperMarkupPct = 5
): FormState {
  return {
    ratePerKm: String(pricing.ratePerKm),
    soleMultiplier: String(pricing.soleMultiplier),
    jointMultiplier: String(pricing.jointMultiplier),
    freeMultiplier: String(pricing.freeMultiplier),
    expressPurchasePct: String(pricing.expressPurchasePct * 100),
    freePurchasePct: String(pricing.freePurchasePct * 100),
    promoDiscount: String(pricing.promoDiscount),
    hubLabel: hub.label,
    hubLat: String(hub.lat),
    hubLng: String(hub.lng),
    shopperMarkupPct: String(Number.isFinite(shopperMarkupPct) ? shopperMarkupPct : 5),
  };
}

export default function AdminDeliveryPricingPage() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Sample preview inputs
  const [previewKm, setPreviewKm] = useState('10');
  const [previewTotal, setPreviewTotal] = useState('300');

  useEffect(() => {
    fetch('/api/delivery/settings')
      .then((res) => res.json())
      .then((data) => {
        if (data?.success && data.settings) {
          setForm(toForm(
            normalizeDeliveryPricing(data.settings.pricing),
            data.settings.hub || GSG_HUB,
            Number(data.settings.shopperMarkupPct)
          ));
        } else {
          setForm(toForm(normalizeDeliveryPricing(null), GSG_HUB));
        }
      })
      .catch(() => setForm(toForm(normalizeDeliveryPricing(null), GSG_HUB)))
      .finally(() => setLoading(false));
  }, []);

  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const draftPricing: DeliveryPricingConfig = useMemo(
    () =>
      normalizeDeliveryPricing({
        ratePerKm: parseFloat(form.ratePerKm),
        soleMultiplier: parseFloat(form.soleMultiplier),
        jointMultiplier: parseFloat(form.jointMultiplier),
        freeMultiplier: parseFloat(form.freeMultiplier),
        expressPurchasePct: parseFloat(form.expressPurchasePct) / 100,
        freePurchasePct: parseFloat(form.freePurchasePct) / 100,
        promoDiscount: parseFloat(form.promoDiscount),
      }),
    [form]
  );

  const previews = useMemo(() => {
    const km = Math.max(0, parseFloat(previewKm) || 0);
    const purchaseTotal = Math.max(0, parseFloat(previewTotal) || 0);
    return (['sole-express', 'joint-express', 'free-delivery'] as const).map((method) => ({
      method,
      breakdown: calculateDeliveryFee({ method, km, purchaseTotal, config: draftPricing }),
    }));
  }, [draftPricing, previewKm, previewTotal]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const lat = parseFloat(form.hubLat);
      const lng = parseFloat(form.hubLng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error('Hub latitude/longitude must be valid numbers.');
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Session expired — please log in again.');

      const res = await fetch('/api/delivery/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          pricing: draftPricing,
          hub: { label: form.hubLabel.trim(), lat, lng },
          shopperMarkupPct: parseFloat(form.shopperMarkupPct),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save');

      setForm(toForm(
        normalizeDeliveryPricing(data.settings.pricing),
        data.settings.hub,
        Number(data.settings.shopperMarkupPct)
      ));
      setMessage({ type: 'success', text: 'Saved. New orders use these values immediately.' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save settings.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-3 text-gray-500">
        <i className="ri-loader-4-line animate-spin text-xl" /> Loading delivery settings…
      </div>
    );
  }

  const numField = (
    label: string,
    field: keyof FormState,
    hint: string,
    opts?: { step?: string; prefix?: string; suffix?: string }
  ) => (
    <div>
      <label className="block text-sm font-bold text-gray-700 mb-1">{label}</label>
      <div className="relative">
        {opts?.prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">{opts.prefix}</span>
        )}
        <input
          type="number"
          min="0"
          step={opts?.step || '0.01'}
          value={form[field]}
          onChange={set(field)}
          className={`w-full py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none tabular-nums ${
            opts?.prefix ? 'pl-11' : 'pl-3'
          } ${opts?.suffix ? 'pr-10' : 'pr-3'}`}
        />
        {opts?.suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">{opts.suffix}</span>
        )}
      </div>
      <p className="text-xs text-gray-500 mt-1">{hint}</p>
    </div>
  );

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Delivery Pricing</h1>
        <p className="text-sm text-gray-500 mt-1">
          Adjust rates for fuel prices, promotions and hub changes. Applies to Convenience Goods checkout
          and Personal Shopper immediately — no redeploy needed.
        </p>
      </div>

      {message && (
        <div
          className={`mb-6 p-4 rounded-xl border text-sm ${
            message.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-6">
          {/* Rates */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Rates & Multipliers</h2>
            <p className="text-xs text-gray-500 mb-5">
              Fee = rate × km × multiplier + purchase % (express) − discounts.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              {numField('Rate per km', 'ratePerKm', 'Base distance rate. Raise when fuel goes up.', { prefix: 'GH₵', step: '0.05' })}
              {numField('Promo discount', 'promoDiscount', 'Standing discount off express fees. 0 = no promo.', { prefix: 'GH₵', step: '0.5' })}
              {numField('Sole Express multiplier', 'soleMultiplier', 'Default 5.', { step: '0.5' })}
              {numField('Joint Express multiplier', 'jointMultiplier', 'Default 7 (fee is split ÷2).', { step: '0.5' })}
              {numField('Free Delivery multiplier', 'freeMultiplier', 'Default 3 (Tue/Fri).', { step: '0.5' })}
              {numField('Express purchase share', 'expressPurchasePct', 'Added on Sole/Joint. Default 1.5%.', { suffix: '%', step: '0.1' })}
              {numField('Free Delivery purchase offset', 'freePurchasePct', 'Subtracted on Free Delivery. Default 1%.', { suffix: '%', step: '0.1' })}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Personal Shopper markup</h2>
            <p className="text-xs text-gray-500 mb-5">
              Added on top of the item subtotal. Keep it low while you are attracting customers, then raise it here. 0 turns it off. Maximum 30.
            </p>
            {numField('Markup', 'shopperMarkupPct', 'Default 5%. Applies to new lists and when you finalize a request.', { suffix: '%', step: '0.1' })}
          </div>

          {/* Hub */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Dispatch Hub</h2>
            <p className="text-xs text-gray-500 mb-5">
              Distances are measured from here. Current default: GCB Bank Head Office, Thorpe Link, Accra.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Hub name</label>
                <input
                  type="text"
                  value={form.hubLabel}
                  onChange={set('hubLabel')}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none"
                  placeholder="e.g. GSG Hub — GCB Bank Head Office, Thorpe Link, Accra"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                {numField('Latitude', 'hubLat', 'From Google Maps (right-click → copy coordinates).', { step: '0.000001' })}
                {numField('Longitude', 'hubLng', 'Negative for west of Greenwich (Accra ≈ −0.20).', { step: '0.000001' })}
              </div>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${form.hubLat},${form.hubLng}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-purple-700 hover:underline"
              >
                <i className="ri-map-pin-line" /> Preview hub point on Google Maps
              </a>
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full sm:w-auto px-8 py-3.5 bg-gray-900 hover:bg-purple-700 text-white rounded-xl font-bold transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {saving ? <i className="ri-loader-4-line animate-spin" /> : <i className="ri-save-line" />}
            Save pricing
          </button>
        </div>

        {/* Live preview */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sticky top-6">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Fee Preview</h2>
            <p className="text-xs text-gray-500 mb-4">Uses the values in the form (before saving).</p>
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Distance (km)</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={previewKm}
                  onChange={(e) => setPreviewKm(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm tabular-nums outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Purchase (GH₵)</label>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={previewTotal}
                  onChange={(e) => setPreviewTotal(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm tabular-nums outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>
            <div className="space-y-3">
              {previews.map(({ method, breakdown }) => (
                <div key={method} className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-sm font-bold text-gray-900">
                      {method === 'sole-express'
                        ? 'Sole Express (Daily)'
                        : method === 'joint-express'
                          ? 'Joint Express (Daily)'
                          : 'Free Delivery (Tue/Fri)'}
                    </p>
                    <p className="text-sm font-black text-purple-700 tabular-nums">
                      GH₵{breakdown.fee.toFixed(2)}
                    </p>
                  </div>
                  <ul className="space-y-0.5">
                    {breakdown.lines.map((line, i) => (
                      <li key={i} className="text-[11px] text-gray-500">{line}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
