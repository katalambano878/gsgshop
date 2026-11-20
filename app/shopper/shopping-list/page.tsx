'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import DeliveryLocationPicker from '@/components/DeliveryLocationPicker';
import { calculateDeliveryFee } from '@/lib/delivery-pricing';
import { isGhanaPhone } from '@/lib/phone';
import {
  FINAL_AMOUNT_NOTE,
  REFUND_NOTE,
  authHeaders,
  getAccessToken,
  ghs,
  readJson,
  rememberShopperPhone,
  useShopperSettings,
} from '../_lib/shopper-client';

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

/** Limits shown to the customer; the server enforces its own as well. */
const LIMITS = {
  items: 100,
  itemName: 200,
  qty: 100,
  remark: 300,
  price: 100000,
  name: 120,
  email: 160,
  address: 500,
  preferredTime: 120,
  notes: 1000,
};

const fieldClass =
  'w-full rounded-xl border border-stone-200 bg-white px-3.5 py-3 text-sm text-gsg-black outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-stone-400 focus:border-gsg-purple focus:ring-4 focus:ring-gsg-purple/10';
const fieldErrorClass = 'border-red-400 focus:border-red-500 focus:ring-red-500/10';
const labelClass = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500';
const errorTextClass = 'mt-1.5 text-xs text-red-600';

interface RequestItem {
  id: string;
  nameBrand: string;
  qtySizeRange: string;
  remark: string;
  estimatedPrice: string;
  sourceType: string;
}

type FieldErrors = Record<string, string>;

const emptyItem = (id: string): RequestItem => ({
  id,
  nameBrand: '',
  qtySizeRange: '',
  remark: '',
  estimatedPrice: '',
  sourceType: '',
});

