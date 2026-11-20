'use client';

import Link from 'next/link';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import PageHero from '@/components/PageHero';
import { phoneLast9 } from '@/lib/phone';
import { useDeliverySettings } from '@/hooks/useDeliveryPricing';
import { computeDeliveryEstimate } from '../order-success/delivery-estimate';

const METHOD_LABELS: Record<string, string> = {
  pickup: 'Pickup',
  'free-delivery': 'Free Delivery',
  'sole-express': 'Sole Express',
  'joint-express': 'Joint Express',
  'personal-shopper': 'With Personal Shopper',
};
const STEP_ORDER = ['pending', 'processing', 'shipped', 'delivered'];
const fmtDateTime = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

function OrderTrackingContent() {
  const searchParams = useSearchParams();
  const urlOrderNumber = searchParams.get('order') || '';
  const { settings: deliverySettings } = useDeliverySettings();

  const [orderNumber, setOrderNumber] = useState(urlOrderNumber);
  const [contact, setContact] = useState('');
  const [isTracking, setIsTracking] = useState(false);
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Prefill from ?order= (links in SMS/WhatsApp and on the success page).
  useEffect(() => {
    if (urlOrderNumber) setOrderNumber(urlOrderNumber);
  }, [urlOrderNumber]);

  const fetchOrder = async (orderNum: string, contactValue: string) => {
    const value = contactValue.trim();
    const isEmail = value.includes('@');
    if (!isEmail && !phoneLast9(value)) {
      setError('Enter the phone number (for example 024 123 4567) or the email address you used for this order.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // The server checks the contact against the order, so guests can track too.
      const res = await fetch('/api/storefront/orders/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderNumber: orderNum.trim(),
          ...(isEmail ? { email: value } : { phone: value }),
        }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        setError(
          json?.error ||
            (res.status === 404
              ? 'No order found. Check your order number and the phone or email you used, then try again.'
              : 'Something went wrong. Please try again.')
        );
        setIsTracking(false);
        return;
      }
      const found = Array.isArray(json?.orders) ? json.orders[0] : null;
      if (!found) {
        setError('No order found. Check your order number and the phone or email you used, then try again.');
        setIsTracking(false);
        return;
      }

      setOrder(found);
      setIsTracking(true);
    } catch (err) {
      console.error('Error fetching order:', err);
      setError('Something went wrong. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleTrack = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!orderNumber.trim()) {
      setError('Please enter your order number');
      return;
    }
    if (!contact.trim()) {
      setError('Please enter the phone number or email you used for this order');
      return;
    }
    fetchOrder(orderNumber, contact);
  };

  const historyDate = (status: string): string => {
    const hit = (order?.status_history || []).find((h: any) => h?.status === status);
    return hit?.created_at ? fmtDateTime(hit.created_at) : '';
  };

  const getTrackingSteps = () => {
    if (!order) return [];

    const status = order.status || 'pending';
    const paymentStatus = order.payment_status || 'pending';
    const isPaid = paymentStatus === 'paid';
    const currentIndex = Math.max(0, STEP_ORDER.indexOf(status));

    return [
      {
        key: 'placed',
        title: 'Order received',
        description: isPaid ? 'We have your order' : 'We have your order; it is waiting for payment',
        date: fmtDateTime(order.created_at),
        icon: 'ri-file-list-3-line',
        status: 'completed' as const,
      },
      {
        key: 'payment',
        title: 'Payment',
        description: isPaid ? 'Payment confirmed' : paymentStatus === 'failed' ? 'Payment did not go through' : 'Awaiting payment',
        date: isPaid ? historyDate('paid') || 'Confirmed' : 'Pending',
        icon: 'ri-secure-payment-line',
        status: isPaid ? ('completed' as const) : ('active' as const),
      },
      {
        key: 'processing',
        title: 'Processing',
        description: 'Your order is being prepared',
        date: currentIndex >= 1 ? historyDate('processing') || 'In progress' : 'Pending',
        icon: 'ri-box-3-line',
        status: currentIndex >= 1 ? ('completed' as const) : isPaid ? ('active' as const) : ('pending' as const),
      },
      {
        key: 'shipped',
        title: order.shipping_method === 'pickup' ? 'Ready' : 'On the Way',
        description: order.shipping_method === 'pickup' ? 'Ready for you to collect' : 'Your order is out for delivery',
        date: currentIndex >= 2 ? historyDate('shipped') || 'Yes' : 'Pending',
        icon: order.shipping_method === 'pickup' ? 'ri-store-2-line' : 'ri-truck-line',
        status: currentIndex >= 2 ? ('completed' as const) : currentIndex === 1 ? ('active' as const) : ('pending' as const),
      },
      {
        key: 'delivered',
        title: order.shipping_method === 'pickup' ? 'Collected' : 'Delivered',
        description: order.shipping_method === 'pickup' ? 'Order collected' : 'Order delivered',
        date: currentIndex >= 3 ? historyDate('delivered') || 'Done' : 'Pending',
        icon: 'ri-check-double-line',
        status: currentIndex >= 3 ? ('completed' as const) : currentIndex === 2 ? ('active' as const) : ('pending' as const),
      },
    ];
  };

  const getStatusBadge = () => {
    if (!order) return { label: 'Unknown', color: 'bg-gray-100 text-gray-800' };
    
    if (order.payment_status !== 'paid' && !['cancelled', 'refunded'].includes(order.status)) {
      return { label: 'Awaiting payment', color: 'bg-amber-100 text-amber-800' };
    }
    const statusMap: Record<string, { label: string; color: string }> = {
      'pending': { label: 'Order received', color: 'bg-amber-100 text-amber-800' },
      'processing': { label: 'Processing', color: 'bg-blue-100 text-blue-800' },
      'shipped': { label: 'On the Way', color: 'bg-purple-100 text-purple-800' },
      'delivered': { label: 'Delivered', color: 'bg-green-100 text-green-800' },
      'cancelled': { label: 'Cancelled', color: 'bg-red-100 text-red-800' },
      'refunded': { label: 'Refunded', color: 'bg-gray-100 text-gray-800' },
    };

    return statusMap[order.status] || { label: order.status, color: 'bg-gray-100 text-gray-800' };
  };

  if (!isTracking || !order) {
    return (
      <main className="min-h-screen bg-gray-50">
        <PageHero title="Track Your Order" subtitle="Enter your order number and the phone or email you used" />
        <div className="py-12 px-4">
          <div className="max-w-xl mx-auto">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
              <form onSubmit={handleTrack} className="space-y-6">
                <div>
                  <label htmlFor="track-order" className="block text-sm font-bold text-gsg-black mb-2">
                    Order or Tracking Number
                  </label>
                  <input
                    id="track-order"
                    type="text"
                    autoComplete="off"
                    value={orderNumber}
                    onChange={(e) => setOrderNumber(e.target.value)}
                    className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple transition-all outline-none border-gray-200 bg-gray-50 focus:bg-white"
                    placeholder="e.g. ORD-123456789"
                  />
                </div>

                <div>
                  <label htmlFor="track-contact" className="block text-sm font-bold text-gsg-black mb-2">
                    Phone or Email Used on the Order <span className="text-red-500 font-normal" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="track-contact"
                    type="text"
                    inputMode="text"
                    autoComplete="tel"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple transition-all outline-none border-gray-200 bg-gray-50 focus:bg-white"
                    placeholder="024 123 4567 or you@example.com"
                  />
                </div>

                {error && (
                  <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3" role="alert">
                    <i className="ri-error-warning-fill text-red-500 mt-0.5" aria-hidden="true"></i>
                    <p className="text-sm text-red-600">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gsg-black hover:bg-gsg-purple text-white py-4 rounded-xl font-bold transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <i className="ri-loader-4-line animate-spin"></i>
                      Searching...
                    </span>
                  ) : 'Track Order'}
                </button>
              </form>

              <div className="mt-8 pt-6 border-t border-gray-100">
                <div className="flex items-start space-x-3 text-sm text-gray-500">
                  <i className="ri-information-fill text-gsg-purple text-lg mt-0.5"></i>
                  <p>
                    Your order number is in the SMS or WhatsApp message we sent you. Can&apos;t find it?{' '}
                    <a href="https://wa.me/233246033792" target="_blank" rel="noopener noreferrer" className="text-gsg-purple underline">
                      WhatsApp us
                    </a>.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const trackingSteps = getTrackingSteps();
  const statusBadge = getStatusBadge();
  const trackingNumber = order.tracking_number || '';
  const isPaid = order.payment_status === 'paid';
  const isClosed = order.status === 'cancelled' || order.status === 'refunded';
  const estimate = computeDeliveryEstimate(order, { hubLabel: deliverySettings?.hub?.label || null });
  const payHref = `/pay/${encodeURIComponent(order.order_number)}`;

  return (
    <main className="min-h-screen bg-gray-50">
      <PageHero title="Order Status" subtitle={`Order #${order.order_number}`} />
      
      <div className="py-12 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <button 
              type="button"
              onClick={() => { setIsTracking(false); setOrder(null); setOrderNumber(''); setContact(''); }}
              className="text-gray-500 hover:text-gsg-purple font-medium inline-flex items-center gap-2 transition-colors"
            >
              <i className="ri-arrow-left-line" aria-hidden="true"></i>
              Track Another Order
            </button>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-8">
            <div className="p-6 sm:p-8 border-b border-gray-100 bg-gray-50/50">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold text-gsg-black mb-1">Order {order.order_number}</h1>
                  <p className="text-gray-500 text-sm">
                    Placed on {new Date(order.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                  {trackingNumber && <p className="text-gray-500 text-sm">Tracking number: {trackingNumber}</p>}
                </div>
                <div className={`px-4 py-2 rounded-full font-bold text-sm ${statusBadge.color}`}>
                  {statusBadge.label}
                </div>
              </div>
            </div>

            <div className="p-6 sm:p-8">
              <div className="grid md:grid-cols-3 gap-6 mb-10">
                <div className="p-5 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 flex items-center justify-center bg-white rounded-full shadow-sm text-gsg-purple">
                      <i className="ri-map-pin-line"></i>
                    </div>
                    <span className="text-sm font-bold text-gray-900">Delivery Method</span>
                  </div>
                  <p className="text-gray-600 text-sm pl-11">
                    {METHOD_LABELS[order.shipping_method] || order.shipping_method || '—'}
                  </p>
                </div>

                <div className="p-5 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 flex items-center justify-center bg-white rounded-full shadow-sm text-gsg-purple">
                      <i className="ri-money-cny-circle-line"></i>
                    </div>
                    <span className="text-sm font-bold text-gray-900">Total Amount</span>
                  </div>
                  <p className="text-gray-600 text-sm pl-11 font-medium">
                    GH₵ {Number(order.total).toFixed(2)}
                  </p>
                </div>

                <div className="p-5 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 flex items-center justify-center bg-white rounded-full shadow-sm text-gsg-purple">
                      <i className="ri-time-line"></i>
                    </div>
                    <span className="text-sm font-bold text-gray-900">{estimate.heading}</span>
                  </div>
                  <p className="text-gray-600 text-sm pl-11">{estimate.dateLabel}</p>
                  {estimate.subLabel && <p className="text-gray-500 text-xs pl-11 mt-1">{estimate.subLabel}</p>}
                </div>
              </div>

              {isClosed && (
                <div className="mb-8 p-5 rounded-xl border border-red-100 bg-red-50" role="status">
                  <p className="font-bold text-red-800">
                    {order.status === 'refunded' ? 'This order was refunded.' : 'This order was cancelled.'}
                  </p>
                  <p className="text-sm text-red-700 mt-1">
                    Questions? <a href="https://wa.me/233246033792" target="_blank" rel="noopener noreferrer" className="underline">WhatsApp us</a>.
                  </p>
                </div>
              )}
              {!isClosed && !isPaid && (
                <div className="mb-8 p-5 rounded-xl border border-amber-200 bg-amber-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <p className="font-bold text-amber-900">Waiting for payment</p>
                    <p className="text-sm text-amber-800 mt-1">We start preparing your order once it is paid.</p>
                  </div>
                  <Link
                    href={payHref}
                    className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-gsg-black hover:bg-gsg-purple text-white font-bold"
                  >
                    Pay GH₵ {Number(order.total).toFixed(2)}
                  </Link>
                </div>
              )}

              {/* Tracking Timeline */}
              {!isClosed && (
              <div className="relative pl-4 sm:pl-8">
                {trackingSteps.map((step, index) => (
                  <div key={step.key} className="flex items-start mb-8 last:mb-0 relative">
                    {/* Vertical Line */}
                    {index < trackingSteps.length - 1 && (
                      <div className={`absolute left-[19px] top-10 bottom-0 w-0.5 ${
                        step.status === 'completed' ? 'bg-gsg-purple' : 'bg-gray-200'
                      }`}></div>
                    )}
                    
                    <div className={`relative z-10 w-10 h-10 flex items-center justify-center rounded-full border-4 mr-6 flex-shrink-0 transition-colors ${
                      step.status === 'completed'
                        ? 'bg-gsg-purple border-purple-100 text-white'
                        : step.status === 'active'
                        ? 'bg-white border-gsg-purple text-gsg-purple'
                        : 'bg-gray-100 border-gray-50 text-gray-400'
                    }`}>
                      <i className={`${step.icon} text-lg`} aria-hidden="true"></i>
                    </div>
                    
                    <div className="flex-1 pt-1">
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1">
                        <h3 className={`font-bold text-lg ${
                          step.status === 'pending' ? 'text-gray-400' : 'text-gsg-black'
                        }`}>
                          {step.title}
                        </h3>
                        <span className={`text-xs font-bold px-2 py-1 rounded-md inline-block sm:inline ${
                          step.status === 'pending' ? 'bg-gray-100 text-gray-400' : 'bg-purple-50 text-gsg-purple'
                        }`}>
                          {step.date}
                        </span>
                      </div>
                      <p className={`text-sm mt-1 ${
                        step.status === 'pending' ? 'text-gray-400' : 'text-gray-600'
                      }`}>
                        {step.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              )}
            </div>
          </div>

          {/* Order Items */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
            <h2 className="text-xl font-bold text-gsg-black mb-6">Items in Order</h2>
            <div className="space-y-4">
              {(order.items || []).map((item: any, idx: number) => (
                <div key={`${item.product_name}-${idx}`} className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="w-16 h-16 bg-white rounded-lg overflow-hidden flex-shrink-0 border border-gray-200 relative">
                    {item.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.image}
                        alt={item.product_name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <i className="ri-image-line text-2xl text-gray-300" aria-hidden="true"></i>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-gsg-black truncate">{item.product_name}</h3>
                    <p className="text-sm text-gray-500 mt-0.5">
                      GH₵ {Number(item.unit_price).toFixed(2)} × {item.quantity} {item.variant_name && `• ${item.variant_name}`}
                    </p>
                  </div>
                  <p className="font-bold text-gsg-purple whitespace-nowrap">
                    GH₵ {Number(item.total_price ?? Number(item.unit_price) * Number(item.quantity)).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
            <div className="border-t border-gray-100 mt-6 pt-4 space-y-1 text-sm text-gray-600">
              <div className="flex justify-between"><span>Subtotal</span><span>GH₵ {Number(order.subtotal).toFixed(2)}</span></div>
              {Number(order.discount_total) > 0 && (
                <div className="flex justify-between text-green-700"><span>Coupon</span><span>-GH₵ {Number(order.discount_total).toFixed(2)}</span></div>
              )}
              <div className="flex justify-between"><span>Delivery</span><span>GH₵ {Number(order.shipping_total).toFixed(2)}</span></div>
              <div className="flex justify-between font-bold text-gsg-black text-base"><span>Total</span><span>GH₵ {Number(order.total).toFixed(2)}</span></div>
            </div>
          </div>

          <div className="mt-10 text-center">
            <p className="text-gray-500 mb-4">Need help with your order?</p>
            <div className="flex flex-wrap justify-center gap-4">
              <a
                href={`https://wa.me/233246033792?text=${encodeURIComponent(`Hello GSG, I need help with order ${order.order_number}.`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3 bg-white border border-gray-200 rounded-full text-gsg-black font-bold hover:border-gsg-purple hover:text-gsg-purple transition-colors shadow-sm"
              >
                <i className="ri-whatsapp-line" aria-hidden="true"></i>
                WhatsApp Us
              </a>
              <Link href="/returns" className="inline-flex items-center gap-2 px-6 py-3 bg-white border border-gray-200 rounded-full text-gsg-black font-bold hover:border-gsg-purple hover:text-gsg-purple transition-colors shadow-sm">
                <i className="ri-arrow-left-right-line" aria-hidden="true"></i>
                Report a Problem
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function OrderTrackingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <i className="ri-loader-4-line animate-spin text-4xl text-gsg-purple"></i>
      </div>
    }>
      <OrderTrackingContent />
    </Suspense>
  );
}
