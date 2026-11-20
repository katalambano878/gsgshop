'use client';

import { Suspense, useCallback, useEffect, useRef, useState, use } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
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
} from '../../_lib/shopper-client';

type PayInfo = {
  id: string;
  request_number: string;
  status: string;
  payment_status: string;
  total_final: number | null;
  total_est: number | null;
  markup: number | null;
  delivery_fee: number | null;
  contact_name: string | null;
  contact_email: string | null;
  items: Array<{
    id: string;
    name_brand: string;
    qty_size_range: string;
    price: number | null;
  }>;
};

type PaymentMethod = 'moolre' | 'paystack';

const paymentOptions: Array<{
  value: PaymentMethod;
  label: string;
  desc: string;
  icon: string;
  badges: string[];
}> = [
  {
    value: 'moolre',
    label: 'Mobile Money',
    desc: 'Pay with MTN MoMo, Telecel Cash or AirtelTigo Money.',
    icon: 'ri-smartphone-line',
    badges: ['MTN', 'Telecel', 'AirtelTigo'],
  },
  {
    value: 'paystack',
    label: 'Card Payments',
    desc: 'Pay securely with your debit or credit card via Paystack.',
    icon: 'ri-bank-card-line',
    badges: ['Visa', 'Mastercard', 'Verve'],
  },
];

function normalisePayInfo(data: any): PayInfo {
  const items = Array.isArray(data?.items) ? data.items : [];
  return {
    id: String(data?.id ?? ''),
    request_number: String(data?.request_number ?? data?.requestNumber ?? ''),
    status: String(data?.status ?? ''),
    payment_status: String(data?.payment_status ?? ''),
    total_final: toNumber(data?.total_final),
    total_est: toNumber(data?.total_est),
    markup: toNumber(data?.markup),
    delivery_fee: toNumber(data?.delivery_fee),
    contact_name: typeof data?.contact_name === 'string' ? data.contact_name : null,
    contact_email: typeof data?.contact_email === 'string' ? data.contact_email : null,
    items: items.map((it: any, i: number) => ({
      id: String(it?.id ?? i),
      name_brand: String(it?.name_brand ?? ''),
      qty_size_range: String(it?.qty_size_range ?? ''),
      price: toNumber(it?.price ?? it?.market_price ?? it?.estimated_price),
    })),
  };
}

