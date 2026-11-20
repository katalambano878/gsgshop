'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { isPlaceholderEmail } from '@/lib/placeholder-email';
import { normalizeGhanaPhone } from '@/lib/phone';

type Totals = { paidOrders: number; totalSpent: number; lastOrderAt: string | null };

const money = (value: unknown) => {
    const n = Number(value);
    return (Number.isFinite(n) ? n : 0).toFixed(2);
};

const statusLabel = (s: string) => (s === 'shipped' ? 'Packaged' : (s || 'unknown').replace(/_/g, ' '));

export default function CustomerDetailsPage() {
    const params = useParams();
    const customerId = params.id as string;

    const [customer, setCustomer] = useState<any>(null);
    const [orders, setOrders] = useState<any[]>([]);
    const [totals, setTotals] = useState<Totals>({ paidOrders: 0, totalSpent: 0, lastOrderAt: null });
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({ full_name: '', phone: '', secondary_phone: '', notes: '' });

    useEffect(() => {
        if (customerId) {
            fetchCustomerData();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch when the id changes
    }, [customerId]);

    const fetchCustomerData = async () => {
        try {
            setLoading(true);
            setLoadError(null);
            const { data: { session } } = await supabase.auth.getSession();
            const res = await fetch(`/api/admin/customers/${encodeURIComponent(customerId)}`, {
                headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
            });
            const body = await res.json().catch(() => ({}));
            if (res.status === 404) {
                setCustomer(null);
                return;
            }
            if (!res.ok) throw new Error(body?.error || body?.message || `Request failed (${res.status})`);
            setCustomer(body.customer || null);
            setOrders(Array.isArray(body.orders) ? body.orders : []);
            setTotals({
                paidOrders: Number(body.totals?.paidOrders || 0),
                totalSpent: Number(body.totals?.totalSpent || 0),
                lastOrderAt: body.totals?.lastOrderAt || null,
            });
            if (body.customer) {
                setForm({
                    full_name: body.customer.full_name || '',
                    phone: body.customer.phone || '',
                    secondary_phone: body.customer.secondary_phone || '',
                    notes: body.customer.notes || '',
                });
            }
        } catch (err: any) {
            console.error('Error fetching customer:', err);
            setLoadError(err?.message || 'Could not load this customer.');
        } finally {
            setLoading(false);
        }
    };

    /** Save only the fields that changed. */
    const handleSave = async () => {
        if (!customer) return;
        const update: Record<string, string | null> = {};
        (['full_name', 'phone', 'secondary_phone', 'notes'] as const).forEach((key) => {
            const next = form[key].trim();
            if (next !== (customer[key] || '')) update[key] = next || null;
        });
        for (const key of ['phone', 'secondary_phone'] as const) {
            if (update[key]) {
                const normalised = normalizeGhanaPhone(update[key]);
                if (!normalised) {
                    alert(`${key === 'phone' ? 'Phone' : 'Second phone'} is not a valid Ghana mobile number.`);
                    return;
                }
                update[key] = normalised;
            }
        }
        if (Object.keys(update).length === 0) {
            setEditing(false);
            return;
        }
        try {
            setSaving(true);
            const { error } = await supabase
                .from('customers')
                .update({ ...update, updated_at: new Date().toISOString() })
                .eq('id', customer.id);
            if (error) throw error;
            setCustomer({ ...customer, ...update });
            setEditing(false);
        } catch (err: any) {
            alert('Failed to save customer: ' + (err?.message || 'unknown error'));
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="p-8 text-center text-gray-500">Loading customer details...</div>;
    if (loadError) return <div className="p-8 text-center text-red-500">{loadError}</div>;
    if (!customer) return <div className="p-8 text-center text-red-500">Customer not found</div>;

    const displayName = customer.full_name ||
        [customer.first_name, customer.last_name].filter(Boolean).join(' ') ||
        'No Name';
    const email = isPlaceholderEmail(customer.email) ? '' : (customer.email || '');
    const waPhone = normalizeGhanaPhone(customer.phone);
    const initial = (displayName !== 'No Name' ? displayName : email || '?').charAt(0).toUpperCase();

    return (
        <div className="max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center space-x-4">
                    <Link href="/admin/customers" aria-label="Back to customers" className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors">
                        <i className="ri-arrow-left-line text-xl" aria-hidden="true"></i>
                    </Link>
                    <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 text-2xl font-bold">
                        {initial}
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">{displayName}</h1>
                        <p className="text-gray-500">{email || (customer.user_id ? 'Registered customer' : 'Guest / till customer')}</p>
                    </div>
                </div>
                <div className="flex space-x-3">
                    {waPhone && (
                        <a
                            href={`https://wa.me/${waPhone.replace('+', '')}`}
                            target="_blank"
                            rel="noreferrer"
                            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 cursor-pointer"
                        >
                            <i className="ri-whatsapp-line mr-2" aria-hidden="true"></i>
                            WhatsApp
                        </a>
                    )}
                    <button
                        onClick={() => setEditing((v) => !v)}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 cursor-pointer"
                    >
                        {editing ? 'Close' : 'Edit Customer'}
                    </button>
                </div>
            </div>

            {editing && (
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 mb-8 grid md:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="cust-name" className="block text-sm font-semibold text-gray-700 mb-1">Full name</label>
                        <input id="cust-name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg" />
                    </div>
                    <div>
                        <label htmlFor="cust-phone" className="block text-sm font-semibold text-gray-700 mb-1">Phone</label>
                        <input id="cust-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg" placeholder="024 000 0000" />
                    </div>
                    <div>
                        <label htmlFor="cust-phone2" className="block text-sm font-semibold text-gray-700 mb-1">Second phone</label>
                        <input id="cust-phone2" value={form.secondary_phone} onChange={(e) => setForm({ ...form, secondary_phone: e.target.value })} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg" />
                    </div>
                    <div className="md:col-span-2">
                        <label htmlFor="cust-notes" className="block text-sm font-semibold text-gray-700 mb-1">Staff notes</label>
                        <textarea id="cust-notes" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg resize-none" />
                    </div>
                    <div className="md:col-span-2 flex justify-end">
                        <button onClick={handleSave} disabled={saving} className="px-6 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold disabled:opacity-50">
                            {saving ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </div>
            )}

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                    <p className="text-sm font-medium text-gray-500 mb-1">Total Spent</p>
                    <p className="text-2xl font-bold text-gray-900">GH₵{money(totals.totalSpent)}</p>
                    <p className="text-xs text-gray-500 mt-1">Paid orders, excluding cancelled and refunded</p>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                    <p className="text-sm font-medium text-gray-500 mb-1">Paid Orders</p>
                    <p className="text-2xl font-bold text-gray-900">{totals.paidOrders}</p>
                    <p className="text-xs text-gray-500 mt-1">{orders.length} order{orders.length === 1 ? '' : 's'} in all</p>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                    <p className="text-sm font-medium text-gray-500 mb-1">Last Paid Order</p>
                    <p className="text-xl font-bold text-gray-900">
                        {totals.lastOrderAt ? new Date(totals.lastOrderAt).toLocaleDateString('en-GB') : 'Never'}
                    </p>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                    <p className="text-sm font-medium text-gray-500 mb-1">Phone</p>
                    <p className="text-lg font-bold text-gray-900">{customer.phone || 'N/A'}</p>
                    {customer.secondary_phone && <p className="text-sm text-gray-600">{customer.secondary_phone}</p>}
                </div>
            </div>

            {customer.notes && !editing && (
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 mb-8">
                    <p className="text-sm font-medium text-gray-500 mb-1">Staff notes</p>
                    <p className="text-gray-800 whitespace-pre-line">{customer.notes}</p>
                </div>
            )}

            {/* Orders History */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                    <h2 className="text-lg font-bold text-gray-900">Order History</h2>
                    <p className="text-xs text-gray-500">Orders placed signed in, or with this customer&apos;s email or phone</p>
                </div>

                {orders.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">No orders found.</div>
                ) : (
                    <table className="w-full text-left">
                        <thead className="bg-gray-50 text-gray-600 text-xs uppercase font-semibold">
                            <tr>
                                <th className="px-6 py-4">Order</th>
                                <th className="px-6 py-4">Date</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4">Payment</th>
                                <th className="px-6 py-4">Total</th>
                                <th className="px-6 py-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {orders.map(order => (
                                <tr key={order.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 text-sm font-medium text-blue-600">
                                        <Link href={`/admin/orders/${order.id}`}>{order.order_number || `#${String(order.id).slice(0, 8)}`}</Link>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-600">
                                        {new Date(order.created_at).toLocaleDateString('en-GB')}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize
                                            ${order.status === 'delivered' ? 'bg-blue-100 text-blue-800' :
                                                order.status === 'pending' || order.status === 'awaiting_payment' ? 'bg-yellow-100 text-yellow-800' :
                                                    order.status === 'cancelled' || order.status === 'refunded' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'}`}>
                                            {statusLabel(order.status)}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize
                                            ${order.payment_status === 'paid' ? 'bg-green-100 text-green-800' :
                                                order.payment_status === 'failed' ? 'bg-red-100 text-red-800' :
                                                    order.payment_status === 'refunded' || order.payment_status === 'partially_refunded' ? 'bg-purple-100 text-purple-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                            {String(order.payment_status || 'pending').replace(/_/g, ' ')}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-sm font-bold text-gray-900">
                                        GH₵{money(order.total)}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <Link href={`/admin/orders/${order.id}`} aria-label={`View order ${order.order_number || order.id}`} className="text-gray-400 hover:text-blue-600">
                                            <i className="ri-eye-line text-lg" aria-hidden="true"></i>
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
