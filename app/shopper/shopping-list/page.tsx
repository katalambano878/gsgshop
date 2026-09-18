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

  return (
    <div className="bg-gray-50 min-h-screen py-12">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-gsg-black mb-4">Create Your Shopping List</h1>
          <p className="text-gray-600">
            List the items you need, and we&apos;ll source them for you at market price.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-8 border border-red-100">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-100">
            <h2 className="text-xl font-bold text-gsg-black mb-6">Items</h2>

            <div className="space-y-6">
              {items.map((item, index) => (
                <div
                  key={item.id}
                  className="relative p-4 md:p-6 border border-gray-200 rounded-xl bg-gray-50/50"
                >
                  <div className="absolute -top-3 -left-3 w-8 h-8 bg-gsg-purple text-white rounded-full flex items-center justify-center font-bold text-sm">
                    {index + 1}
                  </div>
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="absolute top-4 right-4 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <i className="ri-delete-bin-line text-xl"></i>
                    </button>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mt-2">
                    <div className="md:col-span-4">
                      <label className="block text-xs font-bold text-gray-700 mb-1">
                        Item Name / Brand *
                      </label>
                      <input
                        type="text"
                        required
                        value={item.nameBrand}
                        onChange={(e) => updateItem(item.id, 'nameBrand', e.target.value)}
                        className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gsg-purple outline-none"
                        placeholder="e.g. Milo Cereal 500g"
                      />
                    </div>
                    <div className="md:col-span-3">
                      <label className="block text-xs font-bold text-gray-700 mb-1">
                        Qty / Size / Range *
                      </label>
                      <input
                        type="text"
                        required
                        value={item.qtySizeRange}
                        onChange={(e) => updateItem(item.id, 'qtySizeRange', e.target.value)}
                        className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gsg-purple outline-none"
                        placeholder="e.g. 2 packs"
                      />
                    </div>
                    <div className="md:col-span-3">
                      <label className="block text-xs font-bold text-gray-700 mb-1">
                        Est. Price (GHS) *
                      </label>
                      <input
                        type="number"
                        required
                        min="0"
                        step="0.01"
                        value={item.estimatedPrice}
                        onChange={(e) => updateItem(item.id, 'estimatedPrice', e.target.value)}
                        className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gsg-purple outline-none"
                        placeholder="0.00"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-gray-700 mb-1">
                        Produce Source
                      </label>
                      <select
                        value={item.sourceType}
                        onChange={(e) => updateItem(item.id, 'sourceType', e.target.value)}
                        className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gsg-purple outline-none text-sm"
                      >
                        <option value="">N/A</option>
                        <option value="Local Market">Local Market</option>
                        <option value="Imported">Imported</option>
                        <option value="Controlled Environment">Controlled Env.</option>
                      </select>
                    </div>
                    <div className="md:col-span-12">
                      <label className="block text-xs font-bold text-gray-700 mb-1">
                        Remarks / Comments
                      </label>
                      <input
                        type="text"
                        value={item.remark}
                        onChange={(e) => updateItem(item.id, 'remark', e.target.value)}
                        className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gsg-purple outline-none"
                        placeholder="Any specific instructions for this item?"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addItem}
              className="mt-6 flex items-center gap-2 text-gsg-purple font-bold hover:text-gsg-purple-dark transition-colors"
            >
              <i className="ri-add-circle-line text-xl"></i> Add Another Item
            </button>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-100">
              <h2 className="text-xl font-bold text-gsg-black mb-6">Contact & Delivery</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gsg-purple outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">
                    Phone Number *
                  </label>
                  <input
                    type="tel"
                    required
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gsg-purple outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">
                    Email (Optional)
                  </label>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gsg-purple outline-none"
                  />
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
                  <label className="block text-sm font-bold text-gray-700 mb-1">
                    Delivery Address *
                  </label>
                  <textarea
                    required
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    rows={3}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gsg-purple outline-none"
                    placeholder="Street, house number, and landmarks"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Add street details after selecting your area above.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    Delivery Method *
                  </label>
                  <div className="space-y-3">
                    {SHOPPER_DELIVERY_OPTIONS.map((opt) => {
                      const preview = calculateDeliveryFee({
                        method: opt.value,
                        km: kmValue,
                        purchaseTotal: subtotal,
                        config: pricingConfig,
                      });
                      const selected = deliveryMethod === opt.value;
                      return (
                        <label
                          key={opt.value}
                          className={`flex items-start justify-between gap-3 p-4 border-2 rounded-xl cursor-pointer transition-all ${
                            selected
                              ? 'border-gsg-purple bg-purple-50'
                              : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-start gap-3 min-w-0">
                            <div
                              className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                                selected ? 'border-gsg-purple' : 'border-gray-300'
                              }`}
                            >
                              {selected && <div className="w-2.5 h-2.5 rounded-full bg-gsg-purple"></div>}
                            </div>
                            <input
                              type="radio"
                              name="shopper-delivery"
                              value={opt.value}
                              checked={selected}
                              onChange={() => setDeliveryMethod(opt.value)}
                              className="hidden"
                            />
                            <div className="min-w-0">
                              <p className={`font-bold text-sm ${selected ? 'text-gsg-purple' : 'text-gsg-black'}`}>
                                {opt.label}
                              </p>
                              <p className="text-xs text-gray-500 mt-1 leading-relaxed text-pretty">{opt.desc}</p>
                            </div>
                          </div>
                          <p
                            className={`text-sm font-bold shrink-0 tabular-nums ${
                              selected ? 'text-gsg-purple' : 'text-gsg-black'
                            }`}
                          >
                            {kmValue > 0 ? `GH₵${preview.fee.toFixed(2)}` : '—'}
                          </p>
                        </label>
                      );
                    })}
                  </div>
                  {kmValue <= 0 && (
                    <p className="text-xs text-gray-500 mt-2">
                      Type your delivery area above to see the exact fees.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">
                    Preferred Delivery Time
                  </label>
                  <input
                    type="text"
                    value={preferredTime}
                    onChange={(e) => setPreferredTime(e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gsg-purple outline-none"
                    placeholder="e.g. Tomorrow morning, Today by 5pm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">
                    General Notes
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gsg-purple outline-none"
                  />
                </div>
              </div>
            </div>

            <div>
              <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-100 sticky top-24">
                <h2 className="text-xl font-bold text-gsg-black mb-6">Estimate Summary</h2>

                <div className="space-y-4 mb-6">
                  <div className="flex justify-between text-gray-600">
                    <span>Items Subtotal (Est.)</span>
                    <span className="font-medium">GH₵{subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Markup (5% or less)</span>
                    <span className="font-medium">GH₵{markup.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600 text-sm">
                    <span>Distance</span>
                    <span className="font-medium tabular-nums">
                      {kmValue > 0 ? `${kmValue.toFixed(1)} km` : 'Select location'}
                    </span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>
                      Delivery Fee
                      <span className="block text-[11px] text-gray-400">
                        {deliveryMethod === 'sole-express'
                          ? 'Sole Express (Daily)'
                          : 'Joint Express – Myself & Neighbor'}
                      </span>
                    </span>
                    <span className="font-medium tabular-nums">
                      {kmValue > 0 ? `GH₵${deliveryFee.toFixed(2)}` : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between text-gray-600 text-sm italic">
                    <span>Sourcing Fee</span>
                    <span>If applicable</span>
                  </div>
                  <div className="border-t border-gray-200 pt-4 flex justify-between text-lg font-bold text-gsg-black">
                    <span>Total Estimate</span>
                    <span className="text-gsg-purple">GH₵{total.toFixed(2)}</span>
                  </div>
                </div>

                <div className="bg-purple-50 p-4 rounded-xl mb-6 text-sm text-purple-800">
                  <i className="ri-information-line mr-2"></i>
                  You&apos;ll pay this estimate upfront to lock in your shopper. If actual market
                  prices differ significantly, we&apos;ll contact you before delivery to adjust —
                  extra owed becomes a top-up, refunds are issued in 1–3 business days.
                </div>

                <button
                  type="submit"
                  disabled={loading || items.length === 0}
                  className="w-full bg-gsg-black hover:bg-gsg-purple text-white py-4 rounded-xl font-bold transition-all shadow-lg disabled:opacity-50 flex justify-center items-center gap-2"
                >
                  {loading ? (
                    <i className="ri-loader-4-line animate-spin text-xl"></i>
                  ) : (
                    <>
                      <i className="ri-secure-payment-line text-lg"></i>
                      Submit & Pay GH₵{total.toFixed(2)}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
