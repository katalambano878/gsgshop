'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import DeliveryLocationPicker from '@/components/DeliveryLocationPicker';
import { calculateDeliveryFee } from '@/lib/delivery-pricing';
import { useDeliveryPricing } from '@/hooks/useDeliveryPricing';

const SHOPPER_DELIVERY_OPTIONS = [
  {
    value: 'sole-express',
    label: 'Sole Express Delivery (Daily)',
    desc: 'Your own dedicated delivery. Required for fresh/perishable items. 2hr–48hr slots.',
  },
  {
    value: 'joint-express',
    label: 'Joint Express – Myself & Neighbor (Daily)',
    desc: 'Share delivery with a neighbour and split the fee; items stay private. 2hr–48hr slots.',
  },
] as const;

const fieldClass =
  'w-full rounded-xl border border-stone-200 bg-white px-3.5 py-3 text-sm text-gsg-black outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-stone-400 focus:border-gsg-purple focus:ring-4 focus:ring-gsg-purple/10';
const labelClass = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500';

interface RequestItem {
  id: string;
  nameBrand: string;
  qtySizeRange: string;
  remark: string;
  estimatedPrice: string;
  sourceType: string;
}

export default function ShoppingList() {
  const router = useRouter();
  const [items, setItems] = useState<RequestItem[]>([
    { id: '1', nameBrand: '', qtySizeRange: '', remark: '', estimatedPrice: '', sourceType: '' },
  ]);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryKm, setDeliveryKm] = useState('');
  const [deliveryLocationLabel, setDeliveryLocationLabel] = useState('');
  const [deliveryPin, setDeliveryPin] = useState<{ lat: number; lng: number } | null>(null);
  const [deliveryMethod, setDeliveryMethod] = useState<'sole-express' | 'joint-express'>('sole-express');
  const pricingConfig = useDeliveryPricing();
  const [preferredTime, setPreferredTime] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [locationError, setLocationError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setContactEmail(session.user.email || '');
        supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single()
          .then(({ data }) => {
            if (data) {
              if (data.full_name) setContactName(data.full_name);
              if (data.phone) setContactPhone(data.phone);
            }
          });
      }
    });
  }, []);

  const addItem = () => {
    setItems([
      ...items,
      {
        id: Date.now().toString(),
        nameBrand: '',
        qtySizeRange: '',
        remark: '',
        estimatedPrice: '',
        sourceType: '',
      },
    ]);
  };

  const removeItem = (id: string) => {
    if (items.length > 1) {
      setItems(items.filter((item) => item.id !== id));
    }
  };

  const updateItem = (id: string, field: keyof RequestItem, value: string) => {
    setItems(items.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  };

  const subtotal = items.reduce((sum, item) => sum + (parseFloat(item.estimatedPrice) || 0), 0);
  const markup = subtotal * 0.05;
  const kmValue = Math.max(0, parseFloat(deliveryKm) || 0);
  const deliveryBreakdown = useMemo(
    () =>
      calculateDeliveryFee({
        method: deliveryMethod,
        km: kmValue,
        purchaseTotal: subtotal,
        config: pricingConfig,
      }),
    [deliveryMethod, kmValue, subtotal, pricingConfig]
  );
  const deliveryFee = kmValue > 0 ? deliveryBreakdown.fee : 0;
  const total = subtotal + markup + deliveryFee;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setLocationError('');

    try {
      if (!contactName || !contactPhone || !deliveryAddress) {
        throw new Error('Please fill in all required contact and delivery fields.');
      }
      if (!(kmValue > 0)) {
        setLocationError('Type your delivery area so we can set the distance.');
        throw new Error('Please type your delivery area so we can calculate the distance.');
      }
      if (items.some((i) => !i.nameBrand || !i.qtySizeRange || !i.estimatedPrice)) {
        throw new Error('Please fill in all required item fields (Name, Qty, Estimated Price).');
      }

      const res = await fetch('/api/shopper/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items,
          contactName,
          contactPhone,
          contactEmail,
          deliveryAddress: {
            text: deliveryAddress,
            location_label: deliveryLocationLabel || null,
            km: kmValue,
            method: deliveryMethod,
            lat: deliveryPin?.lat ?? null,
            lng: deliveryPin?.lng ?? null,
          },
          preferredTime,
          notes,
          subtotalEst: subtotal,
          markup: markup,
          totalEst: total,
          deliveryKm: kmValue,
          deliveryMethod,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit request');

      router.push(`/shopper/pay/${data.id}`);
    } catch (err: any) {
      setError(err.message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setLoading(false);
    }
  };

  const ghs = (amount: number) => `GH₵${amount.toFixed(2)}`;

  return (
    <div className="min-h-screen bg-[#f4f0ea] py-8 md:py-14">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <header className="mb-8 flex flex-col gap-6 border-b border-stone-300/70 pb-8 md:mb-10 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gsg-purple">
              My Personal Shopper
            </p>
            <h1 className="mt-2 font-serif text-4xl leading-tight text-gsg-black text-balance md:text-5xl">
              Create your list
            </h1>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-stone-600 text-pretty">
              Tell us what you need. We source it at the market price and bring it to your door in Accra.
            </p>
          </div>
          <dl className="grid w-full min-w-0 grid-cols-3 gap-3 text-stone-600 sm:w-auto sm:gap-8">
            <div className="min-w-0">
              <dt className="font-serif text-2xl text-gsg-black">5%</dt>
              <dd className="mt-0.5 text-[11px] leading-snug text-pretty sm:text-xs">markup or less</dd>
            </div>
            <div className="min-w-0">
              <dt className="font-serif text-2xl text-gsg-black">Daily</dt>
              <dd className="mt-0.5 text-[11px] leading-snug text-pretty sm:text-xs">express in Accra</dd>
            </div>
            <div className="min-w-0">
              <dt className="font-serif text-2xl text-gsg-black">Pay</dt>
              <dd className="mt-0.5 text-[11px] leading-snug text-pretty sm:text-xs">estimate first</dd>
            </div>
          </dl>
        </header>

        {error && (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-8">
          <section className="rounded-3xl border border-white/80 bg-white p-5 shadow-[0_20px_50px_-28px_rgba(15,15,15,0.45)] md:p-8">
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">01</p>
                <h2 className="mt-1 font-serif text-2xl text-gsg-black text-balance">What should we buy?</h2>
              </div>
              <p className="hidden text-xs text-stone-500 sm:block">{items.length} item{items.length === 1 ? '' : 's'}</p>
            </div>

            <div className="space-y-6">
              {items.map((item, index) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-stone-200/80 bg-[#faf8f5] p-4 md:p-5"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-gsg-black px-2 font-serif text-sm text-white">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        aria-label={`Remove item ${index + 1}`}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full text-stone-400 transition-colors duration-150 hover:bg-red-50 hover:text-red-600"
                      >
                        <i className="ri-delete-bin-line text-lg"></i>
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                    <div className="md:col-span-5">
                      <label className={labelClass}>Item name / brand *</label>
                      <input
                        type="text"
                        required
                        value={item.nameBrand}
                        onChange={(e) => updateItem(item.id, 'nameBrand', e.target.value)}
                        className={fieldClass}
                        placeholder="Milo cereal 500g"
                      />
                    </div>
                    <div className="md:col-span-3">
                      <label className={labelClass}>Qty / size *</label>
                      <input
                        type="text"
                        required
                        value={item.qtySizeRange}
                        onChange={(e) => updateItem(item.id, 'qtySizeRange', e.target.value)}
                        className={fieldClass}
                        placeholder="2 packs"
                      />
                    </div>
                    <div className="md:col-span-4">
                      <label className={labelClass}>Est. price (GHS) *</label>
                      <input
                        type="number"
                        required
                        min="0"
                        step="0.01"
                        value={item.estimatedPrice}
                        onChange={(e) => updateItem(item.id, 'estimatedPrice', e.target.value)}
                        className={`${fieldClass} tabular-nums`}
                        placeholder="0.00"
                      />
                    </div>
                    <div className="md:col-span-4">
                      <label className={labelClass}>Produce source</label>
                      <select
                        value={item.sourceType}
                        onChange={(e) => updateItem(item.id, 'sourceType', e.target.value)}
                        className={fieldClass}
                      >
                        <option value="">Not specified</option>
                        <option value="Local Market">Local market</option>
                        <option value="Imported">Imported</option>
                        <option value="Controlled Environment">Controlled environment</option>
                      </select>
                    </div>
                    <div className="md:col-span-8">
                      <label className={labelClass}>Note for this item</label>
                      <input
                        type="text"
                        value={item.remark}
                        onChange={(e) => updateItem(item.id, 'remark', e.target.value)}
                        className={fieldClass}
                        placeholder="Brand, ripeness, substitute if sold out…"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addItem}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-stone-300 py-3.5 text-sm font-semibold text-gsg-purple transition-colors duration-150 hover:border-gsg-purple hover:bg-purple-50/60"
            >
              <i className="ri-add-line text-lg"></i> Add another item
            </button>
          </section>

          <section className="rounded-3xl border border-white/80 bg-white p-5 shadow-[0_20px_50px_-28px_rgba(15,15,15,0.45)] md:p-8">
              <div className="mb-6">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">02</p>
                <h2 className="mt-1 font-serif text-2xl text-gsg-black text-balance">Where should it go?</h2>
              </div>
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={labelClass}>Full name *</label>
                  <input
                    type="text"
                    required
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    className={fieldClass}
                    autoComplete="name"
                  />
                </div>
                <div>
                  <label className={labelClass}>Phone *</label>
                  <input
                    type="tel"
                    required
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    className={fieldClass}
                    autoComplete="tel"
                  />
                </div>
                <div>
                  <label className={labelClass}>Email</label>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    className={fieldClass}
                    autoComplete="email"
                  />
                </div>
                </div>

                <DeliveryLocationPicker
                  valueKm={deliveryKm}
                  error={locationError}
                  onDistanceChange={(km, meta) => {
                    setDeliveryKm(km);
                    if (meta?.label) setDeliveryLocationLabel(meta.label);
                    if (Number.isFinite(meta?.lat) && Number.isFinite(meta?.lng)) {
                      setDeliveryPin({ lat: meta!.lat!, lng: meta!.lng! });
                    } else if (!km) {
                      setDeliveryPin(null);
                    }
                    if (km) setLocationError('');
                  }}
                  onPlaceFill={({ addressHint }) => {
                    if (addressHint && !deliveryAddress.trim()) {
                      setDeliveryAddress(addressHint);
                    }
                  }}
                />

                <div>
                  <label className={labelClass}>Street address *</label>
                  <textarea
                    required
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    rows={3}
                    className={fieldClass}
                    placeholder="House number, street, and a landmark"
                  />
                  <p className="mt-1.5 text-xs text-stone-500 text-pretty">
                    Add the door details after choosing the area above.
                  </p>
                </div>

                <div>
                  <label className={labelClass}>Delivery method *</label>
                  <div className="grid gap-3">
                    {SHOPPER_DELIVERY_OPTIONS.map((opt) => {
                      const preview = calculateDeliveryFee({
                        method: opt.value,
                        km: kmValue,
                        purchaseTotal: subtotal,
                        config: pricingConfig,
                      });
                      const selected = deliveryMethod === opt.value;
                      const icon = opt.value === 'sole-express' ? 'ri-motorbike-line' : 'ri-user-shared-line';
                      return (
                        <label
                          key={opt.value}
                          className={`flex cursor-pointer items-start justify-between gap-3 rounded-2xl border p-4 transition-[border-color,background-color,box-shadow] duration-150 ${
                            selected
                              ? 'border-gsg-purple bg-[#faf7ff] shadow-[0_0_0_1px_#6B21A8]'
                              : 'border-stone-200 bg-[#faf8f5] hover:border-stone-300'
                          }`}
                        >
                          <div className="flex min-w-0 items-start gap-3">
                            <span
                              className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                                selected ? 'bg-gsg-purple text-white' : 'bg-white text-stone-500'
                              }`}
                            >
                              <i className={`${icon} text-lg`}></i>
                            </span>
                            <input
                              type="radio"
                              name="shopper-delivery"
                              value={opt.value}
                              checked={selected}
                              onChange={() => setDeliveryMethod(opt.value)}
                              className="sr-only"
                            />
                            <span className="min-w-0">
                              <span className={`block text-sm font-semibold ${selected ? 'text-gsg-purple' : 'text-gsg-black'}`}>
                                {opt.label}
                              </span>
                              <span className="mt-1 block text-xs leading-relaxed text-stone-500 text-pretty">{opt.desc}</span>
                            </span>
                          </div>
                          <span className={`shrink-0 text-sm font-semibold tabular-nums ${selected ? 'text-gsg-purple' : 'text-gsg-black'}`}>
                            {kmValue > 0 ? ghs(preview.fee) : '—'}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {kmValue <= 0 && (
                    <p className="mt-2 text-xs text-stone-500">
                      Type your delivery area above to see the exact fees.
                    </p>
                  )}
                </div>
                <div>
                  <label className={labelClass}>Preferred time</label>
                  <input
                    type="text"
                    value={preferredTime}
                    onChange={(e) => setPreferredTime(e.target.value)}
                    className={fieldClass}
                    placeholder="Tomorrow morning"
                  />
                </div>
                <div>
                  <label className={labelClass}>Notes for the shopper</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    className={fieldClass}
                    placeholder="Gate code, call on arrival…"
                  />
                </div>
              </div>
          </section>
          </div>

          <aside className="lg:sticky lg:top-24">
            <div className="overflow-hidden rounded-3xl bg-[#161218] text-white shadow-[0_24px_60px_-28px_rgba(15,15,15,0.7)]">
              <div className="border-b border-white/10 px-6 py-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gsg-accent">03 · Estimate</p>
                <h2 className="mt-1 font-serif text-2xl text-balance">Your receipt</h2>
              </div>
              <dl className="space-y-3 px-6 py-5 text-sm">
                <div className="flex justify-between gap-4 text-white/70">
                  <dt>Items</dt>
                  <dd className="tabular-nums text-white">{ghs(subtotal)}</dd>
                </div>
                <div className="flex justify-between gap-4 text-white/70">
                  <dt>Markup, 5% or less</dt>
                  <dd className="tabular-nums text-white">{ghs(markup)}</dd>
                </div>
                <div className="flex justify-between gap-4 text-white/70">
                  <dt>Distance</dt>
                  <dd className="tabular-nums text-white">{kmValue > 0 ? `${kmValue.toFixed(1)} km` : 'Not set'}</dd>
                </div>
                <div className="flex justify-between gap-4 text-white/70">
                  <dt>
                    Delivery
                    <span className="mt-0.5 block text-[11px] text-white/40">
                      {deliveryMethod === 'sole-express' ? 'Sole Express, daily' : 'Joint Express, daily'}
                    </span>
                  </dt>
                  <dd className="tabular-nums text-white">{kmValue > 0 ? ghs(deliveryFee) : '—'}</dd>
                </div>
                <div className="flex justify-between gap-4 text-white/50">
                  <dt>Sourcing fee</dt>
                  <dd>If it applies</dd>
                </div>
              </dl>
              <div className="mx-6 border-t border-dashed border-white/15" />
              <div className="flex items-end justify-between px-6 py-5">
                <p className="text-xs uppercase tracking-[0.16em] text-white/50">Total</p>
                <p className="font-serif text-4xl tabular-nums text-gsg-accent">{ghs(total)}</p>
              </div>
              <div className="px-6 pb-6">
                <p className="mb-4 text-xs leading-relaxed text-white/55 text-pretty">
                  You pay this estimate to lock in your shopper. If the market price moves, we call before delivery. Extra becomes a top-up. Refunds take 1–3 business days.
                </p>
                <button
                  type="submit"
                  disabled={loading || items.length === 0}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-4 text-sm font-semibold text-gsg-black transition-[background-color,transform] duration-150 hover:bg-gsg-accent active:scale-[0.98] disabled:opacity-50"
                >
                  {loading ? (
                    <i className="ri-loader-4-line animate-spin text-xl"></i>
                  ) : (
                    <>
                      <i className="ri-secure-payment-line text-lg"></i>
                      Submit and pay {ghs(total)}
                    </>
                  )}
                </button>
              </div>
            </div>
          </aside>
        </form>
      </div>
    </div>
  );
}