export default function ShoppingList() {
  const router = useRouter();
  const [items, setItems] = useState<RequestItem[]>([emptyItem('1')]);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryKm, setDeliveryKm] = useState('');
  const [deliveryLocationLabel, setDeliveryLocationLabel] = useState('');
  const [deliveryPin, setDeliveryPin] = useState<{ lat: number; lng: number } | null>(null);
  const [deliveryMethod, setDeliveryMethod] = useState<'sole-express' | 'joint-express'>('sole-express');
  const settings = useShopperSettings();
  const pricingConfig = settings.pricing;
  const markupPct = settings.markupPct;
  const [preferredTime, setPreferredTime] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [locationError, setLocationError] = useState('');
  const submittingRef = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setContactEmail((prev) => prev || session.user.email || '');
        supabase
          .from('profiles')
          .select('full_name, phone')
          .eq('id', session.user.id)
          .maybeSingle()
          .then(({ data }) => {
            if (data) {
              if (data.full_name) setContactName((prev) => prev || data.full_name);
              if (data.phone) setContactPhone((prev) => prev || data.phone);
            }
          });
      }
    });
  }, []);

  const clearFieldError = (key: string) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const addItem = () => {
    if (items.length >= LIMITS.items) {
      setError(`A list can hold up to ${LIMITS.items} items. Send a second list for the rest.`);
      return;
    }
    setItems([...items, emptyItem(`${Date.now()}`)]);
  };

  const removeItem = (id: string) => {
    if (items.length > 1) {
      setItems(items.filter((item) => item.id !== id));
    }
  };

  const updateItem = (id: string, field: keyof RequestItem, value: string) => {
    setItems(items.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
    clearFieldError(`${id}.${field}`);
  };

  const priceOf = (item: RequestItem) => Math.max(0, parseFloat(item.estimatedPrice) || 0);

  // Preview only: the server works out the estimate the customer pays.
  const subtotal = items.reduce((sum, item) => sum + priceOf(item), 0);
  const markup = markupPct === null ? 0 : Math.round(subtotal * (markupPct / 100) * 100) / 100;
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
  const previewReady = settings.loaded && markupPct !== null;
  const total = subtotal + markup + deliveryFee;

  const validate = (): FieldErrors => {
    const errs: FieldErrors = {};
    if (!contactName.trim()) errs.contactName = 'Enter your full name.';
    if (!contactPhone.trim()) errs.contactPhone = 'Enter your phone number.';
    else if (!isGhanaPhone(contactPhone)) {
      errs.contactPhone = 'Enter a Ghana mobile number, for example 024 123 4567 or +233 24 123 4567.';
    }
    if (contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) {
      errs.contactEmail = 'Check the email address, or leave it empty.';
    }
    if (!deliveryAddress.trim()) errs.deliveryAddress = 'Enter the street address, house number or a landmark.';
    if (!(kmValue > 0)) errs.location = 'Type your delivery area so we can set the distance.';

    items.forEach((item) => {
      if (!item.nameBrand.trim()) errs[`${item.id}.nameBrand`] = 'Enter the item name.';
      if (!item.qtySizeRange.trim()) errs[`${item.id}.qtySizeRange`] = 'Enter the quantity or size.';
      const raw = item.estimatedPrice.trim();
      const price = Number(raw);
      if (!raw) errs[`${item.id}.estimatedPrice`] = 'Enter your estimated price.';
      else if (!Number.isFinite(price) || price < 0) {
        errs[`${item.id}.estimatedPrice`] = 'The price cannot be negative.';
      } else if (price > LIMITS.price) {
        errs[`${item.id}.estimatedPrice`] = `Prices above ${ghs(LIMITS.price)} need a chat with us on WhatsApp first.`;
      }
    });
    if (items.length > LIMITS.items) errs.items = `A list can hold up to ${LIMITS.items} items.`;
    return errs;
  };

  const showError = (message: string) => {
    setError(message);
    requestAnimationFrame(() => errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;

    setError('');
    const errs = validate();
    setFieldErrors(errs);
    setLocationError(errs.location || '');
    if (Object.keys(errs).length > 0) {
      showError('Some details need attention. Check the fields marked in red.');
      return;
    }

    submittingRef.current = true;
    setLoading(true);

    try {
      const token = await getAccessToken();
      const res = await fetch('/api/shopper/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify({
          items: items.map((item) => ({
            nameBrand: item.nameBrand.trim(),
            qtySizeRange: item.qtySizeRange.trim(),
            remark: item.remark.trim(),
            estimatedPrice: priceOf(item),
            sourceType: item.sourceType,
          })),
          contactName: contactName.trim(),
          contactPhone: contactPhone.trim(),
          contactEmail: contactEmail.trim(),
          deliveryAddress: {
            text: deliveryAddress.trim(),
            location_label: deliveryLocationLabel || null,
            km: kmValue,
            method: deliveryMethod,
            lat: deliveryPin?.lat ?? null,
            lng: deliveryPin?.lng ?? null,
          },
          preferredTime: preferredTime.trim(),
          notes: notes.trim(),
          deliveryKm: kmValue,
          deliveryMethod,
        }),
      });

      const data = await readJson(res);
      if (!res.ok || !data?.id) {
        if (data?.code === 'invalid_phone') {
          setFieldErrors((prev) => ({ ...prev, contactPhone: 'Enter a Ghana mobile number.' }));
        }
        const message =
          typeof data?.message === 'string' && res.status < 500
            ? data.message
            : typeof data?.error === 'string' && res.status < 500
              ? data.error
              : 'We could not send your list just now. Please try again, or send it to us on WhatsApp.';
        throw new Error(message);
      }

      const requestNumber: string | undefined = data.requestNumber ?? data.request_number;
      rememberShopperPhone(contactPhone.trim(), data.id, requestNumber);
      // Keep the button locked: the pay page loads next and shows the
      // server's estimate before anything is charged.
      router.push(`/shopper/pay/${data.id}`);
    } catch (err: any) {
      submittingRef.current = false;
      setLoading(false);
      showError(err?.message || 'We could not send your list just now. Please try again.');
    }
  };

  const errClass = (key: string) => (fieldErrors[key] ? ` ${fieldErrorClass}` : '');

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
              <dt className="font-serif text-2xl text-gsg-black tabular-nums">
                {markupPct === null ? '—' : `${markupPct}%`}
              </dt>
              <dd className="mt-0.5 text-[11px] leading-snug text-pretty sm:text-xs">markup</dd>
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

        <div ref={errorRef} aria-live="assertive">
          {error && (
            <div role="alert" className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <form noValidate onSubmit={handleSubmit} className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-8">
          <section className="rounded-3xl border border-white/80 bg-white p-5 shadow-[0_20px_50px_-28px_rgba(15,15,15,0.45)] md:p-8">
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">01</p>
                <h2 className="mt-1 font-serif text-2xl text-gsg-black text-balance">What should we buy?</h2>
              </div>
              <p className="hidden text-xs text-stone-500 sm:block">
                {items.length} of {LIMITS.items} item{items.length === 1 ? '' : 's'}
              </p>
            </div>

            <div className="space-y-6">
              {items.map((item, index) => {
                const fid = (f: string) => `item-${item.id}-${f}`;
                return (
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
                        <i className="ri-delete-bin-line text-lg" aria-hidden="true"></i>
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                    <div className="md:col-span-5">
                      <label htmlFor={fid('name')} className={labelClass}>Item name / brand *</label>
                      <input
                        id={fid('name')}
                        type="text"
                        required
                        maxLength={LIMITS.itemName}
                        value={item.nameBrand}
                        onChange={(e) => updateItem(item.id, 'nameBrand', e.target.value)}
                        aria-invalid={!!fieldErrors[`${item.id}.nameBrand`]}
                        aria-describedby={fieldErrors[`${item.id}.nameBrand`] ? `${fid('name')}-err` : undefined}
                        className={`${fieldClass}${errClass(`${item.id}.nameBrand`)}`}
                        placeholder="Milo cereal 500g"
                      />
                      {fieldErrors[`${item.id}.nameBrand`] && (
                        <p id={`${fid('name')}-err`} className={errorTextClass}>{fieldErrors[`${item.id}.nameBrand`]}</p>
                      )}
                    </div>
                    <div className="md:col-span-3">
                      <label htmlFor={fid('qty')} className={labelClass}>Qty / size *</label>
                      <input
                        id={fid('qty')}
                        type="text"
                        required
                        maxLength={LIMITS.qty}
                        value={item.qtySizeRange}
                        onChange={(e) => updateItem(item.id, 'qtySizeRange', e.target.value)}
                        aria-invalid={!!fieldErrors[`${item.id}.qtySizeRange`]}
                        aria-describedby={fieldErrors[`${item.id}.qtySizeRange`] ? `${fid('qty')}-err` : undefined}
                        className={`${fieldClass}${errClass(`${item.id}.qtySizeRange`)}`}
                        placeholder="2 packs"
                      />
                      {fieldErrors[`${item.id}.qtySizeRange`] && (
                        <p id={`${fid('qty')}-err`} className={errorTextClass}>{fieldErrors[`${item.id}.qtySizeRange`]}</p>
                      )}
                    </div>
                    <div className="md:col-span-4">
                      <label htmlFor={fid('price')} className={labelClass}>Est. price (GHS) *</label>
                      <input
                        id={fid('price')}
                        type="number"
                        inputMode="decimal"
                        required
                        min="0"
                        max={LIMITS.price}
                        step="0.01"
                        value={item.estimatedPrice}
                        onChange={(e) => updateItem(item.id, 'estimatedPrice', e.target.value.replace(/^-/, ''))}
                        onKeyDown={(e) => {
                          if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault();
                        }}
                        aria-invalid={!!fieldErrors[`${item.id}.estimatedPrice`]}
                        aria-describedby={fieldErrors[`${item.id}.estimatedPrice`] ? `${fid('price')}-err` : undefined}
                        className={`${fieldClass} tabular-nums${errClass(`${item.id}.estimatedPrice`)}`}
                        placeholder="0.00"
                      />
                      {fieldErrors[`${item.id}.estimatedPrice`] && (
                        <p id={`${fid('price')}-err`} className={errorTextClass}>{fieldErrors[`${item.id}.estimatedPrice`]}</p>
                      )}
                    </div>
                    <div className="md:col-span-4">
                      <label htmlFor={fid('source')} className={labelClass}>Produce source</label>
                      <select
                        id={fid('source')}
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
                      <label htmlFor={fid('remark')} className={labelClass}>Note for this item</label>
                      <input
                        id={fid('remark')}
                        type="text"
                        maxLength={LIMITS.remark}
                        value={item.remark}
                        onChange={(e) => updateItem(item.id, 'remark', e.target.value)}
                        className={fieldClass}
                        placeholder="Brand, ripeness, substitute if sold out…"
                      />
                    </div>
                  </div>
                </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={addItem}
              disabled={items.length >= LIMITS.items}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-stone-300 py-3.5 text-sm font-semibold text-gsg-purple transition-colors duration-150 hover:border-gsg-purple hover:bg-purple-50/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <i className="ri-add-line text-lg" aria-hidden="true"></i> Add another item
            </button>
            {items.length >= LIMITS.items && (
              <p className="mt-2 text-xs text-stone-500">
                A list can hold up to {LIMITS.items} items. Send a second list for the rest.
              </p>
            )}
          </section>

          <section className="rounded-3xl border border-white/80 bg-white p-5 shadow-[0_20px_50px_-28px_rgba(15,15,15,0.45)] md:p-8">
              <div className="mb-6">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">02</p>
                <h2 className="mt-1 font-serif text-2xl text-gsg-black text-balance">Where should it go?</h2>
              </div>
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="sl-name" className={labelClass}>Full name *</label>
                  <input
                    id="sl-name"
                    type="text"
                    required
                    maxLength={LIMITS.name}
                    value={contactName}
                    onChange={(e) => { setContactName(e.target.value); clearFieldError('contactName'); }}
                    aria-invalid={!!fieldErrors.contactName}
                    aria-describedby={fieldErrors.contactName ? 'sl-name-err' : undefined}
                    className={`${fieldClass}${errClass('contactName')}`}
                    autoComplete="name"
                  />
                  {fieldErrors.contactName && <p id="sl-name-err" className={errorTextClass}>{fieldErrors.contactName}</p>}
                </div>
                <div>
                  <label htmlFor="sl-phone" className={labelClass}>Phone *</label>
                  <input
                    id="sl-phone"
                    type="tel"
                    inputMode="tel"
                    required
                    maxLength={20}
                    value={contactPhone}
                    onChange={(e) => { setContactPhone(e.target.value); clearFieldError('contactPhone'); }}
                    aria-invalid={!!fieldErrors.contactPhone}
                    aria-describedby={fieldErrors.contactPhone ? 'sl-phone-err' : 'sl-phone-hint'}
                    className={`${fieldClass}${errClass('contactPhone')}`}
                    autoComplete="tel"
                    placeholder="024 123 4567"
                  />
                  {fieldErrors.contactPhone ? (
                    <p id="sl-phone-err" className={errorTextClass}>{fieldErrors.contactPhone}</p>
                  ) : (
                    <p id="sl-phone-hint" className="mt-1.5 text-xs text-stone-500">
                      Ghana mobile number. You need it with your request number to track or pay.
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="sl-email" className={labelClass}>Email</label>
                  <input
                    id="sl-email"
                    type="email"
                    maxLength={LIMITS.email}
                    value={contactEmail}
                    onChange={(e) => { setContactEmail(e.target.value); clearFieldError('contactEmail'); }}
                    aria-invalid={!!fieldErrors.contactEmail}
                    aria-describedby={fieldErrors.contactEmail ? 'sl-email-err' : undefined}
                    className={`${fieldClass}${errClass('contactEmail')}`}
                    autoComplete="email"
                  />
                  {fieldErrors.contactEmail && <p id="sl-email-err" className={errorTextClass}>{fieldErrors.contactEmail}</p>}
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
                    if (km) {
                      setLocationError('');
                      clearFieldError('location');
                    }
                  }}
                  onPlaceFill={({ addressHint }) => {
                    if (addressHint && !deliveryAddress.trim()) {
                      setDeliveryAddress(addressHint);
                    }
                  }}
                />

                <div>
                  <label htmlFor="sl-address" className={labelClass}>Street address *</label>
                  <textarea
                    id="sl-address"
                    required
                    maxLength={LIMITS.address}
                    value={deliveryAddress}
                    onChange={(e) => { setDeliveryAddress(e.target.value); clearFieldError('deliveryAddress'); }}
                    rows={3}
                    aria-invalid={!!fieldErrors.deliveryAddress}
                    aria-describedby={fieldErrors.deliveryAddress ? 'sl-address-err' : 'sl-address-hint'}
                    className={`${fieldClass}${errClass('deliveryAddress')}`}
                    placeholder="House number, street, and a landmark"
                  />
                  {fieldErrors.deliveryAddress ? (
                    <p id="sl-address-err" className={errorTextClass}>{fieldErrors.deliveryAddress}</p>
                  ) : (
                    <p id="sl-address-hint" className="mt-1.5 text-xs text-stone-500 text-pretty">
                      Add the door details after choosing the area above.
                    </p>
                  )}
                </div>

                <fieldset>
                  <legend className={labelClass}>Delivery method *</legend>
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
                          className={`flex cursor-pointer items-start justify-between gap-3 rounded-2xl border p-4 transition-[border-color,background-color,box-shadow] duration-150 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-gsg-purple/30 ${
                            selected
                              ? 'border-gsg-purple bg-[#faf7ff] shadow-[0_0_0_1px_#6B21A8]'
                              : 'border-stone-200 bg-[#faf8f5] hover:border-stone-300'
                          }`}
                        >
                          <div className="flex min-w-0 items-start gap-3">
                            <span
                              aria-hidden="true"
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
                            {kmValue > 0 && settings.loaded ? ghs(preview.fee) : '—'}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {kmValue <= 0 && (
                    <p className="mt-2 text-xs text-stone-500">
                      Type your delivery area above to see the fees.
                    </p>
                  )}
                </fieldset>
                <div>
                  <label htmlFor="sl-time" className={labelClass}>Preferred time</label>
                  <input
                    id="sl-time"
                    type="text"
                    maxLength={LIMITS.preferredTime}
                    value={preferredTime}
                    onChange={(e) => setPreferredTime(e.target.value)}
                    className={fieldClass}
                    placeholder="Tomorrow morning"
                  />
                </div>
                <div>
                  <label htmlFor="sl-notes" className={labelClass}>Notes for the shopper</label>
                  <textarea
                    id="sl-notes"
                    maxLength={LIMITS.notes}
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
                  <dt>Markup{markupPct !== null ? `, ${markupPct}%` : ''}</dt>
                  <dd className="tabular-nums text-white">{previewReady ? ghs(markup) : '—'}</dd>
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
                  <dd className="tabular-nums text-white">{kmValue > 0 && settings.loaded ? ghs(deliveryFee) : '—'}</dd>
                </div>
                <div className="flex justify-between gap-4 text-white/50">
                  <dt>Sourcing fee</dt>
                  <dd>Only if agreed with you</dd>
                </div>
              </dl>
              <div className="mx-6 border-t border-dashed border-white/15" />
              <div className="flex items-end justify-between px-6 py-5">
                <p className="text-xs uppercase tracking-[0.16em] text-white/50">Preview</p>
                <p className="font-serif text-4xl tabular-nums text-gsg-accent">{previewReady ? ghs(total) : '—'}</p>
              </div>
              <div className="px-6 pb-6">
                <p className="mb-2 text-xs leading-relaxed text-white/55 text-pretty">
                  This preview is a guide. When you send the list, our system works out your estimate and shows it on the next page before you pay. {FINAL_AMOUNT_NOTE}
                </p>
                <p className="mb-4 text-xs leading-relaxed text-white/55 text-pretty">{REFUND_NOTE}</p>
                <button
                  type="submit"
                  disabled={loading || items.length === 0}
                  aria-busy={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-4 text-sm font-semibold text-gsg-black transition-[background-color,transform] duration-150 hover:bg-gsg-accent active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <i className="ri-loader-4-line animate-spin text-xl" aria-hidden="true"></i>
                      Sending your list…
                    </>
                  ) : (
                    <>
                      <i className="ri-secure-payment-line text-lg" aria-hidden="true"></i>
                      Send list and see estimate
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
