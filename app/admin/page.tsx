'use client';

import Link from 'next/link';
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { isPlaceholderEmail } from '@/lib/placeholder-email';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

/** Page through a query 1000 rows at a time (one select is capped at 1000 rows). */
async function fetchAllRows<T = any>(build: () => any): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...((data || []) as T[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

/** Real sales only: paid, and not cancelled or refunded. */
function isRealSale(o: { payment_status?: string | null; status?: string | null }) {
  return o.payment_status === 'paid' && o.status !== 'cancelled' && o.status !== 'refunded';
}

/** Low-stock threshold for a product: metadata.low_stock_threshold, default 5 (same rule as Products → Low stock). */
function lowStockThreshold(product: any): number {
  const raw = product?.metadata?.low_stock_threshold;
  const n = Number(raw);
  return raw !== null && raw !== undefined && raw !== '' && Number.isFinite(n) && n >= 0 ? n : 5;
}

const TOP_SELLER_DAYS = 90;
const PLACEHOLDER_IMAGE = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2780%27 height=%2780%27 viewBox=%270 0 80 80%27%3E%3Crect width=%2780%27 height=%2780%27 fill=%27%23f3f4f6%27/%3E%3Cpath d=%27M24 54l10-12 8 9 6-7 8 10z%27 fill=%27%23d1d5db%27/%3E%3Ccircle cx=%2730%27 cy=%2730%27 r=%275%27 fill=%27%23d1d5db%27/%3E%3C/svg%3E';

/** Local calendar day key (YYYY-MM-DD), so the chart follows Ghana time, not UTC. */
function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AdminDashboard() {
  const [dateRange, setDateRange] = useState<'7days' | '30days'>('7days');
  // Real sales (paid, not cancelled/refunded); the chart is built from these for the chosen range.
  const [realOrders, setRealOrders] = useState<{ total: number | null; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [stats, setStats] = useState<{ title: string; value: string; note: string; icon: string; color: string }[]>([
    { title: 'Revenue (all time)', value: 'GH₵ 0.00', note: 'Paid orders', icon: 'ri-money-dollar-circle-line', color: 'blue' },
    { title: 'Paid Orders', value: '0', note: 'All time', icon: 'ri-shopping-bag-line', color: 'blue' },
    { title: 'Paying Customers', value: '0', note: 'Unique email or phone', icon: 'ri-group-line', color: 'purple' },
    { title: 'Avg Order Value', value: 'GH₵ 0.00', note: 'Paid orders', icon: 'ri-line-chart-line', color: 'amber' }
  ]);

  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [lowStockProducts, setLowStockProducts] = useState<any[]>([]);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [topProducts, setTopProducts] = useState<any[]>([]);

  const chartData = useMemo(() => {
    const days = dateRange === '30days' ? 30 : 7;
    const keys = Array.from({ length: days }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (days - 1 - i));
      return dayKey(d);
    });
    const map: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
    realOrders.forEach((order) => {
      const key = dayKey(new Date(order.created_at));
      if (map[key] !== undefined) map[key] += Number(order.total || 0);
    });
    return keys.map((key) => ({
      date: new Date(`${key}T12:00:00`).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }),
      revenue: Math.round(map[key] * 100) / 100,
    }));
  }, [realOrders, dateRange]);

  const rangeRevenue = useMemo(() => chartData.reduce((sum, d) => sum + d.revenue, 0), [chartData]);

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        // 1. All orders, paged (one select is capped at 1000 rows).
        const allOrdersData = await fetchAllRows<{
          id: string;
          total: number | null;
          status: string;
          payment_status: string;
          created_at: string;
          email: string | null;
          phone: string | null;
        }>(() =>
          supabase
            .from('orders')
            .select('id, total, status, payment_status, created_at, email, phone')
            .order('created_at', { ascending: false })
        );

        // Unpaid (abandoned) checkouts and cancelled/refunded orders are not counted.
        const paidOrders = allOrdersData.filter(isRealSale);
        const totalRevenue = paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
        const paidOrderCount = paidOrders.length;
        const avgOrderValue = paidOrderCount > 0 ? totalRevenue / paidOrderCount : 0;
        const uniqueCustomers = new Set(
          paidOrders
            .map(o => (isPlaceholderEmail(o.email) ? '' : (o.email || '').trim().toLowerCase()) || (o.phone || '').replace(/\D/g, '').slice(-9))
            .filter(Boolean)
        ).size;

        setRealOrders(paidOrders);

        setStats([
          { title: 'Revenue (all time)', value: `GH₵ ${totalRevenue.toFixed(2)}`, note: 'Paid orders', icon: 'ri-money-dollar-circle-line', color: 'blue' },
          { title: 'Paid Orders', value: paidOrderCount.toString(), note: 'All time', icon: 'ri-shopping-bag-line', color: 'blue' },
          { title: 'Paying Customers', value: uniqueCustomers.toString(), note: 'Unique email or phone', icon: 'ri-group-line', color: 'purple' },
          { title: 'Avg Order Value', value: `GH₵ ${avgOrderValue.toFixed(2)}`, note: 'Paid orders', icon: 'ri-line-chart-line', color: 'amber' }
        ]);

        // 2. Recent orders (paid, not cancelled or refunded)
        const { data: recentOrdersData, error: recentError } = await supabase
          .from('orders')
          .select('id, order_number, user_id, email, created_at, total, status, shipping_address')
          .eq('payment_status', 'paid')
          .not('status', 'in', '(cancelled,refunded)')
          .order('created_at', { ascending: false })
          .limit(5);
        if (recentError) throw recentError;

        setRecentOrders((recentOrdersData || []).map((o: any) => {
          const addr = o.shipping_address || {};
          const customerName = (addr.firstName && addr.lastName)
            ? `${addr.firstName.trim()} ${addr.lastName.trim()}`
            : addr.full_name || addr.firstName || (isPlaceholderEmail(o.email) ? '' : (o.email || '').split('@')[0]) || 'Customer';
          return {
            id: o.id,
            displayId: o.order_number,
            customer: customerName,
            email: isPlaceholderEmail(o.email) ? (addr.phone || '') : o.email,
            date: new Date(o.created_at).toLocaleDateString(),
            total: Number(o.total || 0),
            status: o.status,
          };
        }));

        // 3. Low stock: active, stock-tracked products at or below their own threshold.
        const activeProducts = await fetchAllRows<any>(() =>
          supabase
            .from('products')
            .select('id, name, quantity, track_quantity, status, metadata')
            .eq('status', 'active')
            .eq('track_quantity', true)
            .order('quantity', { ascending: true })
        );
        const lowStock = activeProducts
          .filter(p => p.track_quantity === true && Number(p.quantity ?? 0) <= lowStockThreshold(p))
          .sort((a, b) => Number(a.quantity ?? 0) - Number(b.quantity ?? 0));
        setLowStockCount(lowStock.length);
        setLowStockProducts(lowStock.slice(0, 5).map((p: any) => ({
          id: p.id,
          name: p.name,
          stock: Number(p.quantity ?? 0),
          threshold: lowStockThreshold(p),
          status: Number(p.quantity ?? 0) <= 0 ? 'critical' : 'low'
        })));

        // 4. Top sellers: units sold on real sales in the last 90 days.
        const since = new Date();
        since.setDate(since.getDate() - TOP_SELLER_DAYS);
        const realIds = new Set(paidOrders.filter(o => new Date(o.created_at) >= since).map(o => o.id));
        const items = await fetchAllRows<any>(() =>
          supabase
            .from('order_items')
            .select('order_id, product_id, product_name, quantity, total_price')
            .gte('created_at', since.toISOString())
        );
        const byProduct = new Map<string, { id: string; name: string; sales: number; revenue: number }>();
        for (const item of items) {
          if (!item.product_id || !realIds.has(item.order_id)) continue;
          const entry = byProduct.get(item.product_id) || { id: item.product_id, name: item.product_name, sales: 0, revenue: 0 };
          entry.sales += Number(item.quantity || 0);
          entry.revenue += Number(item.total_price || 0);
          byProduct.set(item.product_id, entry);
        }
        const top = Array.from(byProduct.values()).sort((a, b) => b.sales - a.sales || b.revenue - a.revenue).slice(0, 4);
        if (top.length > 0) {
          const { data: productData, error: productError } = await supabase
            .from('products')
            .select('id, name, quantity, product_images(url, position)')
            .in('id', top.map(t => t.id));
          if (productError) throw productError;
          const productMap = new Map((productData || []).map((p: any) => [p.id, p]));
          setTopProducts(top.map(t => {
            const p: any = productMap.get(t.id);
            const images = [...(p?.product_images || [])].sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
            return {
              id: t.id,
              name: p?.name || t.name,
              image: images[0]?.url || PLACEHOLDER_IMAGE,
              sales: t.sales,
              revenue: t.revenue,
              stock: p ? Number(p.quantity ?? 0) : null,
            };
          }));
        } else {
          setTopProducts([]);
        }

      } catch (error: any) {
        console.error('Error loading dashboard:', error);
        setLoadError(error?.message || 'Some dashboard figures could not be loaded.');
      } finally {
        setLoading(false);
      }
    }

    fetchDashboardData();
  }, []);

  const statusColors: any = {
    'pending': 'bg-amber-100 text-amber-700',
    'processing': 'bg-blue-100 text-blue-700',
    'shipped': 'bg-purple-100 text-purple-700',
    'delivered': 'bg-blue-100 text-blue-700',
    'cancelled': 'bg-red-100 text-red-700',
    'refunded': 'bg-red-100 text-red-700'
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading Dashboard...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-gray-600 mt-1">Welcome back! Here's what's happening with your store.</p>
          </div>
        </div>

        {loadError && (
          <div className="mb-6 p-4 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm" role="alert">
            Some figures could not be loaded: {loadError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {stats.map((stat) => (
            <div key={stat.title} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-4">
                <div className={`w-12 h-12 flex items-center justify-center bg-${stat.color}-100 text-${stat.color}-700 rounded-lg`}>
                  <i className={`${stat.icon} text-2xl`}></i>
                </div>
                <span className="text-xs font-medium text-gray-500">
                  {stat.note}
                </span>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-1">{stat.value}</h3>
              <p className="text-gray-600 text-sm">{stat.title}</p>
            </div>
          ))}
        </div>

        {/* Revenue Chart & Quick Actions */}
        <div className="grid lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Revenue Trend</h2>
                <p className="text-sm text-gray-500">Paid orders: GH₵ {rangeRevenue.toFixed(2)} in the {dateRange === '30days' ? 'last 30 days' : 'last 7 days'}</p>
              </div>
              <select
                aria-label="Chart date range"
                className="bg-gray-50 border border-gray-200 text-gray-700 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2"
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value === '30days' ? '30days' : '7days')}
              >
                <option value="7days">Last 7 Days</option>
                <option value="30days">Last 30 Days</option>
              </select>
            </div>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.1} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(value) => `GH₵${value}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    formatter={(value) => [`GH₵${(value as number)?.toFixed(2) ?? '0.00'}`, 'Revenue']}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorRevenue)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Quick Actions</h2>
            <div className="space-y-3">
              <Link href="/admin/products/new" className="flex items-center justify-between p-4 bg-gray-50 hover:bg-blue-50 text-gray-700 hover:text-blue-700 rounded-lg transition-colors group">
                <div className="flex items-center font-medium">
                  <span className="w-8 h-8 rounded-full bg-white flex items-center justify-center mr-3 group-hover:bg-blue-100 transition-colors shadow-sm">
                    <i className="ri-add-line"></i>
                  </span>
                  Add Product
                </div>
                <i className="ri-arrow-right-line"></i>
              </Link>
              <Link href="/admin/pos" className="flex items-center justify-between p-4 bg-gray-50 hover:bg-blue-50 text-gray-700 hover:text-blue-700 rounded-lg transition-colors group">
                <div className="flex items-center font-medium">
                  <span className="w-8 h-8 rounded-full bg-white flex items-center justify-center mr-3 group-hover:bg-blue-100 transition-colors shadow-sm">
                    <i className="ri-computer-line"></i>
                  </span>
                  Open POS
                </div>
                <i className="ri-arrow-right-line"></i>
              </Link>
              <Link href="/admin/orders" className="flex items-center justify-between p-4 bg-gray-50 hover:bg-blue-50 text-gray-700 hover:text-blue-700 rounded-lg transition-colors group">
                <div className="flex items-center font-medium">
                  <span className="w-8 h-8 rounded-full bg-white flex items-center justify-center mr-3 group-hover:bg-blue-100 transition-colors shadow-sm">
                    <i className="ri-file-list-line"></i>
                  </span>
                  Manage Orders
                </div>
                <i className="ri-arrow-right-line"></i>
              </Link>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6 overflow-hidden">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900">Recent Paid Orders</h2>
              <Link href="/admin/orders" className="text-blue-700 hover:text-blue-800 font-medium text-sm whitespace-nowrap cursor-pointer">
                View All <i className="ri-arrow-right-line ml-1"></i>
              </Link>
            </div>

            <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
              {recentOrders.length === 0 ? (
                <p className="text-gray-500 text-center py-4">No recent orders.</p>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Order ID</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Customer</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Date</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Total</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentOrders.map((order) => (
                      <tr key={order.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="py-4 px-4">
                          <Link href={`/admin/orders/${order.id}`} className="text-blue-700 hover:text-blue-800 font-medium whitespace-nowrap cursor-pointer">
                            {order.displayId}
                          </Link>
                        </td>
                        <td className="py-4 px-4">
                          <p className="font-medium text-gray-900 whitespace-nowrap">{order.customer}</p>
                          <p className="text-sm text-gray-500">{order.email}</p>
                        </td>
                        <td className="py-4 px-4 text-gray-700 whitespace-nowrap">{order.date}</td>
                        <td className="py-4 px-4 font-semibold text-gray-900 whitespace-nowrap">GH₵ {Number(order.total || 0).toFixed(2)}</td>
                        <td className="py-4 px-4">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${statusColors[order.status] || 'bg-gray-100'}`}>
                            {order.status === 'shipped' ? 'Packaged' : order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">
                Low Stock Alert{lowStockCount > 0 ? ` (${lowStockCount})` : ''}
              </h2>
              {lowStockProducts.length === 0 ? (
                <p className="text-gray-500">Inventory looks good!</p>
              ) : (
                <div className="space-y-3">
                  {lowStockProducts.map((product) => (
                    <Link key={product.id} href={`/admin/products/${product.id}`} className="flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 text-sm truncate pr-2">{product.name}</p>
                        <p className="text-xs text-gray-600 mt-1">Stock: {product.stock} units (alert at {product.threshold})</p>
                      </div>
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${product.status === 'critical' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                        {product.status === 'critical' ? 'Out of stock' : 'Low'}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
              <Link href="/admin/products?filter=low-stock" className="block text-center mt-4 text-blue-700 hover:text-blue-800 font-medium text-sm whitespace-nowrap cursor-pointer">
                View all low-stock products <i className="ri-arrow-right-line ml-1"></i>
              </Link>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6 overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Top Sellers</h2>
              <p className="text-sm text-gray-500">Units sold on paid orders, last {TOP_SELLER_DAYS} days</p>
            </div>
            <Link href="/admin/products" className="text-blue-700 hover:text-blue-800 font-medium text-sm whitespace-nowrap cursor-pointer">
              View All <i className="ri-arrow-right-line ml-1"></i>
            </Link>
          </div>

          {topProducts.length === 0 && (
            <p className="text-gray-500 text-center py-4">No paid sales in the last {TOP_SELLER_DAYS} days.</p>
          )}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {topProducts.map((product) => (
              <div key={product.id} className="border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow">
                <div className="aspect-square bg-gray-100 rounded-lg overflow-hidden mb-3">
                  <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2">{product.name}</h3>
                <p className="text-sm text-gray-700">{product.sales} sold · GH₵ {product.revenue.toFixed(2)}</p>
                <div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between">
                  <span className="text-sm text-gray-600">{product.stock === null ? 'Product removed' : `Stock: ${product.stock}`}</span>
                  <Link href={`/admin/products/${product.id}`} className="text-blue-700 hover:text-blue-800 text-sm font-medium whitespace-nowrap cursor-pointer">
                    Edit <i className="ri-arrow-right-line ml-1"></i>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
