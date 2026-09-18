'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

type ShopperItem = {
  id: string;
  name_brand: string;
  qty_size_range: string;
  source_type: string | null;
  remark: string | null;
  estimated_price: number;
  market_price: number | null;
};

type StatusEvent = {
  id: string;
  status: string;
  note: string | null;
  created_at: string;
};

type ShopperRequest = {
  id: string;
  request_number: string | null;
  status: string;
  payment_status: string | null;
  payment_provider: string | null;
  payment_method: string | null;
  paid_at: string | null;
  subtotal_est: number;
  markup: number;
  delivery_fee: number | null;
  total_est: number;
  total_final: number | null;
  contact_name: string;
  contact_phone: string;
  contact_email: string | null;
  delivery_address: {
    text?: string;
    location_label?: string | null;
    km?: number | null;
    method?: string | null;
    lat?: number | null;
    lng?: number | null;
  } | null;
  preferred_time: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
  items: ShopperItem[];
  history: StatusEvent[];
};

const STATUS_OPTIONS = [
  'SUBMITTED',
  'REVIEWING',
  'SOURCING',
  'AWAITING_CONFIRMATION',
  'PAID',
  'SHOPPING',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
] as const;

// Workflow order: customer pays the estimate UPFRONT (right after submission),
// then admin works the request and may need to cancel + refund along the way.
const WORKFLOW_STEPS: Array<{ key: string; label: string; hint?: string }> = [
  { key: 'SUBMITTED',             label: 'Submitted' },
  { key: 'PAID',                  label: 'Paid',                 hint: 'Customer paid the estimate' },
  { key: 'REVIEWING',             label: 'Reviewing',            hint: 'Call customer to clarify the list' },
  { key: 'SOURCING',              label: 'Sourcing',             hint: 'Check market prices' },
  { key: 'AWAITING_CONFIRMATION', label: 'Awaiting Confirmation', hint: 'Customer approves price changes' },
  { key: 'SHOPPING',              label: 'Shopping' },
  { key: 'OUT_FOR_DELIVERY',      label: 'Out for Delivery' },
  { key: 'DELIVERED',             label: 'Delivered' },
];

// Workflow steps that come AT or BEFORE PAID — used to mark the PAID step as
// completed in the stepper if payment_status='paid' but admin hasn't moved
// status forward yet.
const STEPS_BEFORE_PAID = new Set(['SUBMITTED']);

const STATUS_STYLES: Record<string, { pill: string; dot: string; ring: string }> = {
  SUBMITTED:             { pill: 'bg-gray-100 text-gray-700 border-gray-200',           dot: 'bg-gray-400',   ring: 'ring-gray-200' },
  REVIEWING:             { pill: 'bg-blue-50 text-blue-700 border-blue-200',           dot: 'bg-blue-500',   ring: 'ring-blue-200' },
  SOURCING:              { pill: 'bg-purple-50 text-purple-700 border-purple-200',     dot: 'bg-purple-500', ring: 'ring-purple-200' },
  AWAITING_CONFIRMATION: { pill: 'bg-yellow-50 text-yellow-800 border-yellow-200',     dot: 'bg-yellow-500', ring: 'ring-yellow-200' },
  PAID:                  { pill: 'bg-green-50 text-green-700 border-green-200',         dot: 'bg-green-500',  ring: 'ring-green-200' },
  SHOPPING:              { pill: 'bg-indigo-50 text-indigo-700 border-indigo-200',     dot: 'bg-indigo-500', ring: 'ring-indigo-200' },
  OUT_FOR_DELIVERY:      { pill: 'bg-orange-50 text-orange-700 border-orange-200',     dot: 'bg-orange-500', ring: 'ring-orange-200' },
  DELIVERED:             { pill: 'bg-teal-50 text-teal-700 border-teal-200',           dot: 'bg-teal-500',   ring: 'ring-teal-200' },
  CANCELLED:             { pill: 'bg-red-50 text-red-700 border-red-200',               dot: 'bg-red-500',    ring: 'ring-red-200' },
};

