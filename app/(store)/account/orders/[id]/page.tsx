'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { SHOP_NAME, CONTACT_EMAIL, PHONE_PRIMARY_DISPLAY } from '@/components/legal/business-facts';

type ReceiptOrder = {
  id: string;
  order_number: string;
  created_at: string;
  status: string;
  payment_status: string;
  subtotal: number;
  shipping_total: number;
  discount_total: number;
  total: number;
  shipping_method: string | null;
  shipping_address: Record<string, any> | null;
  order_items: { id: string; product_name: string; variant_name: string | null; quantity: number; unit_price: number; total_price: number }[];
};

const money = (n: unknown) => `GH₵${(Number(n) || 0).toFixed(2)}`;
const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export default function OrderReceiptPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const orderId = params?.id || '';
  const [order, setOrder] = useState<ReceiptOrder | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace(`/auth/login?redirect=${encodeURIComponent(`/account/orders/${orderId}`)}`);
        return;
      }
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, created_at, status, payment_status, subtotal, shipping_total, discount_total, total, shipping_method, shipping_address, order_items(id, product_name, variant_name, quantity, unit_price, total_price)')
        .eq('id', orderId)
        .eq('user_id', session.user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) { setState('error'); return; }
      if (!data) { setState('missing'); return; }
      setOrder(data as ReceiptOrder);
      setState('ready');
    })();
    return () => { cancelled = true; };
  }, [orderId, router]);

  if (state === 'loading') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <i className="ri-loader-4-line animate-spin text-4xl text-gsg-purple" aria-label="Loading"></i>
      </div>
    );
  }

  if (state !== 'ready' || !order) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div role="alert" className="text-center max-w-md">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            {state === 'missing' ? 'Order not found' : 'We could not load this order'}
          </h1>
          <p className="text-gray-600 mb-6">
            {state === 'missing' ? 'This order is not on your account.' : 'Please refresh the page in a moment.'}
          </p>
          <Link href="/account?tab=orders" className="text-gsg-purple font-semibold hover:underline">Back to my orders</Link>
        </div>
      </div>
    );
  }

  const addr = order.shipping_address || {};
  const addressLines = [
    [addr.firstName, addr.lastName].filter(Boolean).join(' ') || addr.full_name || addr.name,
    addr.address || addr.address_line1 || addr.street,
    addr.city,
    addr.region || addr.state,
    addr.phone,
  ].filter(Boolean);

  return (
    <main className="min-h-screen bg-gray-50 py-10 print:bg-white print:py-0">
      <div className="max-w-3xl mx-auto px-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6 print:hidden">
          <Link href="/account?tab=orders" className="inline-flex items-center gap-2 text-gsg-purple font-semibold hover:text-gsg-purple-dark">
            <i className="ri-arrow-left-line" aria-hidden="true"></i> My orders
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gsg-purple text-white rounded-lg font-semibold hover:bg-gsg-purple-dark transition-colors"
          >
            <i className="ri-printer-line" aria-hidden="true"></i> Print or save as PDF
          </button>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 sm:p-10 print:border-0 print:p-0">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 pb-6 mb-6">
            <div>
              <p className="text-lg font-bold text-gray-900">{SHOP_NAME}</p>
              <p className="text-sm text-gray-600">{PHONE_PRIMARY_DISPLAY} · {CONTACT_EMAIL}</p>
              <p className="text-sm text-gray-600">Accra, Ghana</p>
            </div>
            <div className="text-left sm:text-right">
              <h1 className="text-2xl font-bold text-gray-900">Order receipt</h1>
              <p className="text-sm text-gray-600">Order {order.order_number}</p>
              <p className="text-sm text-gray-600">
                {new Date(order.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8 text-sm">
            <div>
              <dt className="text-gray-500">Payment</dt>
              <dd className="font-semibold text-gray-900">{label(order.payment_status || 'pending')}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Order status</dt>
              <dd className="font-semibold text-gray-900">{label(order.status || 'pending')}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Delivery</dt>
              <dd className="font-semibold text-gray-900">{order.shipping_method ? label(order.shipping_method) : '—'}</dd>
            </div>
            {addressLines.length > 0 && (
              <div className="sm:col-span-3">
                <dt className="text-gray-500">Deliver to</dt>
                <dd className="text-gray-900">{addressLines.join(', ')}</dd>
              </div>
            )}
          </dl>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  <th scope="col" className="py-2 pr-2 font-medium">Item</th>
                  <th scope="col" className="py-2 px-2 font-medium text-right">Qty</th>
                  <th scope="col" className="py-2 px-2 font-medium text-right">Price</th>
                  <th scope="col" className="py-2 pl-2 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {order.order_items.map((item) => (
                  <tr key={item.id} className="border-b border-gray-100">
                    <td className="py-3 pr-2 text-gray-900">
                      {item.product_name}
                      {item.variant_name && <span className="block text-gray-500">{item.variant_name}</span>}
                    </td>
                    <td className="py-3 px-2 text-right">{item.quantity}</td>
                    <td className="py-3 px-2 text-right whitespace-nowrap">{money(item.unit_price)}</td>
                    <td className="py-3 pl-2 text-right whitespace-nowrap">{money(item.total_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="mt-6 ml-auto max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-gray-600">Subtotal</dt><dd>{money(order.subtotal)}</dd></div>
            {Number(order.discount_total) > 0 && (
              <div className="flex justify-between"><dt className="text-gray-600">Discount</dt><dd>−{money(order.discount_total)}</dd></div>
            )}
            <div className="flex justify-between"><dt className="text-gray-600">Delivery</dt><dd>{Number(order.shipping_total) > 0 ? money(order.shipping_total) : 'Free'}</dd></div>
            <div className="flex justify-between border-t border-gray-200 pt-2 font-bold text-gray-900"><dt>Order total</dt><dd>{money(order.total)}</dd></div>
          </dl>
          <p className="mt-6 text-xs text-gray-500">
            Questions about this order? WhatsApp or call us on {PHONE_PRIMARY_DISPLAY} and quote the order number.
          </p>
        </div>
      </div>
    </main>
  );
}
