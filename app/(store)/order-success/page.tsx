'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { trackPixelOnce } from '@/lib/meta-pixel';
import { useCart } from '@/context/CartContext';
import { useDeliverySettings } from '@/hooks/useDeliveryPricing';
import { shopperUrl } from '@/lib/site-urls';
import { computeDeliveryEstimate } from './delivery-estimate';

const WHATSAPP_NUMBER = '233246033792';

/**
 * Reads the order through the server (guests cannot read orders from the
 * browser). The receipt route carries the items; the plain route is the
 * fallback. Returns null when the order does not exist, throws on a network
 * or server failure.
 */
async function loadOrder(orderNum: string): Promise<any | null> {
  const ref = encodeURIComponent(orderNum);
  const res = await fetch(`/api/payment/order/${ref}/receipt`, { cache: 'no-store' });
  if (res.ok) {
    const json = await res.json().catch(() => null);
    if (json?.success && json.order) {
      const receipt = json.order;
      if (!receipt.phone_masked || !receipt.status) {
        // The plain read-back carries the order status and the masked phone.
        const basic = await fetch(`/api/payment/order/${ref}`, { cache: 'no-store' }).catch(() => null);
        const b = basic && basic.ok ? await basic.json().catch(() => null) : null;
        if (b?.success && b.order) {
          return { ...receipt, status: receipt.status ?? b.order.status, phone_masked: receipt.phone_masked ?? b.order.phone_masked };
        }
      }
      return receipt;
    }
  }
  if (res.status === 404) return null;
  const basic = await fetch(`/api/payment/order/${ref}`, { cache: 'no-store' });
  if (basic.status === 404) return null;
  if (!basic.ok) throw new Error(`HTTP ${basic.status}`);
  const json = await basic.json().catch(() => null);
  return json?.success ? json.order : null;
}

/** Ask the order's own gateway whether it has been paid. */
async function verifyWithGateway(order: any, providerHint?: string | null): Promise<void> {
  const provider =
    providerHint === 'paystack' || providerHint === 'moolre'
      ? providerHint
      : order?.metadata?.payment_method === 'paystack' || order?.payment_method === 'paystack'
        ? 'paystack'
        : 'moolre';
  const endpoint = provider === 'paystack' ? '/api/payment/paystack/verify' : '/api/payment/moolre/verify';
  await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderNumber: order.order_number }),
  }).catch(() => undefined);
}

const money = (n: unknown) => `GH₵${(Number(n) || 0).toFixed(2)}`;