const fmtGHS = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : `GH₵${Number(n).toFixed(2)}`;

const fmtDateTime = (s?: string | null) =>
  !s ? '' : new Date(s).toLocaleString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

const initials = (name?: string | null) =>
  (name || 'GS')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]!.toUpperCase())
    .join('');

export default function AdminShopperRequestDetail({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [request, setRequest] = useState<ShopperRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const [deliveryFeeInput, setDeliveryFeeInput] = useState<string>('');
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeMsg, setFinalizeMsg] = useState<string | null>(null);
  const [itemSavingId, setItemSavingId] = useState<string | null>(null);
  const [itemSavedId, setItemSavedId] = useState<string | null>(null);

  useEffect(() => { params.then(p => setId(p.id)); }, [params]);
  useEffect(() => { if (id) fetchRequest(id); }, [id]);
  useEffect(() => {
    if (request) setDeliveryFeeInput(String(request.delivery_fee ?? 0));
  }, [request?.id, request?.delivery_fee]);

  const fetchRequest = async (requestId: string) => {
    try {
      const { data, error } = await supabase
        .from('shopper_requests')
        .select(`
          *,
          items:shopper_request_items(*),
          history:shopper_status_history(*)
        `)
        .eq('id', requestId)
        .single();

      if (error) throw error;
      setRequest(data as ShopperRequest);
    } catch (err) {
      console.error('Error fetching request:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (newStatus: string) => {
    if (!request || newStatus === request.status) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('shopper_requests')
        .update({ status: newStatus })
        .eq('id', request.id);
      if (error) throw error;

      await supabase.from('shopper_status_history').insert({
        request_id: request.id,
        status: newStatus,
        note: `Status updated to ${newStatus} by admin`,
      });

      if (id) fetchRequest(id);
    } catch (err) {
      console.error('Error updating status:', err);
      alert('Failed to update status');
    } finally {
      setSaving(false);
    }
  };

  const callFinalize = async (sendPaymentLink: boolean) => {
    if (!request) return;
    setFinalizing(true);
    setFinalizeMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        setFinalizeMsg('You appear to be signed out — please log in again.');
        return;
      }

      const deliveryFee = parseFloat(deliveryFeeInput);
      const res = await fetch(`/api/shopper/requests/${request.id}/finalize`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          deliveryFee: Number.isFinite(deliveryFee) ? deliveryFee : undefined,
          setStatus: true,
          sendPaymentLink,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to finalise request');

      setFinalizeMsg(
        sendPaymentLink
          ? `Total set at GH₵${Number(data.request.total_final).toFixed(2)} and payment link sent to customer.`
          : `Total saved at GH₵${Number(data.request.total_final).toFixed(2)}.`,
      );
      if (id) fetchRequest(id);
    } catch (err: any) {
      setFinalizeMsg(err.message || 'Failed to finalise request');
    } finally {
      setFinalizing(false);
    }
  };

  const updateItemMarketPrice = async (itemId: string, price: string) => {
    const parsed = parseFloat(price);
    const value = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;

    setItemSavingId(itemId);
    setItemSavedId(null);
    try {
      const { error } = await supabase
        .from('shopper_request_items')
        .update({ market_price: value })
        .eq('id', itemId);
      if (error) throw error;

      setRequest((prev) => !prev ? prev : ({
        ...prev,
        items: prev.items.map(it => it.id === itemId ? { ...it, market_price: value } : it),
      }));
      setItemSavedId(itemId);
      setTimeout(() => setItemSavedId(curr => curr === itemId ? null : curr), 1500);
    } catch (err) {
      console.error('Error updating price:', err);
    } finally {
      setItemSavingId(curr => curr === itemId ? null : curr);
    }
  };

  const marketSubtotal = useMemo(() => {
    if (!request) return 0;
    return request.items.reduce((s, it) => s + (Number(it.market_price ?? 0) || 0), 0);
  }, [request]);

  const liveTotal = useMemo(() => {
    const deliveryFee = parseFloat(deliveryFeeInput);
    const fee = Number.isFinite(deliveryFee) ? deliveryFee : 0;
    return marketSubtotal * 1.05 + fee;
  }, [marketSubtotal, deliveryFeeInput]);

  const allItemsPriced = !!request && request.items.every(it => it.market_price !== null && Number(it.market_price) > 0);

  const isCancelled = request?.status === 'CANCELLED';
  const isPaid = request?.payment_status === 'paid';

  // The "active" step in the stepper. CANCELLED is rendered separately, so we
  // treat the request as off the stepper entirely. If the customer has paid but
  // the admin hasn't moved status past PAID, we visually advance to PAID.
  const activeStepIndex = (() => {
    if (!request || isCancelled) return -1;
    const i = WORKFLOW_STEPS.findIndex(s => s.key === request.status);
    if (isPaid && (i === -1 || (request.status && STEPS_BEFORE_PAID.has(request.status)))) {
      return WORKFLOW_STEPS.findIndex(s => s.key === 'PAID');
    }
    return i;
  })();

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!request) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center">
          <i className="ri-error-warning-line text-4xl text-red-500 mb-2 block" />
          <h1 className="text-xl font-bold text-gray-900 mb-1">Request not found</h1>
          <p className="text-gray-500 mb-6">It may have been deleted or you typed the wrong URL.</p>
          <button
            onClick={() => router.back()}
            className="px-5 py-2.5 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800"
          >
            Back to Requests
          </button>
        </div>
      </div>
    );
  }

  const statusStyle = STATUS_STYLES[request.status] ?? STATUS_STYLES.SUBMITTED;
  const addressText = request.delivery_address?.text || '';
  const addressLabel = request.delivery_address?.location_label || '';
  const addressKm =
    typeof request.delivery_address?.km === 'number' && request.delivery_address.km > 0
      ? request.delivery_address.km
      : null;

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <button
        onClick={() => router.back()}
        className="text-gray-500 hover:text-gray-900 mb-4 flex items-center gap-1 text-sm font-medium"
      >
        <i className="ri-arrow-left-line" /> Back to Requests
      </button>

      {/* HEADER CARD */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 md:p-8 mb-6">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
                {request.request_number ? request.request_number : 'Request Details'}
              </h1>
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${statusStyle.pill}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
                {request.status.replace(/_/g, ' ')}
              </span>
              {request.payment_status === 'paid' && (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold border bg-emerald-50 text-emerald-700 border-emerald-200">
                  <i className="ri-checkbox-circle-fill" /> Paid
                  {request.payment_provider ? ` · ${request.payment_provider}` : ''}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500">
              <span className="font-mono">{request.id}</span>
            </p>
            <p className="text-sm text-gray-500 mt-1">
              <i className="ri-time-line mr-1" />
              Submitted {fmtDateTime(request.created_at)}
              {request.paid_at && (
                <>
                  <span className="mx-2 text-gray-300">·</span>
                  Paid {fmtDateTime(request.paid_at)}
                </>
              )}
            </p>
          </div>

          <div className="flex flex-col items-end gap-3 shrink-0">
            <div className="text-right">
              <p className="text-xs text-gray-500">Customer pays</p>
              <p className="text-3xl font-bold text-gray-900">
                {fmtGHS(request.total_final ?? request.total_est)}
              </p>
            </div>
            <a
              href={`/shopper/pay/${request.id}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-purple-700 hover:underline inline-flex items-center gap-1"
            >
              <i className="ri-external-link-line" /> Open customer pay page
            </a>
          </div>
        </div>

        {/* STEPPER (or CANCELLED banner) */}
        {isCancelled ? (
          <div className="mt-8 rounded-xl border-2 border-red-200 bg-red-50 p-5 flex flex-col md:flex-row md:items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-red-500 text-white flex items-center justify-center shrink-0">
              <i className="ri-close-circle-line text-2xl" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-red-900 text-base">Request cancelled</h3>
              <p className="text-sm text-red-800 mt-0.5">
                This request ended before delivery.
                {isPaid
                  ? ' The customer paid — issue a refund if you have not already.'
                  : ' No payment was captured.'}
              </p>
            </div>
            {isPaid && (
              <a
                href="https://dashboard.paystack.com/#/transactions"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-bold text-red-700 hover:text-red-900 inline-flex items-center gap-1 whitespace-nowrap"
              >
                <i className="ri-external-link-line" /> Open gateway dashboard
              </a>
            )}
          </div>
        ) : (
          <div className="mt-8 -mx-6 md:-mx-8 px-6 md:px-8 overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="flex items-start">
                {WORKFLOW_STEPS.map((step, i) => {
                  const isPast = activeStepIndex > i;
                  const isCurrent = activeStepIndex === i;
                  const isFuture = activeStepIndex < i;
                  const stepStyle = STATUS_STYLES[step.key] ?? STATUS_STYLES.SUBMITTED;
                  return (
                    <div key={step.key} className="flex-1 flex items-start last:flex-initial">
                      <div className="flex flex-col items-center min-w-0 px-1">
                        <div
                          className={[
                            'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all',
                            isPast ? `${stepStyle.dot} text-white border-transparent` : '',
                            isCurrent ? `${stepStyle.dot} text-white border-transparent ring-4 ${stepStyle.ring}` : '',
                            isFuture ? 'bg-white text-gray-300 border-gray-200' : '',
                          ].join(' ')}
                        >
                          {isPast ? <i className="ri-check-line" /> : i + 1}
                        </div>
                        <span
                          className={[
                            'mt-2 text-[11px] font-bold whitespace-nowrap',
                            isPast || isCurrent ? 'text-gray-900' : 'text-gray-400',
                          ].join(' ')}
                        >
                          {step.label}
                        </span>
                        {step.hint && (isCurrent || isPast) && (
                          <span className="mt-0.5 text-[10px] text-gray-400 max-w-[120px] text-center leading-tight">
                            {step.hint}
                          </span>
                        )}
                        {/* Side-branch hint under AWAITING_CONFIRMATION */}
                        {step.key === 'AWAITING_CONFIRMATION' && (
                          <span className="mt-1 text-[10px] text-red-500 font-bold whitespace-nowrap inline-flex items-center gap-1">
                            <i className="ri-arrow-right-down-line" /> or Cancel & Refund
                          </span>
                        )}
                      </div>
                      {i < WORKFLOW_STEPS.length - 1 && (
                        <div
                          className={[
                            'flex-1 h-0.5 mx-1 mt-4 transition-all',
                            isPast ? 'bg-gray-900' : 'bg-gray-200',
                          ].join(' ')}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* STATUS QUICK ACTIONS */}
        <div className="mt-6 flex flex-wrap gap-2 items-center pt-6 border-t border-gray-100">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-500 mr-2">Move to:</span>
          {STATUS_OPTIONS
            .filter(s => s !== request.status && s !== 'CANCELLED')
            .map((s) => {
              const ss = STATUS_STYLES[s];
              return (
                <button
                  key={s}
                  onClick={() => updateStatus(s)}
                  disabled={saving}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${ss.pill} hover:scale-[1.02] transition-all disabled:opacity-50`}
                >
                  {s.replace(/_/g, ' ')}
                </button>
              );
            })}
          {/* CANCELLED is a destructive terminal action — separated and confirmed */}
          {request.status !== 'CANCELLED' && (
            <button
              onClick={() => {
                const msg = isPaid
                  ? 'Cancel this request? The customer has already paid — remember to issue a refund through the payment gateway.'
                  : 'Cancel this request?';
                if (confirm(msg)) updateStatus('CANCELLED');
              }}
              disabled={saving}
              className="ml-auto px-3 py-1.5 rounded-lg text-xs font-bold border bg-red-50 text-red-700 border-red-200 hover:bg-red-100 transition-all disabled:opacity-50 inline-flex items-center gap-1.5"
              title={isPaid ? 'Customer has paid — refund will be required' : 'Cancel this request'}
            >
              <i className="ri-close-circle-line" />
              Cancel{isPaid ? ' & Refund' : ''}
            </button>
          )}
          {saving && (
            <span className="text-xs text-gray-400 inline-flex items-center gap-1.5">
              <i className="ri-loader-4-line animate-spin" /> Saving…
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT — ITEMS */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <i className="ri-shopping-bag-line text-purple-600 text-lg" />
                <h2 className="text-lg font-bold text-gray-900">Items ({request.items.length})</h2>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Market subtotal</p>
                <p className="text-lg font-bold text-gray-900">{fmtGHS(marketSubtotal)}</p>
              </div>
            </div>

            <ul className="divide-y divide-gray-100">
              {request.items.map((item) => {
                const est = Number(item.estimated_price) || 0;
                const mkt = item.market_price === null ? null : Number(item.market_price) || 0;
                const hasMarket = mkt !== null && mkt > 0;
                const diff = hasMarket ? mkt! - est : 0;
                const diffPct = est > 0 && hasMarket ? (diff / est) * 100 : 0;
                const saving = itemSavingId === item.id;
                const saved = itemSavedId === item.id;

                return (
                  <li key={item.id} className="p-6 hover:bg-gray-50/60 transition-colors">
                    <div className="flex flex-col md:flex-row md:items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-gray-900 break-words">{item.name_brand}</h3>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-gray-500">
                          <span><i className="ri-stack-line mr-1" />{item.qty_size_range}</span>
                          {item.source_type && (
                            <span className="text-purple-600 font-medium"><i className="ri-map-pin-line mr-1" />{item.source_type}</span>
                          )}
                        </div>
                        {item.remark && (
                          <p className="text-sm text-gray-500 mt-2 italic bg-gray-50 border-l-2 border-gray-200 pl-3 py-1">
                            "{item.remark}"
                          </p>
                        )}
                      </div>

                      <div className="md:w-72 shrink-0 grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] uppercase tracking-wider font-bold text-gray-400 block">Est.</label>
                          <div className="font-bold text-gray-900 mt-1">{fmtGHS(est)}</div>
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-wider font-bold text-purple-600 flex items-center gap-1">
                            Market
                            {saving && <i className="ri-loader-4-line animate-spin text-purple-500" />}
                            {saved && <i className="ri-check-line text-green-600" />}
                          </label>
                          <div className="relative mt-1">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">GH₵</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              defaultValue={item.market_price ?? ''}
                              onBlur={(e) => {
                                if (parseFloat(e.target.value || '0') !== Number(item.market_price ?? 0)) {
                                  updateItemMarketPrice(item.id, e.target.value);
                                }
                              }}
                              className="w-full pl-10 pr-2 py-1.5 border border-purple-200 rounded-lg outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-100 text-sm font-medium"
                              placeholder="0.00"
                            />
                          </div>
                          {hasMarket && est > 0 && (
                            <p className={`text-[11px] mt-1 font-bold ${diff > 0 ? 'text-red-600' : diff < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                              {diff > 0 ? '+' : ''}{diffPct.toFixed(1)}% vs est.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            {!allItemsPriced && (
              <div className="px-6 py-3 bg-yellow-50 border-t border-yellow-100 text-xs text-yellow-800 flex items-center gap-2">
                <i className="ri-information-line" />
                {request.items.filter(it => !it.market_price).length} item(s) still need a market price before you can finalise the total.
              </div>
            )}
          </div>

          {/* TIMELINE */}
          {request.history?.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <i className="ri-history-line text-gray-600 text-lg" />
                <h2 className="text-lg font-bold text-gray-900">Activity</h2>
              </div>
              <ol className="relative border-l-2 border-gray-100 ml-2 space-y-5">
                {[...request.history].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)).map((evt) => {
                  const ss = STATUS_STYLES[evt.status] ?? STATUS_STYLES.SUBMITTED;
                  return (
                    <li key={evt.id} className="pl-5 relative">
                      <span
                        className={`absolute -left-[7px] top-1 w-3 h-3 rounded-full ring-4 ring-white ${ss.dot}`}
                      />
                      <div className="flex flex-wrap items-center gap-2 mb-0.5">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-md border ${ss.pill}`}>
                          {evt.status.replace(/_/g, ' ')}
                        </span>
                        <span className="text-xs text-gray-400">{fmtDateTime(evt.created_at)}</span>
                      </div>
                      {evt.note && <p className="text-sm text-gray-600">{evt.note}</p>}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>

        {/* RIGHT — CUSTOMER + FINANCIALS + PAYMENT */}
        <div className="space-y-6">
          {/* Customer */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <i className="ri-user-line text-purple-600" /> Customer
            </h2>
            <div className="flex items-start gap-3 mb-5 pb-5 border-b border-gray-100">
              <div className="w-12 h-12 rounded-full bg-purple-100 text-purple-700 font-bold flex items-center justify-center text-sm shrink-0">
                {initials(request.contact_name)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-gray-900 truncate">{request.contact_name}</p>
                <a
                  href={`tel:${request.contact_phone}`}
                  className="text-sm text-gray-600 hover:text-purple-700 inline-flex items-center gap-1.5"
                >
                  <i className="ri-phone-line text-gray-400" /> {request.contact_phone}
                </a>
                {request.contact_email && (
                  <div>
                    <a
                      href={`mailto:${request.contact_email}`}
                      className="text-sm text-gray-600 hover:text-purple-700 inline-flex items-center gap-1.5 truncate max-w-full"
                    >
                      <i className="ri-mail-line text-gray-400" /> {request.contact_email}
                    </a>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Delivery address</p>
                {(addressLabel || addressKm != null) && (
                  <p className="text-gray-700 mt-0.5 text-sm">
                    {addressLabel || 'Selected area'}
                    {addressKm != null ? ` · ${addressKm.toFixed(1)} km from hub` : ''}
                  </p>
                )}
                {request.delivery_address?.method && (
                  <p className="text-purple-700 mt-0.5 text-xs font-semibold">
                    {request.delivery_address.method === 'joint-express'
                      ? 'Joint Express – Myself & Neighbor (Daily)'
                      : 'Sole Express Delivery (Daily)'}
                  </p>
                )}
                <p className="text-gray-900 mt-0.5">{addressText || '—'}</p>
                {(() => {
                  const pinLat = request.delivery_address?.lat;
                  const pinLng = request.delivery_address?.lng;
                  const hasPin = typeof pinLat === 'number' && typeof pinLng === 'number';
                  if (!hasPin && !addressText && !addressLabel) return null;
                  const href = hasPin
                    ? `https://www.google.com/maps/dir/?api=1&destination=${pinLat},${pinLng}`
                    : `https://www.google.com/maps/search/${encodeURIComponent(addressLabel || addressText)}`;
                  return (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-purple-700 hover:underline inline-flex items-center gap-1 mt-1"
                    >
                      <i className="ri-map-pin-line" />
                      {hasPin ? 'Navigate to exact pin (Google Maps)' : 'Open in Google Maps'}
                    </a>
                  );
                })()}
              </div>
              {request.preferred_time && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Preferred time</p>
                  <p className="text-gray-900 mt-0.5">{request.preferred_time}</p>
                </div>
              )}
              {request.notes && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Customer notes</p>
                  <p className="text-gray-900 mt-0.5 whitespace-pre-wrap">{request.notes}</p>
                </div>
              )}
            </div>
          </div>

          {/* Financials */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <i className="ri-money-dollar-circle-line text-purple-600" /> Financials
            </h2>
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">Est. subtotal</dt>
                <dd className="font-medium text-gray-700">{fmtGHS(request.subtotal_est)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Est. markup (5%)</dt>
                <dd className="font-medium text-gray-700">{fmtGHS(request.markup)}</dd>
              </div>
              <div className="flex justify-between border-t border-gray-100 pt-2.5">
                <dt className="text-gray-600 font-medium">Customer estimate</dt>
                <dd className="font-bold text-gray-900">{fmtGHS(request.total_est)}</dd>
              </div>
            </dl>

            {marketSubtotal > 0 && (
              <>
                <div className="border-t border-dashed border-gray-200 my-4" />
                <dl className="space-y-2.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Market subtotal</dt>
                    <dd className="font-medium text-gray-700">{fmtGHS(marketSubtotal)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Markup (5%)</dt>
                    <dd className="font-medium text-gray-700">{fmtGHS(marketSubtotal * 0.05)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Delivery fee</dt>
                    <dd className="font-medium text-gray-700">{fmtGHS(parseFloat(deliveryFeeInput) || 0)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-gray-100 pt-2.5">
                    <dt className="text-gray-700 font-bold">Live total {request.total_final !== null && '(saved: ' + fmtGHS(request.total_final) + ')'}</dt>
                    <dd className="font-bold text-purple-700 text-base">{fmtGHS(liveTotal)}</dd>
                  </div>
                </dl>
              </>
            )}
          </div>

          {/* Payment */}
          {request.payment_status !== 'paid' ? (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-1 flex items-center gap-2">
                <i className="ri-secure-payment-line text-purple-600" /> Payment
              </h2>
              <p className="text-xs text-gray-500 mb-5 leading-relaxed">
                Enter the actual market price on each item, set a delivery fee (if any), then send the customer a payment link.
              </p>

              <label className="text-[10px] uppercase tracking-wider font-bold text-gray-400 block mb-1">
                Delivery fee (GHS)
              </label>
              <div className="relative mb-4">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">GH₵</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={deliveryFeeInput}
                  onChange={(e) => setDeliveryFeeInput(e.target.value)}
                  disabled={finalizing}
                  className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-100 text-sm"
                  placeholder="0.00"
                />
              </div>

              {finalizeMsg && (
                <div className={`text-xs p-3 rounded-lg mb-4 border ${finalizeMsg.startsWith('Total') ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                  <i className={`mr-1.5 ${finalizeMsg.startsWith('Total') ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'}`} />
                  {finalizeMsg}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => callFinalize(true)}
                  disabled={finalizing || !allItemsPriced}
                  className="w-full px-4 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 shadow-sm"
                >
                  {finalizing
                    ? <><i className="ri-loader-4-line animate-spin" /> Sending…</>
                    : <><i className="ri-send-plane-line" /> Save total & send payment link</>}
                </button>
                <button
                  type="button"
                  onClick={() => callFinalize(false)}
                  disabled={finalizing || !allItemsPriced}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save total without notifying
                </button>
                {!allItemsPriced && (
                  <p className="text-[11px] text-gray-400 text-center">
                    Fill in every market price first.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-emerald-200 rounded-2xl p-6">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0">
                  <i className="ri-check-line text-xl" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-emerald-900">Payment received</h3>
                  <p className="text-2xl font-bold text-emerald-700 mt-1">
                    {fmtGHS(request.total_final ?? request.total_est)}
                  </p>
                  <p className="text-xs text-emerald-700 mt-2">
                    {request.payment_provider && <>via <span className="font-bold capitalize">{request.payment_provider}</span> · </>}
                    {fmtDateTime(request.paid_at)}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
