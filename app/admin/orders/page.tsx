'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { isPlaceholderEmail } from '@/lib/placeholder-email';
import ProductSalesStats from './ProductSalesStats';
import { downloadCsv, csvMoney } from '@/lib/csv';

/** Payment states that mean money was taken (now or before a refund). */
const SETTLED_PAYMENT = ['paid', 'refunded', 'partially_refunded'];
const CLOSED_STATUSES = ['cancelled', 'refunded'];

/** Confirmed tab: paid (or since refunded), plus anything cancelled/refunded. */
function isConfirmedOrder(o: { payment_status: string; status: string }) {
  return SETTLED_PAYMENT.includes(o.payment_status) || CLOSED_STATUSES.includes(o.status);
}

/** Abandoned cart: payment pending or failed, and the order never moved past checkout. */
function isAbandonedOrder(o: { payment_status: string; status: string }) {
  return ['pending', 'failed'].includes(o.payment_status) && ['pending', 'awaiting_payment'].includes(o.status);
}

/** Forward order of the fulfilment steps; bulk changes only ever move an order forward. */
const STATUS_RANK: Record<string, number> = { pending: 0, awaiting_payment: 0, processing: 1, shipped: 2, delivered: 3 };

/** An unpaid, still-open order that staff may mark as paid (cash/transfer received). */
function canMarkPaid(o: { payment_status: string; status: string }) {
  return (o.payment_status === 'pending' || o.payment_status === 'failed') && !CLOSED_STATUSES.includes(o.status);
}

