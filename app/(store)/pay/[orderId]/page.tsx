'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { usePageTitle } from '@/hooks/usePageTitle';
import { supabase } from '@/lib/supabase';
import { isGhanaPhone } from '@/lib/phone';
import { readOrderUuid } from '@/hooks/useOrderUuid';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Provider = 'moolre' | 'paystack';

const PROVIDERS: Array<{ value: Provider; label: string; desc: string; icon: string }> = [
  {
    value: 'moolre',
    label: 'Mobile Money',
    desc: 'MTN MoMo, Telecel Cash or AirtelTigo Money, through Moolre.',
    icon: 'ri-smartphone-line',
  },
  {
    value: 'paystack',
    label: 'Card',
    desc: 'Visa, Mastercard or Verve, through Paystack.',
    icon: 'ri-bank-card-line',
  },
];

export default function PaymentPage() {
  usePageTitle('Complete Payment');
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const orderId = String(params?.orderId ?? '');
  const wasCancelled =
    searchParams?.get('cancelled') === '1' ||
    searchParams?.get('cancelled') === 'true' ||
    searchParams?.get('canceled') === '1';

  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<Provider>('moolre');
  // Shown when the server needs proof that the order belongs to this visitor.
  const [needsPhone, setNeedsPhone] = useState(false);
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function fetchOrder() {
      setLoading(true);
      setLoadFailed(false);
      setError(null);
      try {
        // Guests can't read orders through the data API, so the server looks
        // the order up and returns only what this page shows.
        const res = await fetch(`/api/payment/order/${encodeURIComponent(orderId)}`, {
          cache: 'no-store',
        });
        if (!active) return;
        if (res.status === 404 || res.status === 400) {
          setError('Order not found. Please check your link and try again.');
          return;
        }
        const json = await res.json().catch(() => null);
        if (!res.ok || !json) {
          setLoadFailed(true);
          return;
        }
        const data = json?.success ? json.order : null;
        if (!data) {
          setError('Order not found. Please check your link and try again.');
          return;
        }

        setOrder(data);
        const chosen =
          data?.metadata?.payment_method === 'paystack' || data?.payment_method === 'paystack'
            ? 'paystack'
            : 'moolre';
        setProvider(chosen);

        if (data.payment_status === 'paid') {
          router.push(`/order-success?order=${encodeURIComponent(data.order_number)}`);
          return;
        }
      } catch (err) {
        console.error('Error fetching order:', err);
        if (active) setLoadFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    }

    if (orderId) {
      fetchOrder();
    } else {
      setLoading(false);
      setError('Order not found. Please check your link and try again.');
    }
    return () => {
      active = false;
    };
  }, [orderId, router, reloadKey]);

  useEffect(() => {
    if (order && wasCancelled && order.payment_status !== 'paid') {
      setError('Payment was not completed. Your order is saved: you can pay below with Mobile Money or card.');
    }
  }, [order, wasCancelled]);

  const status = String(order?.status || '');
  const paymentStatus = String(order?.payment_status || '');
  const isClosed =
    ['cancelled', 'refunded'].includes(status) ||
    ['refunded', 'partially_refunded', 'paid'].includes(paymentStatus);
  const canPay = !!order && !isClosed;

  const handlePayNow = async () => {
    if (!order || !canPay) return;

    const proof = phone.trim();
    const proofIsEmail = proof.includes('@');
    if (needsPhone && !(proofIsEmail ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(proof) : isGhanaPhone(proof))) {
      setPhoneError('Enter the phone number (for example 024 123 4567) or email used on this order.');
      return;
    }
    setPhoneError(null);
    setProcessing(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      // The order's row id proves it is ours: from the link itself, or saved
      // by checkout on this device.
      const orderUuid = UUID_RE.test(orderId) ? orderId : readOrderUuid(order.order_number);

      const endpoint = provider === 'paystack' ? '/api/payment/paystack' : '/api/payment/moolre';
      const paymentRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        // The server always charges the stored order total.
        body: JSON.stringify({
          orderId: order.order_number,
          ...(orderUuid ? { orderUuid } : {}),
          ...(needsPhone && proof ? (proofIsEmail ? { customerEmail: proof } : { phone: proof }) : {}),
        }),
      });

      const paymentResult = await paymentRes.json().catch(() => null);

      if (paymentRes.status === 403) {
        setNeedsPhone(true);
        throw new Error(
          needsPhone
            ? 'That does not match this order. Use the phone number or email you gave at checkout.'
            : 'To keep your order safe, enter the phone number or email you used at checkout.'
        );
      }
      if (paymentRes.status === 409) {
        throw new Error(paymentResult?.message || 'This order can no longer be paid. Please contact us.');
      }
      if (paymentRes.status === 502 || paymentRes.status === 503) {
        const other = provider === 'paystack' ? 'Mobile Money' : 'Card';
        throw new Error(
          `${provider === 'paystack' ? 'Card payment' : 'Mobile Money'} is not available right now. Please choose ${other} above and try again.`
        );
      }
      if (!paymentResult?.success || !paymentResult.url) {
        throw new Error(paymentResult?.message || 'We could not start the payment. Please try again or choose another method.');
      }

      window.location.href = paymentResult.url;
    } catch (err: any) {
      console.error('Payment error:', err);
      setError(err?.message || 'We could not start the payment. Please try again.');
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center" role="status" aria-live="polite">
          <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-700 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading order details...</p>
        </div>
      </main>
    );
  }

  if (loadFailed && !order) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center max-w-md" role="alert">
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Couldn&apos;t load this order</h1>
          <p className="text-gray-600 mb-6">Check your connection and try again.</p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="inline-flex items-center px-6 py-3 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold transition-colors"
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 mx-auto mb-6 bg-red-50 rounded-full flex items-center justify-center">
            <i className="ri-error-warning-line text-4xl text-red-500" aria-hidden="true"></i>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Order Not Found</h1>
          <p className="text-gray-600 mb-6">{error || 'Order not found. Please check your link and try again.'}</p>
          <Link
            href="/"
            className="inline-flex items-center px-6 py-3 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold transition-colors"
          >
            <i className="ri-home-line mr-2" aria-hidden="true"></i>
            Go to Homepage
          </Link>
        </div>
      </main>
    );
  }

  const customerName = order?.metadata?.first_name || 'there';
  const total = Number(order.total) || 0;

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-block mb-6">
            <span className="text-2xl font-['Pacifico'] text-blue-700">GSG</span>
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Complete Your Payment</h1>
          <p className="text-gray-600 mt-2">
            {canPay
              ? `Hi ${customerName}, your order is waiting for payment.`
              : `Hi ${customerName}, this order cannot be paid online.`}
          </p>
        </div>

        {/* Order Summary Card */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-100">
            <span className="text-sm text-gray-500">Order Number</span>
            <span className="font-semibold text-gray-900">{order.order_number}</span>
          </div>

          <div className="space-y-3 mb-6">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Subtotal</span>
              <span className="text-gray-900">GH₵ {(Number(order.subtotal) || 0).toFixed(2)}</span>
            </div>
            {Number(order.discount_total) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Discount</span>
                <span className="text-green-600">-GH₵ {Number(order.discount_total).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Delivery</span>
              <span className="text-gray-900">GH₵ {(Number(order.shipping_total) || 0).toFixed(2)}</span>
            </div>
          </div>

          <div className="flex justify-between items-center pt-4 border-t border-gray-200">
            <span className="text-lg font-semibold text-gray-900">Total</span>
            <span className="text-2xl font-bold text-blue-700">GH₵ {total.toFixed(2)}</span>
          </div>
        </div>

        {isClosed && (
          <div className="bg-gray-100 border border-gray-200 rounded-lg p-4 mb-6" role="status">
            <p className="text-sm font-semibold text-gray-900">
              {status === 'cancelled'
                ? 'This order was cancelled.'
                : paymentStatus === 'paid'
                  ? 'This order is already paid.'
                  : 'This order was refunded.'}
            </p>
            <p className="text-sm text-gray-700 mt-1">
              If you think this is a mistake, please{' '}
              <Link href="/contact" className="underline">contact us</Link>.
            </p>
          </div>
        )}

        {canPay && paymentStatus === 'pending' && !wasCancelled && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <div className="flex items-start space-x-3">
              <i className="ri-time-line text-xl text-yellow-600 mt-0.5" aria-hidden="true"></i>
              <div>
                <p className="text-sm font-semibold text-yellow-800">Payment Pending</p>
                <p className="text-sm text-yellow-700 mt-1">
                  Complete your payment to confirm your order.
                </p>
              </div>
            </div>
          </div>
        )}

        {canPay && paymentStatus === 'failed' && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex items-start space-x-3">
              <i className="ri-error-warning-line text-xl text-red-600 mt-0.5" aria-hidden="true"></i>
              <div>
                <p className="text-sm font-semibold text-red-800">Payment Failed</p>
                <p className="text-sm text-red-700 mt-1">
                  Your previous payment attempt was unsuccessful. You can try again or use the other method.
                </p>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6" role="alert">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {canPay && (
          <>
            <fieldset className="mb-6 bg-white rounded-xl shadow-sm p-6">
              <legend className="text-base font-bold text-gray-900 mb-4 float-left w-full">Payment method</legend>
              <div className="space-y-3 clear-both">
                {PROVIDERS.map((opt) => {
                  const selected = provider === opt.value;
                  return (
                    <label
                      key={opt.value}
                      className={`flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-700 has-[:focus-visible]:ring-offset-2 ${
                        selected ? 'border-blue-700 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="pay-provider"
                        value={opt.value}
                        checked={selected}
                        onChange={() => setProvider(opt.value)}
                        className="sr-only"
                      />
                      <i className={`${opt.icon} text-2xl ${selected ? 'text-blue-700' : 'text-gray-500'} flex-shrink-0`} aria-hidden="true"></i>
                      <span>
                        <span className="font-semibold text-gray-900 block">{opt.label}</span>
                        <span className="text-xs text-gray-600">{opt.desc}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {needsPhone && (
              <div className="mb-6 bg-white rounded-xl shadow-sm p-6">
                <label htmlFor="pay-phone" className="block text-sm font-bold text-gray-700 mb-2">
                  Phone number or email used on this order
                </label>
                <input
                  id="pay-phone"
                  type="text"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  aria-invalid={Boolean(phoneError)}
                  aria-describedby={phoneError ? 'pay-phone-error' : undefined}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-700 outline-none"
                  placeholder="024 123 4567 or you@example.com"
                />
                {phoneError && (
                  <p id="pay-phone-error" className="text-xs text-red-600 mt-1">{phoneError}</p>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={handlePayNow}
              disabled={processing}
              className="w-full bg-blue-700 hover:bg-blue-800 text-white py-4 rounded-xl font-semibold text-lg transition-colors disabled:opacity-70 flex items-center justify-center cursor-pointer"
            >
              {processing ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Processing...
                </>
              ) : (
                <>
                  <i className="ri-secure-payment-line mr-2" aria-hidden="true"></i>
                  Pay GH₵ {total.toFixed(2)}
                  {provider === 'paystack' ? ' with Card' : ' with Mobile Money'}
                </>
              )}
            </button>

            <div className="mt-6 text-center">
              <p className="text-xs text-gray-500 flex items-center justify-center">
                <i className="ri-lock-line mr-1" aria-hidden="true"></i>
                Secure payment through {provider === 'paystack' ? 'Paystack' : 'Moolre'}
              </p>
            </div>
          </>
        )}

        <div className="mt-8 text-center">
          <p className="text-sm text-gray-600">
            Having issues?{' '}
            <a
              href="https://wa.me/233246033792"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 hover:underline"
            >
              WhatsApp us
            </a>{' '}
            or <Link href="/contact" className="text-blue-700 hover:underline">contact us</Link>.
          </p>
        </div>
      </div>
    </main>
  );
}