function OrderSuccessContent() {
  const searchParams = useSearchParams();
  const orderNumber = searchParams.get('order');
  // The gateway's return URL says which provider took the payment.
  const providerHint = (searchParams.get('provider') || '').toLowerCase() || null;
  const { clearCart } = useCart();
  const { settings: deliverySettings } = useDeliverySettings();

  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const clearedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!orderNumber) return null;
    const data = await loadOrder(orderNumber);
    if (data) setOrder(data);
    return data;
  }, [orderNumber]);

  useEffect(() => {
    let active = true;
    async function run() {
      if (!orderNumber) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadFailed(false);
      let current: any = null;
      try {
        current = await loadOrder(orderNumber);
        if (!active) return;
        setOrder(current);
      } catch (err) {
        console.error('Error fetching order:', err);
        if (active) setLoadFailed(true);
      } finally {
        if (active) setLoading(false);
      }

      // Not paid yet: the gateway's callback may still be on its way. Ask the
      // gateway a few times before saying the payment did not go through.
      const closed = ['cancelled', 'refunded'].includes(String(current?.status || ''));
      if (!current || current.payment_status === 'paid' || closed) return;
      setVerifying(true);
      try {
        for (let attempt = 0; attempt < 3 && active; attempt++) {
          await new Promise((r) => setTimeout(r, attempt === 0 ? 2500 : 4000));
          if (!active) return;
          await verifyWithGateway(current, providerHint);
          const fresh = await loadOrder(orderNumber).catch(() => null);
          if (!active) return;
          if (fresh) {
            current = fresh;
            setOrder(fresh);
            if (fresh.payment_status === 'paid') break;
          }
        }
      } finally {
        if (active) setVerifying(false);
      }
    }
    run();
    return () => {
      active = false;
    };
  }, [orderNumber, reloadKey, providerHint]);

  const isPaid = order?.payment_status === 'paid';
  const status = String(order?.status || '');
  const isCancelled = status === 'cancelled' || status === 'refunded';

  // The cart is kept through payment so a failed attempt loses nothing;
  // it is emptied here once the order is really paid.
  useEffect(() => {
    if (isPaid && !clearedRef.current) {
      clearedRef.current = true;
      clearCart();
    }
  }, [isPaid, clearCart]);

  // Meta Pixel Purchase — only once the payment is confirmed, once per order.
  useEffect(() => {
    if (!order?.order_number || order.payment_status !== 'paid') return;
    const items: any[] = order.order_items || [];
    const contents = items.map((i) => ({
      id: i.sku || i.product_id || i.product_name,
      quantity: i.quantity,
      item_price: Number(i.unit_price) || 0,
    }));
    trackPixelOnce(
      order.order_number,
      'Purchase',
      {
        value: Number(order.total) || 0,
        currency: 'GHS',
        content_type: 'product',
        content_ids: contents.map((c) => c.id),
        contents,
        num_items: contents.reduce((n, c) => n + (c.quantity || 0), 0),
      },
      order.order_number
    );
  }, [order?.order_number, order?.payment_status]);

  const confetti = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => ({
        key: i,
        left: Math.random() * 100,
        top: Math.random() * 20,
        delay: Math.random() * 3,
        duration: 3 + Math.random() * 2,
        icon: ['heart', 'star', 'gift'][i % 3],
      })),
    []
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center" role="status" aria-live="polite">
          <i className="ri-loader-4-line text-4xl text-blue-700 animate-spin mb-4 block" aria-hidden="true"></i>
          <p className="text-gray-500">Loading order details...</p>
        </div>
      </div>
    );
  }

  if (loadFailed && !order) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center max-w-md" role="alert">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Couldn&apos;t load your order</h1>
          <p className="text-gray-600 mb-6">Check your connection and try again.</p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="bg-blue-700 hover:bg-blue-800 text-white px-6 py-3 rounded-lg font-semibold"
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center max-w-md">
          <i className="ri-error-warning-line text-4xl text-red-500 mb-4 block" aria-hidden="true"></i>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Order Not Found</h1>
          <p className="text-gray-600 mb-6">
            We couldn&apos;t find that order. Check the order number in your SMS or WhatsApp message.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/order-tracking" className="text-blue-700 font-semibold hover:underline">
              Track an order
            </Link>
            <Link href="/shop" className="text-blue-700 font-semibold hover:underline">
              Return to Shop
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const orderDate = order.created_at
    ? new Date(order.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const hubLabel = deliverySettings?.hub?.label || null;
  const deliveryEstimate = computeDeliveryEstimate(order, { hubLabel });
  const trackHref = `/order-tracking?order=${encodeURIComponent(order.order_number)}`;
  const payHref = `/pay/${encodeURIComponent(order.order_number)}`;
  const whatsappHref = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
    `Hello GSG, I need help with order ${order.order_number}.`
  )}`;
  const items: any[] = order.order_items || [];
  const address = order.shipping_address || {};
  const isPickup = order.shipping_method === 'pickup';
  const isPersonalShopper = order.shipping_method === 'personal-shopper';
  // Contact details only ever come back masked from the server.
  const maskedPhone: string | null = order.phone_masked || null;

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50">
      {isPaid && (
        <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden motion-reduce:hidden" aria-hidden="true">
          {confetti.map((c) => (
            <div
              key={c.key}
              className="absolute animate-fall"
              style={{
                left: `${c.left}%`,
                top: `-${c.top}%`,
                animationDelay: `${c.delay}s`,
                animationDuration: `${c.duration}s`,
              }}
            >
              <i className={`ri-${c.icon}-fill text-blue-500 text-xl opacity-70`}></i>
            </div>
          ))}
        </div>
      )}

      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="bg-white rounded-2xl shadow-xl p-8 md:p-12 text-center mb-8">
            {isPaid ? (
              <>
                <div className="w-24 h-24 flex items-center justify-center mx-auto mb-6 bg-blue-100 rounded-full">
                  <i className="ri-checkbox-circle-fill text-6xl text-blue-600" aria-hidden="true"></i>
                </div>
                <h1 className="text-4xl font-bold text-gray-900 mb-4">Order Confirmed!</h1>
                <p className="text-xl text-gray-600 mb-8">
                  Thank you. Your payment has been received and we are preparing your order.
                </p>
              </>
            ) : isCancelled ? (
              <>
                <div className="w-24 h-24 flex items-center justify-center mx-auto mb-6 bg-gray-100 rounded-full">
                  <i className="ri-close-circle-line text-6xl text-gray-500" aria-hidden="true"></i>
                </div>
                <h1 className="text-3xl font-bold text-gray-900 mb-4">
                  {status === 'refunded' ? 'This order was refunded' : 'This order was cancelled'}
                </h1>
                <p className="text-lg text-gray-600 mb-8">
                  If you think this is a mistake, please message us on WhatsApp.
                </p>
              </>
            ) : (
              <>
                <div className="w-24 h-24 flex items-center justify-center mx-auto mb-6 bg-amber-100 rounded-full">
                  <i className="ri-time-line text-6xl text-amber-600" aria-hidden="true"></i>
                </div>
                <h1 className="text-3xl font-bold text-gray-900 mb-4">Payment not completed</h1>
                <p className="text-lg text-gray-600 mb-4" role="status" aria-live="polite">
                  {verifying
                    ? 'Checking your payment with the payment provider…'
                    : order.payment_status === 'failed'
                      ? 'The payment did not go through. Your order is saved, so you can pay again.'
                      : 'We have not received the payment for this order yet. Your order is saved, so you can pay now.'}
                </p>
                {!verifying && (
                  <div className="flex flex-col sm:flex-row gap-3 justify-center mb-8">
                    <Link
                      href={payHref}
                      className="bg-blue-700 hover:bg-blue-800 text-white px-8 py-4 rounded-lg font-semibold transition-colors inline-flex items-center justify-center"
                    >
                      <i className="ri-secure-payment-line mr-2" aria-hidden="true"></i>
                      Pay now ({money(order.total)})
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        setVerifying(true);
                        verifyWithGateway(order, providerHint)
                          .then(() => refresh())
                          .catch(() => undefined)
                          .finally(() => setVerifying(false));
                      }}
                      className="border-2 border-gray-300 hover:border-gray-400 text-gray-700 px-8 py-4 rounded-lg font-semibold"
                    >
                      I have paid, check again
                    </button>
                  </div>
                )}
              </>
            )}

            <div className="bg-blue-50 rounded-xl p-6 mb-8">
              <div className="grid md:grid-cols-3 gap-6 text-center">
                <div>
                  <p className="text-sm text-gray-600 mb-1">Order Number</p>
                  <p className="text-lg font-bold text-gray-900">{order.order_number}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">Order Date</p>
                  <p className="text-lg font-bold text-gray-900">{orderDate || '—'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">{deliveryEstimate.heading}</p>
                  <p className="text-lg font-bold text-blue-700">{deliveryEstimate.dateLabel}</p>
                  {deliveryEstimate.subLabel && (
                    <p className="text-xs text-gray-500 mt-1">{deliveryEstimate.subLabel}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href={trackHref}
                className="bg-blue-700 hover:bg-blue-800 text-white px-8 py-4 rounded-lg font-semibold transition-colors inline-flex items-center justify-center whitespace-nowrap"
              >
                <i className="ri-file-list-3-line mr-2" aria-hidden="true"></i>
                Track Order
              </Link>
              <Link
                href="/shop"
                className="border-2 border-gray-300 hover:border-gray-400 text-gray-700 px-8 py-4 rounded-lg font-semibold transition-colors inline-flex items-center justify-center whitespace-nowrap"
              >
                <i className="ri-shopping-bag-line mr-2" aria-hidden="true"></i>
                Continue Shopping
              </Link>
            </div>

            {isPersonalShopper && isPaid && (
              <div className="mt-6 rounded-xl border border-purple-200 bg-purple-50 p-5 text-left">
                <p className="font-semibold text-gray-900">Continue at Personal Shopper</p>
                <p className="text-sm text-gray-600 mt-1">
                  Add the rest of your list on Personal Shopper and we will deliver it together with this order.
                </p>
                <a
                  href={shopperUrl('/')}
                  className="mt-3 inline-flex items-center bg-gsg-purple hover:bg-gsg-purple-dark text-white px-5 py-2.5 rounded-lg font-semibold"
                >
                  Go to Personal Shopper
                  <i className="ri-arrow-right-line ml-2" aria-hidden="true"></i>
                </a>
              </div>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-8 mb-8">
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Order Items</h2>
              {items.length === 0 ? (
                <p className="text-sm text-gray-500">Item details are on your tracking page.</p>
              ) : (
                <div className="space-y-4">
                  {items.map((item: any, idx: number) => {
                    const unit = Number(item.unit_price) || 0;
                    return (
                      <div key={item.id || idx} className="flex items-center space-x-4">
                        <div className="w-20 h-20 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0 border border-gray-200 flex items-center justify-center">
                          {item.metadata?.image ? (
                            <img
                              src={item.metadata.image}
                              alt={item.product_name}
                              className="w-full h-full object-cover object-center"
                            />
                          ) : (
                            <i className="ri-shopping-basket-2-line text-2xl text-gray-300" aria-hidden="true"></i>
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="font-semibold text-gray-900 line-clamp-2">{item.product_name}</p>
                          {item.variant_name && <p className="text-xs text-gray-500">{item.variant_name}</p>}
                          <p className="text-sm text-gray-600">
                            {money(unit)} × {item.quantity}
                          </p>
                        </div>
                        <p className="font-bold text-gray-900">{money(unit * (Number(item.quantity) || 0))}</p>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="border-t border-gray-200 mt-4 pt-4">
                <div className="flex justify-between text-sm text-gray-600 mb-2">
                  <span>Subtotal</span>
                  <span>{money(order.subtotal)}</span>
                </div>
                {Number(order.discount_total) > 0 && (
                  <div className="flex justify-between text-sm text-green-700 mb-2">
                    <span>Coupon</span>
                    <span>-{money(order.discount_total)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm text-gray-600 mb-2">
                  <span>Delivery</span>
                  <span>{money(order.shipping_total)}</span>
                </div>

                <div className="flex justify-between text-xl font-bold text-gray-900 border-t border-gray-200 pt-2">
                  <span>{isPaid ? 'Total Paid' : 'Total to Pay'}</span>
                  <span>{money(order.total)}</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">{isPickup ? 'Pickup Details' : 'Delivery Details'}</h2>
              <div className="space-y-3">
                {(address.firstName || address.lastName) && (
                  <div>
                    <p className="text-sm text-gray-600 mb-1">Name</p>
                    <p className="font-semibold text-gray-900">
                      {[address.firstName, address.lastName].filter(Boolean).join(' ')}
                    </p>
                  </div>
                )}
                {isPickup ? (
                  <div>
                    <p className="text-sm text-gray-600 mb-1">Pickup point</p>
                    <p className="text-gray-900">
                      {hubLabel || 'Our Accra pickup point (we will send the details by SMS/WhatsApp)'}
                    </p>
                  </div>
                ) : (
                  (address.address || address.city || address.region) && (
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Deliver to</p>
                      {address.address && <p className="text-gray-900">{address.address}</p>}
                      <p className="text-gray-900">{[address.city, address.region].filter(Boolean).join(', ')}</p>
                    </div>
                  )
                )}
                {maskedPhone && (
                  <div>
                    <p className="text-sm text-gray-600 mb-1">Phone</p>
                    <p className="text-gray-900">{maskedPhone}</p>
                  </div>
                )}
              </div>

              <div className="mt-6 pt-6 border-t border-gray-200">
                <h3 className="font-semibold text-gray-900 mb-3">What&apos;s Next?</h3>
                <div className="space-y-3">
                  <div className="flex items-start space-x-3">
                    <i className="ri-message-3-line text-blue-700 mt-1" aria-hidden="true"></i>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Confirmation</p>
                      <p className="text-sm text-gray-600">
                        {isPaid
                          ? `Sent by SMS/WhatsApp to ${maskedPhone || 'the phone number you gave at checkout'}`
                          : 'Sent by SMS/WhatsApp once your payment is received'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3">
                    <i className="ri-box-3-line text-blue-700 mt-1" aria-hidden="true"></i>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Packing</p>
                      <p className="text-sm text-gray-600">
                        {isPaid ? 'We pack your order after payment is confirmed' : 'Starts once your payment is received'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3">
                    <i className="ri-truck-line text-blue-700 mt-1" aria-hidden="true"></i>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Updates</p>
                      <p className="text-sm text-gray-600">
                        By SMS/WhatsApp, or any time on the{' '}
                        <Link href={trackHref} className="text-blue-700 underline">
                          tracking page
                        </Link>
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 text-center">
            <p className="text-gray-600 mb-4">Need help with your order?</p>
            <div className="flex flex-wrap justify-center gap-4">
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-700 hover:text-blue-900 font-semibold whitespace-nowrap"
              >
                <i className="ri-whatsapp-line mr-1" aria-hidden="true"></i>
                WhatsApp us about this order
              </a>
              <Link href="/contact" className="text-blue-700 hover:text-blue-900 font-semibold whitespace-nowrap">
                <i className="ri-customer-service-line mr-1" aria-hidden="true"></i>
                Contact Support
              </Link>
              <Link href="/returns" className="text-blue-700 hover:text-blue-900 font-semibold whitespace-nowrap">
                <i className="ri-arrow-left-right-line mr-1" aria-hidden="true"></i>
                Report a Problem
              </Link>
            </div>
          </div>
        </div>
      </section>

      <style jsx>{`
        @keyframes fall {
          to {
            transform: translateY(100vh) rotate(360deg);
            opacity: 0;
          }
        }
        .animate-fall {
          animation: fall linear forwards;
        }
      `}</style>
    </main>
  );
}

export default function OrderSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-16 h-16 border-4 border-blue-700 border-t-transparent rounded-full animate-spin"></div>
        </div>
      }
    >
      <OrderSuccessContent />
    </Suspense>
  );
}