function PayContent({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const cancelled = searchParams.get('cancelled') === '1';

  const [info, setInfo] = useState<PayInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsPhone, setNeedsPhone] = useState(false);
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('moolre');
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const submittingRef = useRef(false);

  const load = useCallback(
    async (proofPhone: string) => {
      setLoading(true);
      setError(null);
      try {
        const token = await getAccessToken();
        if (!token && !proofPhone) {
          setNeedsPhone(true);
          return;
        }
        const qs = proofPhone ? `?phone=${encodeURIComponent(proofPhone)}` : '';
        const res = await fetch(`/api/shopper/requests/${encodeURIComponent(id)}/pay-info${qs}`, {
          headers: authHeaders(token),
          cache: 'no-store',
        });
        const data = await readJson(res);
        if (res.ok) {
          const parsed = normalisePayInfo(data);
          setInfo(parsed);
          setNeedsPhone(false);
          if (proofPhone) rememberShopperPhone(proofPhone, parsed.id, parsed.request_number);
          // Only prefill a real address, never a masked one.
          if (parsed.contact_email && !parsed.contact_email.includes('*')) setEmail(parsed.contact_email);
          return;
        }
        if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
          setNeedsPhone(true);
          if (proofPhone) {
            setPhoneError('We could not find a request with that number and phone. Check both and try again.');
          }
          return;
        }
        setError('We could not load this request just now. Please refresh the page in a moment.');
      } catch {
        setError('We could not load this request just now. Check your connection and refresh the page.');
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    const remembered = recallShopperPhone(id);
    setPhone(remembered);
    load(remembered);
  }, [id, load]);

  const submitPhone = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isGhanaPhone(phone)) {
      setPhoneError('Enter the Ghana mobile number you used on the request.');
      return;
    }
    setPhoneError('');
    load(phone.trim());
  };

  const handlePay = async () => {
    if (!info || submittingRef.current) return;
    if (!isRequestPayable(info)) return;

    const trimmedEmail = email.trim();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
    const hasEmailOnFile = !!info.contact_email;

    if (paymentMethod === 'paystack' && !emailValid && !hasEmailOnFile) {
      setEmailError('Card payments need an email address. Enter one, or choose Mobile Money.');
      return;
    }
    if (trimmedEmail && !emailValid) {
      setEmailError('Check the email address, or leave it empty.');
      return;
    }
    setEmailError('');

    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const endpoint = paymentMethod === 'paystack' ? '/api/payment/paystack' : '/api/payment/moolre';
      const proofPhone = phone.trim() || recallShopperPhone(info.request_number) || undefined;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify({
          orderId: info.request_number,
          orderUuid: info.id,
          customerEmail: emailValid ? trimmedEmail : undefined,
          phone: proofPhone,
        }),
      });
      const data = await readJson(res);
      if (!res.ok || !data?.success || typeof data?.url !== 'string') {
        if (res.status === 409) {
          throw new Error('This request can no longer be paid. It may have been cancelled. Message us on WhatsApp if you need help.');
        }
        if (res.status === 403) {
          throw new Error('We could not confirm this request is yours. Reload the page and enter the phone number you used.');
        }
        throw new Error(
          typeof data?.message === 'string' && res.status < 500
            ? data.message
            : 'We could not start the payment just now. Please try again, or choose the other payment method.',
        );
      }
      window.location.href = data.url;
    } catch (e: any) {
      setError(e?.message || 'We could not start the payment just now. Please try again.');
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-50 min-h-screen flex items-center justify-center" role="status" aria-label="Loading">
        <div className="w-12 h-12 border-4 border-gsg-purple border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (needsPhone && !info) {
    return (
      <div className="bg-gray-50 min-h-screen py-16 px-4">
        <div className="max-w-xl mx-auto bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
          <h1 className="text-2xl font-bold text-gsg-black mb-2 text-center">Confirm it is your request</h1>
          <p className="text-gray-600 mb-6 text-center">
            Enter the phone number you used on this shopping list to see the estimate and pay.
          </p>
          <form onSubmit={submitPhone} noValidate className="space-y-4">
            <div>
              <label htmlFor="pay-phone" className="block text-sm font-medium text-gsg-black mb-1.5">
                Phone number
              </label>
              <input
                id="pay-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={20}
                value={phone}
                onChange={(e) => { setPhone(e.target.value); setPhoneError(''); }}
                aria-invalid={!!phoneError}
                aria-describedby={phoneError ? 'pay-phone-err' : undefined}
                placeholder="024 123 4567"
                className="w-full px-4 py-3 border-2 border-gray-100 rounded-xl focus:border-gsg-purple focus:outline-none transition-colors"
              />
              {phoneError && <p id="pay-phone-err" role="alert" className="text-sm text-red-600 mt-1.5">{phoneError}</p>}
            </div>
            <button
              type="submit"
              className="w-full bg-gsg-black hover:bg-gsg-purple text-white py-3.5 rounded-xl font-bold transition-colors"
            >
              Continue
            </button>
          </form>
          <p className="text-sm text-gray-500 mt-6 text-center">
            <Link href="/shopper/track" className="font-bold text-gsg-purple underline">Track a request instead</Link>
          </p>
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="bg-gray-50 min-h-screen py-16 px-4">
        <div className="max-w-xl mx-auto bg-white p-8 rounded-2xl shadow-sm border border-gray-100 text-center">
          <i className="ri-error-warning-line text-4xl text-red-500 mb-3 block" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-gsg-black mb-2">We couldn't open that request</h1>
          <p className="text-gray-600 mb-6">{error || 'Please try again in a moment.'}</p>
          <Link href="/shopper/track" className="inline-block bg-gsg-purple text-white px-6 py-3 rounded-xl font-bold">
            Track a request
          </Link>
        </div>
      </div>
    );
  }

  const pricedItems = info.items.filter((it) => it.price !== null);
  const itemsSubtotal = pricedItems.reduce((s, it) => s + (it.price ?? 0), 0);
  const total = info.total_final ?? 0;
  const alreadyPaid = isRequestPaid(info.payment_status);
  const isPayable = isRequestPayable(info);
  const isCancelled = info.status.toUpperCase() === 'CANCELLED';
  const trackHref = `/shopper/track?ref=${encodeURIComponent(info.request_number)}`;

  return (
    <div className="bg-gray-50 min-h-screen py-12">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gsg-black mb-2">Confirm & Pay</h1>
          <p className="text-gray-600">
            Request <span className="font-mono">{info.request_number}</span>
          </p>
          <p className="text-xs text-gray-500 mt-1">Keep this number. You need it with your phone number to track the request.</p>
        </div>

        {cancelled && !alreadyPaid && (
          <div role="status" className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-4 rounded-xl mb-6 text-center">
            The payment was not completed, so nothing was charged. You can try again below, with either payment method.
          </div>
        )}

        {alreadyPaid && (
          <div role="status" className="bg-green-50 border border-green-200 text-green-800 p-4 rounded-xl mb-6 text-center">
            <i className="ri-checkbox-circle-fill mr-2" aria-hidden="true" />
            This request has already been paid. <Link href={trackHref} className="font-bold underline">Track it here.</Link>
          </div>
        )}

        {isCancelled && !alreadyPaid && (
          <div role="status" className="bg-gray-100 border border-gray-200 text-gray-700 p-4 rounded-xl mb-6 text-center">
            This request was cancelled and cannot be paid. Message us on WhatsApp if this is a mistake.
          </div>
        )}

        {!alreadyPaid && !isCancelled && !isPayable && (
          <div role="status" className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-4 rounded-xl mb-6 text-center">
            <i className="ri-time-line mr-2" aria-hidden="true" />
            This request has no amount to pay yet. Our team will message you on WhatsApp once it is ready.
          </div>
        )}

        {error && (
          <div role="alert" className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl mb-6">
            {error}
          </div>
        )}

        {/* Items summary */}
        <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-100 mb-6">
          <h2 className="text-xl font-bold text-gsg-black mb-4 flex items-center gap-2">
            <i className="ri-shopping-bag-line text-gsg-purple" aria-hidden="true" />
            Items
          </h2>
          <ul className="divide-y divide-gray-100">
            {info.items.map((it) => (
              <li key={it.id} className="py-3 flex justify-between gap-4 text-sm">
                <div>
                  <p className="font-medium text-gsg-black">{it.name_brand}</p>
                  <p className="text-gray-500">{it.qty_size_range}</p>
                </div>
                <div className="text-right text-gsg-black font-medium whitespace-nowrap">
                  {it.price !== null ? ghs(it.price) : '—'}
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-6 pt-6 border-t border-gray-100 space-y-2 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Items subtotal</span>
              <span>{ghs(itemsSubtotal)}</span>
            </div>
            {info.markup !== null && (
              <div className="flex justify-between text-gray-600">
                <span>Markup</span>
                <span>{ghs(info.markup)}</span>
              </div>
            )}
            {info.delivery_fee !== null && (
              <div className="flex justify-between text-gray-600">
                <span>Delivery</span>
                <span>{info.delivery_fee > 0 ? ghs(info.delivery_fee) : 'Free'}</span>
              </div>
            )}
            <div className="flex justify-between text-lg font-bold text-gsg-black pt-2 border-t border-gray-100">
              <span>{alreadyPaid ? 'Paid' : 'Estimate to pay'}</span>
              <span className="text-gsg-purple">{info.total_final !== null ? ghs(info.total_final) : '—'}</span>
            </div>
            <p className="text-xs text-gray-500 pt-2 leading-relaxed">
              This total was worked out by our system from your list and the current settings. {FINAL_AMOUNT_NOTE}
            </p>
            <p className="text-xs text-gray-500 leading-relaxed">{REFUND_NOTE}</p>
          </div>
        </div>

        {/* Payment method */}
        {isPayable && (
          <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-100 mb-6">
            <h2 id="pay-method-heading" className="text-xl font-bold text-gsg-black mb-1 flex items-center gap-2">
              <i className="ri-secure-payment-line text-gsg-purple" aria-hidden="true" />
              Payment Method
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              Choose how you'd like to pay. You'll be taken to a secure page to complete payment.
            </p>

            <div role="radiogroup" aria-labelledby="pay-method-heading" className="space-y-3 mb-6">
              {paymentOptions.map((opt) => {
                const selected = paymentMethod === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={`flex items-start justify-between gap-4 p-4 border-2 rounded-xl cursor-pointer transition-all has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-gsg-purple/30 ${
                      selected
                        ? 'border-gsg-purple bg-purple-50'
                        : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start space-x-4 flex-1">
                      <input
                        type="radio"
                        name="payment-method"
                        value={opt.value}
                        checked={selected}
                        onChange={() => { setPaymentMethod(opt.value); setEmailError(''); }}
                        className="sr-only"
                      />
                      <div
                        aria-hidden="true"
                        className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                          selected ? 'border-gsg-purple' : 'border-gray-300'
                        }`}
                      >
                        {selected && <div className="w-2.5 h-2.5 rounded-full bg-gsg-purple" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <i className={`${opt.icon} text-lg ${selected ? 'text-gsg-purple' : 'text-gray-500'}`} aria-hidden="true" />
                          <p className={`font-bold ${selected ? 'text-gsg-purple' : 'text-gsg-black'}`}>{opt.label}</p>
                        </div>
                        <p className="text-sm text-gray-500 mt-1 leading-relaxed">{opt.desc}</p>
                        <div className="flex flex-wrap gap-1.5 mt-2" aria-hidden="true">
                          {opt.badges.map((b) => (
                            <span
                              key={b}
                              className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-white text-gray-600 border border-gray-200"
                            >
                              {b}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div>
              <label htmlFor="pay-email" className="block text-sm font-medium text-gsg-black mb-1.5">
                Email address
                {paymentMethod === 'paystack' && !info.contact_email && <span className="text-red-500"> *</span>}
              </label>
              <input
                id="pay-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                maxLength={160}
                value={email}
                onChange={(e) => { setEmail(e.target.value); setEmailError(''); }}
                aria-invalid={!!emailError}
                aria-describedby={emailError ? 'pay-email-err' : 'pay-email-hint'}
                placeholder={info.contact_email && info.contact_email.includes('*') ? info.contact_email : 'you@example.com'}
                className="w-full px-4 py-3 border-2 border-gray-100 rounded-xl focus:border-gsg-purple focus:outline-none transition-colors"
              />
              {emailError ? (
                <p id="pay-email-err" role="alert" className="text-sm text-red-600 mt-1.5">{emailError}</p>
              ) : (
                <p id="pay-email-hint" className="text-xs text-gray-500 mt-1.5">
                  {paymentMethod === 'paystack'
                    ? info.contact_email
                      ? 'Optional. Leave empty to use the email on your request. Paystack needs an email for card payments.'
                      : 'Paystack needs an email address for card payments.'
                    : 'Optional. Updates on your request come by SMS and WhatsApp.'}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={handlePay}
              disabled={submitting}
              aria-busy={submitting}
              className="mt-8 w-full bg-gsg-black hover:bg-gsg-purple text-white py-4 rounded-xl font-bold transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
                  Processing…
                </>
              ) : (
                <>
                  <span>
                    {paymentMethod === 'paystack' ? 'Pay with Card' : 'Pay with Mobile Money'} — {ghs(total)}
                  </span>
                  <i className="ri-secure-payment-line" aria-hidden="true" />
                </>
              )}
            </button>
          </div>
        )}

        <p className="text-center text-sm text-gray-500">
          Status: <span className="font-medium text-gray-700">{statusLabel(info.status)}</span> ·{' '}
          <Link href={trackHref} className="font-bold text-gsg-purple underline">Track this request</Link>
        </p>
      </div>
    </div>
  );
}

export default function ShopperPayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense
      fallback={
        <div className="bg-gray-50 min-h-screen flex items-center justify-center">
          <div className="w-12 h-12 border-4 border-gsg-purple border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <PayContent id={id} />
    </Suspense>
  );
}
