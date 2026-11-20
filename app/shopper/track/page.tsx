'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { isGhanaPhone } from '@/lib/phone';
import {
  FINAL_AMOUNT_NOTE,
  REFUND_NOTE,
  authHeaders,
  getAccessToken,
  ghs,
  isRequestPaid,
  isRequestPayable,
  readJson,
  recallShopperPhone,
  rememberShopperPhone,
  statusLabel,
  toNumber,
} from '../_lib/shopper-client';

const STATUS_STEPS = [
  'SUBMITTED', 'REVIEWING', 'SOURCING', 'AWAITING_CONFIRMATION', 'PAID', 'SHOPPING', 'OUT_FOR_DELIVERY', 'DELIVERED'
];

const STATUS_TEXT: Record<string, string> = {
  SUBMITTED: "We've received your list and will review it shortly.",
  REVIEWING: 'We are reviewing your items.',
  SOURCING: 'We are checking market prices for your items.',
  AWAITING_CONFIRMATION: 'We have priced your items and will confirm any changes with you on WhatsApp.',
  PAID: 'Payment received. We will start shopping soon.',
  SHOPPING: 'Our personal shopper is getting your items.',
  OUT_FOR_DELIVERY: 'Your items are on the way to you.',
  DELIVERED: 'Your order has been delivered.',
  CANCELLED: 'This request was cancelled. Message us on WhatsApp if you have a question.',
};

const SR_RE = /^SR-[A-Z0-9-]{3,40}$/;

type TrackedRequest = {
  id: string;
  request_number: string;
  status: string;
  payment_status: string;
  subtotal_est: number | null;
  total_final: number | null;
  delivery_method: string | null;
  created_at: string | null;
  items: Array<{ id: string; name: string; qty: string; price: number | null }>;
  history: Array<{ status: string; created_at: string | null; note: string | null }>;
};

type OwnSummary = {
  id: string;
  request_number: string;
  status: string;
  payment_status: string | null;
  total_final: number | null;
  created_at: string | null;
};

function normaliseRequest(raw: any): TrackedRequest {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  const history = Array.isArray(raw?.history) ? raw.history : [];
  return {
    id: String(raw?.id ?? ''),
    request_number: String(raw?.request_number ?? ''),
    status: String(raw?.status ?? ''),
    payment_status: String(raw?.payment_status ?? ''),
    subtotal_est: toNumber(raw?.subtotal_est),
    total_final: toNumber(raw?.total_final),
    delivery_method: typeof raw?.delivery_method === 'string' ? raw.delivery_method : null,
    created_at: typeof raw?.created_at === 'string' ? raw.created_at : null,
    items: items.map((it: any, i: number) => ({
      id: String(it?.id ?? i),
      name: String(it?.name_brand ?? it?.name ?? ''),
      qty: String(it?.qty_size_range ?? it?.qty ?? ''),
      price: toNumber(it?.market_price ?? it?.price ?? it?.estimated_price),
    })),
    history: history
      .map((h: any) => ({
        status: String(h?.status ?? ''),
        created_at: typeof h?.created_at === 'string' ? h.created_at : null,
        note: typeof h?.note === 'string' && h.note.trim() ? h.note : null,
      }))
      .sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at))),
  };
}

function formatDate(iso: string | null, withTime = false): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', withTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

function deliveryLabel(method: string | null): string | null {
  if (method === 'sole-express') return 'Sole Express';
  if (method === 'joint-express') return 'Joint Express';
  return method;
}

