'use client';

import Link from 'next/link';
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { downloadCsv, csvMoney } from '@/lib/csv';
import { isPlaceholderEmail } from '@/lib/placeholder-email';
import { normalizeGhanaPhone, phoneLast9 } from '@/lib/phone';

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

/** Lower-cased email; placeholder addresses (till walk-ins, WhatsApp orders) never match anyone. */
const emailKey = (email?: string | null) => (isPlaceholderEmail(email) ? '' : String(email || '').trim().toLowerCase());

export default function AdminCustomersPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sortOption, setSortOption] = useState('Sort by Join Date');
  const [filterStatus, setFilterStatus] = useState('All Customers');

  useEffect(() => {
    fetchCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const fetchCustomers = async () => {
    try {
      setLoading(true);
      setLoadError(null);

      // Every customer record (registered, guest and till customers), paged past 1000 rows.
      const customerData = await fetchAllRows<any>(() =>
        supabase.from('customers').select('*').order('created_at', { ascending: false })
      );

      // Totals follow the revenue rule: paid, and not cancelled or refunded.
      const orders = await fetchAllRows<any>(() =>
        supabase
          .from('orders')
          .select('id, user_id, email, phone, total, created_at')
          .eq('payment_status', 'paid')
          .not('status', 'in', '(cancelled,refunded)')
          .order('created_at', { ascending: false })
      );
      const byUser = new Map<string, any[]>();
      const byEmail = new Map<string, any[]>();
      const byPhone = new Map<string, any[]>();
      const push = (map: Map<string, any[]>, key: string, o: any) => {
        if (!key) return;
        const list = map.get(key) || [];
        list.push(o);
        map.set(key, list);
      };
      for (const o of orders) {
        if (o.user_id) push(byUser, o.user_id, o);
        push(byEmail, emailKey(o.email), o);
        push(byPhone, phoneLast9(o.phone), o);
      }

      const processed = customerData.map((customer: any) => {
        // Orders placed signed in, or as a guest / at the till with this email or phone.
        const matched = new Map<string, any>();
        const add = (list?: any[]) => list?.forEach((o) => matched.set(o.id, o));
        if (customer.user_id) add(byUser.get(customer.user_id));
        add(byEmail.get(emailKey(customer.email)));
        add(byEmail.get(emailKey(customer.secondary_email)));
        add(byPhone.get(phoneLast9(customer.phone)));
        add(byPhone.get(phoneLast9(customer.secondary_phone)));
        const paid = Array.from(matched.values());
        const totalSpent = paid.reduce((sum, o) => sum + Number(o.total || 0), 0);
        const totalOrders = paid.length;
        const lastOrderAt = paid.reduce<string | null>((latest, o) => (!latest || o.created_at > latest ? o.created_at : latest), null);

        let status = 'New';
        if (totalSpent > 1000) status = 'VIP';
        else if (totalOrders > 0) status = 'Active';
        else if (new Date(customer.created_at).getTime() < Date.now() - 30 * 24 * 60 * 60 * 1000) status = 'Inactive';

        const displayName = customer.full_name ||
          (customer.first_name && customer.last_name ? `${customer.first_name} ${customer.last_name}` : null) ||
          customer.first_name ||
          'No Name';
        const email = isPlaceholderEmail(customer.email) ? '' : (customer.email || '');

        return {
          id: customer.id,
          name: displayName,
          email,
          phone: customer.phone || 'N/A',
          avatar: getInitials(displayName !== 'No Name' ? displayName : email || String(customer.phone || '')),
          orders: totalOrders,
          totalSpent,
          joined: new Date(customer.created_at).toLocaleDateString('en-GB'),
          lastOrder: lastOrderAt ? timeAgo(new Date(lastOrderAt)) : 'Never',
          status,
          rawJoined: new Date(customer.created_at),
          rawLastOrder: lastOrderAt ? new Date(lastOrderAt) : null,
          isGuest: !customer.user_id
        };
      });
      setCustomers(processed);
    } catch (error: any) {
      console.error('Error fetching customers:', error);
      setLoadError(error?.message || 'Could not load customers.');
    } finally {
      setLoading(false);
    }
  };

  const getInitials = (name: string) => {
    if (!name) return '??';
    return name
      .split(' ')
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  const timeAgo = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " years ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " months ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hours ago";
    return "Just now";
  }

  const statusColors: any = {
    'New': 'bg-blue-100 text-blue-700',
    'Active': 'bg-blue-100 text-blue-700',
    'VIP': 'bg-purple-100 text-purple-700',
    'Inactive': 'bg-gray-100 text-gray-700'
  };

  /** Select-all covers the rows currently shown (search + status filter), not the whole list. */
  const handleSelectAll = () => {
    const visibleIds = filteredCustomers.map(c => c.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedCustomers.includes(id));
    setSelectedCustomers(allVisibleSelected ? [] : visibleIds);
  };

  /** Selected customers that are still visible under the current search/filter. */
  const visibleSelectedCustomers = () => {
    const visible = new Set(filteredCustomers.map(c => c.id));
    return customers.filter(c => selectedCustomers.includes(c.id) && visible.has(c.id));
  };

  const handleSelectCustomer = (customerId: string) => {
    if (selectedCustomers.includes(customerId)) {
      setSelectedCustomers(selectedCustomers.filter(id => id !== customerId));
    } else {
      setSelectedCustomers([...selectedCustomers, customerId]);
    }
  };

  const handleExportCustomers = (subset?: any[]) => {
    const data = subset || filteredCustomers;
    downloadCsv(
      `customers-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Name', 'Email', 'Phone', 'Paid Orders', 'Total Spent (GHS)', 'Status', 'Type', 'Joined', 'Last Paid Order'],
      data.map(c => [
        c.name,
        c.email,
        c.phone === 'N/A' ? '' : c.phone,
        c.orders,
        csvMoney(c.totalSpent),
        c.status,
        c.isGuest ? 'Guest' : 'Registered',
        c.joined,
        c.rawLastOrder ? new Date(c.rawLastOrder).toLocaleDateString('en-GB') : '',
      ])
    );
  };

  /** Customers are reached on WhatsApp: open a chat with this customer's number. */
  const whatsappHref = (customer: any) => {
    const phone = normalizeGhanaPhone(customer.phone);
    return phone ? `https://wa.me/${phone.replace('+', '')}` : null;
  };

  const handleDeleteCustomer = async (customer: any) => {
    const label = customer.name !== 'No Name' ? customer.name : customer.email || customer.phone;
    if (!confirm(
      `Delete the customer record for ${label}?\n\n` +
      'Their orders are kept. The record is created again if they order with the same email or phone. This cannot be undone.'
    )) return;
    const { error } = await supabase.from('customers').delete().eq('id', customer.id);
    if (error) {
      alert('Failed to delete customer: ' + error.message);
      return;
    }
    setCustomers(prev => prev.filter(c => c.id !== customer.id));
    setSelectedCustomers(prev => prev.filter(id => id !== customer.id));
  };

  // Memoized filter and sort
  const filteredCustomers = useMemo(() => {
    let result = customers;

    // Filter by Status
    if (filterStatus !== 'All Customers') {
      result = result.filter(c => c.status === filterStatus);
    }

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c =>
        String(c.name || '').toLowerCase().includes(q) ||
        String(c.email || '').toLowerCase().includes(q) ||
        String(c.phone || '').toLowerCase().includes(q)
      );
    }

    // Sort
    result = [...result].sort((a, b) => {
      if (sortOption === 'Sort by Name') return a.name.localeCompare(b.name);
      if (sortOption === 'Sort by Orders') return b.orders - a.orders;
      if (sortOption === 'Sort by Spent') return b.totalSpent - a.totalSpent;
      if (sortOption === 'Sort by Join Date') return b.rawJoined.getTime() - a.rawJoined.getTime();
      return 0;
    });

    return result;
  }, [customers, searchQuery, sortOption, filterStatus]);

  // Hidden customers must not stay selected after the search or filter changes.
  useEffect(() => {
    setSelectedCustomers([]);
  }, [searchQuery, filterStatus]);

  // Derived Stats
  const stats = useMemo(() => {
    const buyers = customers.filter(c => c.orders > 0);
    return {
      total: customers.length,
      newThisMonth: customers.filter(c => {
        const d = new Date(c.rawJoined);
        const now = new Date();
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      }).length,
      vip: customers.filter(c => c.status === 'VIP').length,
      // Average over customers who have bought something.
      avgLTV: buyers.length > 0 ? (buyers.reduce((sum, c) => sum + c.totalSpent, 0) / buyers.length) : 0
    };
  }, [customers]);

  const selectedVisibleCount = visibleSelectedCustomers().length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Customers</h1>
          <p className="text-gray-600 mt-1">Manage your customer base and relationships</p>
        </div>
        <button
          onClick={() => handleExportCustomers()}
          disabled={loading || filteredCustomers.length === 0}
          className="bg-blue-700 hover:bg-blue-800 text-white px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <i className="ri-download-line mr-2"></i>
          Export Customers ({filteredCustomers.length})
        </button>
      </div>

      {loadError && (
        <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm" role="alert">
          {loadError}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Total Customers</p>
          <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">New This Month</p>
          <p className="text-2xl font-bold text-blue-700">{stats.newThisMonth}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">VIP Customers</p>
          <p className="text-2xl font-bold text-purple-700">{stats.vip}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Avg Lifetime Value</p>
          <p className="text-2xl font-bold text-gray-900">GH₵ {stats.avgLTV.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          <p className="text-xs text-gray-500 mt-1">Per paying customer</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
            <div className="flex-1 max-w-md">
              <div className="relative">
                <i className="ri-search-line absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg flex items-center justify-center"></i>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name, email, or phone..."
                  aria-label="Search customers"
                  className="w-full pl-12 pr-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                aria-label="Filter by status"
                className="px-4 py-3 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium cursor-pointer"
              >
                <option>All Customers</option>
                <option>New</option>
                <option>Active</option>
                <option>VIP</option>
                <option>Inactive</option>
              </select>
              <select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value)}
                aria-label="Sort customers"
                className="px-4 py-3 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium cursor-pointer"
              >
                <option>Sort by Join Date</option>
                <option>Sort by Name</option>
                <option>Sort by Orders</option>
                <option>Sort by Spent</option>
              </select>
            </div>
          </div>
        </div>

        {selectedVisibleCount > 0 && (
          <div className="p-4 bg-blue-50 border-b border-blue-200 flex items-center justify-between">
            <p className="text-blue-800 font-semibold">
              {selectedVisibleCount} customer{selectedVisibleCount > 1 ? 's' : ''} selected
            </p>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => handleExportCustomers(visibleSelectedCustomers())}
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
                    checked={filteredCustomers.length > 0 && filteredCustomers.every(c => selectedCustomers.includes(c.id))}
                    aria-label="Select all shown customers"
                    onChange={handleSelectAll}
                    className="w-4 h-4 text-blue-700 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                  />
                </th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Customer</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Contact</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Paid Orders</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Total Spent</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Last Order</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Status</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="p-10 text-center text-gray-500">Loading customers...</td></tr>
              ) : filteredCustomers.length === 0 ? (
                <tr><td colSpan={8} className="p-10 text-center text-gray-500">No customers found.</td></tr>
              ) : (
                filteredCustomers.map((customer) => {
                  const wa = whatsappHref(customer);
                  return (
                    <tr key={customer.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="py-4 px-6">
                        <input
                          type="checkbox"
                          checked={selectedCustomers.includes(customer.id)}
                          onChange={() => handleSelectCustomer(customer.id)}
                          aria-label={`Select ${customer.name}`}
                          className="w-4 h-4 text-blue-700 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                        />
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 flex items-center justify-center bg-blue-100 text-blue-700 rounded-full font-semibold">
                            {customer.avatar}
                          </div>
                          <div>
                            <Link href={`/admin/customers/${customer.id}`} className="font-semibold text-gray-900 hover:text-blue-700 whitespace-nowrap">
                              {customer.name}
                            </Link>
                            <p className="text-sm text-gray-500">Joined {customer.joined}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <p className="text-gray-700 text-sm">{customer.email}</p>
                        <p className="text-gray-600 text-sm">{customer.phone}</p>
                      </td>
                      <td className="py-4 px-4 font-semibold text-gray-900">{customer.orders}</td>
                      <td className="py-4 px-4 font-semibold text-gray-900 whitespace-nowrap">GH₵ {customer.totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="py-4 px-4 text-gray-700 text-sm whitespace-nowrap">{customer.lastOrder}</td>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-2">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${statusColors[customer.status]}`}>
                            {customer.status}
                          </span>
                          {customer.isGuest && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                              Guest
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-2">
                          <Link
                            href={`/admin/customers/${customer.id}`}
                            title="View Customer"
                            aria-label={`View ${customer.name}`}
                            className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <i className="ri-eye-line text-lg" aria-hidden="true"></i>
                          </Link>
                          {wa && (
                            <a
                              href={wa}
                              target="_blank"
                              rel="noreferrer"
                              title="Message on WhatsApp"
                              aria-label={`Message ${customer.name} on WhatsApp`}
                              className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-green-700 hover:bg-green-50 rounded-lg transition-colors"
                            >
                              <i className="ri-whatsapp-line text-lg" aria-hidden="true"></i>
                            </a>
                          )}
                          <button
                            onClick={() => handleDeleteCustomer(customer)}
                            title="Delete Customer"
                            aria-label={`Delete ${customer.name}`}
                            className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                          >
                            <i className="ri-delete-bin-line text-lg" aria-hidden="true"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="p-6 border-t border-gray-200 flex items-center justify-between">
          <p className="text-gray-600">Showing {filteredCustomers.length} of {customers.length} customers</p>
        </div>
      </div>
    </div>
  );
}