/** Local calendar day (YYYY-MM-DD) of a timestamp, for the date-range filter. */
function localDay(iso: string) {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

interface Order {
  id: string;
  order_number: string;
  email: string;
  total: number;
  status: string;
  payment_status: string;
  payment_method: string;
  shipping_method: string;
  created_at: string;
  phone?: string;
  shipping_address?: any;
  metadata?: any;
  profiles?: {
    full_name: string;
    email: string;
  };
  order_items?: {
    quantity: number;
    product_name?: string;
  }[];
}

interface OrderStats {
  label: string;
  count: number;
  status: string;
}

export default function AdminOrdersPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState('date');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [orderViewTab, setOrderViewTab] = useState<'confirmed' | 'abandoned'>('confirmed');
  const [sendingPaymentLink, setSendingPaymentLink] = useState<string | null>(null);
  const [orderStats, setOrderStats] = useState<OrderStats[]>([
    { label: 'All Orders', count: 0, status: 'all' },
    { label: 'Pending', count: 0, status: 'pending' },
    { label: 'Processing', count: 0, status: 'processing' },
    { label: 'Packaged', count: 0, status: 'shipped' },
    { label: 'Delivered', count: 0, status: 'delivered' },
    { label: 'Cancelled', count: 0, status: 'cancelled' },
    { label: 'Refunded', count: 0, status: 'refunded' }
  ]);
  const [abandonedCount, setAbandonedCount] = useState(0);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [showProductStats, setShowProductStats] = useState(false);
  const [productFilter, setProductFilter] = useState('all');
  const [availableProducts, setAvailableProducts] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState('all');
  const [shippingMethodFilter, setShippingMethodFilter] = useState('all');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [markingPaid, setMarkingPaid] = useState<string | null>(null);
  const [dbTotal, setDbTotal] = useState<number | null>(null);

  // Hidden rows must never stay selected: any tab or filter change clears the selection.
  useEffect(() => {
    setSelectedOrders([]);
  }, [orderViewTab, statusFilter, searchQuery, productFilter, dateFrom, dateTo, paymentMethodFilter, shippingMethodFilter]);

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      setLoading(true);

      // Page through every order: the API caps a single select at 1000 rows.
      const PAGE = 1000;
      const ordersData: any[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data: page, error } = await supabase
          .from('orders')
          .select(`
          id,
          order_number,
          email,
          total,
          status,
          payment_status,
          payment_method,
          shipping_method,
          created_at,
          phone,
          shipping_address,
          metadata,
          order_items (
            quantity,
            product_name
          )
        `)
          .order('created_at', { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        ordersData.push(...(page || []));
        if (!page || page.length < PAGE) break;
      }

      setOrders(ordersData);

      // Exact row count from the database, so "Showing X of Y" can prove nothing is missing.
      const { count, error: countError } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true });
      setDbTotal(countError ? null : count ?? null);

      // Extract unique product names for filter
      const productNames = new Set<string>();
      ordersData?.forEach(o => {
        o.order_items?.forEach((item: any) => {
          if (item.product_name) productNames.add(item.product_name);
        });
      });
      setAvailableProducts(Array.from(productNames).sort());

      // Confirmed = paid (or refunded / cancelled); abandoned = unpaid and still open.
      const confirmedOrders = ordersData.filter(isConfirmedOrder);
      const abandonedOrders = ordersData.filter(isAbandonedOrder);
      
      setConfirmedCount(confirmedOrders.length);
      setAbandonedCount(abandonedOrders.length);

      // Calculate stats based on confirmed orders only
      const stats = [
        { label: 'All Orders', count: confirmedOrders.length, status: 'all' },
        { label: 'Pending', count: confirmedOrders.filter(o => o.status === 'pending').length, status: 'pending' },
        { label: 'Processing', count: confirmedOrders.filter(o => o.status === 'processing').length, status: 'processing' },
        { label: 'Packaged', count: confirmedOrders.filter(o => o.status === 'shipped').length, status: 'shipped' },
        { label: 'Delivered', count: confirmedOrders.filter(o => o.status === 'delivered').length, status: 'delivered' },
        { label: 'Cancelled', count: confirmedOrders.filter(o => o.status === 'cancelled').length, status: 'cancelled' },
        { label: 'Refunded', count: confirmedOrders.filter(o => o.status === 'refunded').length, status: 'refunded' }
      ];
      setOrderStats(stats);

    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const statusColors: Record<string, string> = {
    'pending': 'bg-amber-100 text-amber-700 border-amber-200',
    'processing': 'bg-blue-100 text-blue-700 border-blue-200',
    'shipped': 'bg-purple-100 text-purple-700 border-purple-200',
    'delivered': 'bg-blue-100 text-blue-700 border-blue-200',
    'cancelled': 'bg-red-100 text-red-700 border-red-200',
    'refunded': 'bg-purple-100 text-purple-700 border-purple-200',
    'awaiting_payment': 'bg-gray-100 text-gray-700 border-gray-200'
  };

  const formatStatus = (status: string) => {
    if (status === 'shipped') return 'Packaged';
    return status ? (status.charAt(0).toUpperCase() + status.slice(1)).replace(/_/g, ' ') : 'Unknown';
  };

  const getCustomerName = (order: Order) => {
    // Try shipping address names first (most reliable — entered at checkout)
    if (order.shipping_address?.firstName || order.shipping_address?.lastName) {
      const first = order.shipping_address.firstName?.trim() || '';
      const last = order.shipping_address.lastName?.trim() || '';
      return `${first} ${last}`.trim();
    }
    if (order.shipping_address?.full_name) return order.shipping_address.full_name;
    // Try metadata names
    if (order.metadata?.first_name || order.metadata?.last_name) {
      const first = order.metadata.first_name?.trim() || '';
      const last = order.metadata.last_name?.trim() || '';
      return `${first} ${last}`.trim();
    }
    if (order.profiles?.full_name) return order.profiles.full_name;
    if (order.email && !isPlaceholderEmail(order.email)) {
      const name = order.email.split('@')[0];
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
    return 'Guest';
  };

  /** Real email only: placeholder addresses (till, WhatsApp, no-email checkout) are not contact details. */
  const getCustomerEmail = (order: Order) => {
    const email = order.email || order.profiles?.email || '';
    return email && !isPlaceholderEmail(email) ? email : '';
  };

  const getCustomerAvatar = (order: Order) => {
    const name = getCustomerName(order);
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return parts[0][0] + parts[1][0];
    }
    return name.substring(0, 2).toUpperCase();
  };

  const getItemCount = (order: Order) => {
    if (!order.order_items) return 0;
    return order.order_items.reduce((sum, item) => sum + item.quantity, 0);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const handleSelectAll = () => {
    if (filteredOrders.length > 0 && filteredOrders.every((o) => selectedOrders.includes(o.id))) {
      setSelectedOrders([]);
    } else {
      setSelectedOrders(filteredOrders.map(o => o.id));
    }
  };

  const handleSelectOrder = (orderId: string) => {
    if (selectedOrders.includes(orderId)) {
      setSelectedOrders(selectedOrders.filter(id => id !== orderId));
    } else {
      setSelectedOrders([...selectedOrders, orderId]);
    }
  };

  const ORDER_CSV_HEADERS = ['Order ID', 'Customer', 'Email', 'Phone', 'Date', 'Items', 'Total (GHS)', 'Status', 'Payment Status', 'Payment Method', 'Shipping Method'];
  const orderCsvRow = (o: Order) => [
    o.order_number || o.id,
    getCustomerName(o),
    getCustomerEmail(o),
    o.phone || o.shipping_address?.phone || '',
    formatDate(o.created_at),
    getItemCount(o),
    csvMoney(o.total),
    o.status,
    o.payment_status,
    o.payment_method || '',
    o.shipping_method || '',
  ];

  /** Selected orders that are still visible under the current tab and filters. */
  const visibleSelected = () => {
    const visible = new Set(filteredOrders.map((o) => o.id));
    return orders.filter((o) => selectedOrders.includes(o.id) && visible.has(o.id));
  };

  const getAuthToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token;
  };

  const handleBulkAction = async (action: string, newStatus?: string) => {
    if (newStatus) {
      const targets = visibleSelected();
      if (targets.length === 0) return;
      // Only paid, open orders move forward. Unpaid (abandoned) orders are never
      // packed or announced to the customer, and cancelled/refunded ones are not reopened.
      const eligible = targets.filter(
        (o) =>
          o.payment_status === 'paid' &&
          !CLOSED_STATUSES.includes(o.status) &&
          (STATUS_RANK[o.status] ?? 99) < (STATUS_RANK[newStatus] ?? -1)
      );
      const unpaid = targets.filter((o) => o.payment_status !== 'paid').length;
      const skippedOther = targets.length - eligible.length - unpaid;
      if (eligible.length === 0) {
        alert(
          unpaid > 0
            ? `None of the selected orders can be marked ${formatStatus(newStatus)}: ${unpaid} ${unpaid === 1 ? 'is' : 'are'} not paid. Mark an order as paid first.`
            : `None of the selected orders can be marked ${formatStatus(newStatus)} (already at or past that step, or cancelled/refunded).`
        );
        return;
      }
      const confirmMsg =
        `Mark ${eligible.length} order${eligible.length === 1 ? '' : 's'} as ${formatStatus(newStatus)}? Each customer will be notified.` +
        (unpaid ? `\n${unpaid} unpaid order${unpaid === 1 ? '' : 's'} will be skipped.` : '') +
        (skippedOther ? `\n${skippedOther} already at or past that step, or cancelled/refunded, will be skipped.` : '');
      if (!confirm(confirmMsg)) return;

      setBulkBusy(true);
      const updated: Order[] = [];
      const failed: string[] = [];
      try {
        const { data: { user } } = await supabase.auth.getUser();
        for (const o of eligible) {
          // Guard on the status we saw, so a change made elsewhere meanwhile is not overwritten.
          const { data: changed, error: upErr } = await supabase
            .from('orders')
            .update({ status: newStatus, updated_at: new Date().toISOString() })
            .eq('id', o.id)
            .eq('payment_status', 'paid')
            .eq('status', o.status)
            .select('id');
          if (upErr || !changed || changed.length === 0) { failed.push(o.order_number || o.id); continue; }
          updated.push(o);
          const { error: histErr } = await supabase.from('order_status_history').insert({
            order_id: o.id,
            status: newStatus,
            notes: `Bulk status change from ${o.status || 'unknown'}`,
            created_by: user?.id ?? null,
          });
          if (histErr) console.error('Status history insert failed', histErr);
        }

        // Notify only the orders whose status actually changed, one at a time so
        // a failure (for example the notification rate limit) is counted, not lost.
        const authToken = await getAuthToken();
        let notifyFailed = 0;
        for (const order of updated) {
          try {
            const res = await fetch('/api/notifications', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(authToken && { 'Authorization': `Bearer ${authToken}` })
              },
              body: JSON.stringify({
                type: 'order_updated',
                payload: { order: { ...order, status: newStatus }, status: newStatus }
              })
            });
            if (!res.ok) notifyFailed++;
          } catch (err) {
            console.error('Notification error', err);
            notifyFailed++;
          }
        }

        await fetchOrders();
        setSelectedOrders([]);
        const skipped = targets.length - eligible.length;
        alert(
          `${updated.length} order${updated.length === 1 ? '' : 's'} updated to ${formatStatus(newStatus)}.` +
            (skipped ? `\n${skipped} skipped (not allowed in their current state).` : '') +
            (failed.length ? `\n${failed.length} not changed (changed elsewhere or failed): ${failed.join(', ')}` : '') +
            (notifyFailed ? `\n${notifyFailed} customer notification${notifyFailed === 1 ? '' : 's'} could not be sent.` : '')
        );
      } catch (error) {
        console.error('Error updating orders:', error);
        alert('Failed to update orders');
      } finally {
        setBulkBusy(false);
      }
    } else if (action === 'Export') {
      downloadCsv('selected-orders.csv', ORDER_CSV_HEADERS, visibleSelected().map(orderCsvRow));
    }
  };

  /** Staff confirms money was received (cash, transfer, MoMo seen on the phone). */
  const handleMarkPaid = async (order: Order) => {
    const ok = confirm(
      `Mark order ${order.order_number} (GH₵ ${Number(order.total || 0).toFixed(2)}) as PAID?\n\n` +
        'Only do this if you have received the money. Stock is taken for the items and the order moves to Confirmed Orders.'
    );
    if (!ok) return;
    setMarkingPaid(order.id);
    try {
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
      if (!res.ok || body?.success === false) throw new Error(body?.error || body?.message || `Request failed (${res.status})`);
      await fetchOrders();
      alert(`Order ${order.order_number} marked as paid.`);
    } catch (error: any) {
      console.error('Mark paid failed:', error);
      alert(`Could not mark the order as paid: ${error?.message || 'unknown error'}`);
    } finally {
      setMarkingPaid(null);
    }
  };

  const handleExportAll = () => {
    const tabName = orderViewTab === 'abandoned' ? 'abandoned-carts' : 'orders';
    downloadCsv(`${tabName}-${new Date().toISOString().slice(0, 10)}.csv`, ORDER_CSV_HEADERS, filteredOrders.map(orderCsvRow));
  };

  const handlePrintInvoice = (orderId: string) => {
    window.open(`/admin/orders/${orderId}?print=true`, '_blank');
  };

  const handleResendPaymentLink = async (order: Order) => {
    setSendingPaymentLink(order.id);
    try {
      const authToken = await getAuthToken();
      const response = await fetch('/api/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { Authorization: `Bearer ${authToken}` })
        },
        body: JSON.stringify({
          type: 'payment_link',
          payload: order
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.success === false) throw new Error(body?.error || body?.message || 'Failed to send');

      alert(`Payment link sent to ${order.phone || order.shipping_address?.phone || 'the customer'}`);
    } catch (error: any) {
      console.error('Error sending payment link:', error);
      alert(`Failed to send payment link: ${error?.message || 'unknown error'}`);
    } finally {
      setSendingPaymentLink(null);
    }
  };

  const filteredOrders = orders.filter(order => {
    const customerName = getCustomerName(order).toLowerCase();
    const customerEmail = getCustomerEmail(order).toLowerCase();
    const orderId = (order.order_number || order.id).toLowerCase();

    // First filter by view tab (confirmed vs abandoned)
    const matchesViewTab = orderViewTab === 'confirmed' ? isConfirmedOrder(order) : isAbandonedOrder(order);

    const matchesSearch = orderId.includes(searchQuery.toLowerCase()) ||
      customerName.includes(searchQuery.toLowerCase()) ||
      customerEmail.includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
    const matchesProduct = productFilter === 'all' || 
      order.order_items?.some((item: any) => item.product_name === productFilter);
    const day = order.created_at ? localDay(order.created_at) : '';
    const matchesDate = (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo);
    const matchesPaymentMethod = paymentMethodFilter === 'all' || (order.payment_method || '') === paymentMethodFilter;
    const matchesShipping = shippingMethodFilter === 'all' || (order.shipping_method || '') === shippingMethodFilter;
    return matchesViewTab && matchesSearch && matchesStatus && matchesProduct &&
      matchesDate && matchesPaymentMethod && matchesShipping;
  }).sort((a, b) => {
    switch (sortBy) {
      case 'total':
        return (b.total || 0) - (a.total || 0);
      case 'customer':
        return getCustomerName(a).localeCompare(getCustomerName(b));
      case 'status':
        return (a.status || '').localeCompare(b.status || '');
      case 'date':
      default:
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
  });

  const distinct = (values: (string | undefined | null)[]) =>
    Array.from(new Set(values.filter((v): v is string => !!v))).sort();
  const paymentMethods = distinct(orders.map((o) => o.payment_method));
  const shippingMethods = distinct(orders.map((o) => o.shipping_method));

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Orders</h1>
          <p className="text-gray-600 mt-1">Manage and track all customer orders</p>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <button
            onClick={() => setShowProductStats(true)}
            className="flex-1 md:flex-none bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer shadow-sm flex items-center justify-center"
          >
            <i className="ri-bar-chart-groupped-line mr-2"></i>
            Stats
          </button>
          <button
            onClick={handleExportAll}
            className="flex-1 md:flex-none bg-blue-700 hover:bg-blue-800 text-white px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer shadow-sm flex items-center justify-center"
          >
            <i className="ri-download-line mr-2"></i>
            Export ({filteredOrders.length})
          </button>
        </div>
      </div>

      {/* View Tabs: Confirmed Orders vs Abandoned Carts */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => { setOrderViewTab('confirmed'); setStatusFilter('all'); }}
          className={`px-6 py-3 font-semibold text-sm border-b-2 transition-colors cursor-pointer ${
            orderViewTab === 'confirmed'
              ? 'border-blue-700 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <i className="ri-check-double-line mr-2"></i>
          Confirmed Orders ({confirmedCount})
        </button>
        <button
          onClick={() => { setOrderViewTab('abandoned'); setStatusFilter('all'); }}
          className={`px-6 py-3 font-semibold text-sm border-b-2 transition-colors cursor-pointer ${
            orderViewTab === 'abandoned'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <i className="ri-shopping-cart-2-line mr-2"></i>
          Abandoned Carts ({abandonedCount})
        </button>
      </div>

      {orderViewTab === 'confirmed' && (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {orderStats.map((stat) => (
          <button
            key={stat.status}
            onClick={() => setStatusFilter(stat.status)}
            className={`p-4 rounded-xl border-2 transition-all text-left cursor-pointer ${statusFilter === stat.status
              ? 'border-blue-700 bg-blue-50'
              : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
          >
            <p className="text-2xl font-bold text-gray-900">{stat.count}</p>
            <p className="text-sm text-gray-600 mt-1">{stat.label}</p>
          </button>
        ))}
      </div>
      )}

      {/* Abandoned carts info banner */}
      {orderViewTab === 'abandoned' && abandonedCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <i className="ri-information-line text-xl text-amber-600 mt-0.5"></i>
            <div>
              <p className="text-sm font-semibold text-amber-800">Abandoned Carts</p>
              <p className="text-sm text-amber-700 mt-1">
                These orders were created but payment was not completed. You can resend payment links to customers.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
            <div className="flex-1 max-w-md">
              <div className="relative">
                <i className="ri-search-line absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg w-5 h-5 flex items-center justify-center"></i>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by order ID, customer name, or email..."
                  className="w-full pl-12 pr-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="px-4 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:border-gray-400 transition-colors font-medium whitespace-nowrap cursor-pointer"
              >
                <i className="ri-filter-line mr-2"></i>
                Filters
              </button>
              <select
                value={productFilter}
                onChange={(e) => setProductFilter(e.target.value)}
                className="px-4 py-3 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium cursor-pointer"
              >
                <option value="all">All Products</option>
                {availableProducts.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-4 py-3 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium cursor-pointer"
              >
                <option value="date">Sort by Date</option>
                <option value="total">Sort by Total</option>
                <option value="customer">Sort by Customer</option>
                <option value="status">Sort by Status</option>
              </select>
            </div>
          </div>

          {showFilters && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg grid md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">From</label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">To</label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Payment Method</label>
                <select value={paymentMethodFilter} onChange={(e) => setPaymentMethodFilter(e.target.value)} className="w-full px-3 py-2 pr-8 border-2 border-gray-300 rounded-lg text-sm cursor-pointer">
                  <option value="all">All Methods</option>
                  {paymentMethods.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Shipping Method</label>
                <select value={shippingMethodFilter} onChange={(e) => setShippingMethodFilter(e.target.value)} className="w-full px-3 py-2 pr-8 border-2 border-gray-300 rounded-lg text-sm cursor-pointer">
                  <option value="all">All Methods</option>
                  {shippingMethods.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              {(dateFrom || dateTo || paymentMethodFilter !== 'all' || shippingMethodFilter !== 'all') && (
                <div className="md:col-span-4">
                  <button
                    onClick={() => { setDateFrom(''); setDateTo(''); setPaymentMethodFilter('all'); setShippingMethodFilter('all'); }}
                    className="text-sm font-medium text-gray-900 hover:underline cursor-pointer"
                  >
                    Clear filters
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {selectedOrders.length > 0 && (
          <div className="p-4 bg-blue-50 border-b border-blue-200 flex items-center justify-between">
            <p className="text-blue-800 font-semibold">
              {visibleSelected().length} order{visibleSelected().length === 1 ? '' : 's'} selected
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {orderViewTab === 'confirmed' && (
                <>
                  <button
                    disabled={bulkBusy}
                    onClick={() => handleBulkAction('Mark as Processing', 'processing')}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
                  >
                    Mark Processing
                  </button>
                  <button
                    disabled={bulkBusy}
                    onClick={() => handleBulkAction('Mark as Packaged', 'shipped')}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
                  >
                    Mark Packaged
                  </button>
                </>
              )}
              <button
                onClick={() => handleBulkAction('Export')}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-800 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                <i className="ri-download-line mr-2"></i>
                Export
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="py-4 px-6">
                  <input
                    type="checkbox"
                    aria-label="Select all visible orders"
                    checked={filteredOrders.length > 0 && filteredOrders.every((o) => selectedOrders.includes(o.id))}
                    onChange={handleSelectAll}
                    className="w-4 h-4 text-blue-700 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                  />
                </th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Order ID</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Customer</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Date</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Items</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Total</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Payment</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Status</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-gray-500">
                    <i className="ri-loader-4-line animate-spin text-3xl text-blue-700"></i>
                    <p className="mt-2">Loading orders...</p>
                  </td>
                </tr>
              ) : filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-gray-500">
                    <i className="ri-inbox-line text-4xl text-gray-300"></i>
                    <p className="mt-2">No orders found</p>
                    <p className="text-sm">Orders will appear here when customers place them</p>
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => (
                  <tr key={order.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-6">
                      <input
                        type="checkbox"
                        aria-label={`Select order ${order.order_number}`}
                        checked={selectedOrders.includes(order.id)}
                        onChange={() => handleSelectOrder(order.id)}
                        className="w-4 h-4 text-blue-700 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                      />
                    </td>
                    <td className="py-4 px-4">
                      <Link href={`/admin/orders/${order.id}`} className="text-blue-700 hover:text-blue-800 font-semibold whitespace-nowrap cursor-pointer">
                        {order.order_number || order.id.substring(0, 8)}
                      </Link>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 flex items-center justify-center bg-gray-200 text-gray-700 rounded-full font-semibold text-sm">
                          {getCustomerAvatar(order)}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 whitespace-nowrap">{getCustomerName(order)}</p>
                          <p className="text-sm text-gray-500">{getCustomerEmail(order) || order.phone || order.shipping_address?.phone || ''}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-gray-700 text-sm whitespace-nowrap">{formatDate(order.created_at)}</td>
                    <td className="py-4 px-4 text-gray-700">{getItemCount(order)}</td>
                    <td className="py-4 px-4 font-semibold text-gray-900 whitespace-nowrap">GH₵ {order.total?.toFixed(2) || '0.00'}</td>
                    <td className="py-4 px-4 text-sm whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-gray-700">{order.payment_method || 'N/A'}</span>
                        {order.payment_status !== 'paid' && (
                          <span className={`text-xs mt-1 capitalize ${order.payment_status === 'failed' ? 'text-red-600' : order.payment_status === 'refunded' || order.payment_status === 'partially_refunded' ? 'text-purple-600' : 'text-amber-600'}`}>
                            {(order.payment_status || 'pending').replace(/_/g, ' ')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold border whitespace-nowrap ${statusColors[order.status] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                        {formatStatus(order.status)}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-2">
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                          title="View Order"
                          aria-label={`View order ${order.order_number}`}
                        >
                          <i className="ri-eye-line text-lg w-4 h-4 flex items-center justify-center"></i>
                        </Link>
                        {orderViewTab === 'abandoned' && isAbandonedOrder(order) && (
                          <button
                            onClick={() => handleResendPaymentLink(order)}
                            disabled={sendingPaymentLink === order.id}
                            className="w-8 h-8 flex items-center justify-center text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                            title="Resend Payment Link"
                            aria-label={`Resend payment link for order ${order.order_number}`}
                          >
                            {sendingPaymentLink === order.id ? (
                              <i className="ri-loader-4-line text-lg w-4 h-4 flex items-center justify-center animate-spin"></i>
                            ) : (
                              <i className="ri-send-plane-line text-lg w-4 h-4 flex items-center justify-center"></i>
                            )}
                          </button>
                        )}
                        {canMarkPaid(order) && (
                          <button
                            onClick={() => handleMarkPaid(order)}
                            disabled={markingPaid === order.id}
                            className="w-8 h-8 flex items-center justify-center text-green-700 hover:text-green-800 hover:bg-green-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                            title="Mark as paid"
                            aria-label={`Mark order ${order.order_number} as paid`}
                          >
                            {markingPaid === order.id ? (
                              <i className="ri-loader-4-line text-lg w-4 h-4 flex items-center justify-center animate-spin"></i>
                            ) : (
                              <i className="ri-money-dollar-circle-line text-lg w-4 h-4 flex items-center justify-center"></i>
                            )}
                          </button>
                        )}
                        <button
                          onClick={() => handlePrintInvoice(order.id)}
                          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                          title="Print Invoice"
                          aria-label={`Print invoice for order ${order.order_number}`}
                        >
                          <i className="ri-printer-line text-lg w-4 h-4 flex items-center justify-center"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {filteredOrders.length > 0 && (
          <div className="p-6 border-t border-gray-200 flex items-center justify-between">
            <p className="text-gray-600">
              Showing {filteredOrders.length} of {orders.length} orders
              {dbTotal !== null && dbTotal !== orders.length && (
                <span className="text-amber-700"> ({dbTotal} in the database: refresh to load the rest)</span>
              )}
            </p>
          </div>
        )}
      </div>

      <ProductSalesStats isOpen={showProductStats} onClose={() => setShowProductStats(false)} />
    </div>
  );
}
