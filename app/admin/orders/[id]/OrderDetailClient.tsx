'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { isPlaceholderEmail } from '@/lib/placeholder-email';

interface OrderDetailClientProps {
  orderId: string;
}

const STORE_NAME = 'GSG Convenience Goods & More';
const STORE_CONTACT = 'WhatsApp +233 24 603 3792 · info@gsgbrands.com.gh';

/** Fulfilment steps, in order. Only paid orders may enter them. */
const FULFILMENT = ['processing', 'shipped', 'delivered'];
const OPEN_UNPAID = ['pending', 'awaiting_payment'];

/**
 * Status changes staff may make from each status. Cancel and refund go through
 * the server route (stock and payment status in one transaction).
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending: ['processing', 'cancelled'],
  awaiting_payment: ['processing', 'cancelled'],
  processing: ['shipped', 'delivered', 'cancelled', 'refunded'],
  shipped: ['processing', 'delivered', 'cancelled', 'refunded'],
  delivered: ['refunded'],
  cancelled: ['refunded'],
  refunded: [],
};

const ITEM_SELECT = `
  *,
  order_items (
    id,
    product_id,
    product_name,
    variant_name,
    sku,
    quantity,
    unit_price,
    total_price,
    metadata,
    products (
      product_images (url)
    )
  )
`;

function money(value: unknown) {
  const n = Number(value);
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

export default function OrderDetailClient({ orderId }: OrderDetailClientProps) {
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusHistory, setStatusHistory] = useState<{ id: string; status: string; notes: string | null; created_at: string }[]>([]);
  const [markingPaid, setMarkingPaid] = useState(false);

  const handlePrint = () => {
    window.print();
  };

  // Inject print styles
  useEffect(() => {
    const styleId = 'order-print-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = '@media print { body * { visibility: hidden; } .print-section, .print-section * { visibility: visible; } .print-section { position: absolute; left: 0; top: 0; width: 100%; padding: 20px; } .no-print { display: none !important; } }';
      document.head.appendChild(style);
    }
    return () => {
      const el = document.getElementById(styleId);
      if (el) el.remove();
    };
  }, []);

  useEffect(() => {
    fetchOrderDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch when orderId changes
  }, [orderId]);

  // The orders list links here with ?print=true: open the print dialog once the slip has data.
  const [autoPrinted, setAutoPrinted] = useState(false);
  useEffect(() => {
    if (!order || autoPrinted || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('print') !== 'true') return;
    setAutoPrinted(true);
    const t = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(t);
  }, [order, autoPrinted]);

  const fetchStatusHistory = async (id: string) => {
    const { data, error: histErr } = await supabase
      .from('order_status_history')
      .select('id, status, notes, created_at')
      .eq('order_id', id)
      .order('created_at', { ascending: true });
    if (histErr) {
      console.error('Error fetching status history:', histErr);
      return;
    }
    setStatusHistory(data || []);
  };

  const fetchOrderDetails = async () => {
    try {
      setLoading(true);
      // Try to fetch by ID, then by order_number
      let { data, error } = await supabase.from('orders').select(ITEM_SELECT).eq('id', orderId).maybeSingle();

      if (!data) {
        const byNumber = await supabase.from('orders').select(ITEM_SELECT).eq('order_number', orderId).maybeSingle();
        if (byNumber.data) {
          data = byNumber.data;
          error = null;
        } else if (!error) {
          error = byNumber.error;
        }
      }

      if (error) throw error;
      if (!data) {
        setError('Order not found');
        return;
      }
      setOrder(data);
      setTrackingNumber(data.metadata?.tracking_number || '');
      setAdminNotes(data.notes || '');
      fetchStatusHistory(data.id);
    } catch (err: any) {
      console.error('Error fetching order:', err);
      setError('Failed to load order details');
    } finally {
      setLoading(false);
    }
  };

  const getAuthToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token;
  };

  /** SMS/WhatsApp the customer about a status (or tracking) change. Returns a warning when it failed. */
  const sendStatusNotification = async (status: string, tracking: string): Promise<string | null> => {
    try {
      const addr = order.shipping_address || {};
      const name = (addr.firstName && addr.lastName)
        ? `${addr.firstName.trim()} ${addr.lastName.trim()}`
        : addr.full_name || addr.firstName || (isPlaceholderEmail(order.email) ? '' : order.email?.split('@')[0]) || 'Customer';
      const authToken = await getAuthToken();
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        },
        body: JSON.stringify({
          type: 'order_status',
          payload: {
            email: order.email,
            name,
            orderId: order.id,
            orderNumber: order.order_number || orderId,
            status,
            trackingNumber: tracking,
            phone: addr.phone || order.phone
          }
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return body?.error || body?.message || `Notification failed (${res.status})`;
      }
      return null;
    } catch (err: any) {
      console.error('Notification error:', err);
      return `Notification could not be sent: ${err?.message || 'network error'}`;
    }
  };

  /** Re-read the order's metadata now and merge only our keys, so a payment callback's keys survive. */
  const mergeIntoCurrentMetadata = async (patch: Record<string, unknown>) => {
    const { data: fresh, error: readErr } = await supabase
      .from('orders')
      .select('metadata')
      .eq('id', order.id)
      .single();
    if (readErr) throw readErr;
    const current = fresh?.metadata && typeof fresh.metadata === 'object' && !Array.isArray(fresh.metadata)
      ? fresh.metadata
      : {};
    return { ...current, ...patch };
  };

  /** Why a status change is not allowed right now, or null when it is. */
  const transitionBlocker = (from: string, to: string): string | null => {
    if (from === to) return null;
    if (!(ALLOWED_TRANSITIONS[from] || []).includes(to)) {
      if (from === 'refunded') return 'Refunded orders are closed.';
      if (from === 'cancelled') return 'Cancelled orders cannot be reopened. Create a new order instead.';
      if (from === 'delivered') return 'Delivered orders can only be refunded.';
      return `Not allowed from ${statusLabel(from)}.`;
    }
    if (FULFILMENT.includes(to) && order?.payment_status !== 'paid') {
      return 'The order is not paid. Use "Mark as Paid" first if the money has been received.';
    }
    if (to === 'refunded' && !['paid', 'partially_refunded'].includes(order?.payment_status)) {
      return 'Only a paid order can be refunded. Cancel it instead.';
    }
    return null;
  };

  /**
   * Cancel or refund through the server so payment status and stock are
   * handled in one transaction. Asks for confirmation first.
   */
  const handleCancelOrRefund = async (action: 'cancel' | 'refund') => {
    if (!order) return;
    const wasPaid = order.payment_status === 'paid' || order.payment_status === 'partially_refunded';
    const stockTaken = !!order.metadata?.stock_reduced && !order.metadata?.stock_restored;
    const lines: string[] = [
      action === 'refund'
        ? `Mark order ${order.order_number} as REFUNDED?`
        : `Cancel order ${order.order_number}?`,
      '',
    ];
    if (action === 'refund') {
      lines.push('• Payment status will change to "refunded". No money is sent back automatically: refund the customer through Mobile Money, Paystack or in cash yourself.');
    } else if (wasPaid) {
      lines.push('• The order is paid. Cancelling does NOT mark the payment refunded and no money is sent back. If you are giving the money back, choose "Refunded" instead.');
    }
    lines.push(stockTaken
      ? '• The items will be put back into stock.'
      : '• Stock is not changed (it was never taken for this order, or was already returned).');
    lines.push('• The customer will be notified of the new status.');
    if (!confirm(lines.join('\n'))) return;

    try {
      setStatusUpdating(true);
      const authToken = await getAuthToken();
      const res = await fetch('/api/admin/orders/refund', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { Authorization: `Bearer ${authToken}` }),
        },
        body: JSON.stringify({ orderId: order.id, action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.success === false) throw new Error(body?.error || body?.message || `Request failed (${res.status})`);

      const newStatus = action === 'refund' ? 'refunded' : 'cancelled';
      const warning = body?.alreadyDone ? null : await sendStatusNotification(newStatus, order.metadata?.tracking_number || '');
      await fetchOrderDetails();
      alert(
        (body?.alreadyDone ? 'Order was already in that state.' : `Order ${newStatus}.`) +
          (body?.stockRestored ? ' Stock was returned.' : '') +
          (warning ? `\n\nThe customer was not notified: ${warning}` : '')
      );
      setShowStatusMenu(false);
    } catch (err: any) {
      console.error('Error cancelling/refunding order:', err);
      alert('Failed to update order: ' + (err?.message || 'Unknown error'));
    } finally {
      setStatusUpdating(false);
    }
  };

  /** Change the order status after the staff member confirms; records an order_status_history row. */
  const handleChangeStatus = async (newStatus: string) => {
    if (!order) return;
    setShowStatusMenu(false);
    const previousStatus = order.status || 'pending';
    if (newStatus === previousStatus) return;
    const blocker = transitionBlocker(previousStatus, newStatus);
    if (blocker) {
      alert(blocker);
      return;
    }
    if (newStatus === 'cancelled' || newStatus === 'refunded') {
      await handleCancelOrRefund(newStatus === 'refunded' ? 'refund' : 'cancel');
      return;
    }
    const msg =
      `Change order ${order.order_number} from "${statusLabel(previousStatus)}" to "${statusLabel(newStatus)}"?\n\n` +
      'The customer will be notified by SMS.';
    if (!confirm(msg)) return;

    try {
      setStatusUpdating(true);
      // Only the status column changes, and only if nobody changed it since the page loaded.
      const { data: changed, error: upErr } = await supabase
        .from('orders')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', order.id)
        .eq('status', previousStatus)
        .select('id');
      if (upErr) throw upErr;
      if (!changed || changed.length === 0) {
        await fetchOrderDetails();
        alert('This order was changed somewhere else while you had it open. The page has been reloaded: check the status and try again.');
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      const { error: histErr } = await supabase.from('order_status_history').insert({
        order_id: order.id,
        status: newStatus,
        notes: `Changed from ${statusLabel(previousStatus)}`,
        created_by: user?.id ?? null,
      });
      if (histErr) console.error('Status history insert failed:', histErr);

      setOrder({ ...order, status: newStatus });
      fetchStatusHistory(order.id);
      const warning = await sendStatusNotification(newStatus, order.metadata?.tracking_number || '');
      alert(
        `Order status changed to ${statusLabel(newStatus)}.` +
          (histErr ? '\n\nThe change was not written to the status history.' : '') +
          (warning ? `\n\nThe customer was not notified: ${warning}` : '')
      );
    } catch (err: any) {
      console.error('Error updating order status:', err);
      alert('Failed to update order status: ' + (err?.message || 'Unknown error'));
    } finally {
      setStatusUpdating(false);
    }
  };

  /** Save tracking number and/or admin notes, writing only what changed. */
  const handleSaveDetails = async () => {
    if (!order) return;
    const previousTracking = order.metadata?.tracking_number || '';
    const trackingChanged = trackingNumber.trim() !== previousTracking;
    const notesChanged = adminNotes !== (order.notes || '');
    if (!trackingChanged && !notesChanged) {
      alert('Nothing has changed.');
      return;
    }
    try {
      setStatusUpdating(true);
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
      let nextMetadata = order.metadata;
      if (notesChanged) update.notes = adminNotes;
      if (trackingChanged) {
        nextMetadata = await mergeIntoCurrentMetadata({ tracking_number: trackingNumber.trim() });
        update.metadata = nextMetadata;
      }
      const { error: upErr } = await supabase.from('orders').update(update).eq('id', order.id);
      if (upErr) throw upErr;

      setOrder({ ...order, notes: notesChanged ? adminNotes : order.notes, metadata: nextMetadata });

      let warning: string | null = null;
      if (trackingChanged && trackingNumber.trim()) {
        warning = await sendStatusNotification(order.status, trackingNumber.trim());
      }
      alert(warning ? `Saved, but the customer was not notified.\n\n${warning}` : 'Saved');
    } catch (err: any) {
      console.error('Error updating order:', err);
      alert('Failed to save: ' + (err?.message || 'Unknown error'));
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleMarkAsPaid = async () => {
    if (!order) return;
    if (!confirm(
      `Mark order ${order.order_number} (GH₵ ${money(order.total)}) as PAID?\n\n` +
      'Only do this after you have received the money. Stock is taken for the items and a pending order moves to Processing.'
    )) return;
    try {
      setMarkingPaid(true);
      const authToken = await getAuthToken();
      const res = await fetch('/api/admin/orders/mark-paid', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { Authorization: `Bearer ${authToken}` }),
        },
        body: JSON.stringify({ orderNumber: order.order_number }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.success === false) {
        throw new Error(body?.error || body?.message || `Request failed (${res.status})`);
      }
      await fetchOrderDetails();
      alert(body?.alreadyDone || body?.order?.already_paid ? 'This order was already marked as paid.' : 'Order marked as paid.');
    } catch (err: any) {
      console.error('Error marking as paid:', err);
      alert('Failed to mark as paid: ' + (err?.message || 'Unknown error'));
    } finally {
      setMarkingPaid(false);
    }
  };

  const [resendingNotification, setResendingNotification] = useState(false);

  const handleResendNotification = async () => {
    if (!order) return;
    try {
      setResendingNotification(true);
      const warning = await sendStatusNotification(order.status, order.metadata?.tracking_number || '');
      if (warning) throw new Error(warning);
      alert('Notification sent to the customer by SMS.');
    } catch (err: any) {
      console.error('Error resending notification:', err);
      alert(`Failed to resend notification: ${err.message || 'Unknown error'}`);
    } finally {
      setResendingNotification(false);
    }
  };

  const statusOptions = ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'];
  function statusLabel(s: string) {
    if (!s) return 'Unknown';
    if (s === 'shipped') return 'Packaged';
    return (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, ' ');
  }
  const statusColors: any = {
    'pending': 'bg-amber-100 text-amber-700 border-amber-200',
    'processing': 'bg-blue-100 text-blue-700 border-blue-200',
    'shipped': 'bg-purple-100 text-purple-700 border-purple-200',
    'delivered': 'bg-blue-100 text-blue-700 border-blue-200',
    'cancelled': 'bg-red-100 text-red-700 border-red-200',
    'refunded': 'bg-purple-100 text-purple-700 border-purple-200',
    'awaiting_payment': 'bg-gray-100 text-gray-700 border-gray-200'
  };
  const paymentColors: Record<string, string> = {
    paid: 'bg-green-100 text-green-700',
    pending: 'bg-amber-100 text-amber-700',
    failed: 'bg-red-100 text-red-700',
    refunded: 'bg-purple-100 text-purple-700',
    partially_refunded: 'bg-purple-100 text-purple-700',
  };

  if (loading) return <div className="p-8 text-center">Loading...</div>;
  if (error || !order) return <div className="p-8 text-center text-red-500">{error || 'Order not found'}</div>;

  const currentStatus = order.status || 'pending';
  const shippingAddress = order.shipping_address || {};
  const customerName = (shippingAddress.firstName && shippingAddress.lastName)
    ? `${shippingAddress.firstName.trim()} ${shippingAddress.lastName.trim()}`
    : shippingAddress.full_name || shippingAddress.firstName || (isPlaceholderEmail(order.email) ? '' : order.email?.split('@')[0]) || 'Customer';

  const formatDateTime = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

  // Timeline from real records: when the order was placed, when payment was confirmed,
  // and every recorded status change with its date.
  const paidAt = order.metadata?.payment_verified_at || order.metadata?.paid_at || null;
  const timeline: { label: string; date: string; note?: string | null; tone: 'done' | 'bad' | 'open' }[] = [
    { label: 'Order placed', date: formatDateTime(order.created_at), tone: 'done' },
    order.payment_status === 'paid' || order.payment_status === 'refunded' || order.payment_status === 'partially_refunded'
      ? { label: 'Payment received', date: formatDateTime(paidAt), note: paidAt ? null : 'Date not recorded', tone: 'done' }
      : { label: `Payment ${statusLabel(order.payment_status || 'pending').toLowerCase()}`, date: '', tone: order.payment_status === 'failed' ? 'bad' : 'open' },
    ...statusHistory.map((h) => ({
      label: statusLabel(h.status),
      date: formatDateTime(h.created_at),
      note: h.notes,
      tone: (h.status === 'cancelled' || h.status === 'refunded' ? 'bad' : 'done') as 'done' | 'bad',
    })),
  ];

  const subtotal = Number(order.subtotal || 0);
  const shippingTotal = Number(order.shipping_total || 0);
  const taxTotal = Number(order.tax_total || 0);
  const discountTotal = Number(order.discount_total || 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Print styles injected via useEffect */}

      {/* Printable Order Slip */}
      <div className="print-section hidden print:block bg-white p-8">
        <div className="border-2 border-gray-800 p-6">
          {/* Header */}
          <div className="flex justify-between items-start border-b-2 border-gray-800 pb-4 mb-4">
            <div>
              <h1 className="text-2xl font-bold">{STORE_NAME}</h1>
              <p className="text-sm text-gray-600">Order Packing Slip</p>
            </div>
            <div className="text-right">
              <p className="font-bold text-lg">{order?.order_number}</p>
              <p className="text-sm">{order ? new Date(order.created_at).toLocaleDateString('en-GB') : ''}</p>
            </div>
          </div>

          {/* Ship To */}
          <div className="mb-6">
            <h2 className="font-bold text-lg mb-2 bg-gray-200 px-2 py-1">SHIP TO:</h2>
            <div className="pl-2">
              <p className="font-bold text-lg">{customerName}</p>
              <p>{shippingAddress.phone || order?.phone}</p>
              <p>{shippingAddress.address || shippingAddress.address_line1}</p>
              <p>{shippingAddress.city}{(shippingAddress.region || shippingAddress.state) && `, ${shippingAddress.region || shippingAddress.state}`}</p>
            </div>
          </div>

          {/* Order Items */}
          <div className="mb-6">
            <h2 className="font-bold text-lg mb-2 bg-gray-200 px-2 py-1">ORDER ITEMS:</h2>
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-400">
                  <th className="text-left py-2 px-2">Product</th>
                  <th className="text-left py-2 px-2">Variant</th>
                  <th className="text-center py-2 px-2">Qty</th>
                  <th className="text-right py-2 px-2">Price</th>
                  <th className="text-right py-2 px-2">Line total</th>
                </tr>
              </thead>
              <tbody>
                {order?.order_items?.map((item: any) => (
                  <tr key={item.id} className="border-b border-gray-200">
                    <td className="py-2 px-2 font-medium">{item.product_name}</td>
                    <td className="py-2 px-2 text-sm">{item.variant_name || '-'}</td>
                    <td className="py-2 px-2 text-center font-bold">{item.quantity}</td>
                    <td className="py-2 px-2 text-right">GH₵ {money(item.unit_price)}</td>
                    <td className="py-2 px-2 text-right">GH₵ {money(item.total_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Order Summary */}
          <div className="flex justify-between mb-6">
            <div>
              <p><span className="font-semibold">Shipping Method:</span> {order?.shipping_method || 'Not set'}</p>
              <p><span className="font-semibold">Payment:</span> {order?.payment_method} ({order?.payment_status})</p>
              {trackingNumber && <p><span className="font-semibold">Tracking #:</span> {trackingNumber}</p>}
            </div>
            <div className="text-right">
              <p>Subtotal: GH₵ {money(subtotal)}</p>
              <p>Shipping: GH₵ {money(shippingTotal)}</p>
              {taxTotal > 0 && <p>Tax: GH₵ {money(taxTotal)}</p>}
              {discountTotal > 0 && <p>Discount: -GH₵ {money(discountTotal)}</p>}
              <p className="font-bold text-lg border-t border-gray-400 pt-1 mt-1">Total: GH₵ {money(order?.total)}</p>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t-2 border-gray-800 pt-4 text-center text-sm text-gray-600">
            <p>Thank you for shopping with {STORE_NAME}!</p>
            <p>Questions? {STORE_CONTACT}</p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6 no-print">
        {/* Page Header with Print Button */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4">
            <Link href="/admin/orders" className="text-gray-600 hover:text-gray-900" aria-label="Back to orders">
              <i className="ri-arrow-left-line text-2xl" aria-hidden="true"></i>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{order?.order_number}</h1>
              <p className="text-sm text-gray-600">Order placed on {order ? new Date(order.created_at).toLocaleDateString('en-GB') : ''}</p>
            </div>
          </div>
          <button
            onClick={handlePrint}
            className="flex items-center space-x-2 bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            <i className="ri-printer-line text-lg"></i>
            <span>Print Order</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">Order Items</h2>
                <span className="text-gray-600">{order.order_items?.length || 0} items</span>
              </div>

              <div className="space-y-4">
                {order.order_items?.map((item: any) => (
                  <div key={item.id} className="flex items-start space-x-4 p-4 bg-gray-50 rounded-lg">
                    <div className="w-20 h-20 bg-white rounded-lg overflow-hidden border border-gray-200 flex items-center justify-center relative">
                      {item.products?.product_images?.[0]?.url ? (
                        <img
                          src={item.products.product_images[0].url}
                          alt={item.product_name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <i className="ri-image-line text-2xl text-gray-300"></i>
                      )}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900 mb-1">{item.product_name}</h3>
                      <p className="text-sm text-gray-600 mb-1">{item.variant_name}</p>
                      {item.sku && <p className="text-xs text-gray-500">SKU: {item.sku}</p>}
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-gray-900 mb-1">GH₵ {money(item.unit_price)}</p>
                      <p className="text-sm text-gray-600">Qty: {item.quantity}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 pt-6 border-t border-gray-200 space-y-3">
                <div className="flex justify-between text-gray-700">
                  <span>Subtotal</span>
                  <span>GH₵ {money(subtotal)}</span>
                </div>
                <div className="flex justify-between text-gray-700">
                  <span>Shipping</span>
                  <span>GH₵ {money(shippingTotal)}</span>
                </div>
                {taxTotal > 0 && (
                  <div className="flex justify-between text-gray-700">
                    <span>Tax</span>
                    <span>GH₵ {money(taxTotal)}</span>
                  </div>
                )}
                {discountTotal > 0 && (
                  <div className="flex justify-between text-blue-700 font-semibold">
                    <span>Discount{order.metadata?.coupon_code ? ` (${order.metadata.coupon_code})` : ''}</span>
                    <span>-GH₵ {money(discountTotal)}</span>
                  </div>
                )}
                <div className="flex justify-between text-xl font-bold text-gray-900 pt-3 border-t border-gray-200">
                  <span>Total</span>
                  <span>GH₵ {money(order.total)}</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6">Order Timeline</h2>
              <div className="space-y-4">
                {timeline.map((event, index) => (
                  <div key={index} className="flex items-start space-x-4">
                    <div className={`w-10 h-10 flex items-center justify-center rounded-full border-2 ${event.tone === 'done' ? 'bg-blue-700 border-blue-700' : event.tone === 'bad' ? 'bg-red-600 border-red-600' : 'bg-white border-gray-300'
                      }`}>
                      {event.tone === 'done' ? (
                        <i className="ri-check-line text-white text-xl"></i>
                      ) : event.tone === 'bad' ? (
                        <i className="ri-close-line text-white text-xl"></i>
                      ) : (
                        <span className="w-3 h-3 bg-gray-300 rounded-full"></span>
                      )}
                    </div>
                    <div className="flex-1 pb-6 border-b border-gray-200 last:border-0">
                      <p className={`font-semibold ${event.tone === 'open' ? 'text-gray-500' : 'text-gray-900'}`}>
                        {event.label}
                      </p>
                      {event.date && (
                        <p className="text-sm text-gray-600 mt-1">{event.date}</p>
                      )}
                      {event.note && (
                        <p className="text-xs text-gray-500 mt-1">{event.note}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {statusHistory.length === 0 && (
                <p className="text-xs text-gray-500 mt-2">No status changes have been recorded for this order yet. Current status: {statusLabel(currentStatus)}.</p>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Order Status</h2>
              <div className="relative">
                <button
                  onClick={() => setShowStatusMenu(!showStatusMenu)}
                  aria-haspopup="listbox"
                  aria-expanded={showStatusMenu}
                  className={`w-full px-4 py-3 rounded-lg border-2 font-semibold text-left flex items-center justify-between ${statusColors[currentStatus] || 'bg-gray-100'}`}
                >
                  <span>{statusLabel(currentStatus)}</span>
                  <i className="ri-arrow-down-s-line text-xl" aria-hidden="true"></i>
                </button>
                {showStatusMenu && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white border-2 border-gray-200 rounded-lg shadow-lg overflow-hidden z-10">
                    {statusOptions.map((status) => {
                      const blocker = status === currentStatus ? null : transitionBlocker(currentStatus, status);
                      return (
                        <button
                          key={status}
                          disabled={statusUpdating || !!blocker || status === currentStatus}
                          title={blocker || undefined}
                          onClick={() => handleChangeStatus(status)}
                          className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors disabled:cursor-not-allowed ${status === currentStatus ? 'bg-blue-50 font-semibold' : ''} ${blocker ? 'text-gray-400' : ''}`}
                        >
                          {statusLabel(status)}
                          {blocker && <span className="block text-xs text-gray-400 font-normal">{blocker}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mt-4">
                <label htmlFor="order-tracking-number" className="block text-sm font-semibold text-gray-900 mb-2">
                  Tracking Number
                </label>
                <input
                  id="order-tracking-number"
                  type="text"
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <button
                onClick={handleSaveDetails}
                disabled={statusUpdating}
                className="w-full mt-4 bg-blue-700 hover:bg-blue-800 text-white py-3 rounded-lg font-semibold transition-colors whitespace-nowrap disabled:opacity-50"
              >
                {statusUpdating ? 'Saving...' : 'Save Tracking'}
              </button>
              <p className="text-xs text-gray-500 mt-2">Choosing a status above asks you to confirm before anything changes.</p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Customer</h2>
              <div className="flex items-start space-x-3 mb-4">
                <div className="w-12 h-12 flex items-center justify-center bg-blue-100 text-blue-700 rounded-full font-semibold uppercase">
                  {customerName.substring(0, 2)}
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{customerName}</p>
                  {!isPlaceholderEmail(order.email) && <p className="text-sm text-gray-600">{order.email}</p>}
                  <p className="text-sm text-gray-600">{shippingAddress.phone || order.phone}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Shipping Address</h2>
              <div className="text-gray-700 space-y-1">
                {/* Support both old field names (address_line1) and new (address) */}
                <p>{shippingAddress.address || shippingAddress.address_line1}</p>
                {(shippingAddress.address_line2) && <p>{shippingAddress.address_line2}</p>}
                <p>
                  {shippingAddress.city}
                  {(shippingAddress.region || shippingAddress.state) && `, ${shippingAddress.region || shippingAddress.state}`}
                </p>
                {shippingAddress.postal_code && <p>{shippingAddress.postal_code}</p>}
                {shippingAddress.country && <p className="font-semibold">{shippingAddress.country}</p>}
                {(order.metadata?.delivery_km > 0 || order.metadata?.delivery_pin) && (
                  <div className="pt-3 mt-3 border-t border-gray-100 space-y-1.5">
                    {order.metadata?.delivery_km > 0 && (
                      <p className="text-sm text-gray-600">
                        <span className="font-semibold text-gray-800">{Number(order.metadata.delivery_km).toFixed(1)} km</span> from GSG Hub
                      </p>
                    )}
                    {order.metadata?.delivery_pin && (
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${order.metadata.delivery_pin.lat},${order.metadata.delivery_pin.lng}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-purple-700 hover:underline"
                      >
                        <i className="ri-map-pin-line" /> Navigate to exact pin (Google Maps)
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Payment Info</h2>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">Method</span>
                  <span className="font-semibold text-gray-900 capitalize">{order.payment_method}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Status</span>
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold whitespace-nowrap capitalize ${paymentColors[order.payment_status] || 'bg-gray-100 text-gray-700'}`}>
                    {(order.payment_status || 'pending').replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="flex justify-between">
                  {/* Transaction ID might be in metadata depending on callback */}
                  <span className="text-gray-600">Transaction</span>
                  <span className="text-sm text-gray-900 font-mono truncate max-w-[150px]">
                    {order.metadata?.moolre_reference || order.payment_transaction_id || order.metadata?.card_reference || 'N/A'}
                  </span>
                </div>
              </div>

              {(order.payment_status === 'pending' || order.payment_status === 'failed') && order.status !== 'cancelled' && order.status !== 'refunded' && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <button
                    onClick={handleMarkAsPaid}
                    disabled={markingPaid}
                    className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-semibold transition-colors whitespace-nowrap disabled:opacity-50 flex items-center justify-center cursor-pointer"
                  >
                    {markingPaid ? (
                      <><i className="ri-loader-4-line animate-spin mr-2"></i>Processing...</>
                    ) : (
                      <><i className="ri-checkbox-circle-line mr-2"></i>Mark as Paid</>
                    )}
                  </button>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Notifications</h2>
              <p className="text-sm text-gray-600 mb-4">
                Resend the SMS about the current order status to the customer.
              </p>
              <button
                onClick={handleResendNotification}
                disabled={resendingNotification}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-semibold transition-colors whitespace-nowrap disabled:opacity-50 flex items-center justify-center"
              >
                {resendingNotification ? (
                  <>
                    <i className="ri-loader-4-line animate-spin mr-2"></i>
                    Sending...
                  </>
                ) : (
                  <>
                    <i className="ri-notification-3-line mr-2"></i>
                    Resend Notification
                  </>
                )}
              </button>
              <p className="text-xs text-gray-500 mt-2">
                Phone: {order.phone || shippingAddress.phone || 'Not provided'}
              </p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <label htmlFor="order-admin-notes" className="block text-lg font-bold text-gray-900 mb-4">Admin Notes</label>
              <textarea
                id="order-admin-notes"
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder="Add internal notes about this order..."
                rows={4}
                maxLength={500}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
              />
              <button
                onClick={handleSaveDetails}
                disabled={statusUpdating}
                className="w-full mt-3 bg-gray-700 hover:bg-gray-800 text-white py-2 rounded-lg font-medium transition-colors whitespace-nowrap disabled:opacity-50"
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