function TrackContent() {
  const searchParams = useSearchParams();
  const initialRef = (searchParams.get('ref') || searchParams.get('requestNumber') || '').trim().toUpperCase();

  const [searchRef, setSearchRef] = useState(initialRef);
  const [searchPhone, setSearchPhone] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ ref?: string; phone?: string }>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [request, setRequest] = useState<TrackedRequest | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [ownRequests, setOwnRequests] = useState<OwnSummary[]>([]);

  const fetchRequest = useCallback(async (params: URLSearchParams, rememberPhone?: string) => {
    setLoading(true);
    setError('');
    setRequest(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/shopper/requests?${params.toString()}`, {
        headers: authHeaders(token),
        cache: 'no-store',
      });
      const data = await readJson(res);
      if (res.ok && data?.request) {
        const req = normaliseRequest(data.request);
        setRequest(req);
        if (rememberPhone) rememberShopperPhone(rememberPhone, req.id, req.request_number);
        return;
      }
      if (res.status === 404 || res.status === 403) {
        setError('We could not find a request with that number and phone. Check both and try again.');
      } else if (res.status === 400) {
        setError('Enter your request number and the phone number you used.');
      } else if (res.status === 429) {
        setError('Too many tries. Please wait a minute and try again.');
      } else {
        setError('We could not load your request just now. Please try again in a moment.');
      }
    } catch {
      setError('We could not load your request just now. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Signed-in customers: list their own requests (database rules only return their rows).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user || cancelled) return;
      setSignedIn(true);
      const { data: rows } = await supabase
        .from('shopper_requests')
        .select('id, request_number, status, payment_status, total_final, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (!cancelled && Array.isArray(rows)) {
        setOwnRequests(
          rows.map((r: any) => ({
            id: String(r.id),
            request_number: String(r.request_number),
            status: String(r.status),
            payment_status: r.payment_status ?? null,
            total_final: toNumber(r.total_final),
            created_at: r.created_at ?? null,
          })),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Open a request passed in the link (?ref=SR-…), using the phone remembered
  // in this tab or the customer's session.
  useEffect(() => {
    if (!initialRef || !SR_RE.test(initialRef)) return;
    const remembered = recallShopperPhone(initialRef);
    if (remembered) setSearchPhone(remembered);
    (async () => {
      const token = await getAccessToken();
      if (!remembered && !token) return;
      const params = new URLSearchParams({ requestNumber: initialRef });
      if (remembered) params.set('phone', remembered);
      fetchRequest(params);
    })();
  }, [initialRef, fetchRequest]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const ref = searchRef.trim().toUpperCase();
    const phone = searchPhone.trim();
    const errs: { ref?: string; phone?: string } = {};
    if (!ref) errs.ref = 'Enter your request number.';
    else if (!SR_RE.test(ref)) errs.ref = 'Request numbers start with SR-, for example SR-1731234567-123.';
    if (!phone) errs.phone = 'Enter the phone number you used on the request.';
    else if (!isGhanaPhone(phone)) errs.phone = 'Enter a Ghana mobile number, for example 024 123 4567.';
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    fetchRequest(new URLSearchParams({ requestNumber: ref, phone }), phone);
  };

  const openOwn = (id: string) => {
    fetchRequest(new URLSearchParams({ id }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const inputClass =
    'w-full pl-12 pr-4 py-4 bg-gray-50 border rounded-xl focus:bg-white focus:ring-2 focus:ring-gsg-purple focus:border-transparent outline-none transition-all text-gray-800 text-base';

  return (
    <div className="bg-gray-50 min-h-screen">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gsg-black py-16 md:py-24">
        <div className="absolute inset-0 z-0">
          <Image
            src="/shopper/shopper_image_3.webp"
            alt=""
            fill
            className="object-cover"
            priority
            sizes="100vw"
          />
        </div>
        <div className="absolute inset-0 bg-black/30 z-[1]" />

        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center z-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-md text-white text-sm font-medium mb-6 ring-1 ring-white/30 shadow-lg">
            <i className="ri-map-pin-line text-gsg-accent" aria-hidden="true" />
            <span>Request status</span>
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-6 tracking-tight">Track Your Request</h1>
          <p className="text-lg md:text-xl text-purple-100 max-w-2xl mx-auto leading-relaxed">
            Enter your request number (it starts with SR-) and the phone number you used on your list.
          </p>
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 -mt-12 relative z-20 pb-20">
        <div className="bg-white p-6 md:p-10 rounded-[2rem] shadow-2xl border border-gray-100 mb-10">
          <form onSubmit={handleSearch} noValidate className="flex flex-col md:flex-row gap-5 items-start">
            <div className="w-full">
              <label htmlFor="track-ref" className="block text-sm font-medium text-gsg-black mb-1.5">
                Request number
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none" aria-hidden="true">
                  <i className="ri-hashtag text-gray-400 text-xl" />
                </div>
                <input
                  id="track-ref"
                  type="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  maxLength={48}
                  placeholder="SR-…"
                  value={searchRef}
                  onChange={(e) => { setSearchRef(e.target.value); setFieldErrors((p) => ({ ...p, ref: undefined })); }}
                  aria-invalid={!!fieldErrors.ref}
                  aria-describedby={fieldErrors.ref ? 'track-ref-err' : undefined}
                  className={`${inputClass} ${fieldErrors.ref ? 'border-red-400' : 'border-gray-200'}`}
                />
              </div>
              {fieldErrors.ref && <p id="track-ref-err" className="text-sm text-red-600 mt-1.5">{fieldErrors.ref}</p>}
            </div>

            <div className="w-full">
              <label htmlFor="track-phone" className="block text-sm font-medium text-gsg-black mb-1.5">
                Phone number used
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none" aria-hidden="true">
                  <i className="ri-phone-line text-gray-400 text-xl" />
                </div>
                <input
                  id="track-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={20}
                  placeholder="024 123 4567"
                  value={searchPhone}
                  onChange={(e) => { setSearchPhone(e.target.value); setFieldErrors((p) => ({ ...p, phone: undefined })); }}
                  aria-invalid={!!fieldErrors.phone}
                  aria-describedby={fieldErrors.phone ? 'track-phone-err' : undefined}
                  className={`${inputClass} ${fieldErrors.phone ? 'border-red-400' : 'border-gray-200'}`}
                />
              </div>
              {fieldErrors.phone && <p id="track-phone-err" className="text-sm text-red-600 mt-1.5">{fieldErrors.phone}</p>}
            </div>

            <button
              type="submit"
              disabled={loading}
              aria-busy={loading}
              className="w-full md:w-auto md:mt-7 bg-gsg-black hover:bg-gsg-purple text-white px-10 py-4 rounded-xl font-bold transition-all disabled:opacity-50 disabled:hover:bg-gsg-black flex items-center justify-center gap-2 shadow-lg hover:shadow-xl hover:-translate-y-0.5 shrink-0 text-base"
            >
              {loading ? (
                <>
                  <i className="ri-loader-4-line animate-spin text-xl" aria-hidden="true" />
                  <span className="sr-only">Searching</span>
                </>
              ) : (
                <>
                  <i className="ri-search-line text-lg" aria-hidden="true" />
                  Track
                </>
              )}
            </button>
          </form>
        </div>

        <div aria-live="polite">
          {error && (
            <div role="alert" className="bg-red-50 text-red-600 p-4 rounded-lg mb-8 border border-red-100 text-center">
              {error}
            </div>
          )}
        </div>

        {request && <RequestCard req={request} />}

        {signedIn && ownRequests.length > 0 && (
          <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-100">
            <h2 className="text-xl font-bold text-gsg-black mb-4">Your requests</h2>
            <ul className="divide-y divide-gray-100">
              {ownRequests.map((r) => (
                <li key={r.id} className="py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <div>
                    <p className="font-mono font-medium text-gsg-black">{r.request_number}</p>
                    <p className="text-gray-500">
                      {formatDate(r.created_at)} · {statusLabel(r.status)}
                      {isRequestPaid(r.payment_status) ? ' · Paid' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {r.total_final !== null && <span className="font-medium">{ghs(r.total_final)}</span>}
                    <button
                      type="button"
                      onClick={() => openOwn(r.id)}
                      className="px-4 py-2 rounded-lg border border-gray-200 font-bold text-gsg-purple hover:bg-purple-50"
                    >
                      View
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function RequestCard({ req }: { req: TrackedRequest }) {
  const isCancelled = req.status.toUpperCase() === 'CANCELLED';
  const currentStepIndex = Math.max(0, STATUS_STEPS.indexOf(req.status));
  const paid = isRequestPaid(req.payment_status);
  const payable = isRequestPayable(req);
  const itemsTotal = req.items.reduce((s, it) => s + (it.price ?? 0), 0);
  const payHref = `/shopper/pay/${encodeURIComponent(req.id || req.request_number)}`;

  return (
    <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-100 mb-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 pb-6 border-b border-gray-100 gap-4">
        <div>
          <p className="text-sm text-gray-500 mb-1">Request number</p>
          <p className="font-mono font-medium text-gsg-black">{req.request_number}</p>
        </div>
        <div className="text-left md:text-right">
          <p className="text-sm text-gray-500 mb-1">Date submitted</p>
          <p className="font-medium text-gsg-black">{formatDate(req.created_at)}</p>
        </div>
      </div>

      {!isCancelled && (
        <div className="relative mb-12">
          <div
            className="overflow-hidden h-2 mb-4 text-xs flex rounded-full bg-gray-100"
            role="progressbar"
            aria-label="Request progress"
            aria-valuemin={1}
            aria-valuemax={STATUS_STEPS.length}
            aria-valuenow={currentStepIndex + 1}
            aria-valuetext={statusLabel(req.status)}
          >
            <div
              style={{ width: `${Math.max(5, (currentStepIndex / (STATUS_STEPS.length - 1)) * 100)}%` }}
              className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-gsg-purple transition-all duration-500"
            ></div>
          </div>
          <div className="flex justify-between text-xs font-bold text-gray-400 px-1" aria-hidden="true">
            <span>Submitted</span>
            <span>Sourcing</span>
            <span>Paid</span>
            <span>Delivered</span>
          </div>
        </div>
      )}

      <div className="text-center mb-8">
        <h3 className="text-2xl font-bold text-gsg-purple mb-2">{statusLabel(req.status)}</h3>
        <p className="text-gray-600">{STATUS_TEXT[req.status.toUpperCase()] || ''}</p>
        {deliveryLabel(req.delivery_method) && (
          <p className="text-sm text-gray-500 mt-2">Delivery: {deliveryLabel(req.delivery_method)}</p>
        )}
      </div>

      <div className="bg-gray-50 rounded-xl p-6">
        <h4 className="font-bold text-gsg-black mb-4">Items</h4>
        <ul className="space-y-3 mb-6">
          {req.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-4 text-sm">
              <span className="text-gray-700">
                {item.qty ? `${item.qty} × ` : ''}{item.name}
              </span>
              <span className="font-medium text-gray-900 whitespace-nowrap">
                {item.price !== null ? ghs(item.price) : '—'}
              </span>
            </li>
          ))}
        </ul>
        <div className="border-t border-gray-200 pt-4 space-y-2 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>Items</span>
            <span>{ghs(req.subtotal_est ?? itemsTotal)}</span>
          </div>
          <div className="flex justify-between font-bold text-lg">
            <span>{paid ? 'Paid' : 'Estimate to pay'}</span>
            <span className="text-gsg-purple">{req.total_final !== null ? ghs(req.total_final) : '—'}</span>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-3 leading-relaxed">{FINAL_AMOUNT_NOTE}</p>
      </div>

      {payable && (
        <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-2xl p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h4 className="text-lg font-bold text-yellow-900 mb-1">This request is not paid yet</h4>
            <p className="text-sm text-yellow-800">Pay the estimate and our shopper will get started.</p>
          </div>
          <Link
            href={payHref}
            className="bg-gsg-black hover:bg-gsg-purple text-white px-6 py-3 rounded-xl font-bold transition-colors whitespace-nowrap text-center inline-flex items-center justify-center gap-2"
          >
            <i className="ri-secure-payment-line" aria-hidden="true" />
            Pay {ghs(req.total_final)}
          </Link>
        </div>
      )}

      {paid && (
        <div className="mt-6 bg-green-50 border border-green-200 rounded-2xl p-4 text-center text-sm text-green-800">
          <i className="ri-checkbox-circle-fill mr-1" aria-hidden="true" /> Payment received.
        </div>
      )}

      {isCancelled && (
        <p className="mt-6 text-xs text-gray-500 text-center">{REFUND_NOTE}</p>
      )}

      {req.history.length > 0 && (
        <div className="mt-8">
          <h4 className="font-bold text-gsg-black mb-4">History</h4>
          <ol className="space-y-3 border-l-2 border-gray-100 pl-4">
            {req.history.map((h, i) => (
              <li key={`${h.status}-${h.created_at}-${i}`} className="text-sm">
                <p className="font-medium text-gsg-black">
                  {statusLabel(h.status)}
                  {h.created_at && <span className="font-normal text-gray-500"> · {formatDate(h.created_at, true)}</span>}
                </p>
                {h.note && <p className="text-gray-600 mt-0.5">{h.note}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

export default function TrackPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="w-12 h-12 border-4 border-gsg-purple border-t-transparent rounded-full animate-spin"></div></div>}>
      <TrackContent />
    </Suspense>
  );
}
