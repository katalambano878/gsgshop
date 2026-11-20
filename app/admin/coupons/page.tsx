'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

/** coupons.type (discount_type enum: percentage | fixed_amount | free_shipping) -> label. */
const TYPE_LABELS: Record<string, string> = {
  percentage: 'Percentage',
  fixed_amount: 'Fixed Amount',
  free_shipping: 'Free Delivery',
};

type CouponStatus = 'Active' | 'Scheduled' | 'Expired' | 'Used up' | 'Disabled';

interface Coupon {
  id: string;
  code: string;
  description: string;
  type: string; // raw enum value
  value: number;
  minPurchase: number;
  maxDiscount: number | null;
  usageLimit: number | null;
  perUserLimit: number | null;
  usedCount: number;
  createdAt: string;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  status: CouponStatus;
}

interface CouponForm {
  code: string;
  description: string;
  type: string;
  value: string;
  minimum_purchase: string;
  maximum_discount: string;
  usage_limit: string;
  per_user_limit: string;
  start_date: string; // yyyy-mm-dd
  end_date: string; // yyyy-mm-dd
  is_active: boolean;
}

const EMPTY_FORM: CouponForm = {
  code: '',
  description: '',
  type: 'percentage',
  value: '',
  minimum_purchase: '',
  maximum_discount: '',
  usage_limit: '',
  per_user_limit: '1',
  start_date: '',
  end_date: '',
  is_active: true,
};

function couponStatus(c: any): CouponStatus {
  const now = new Date();
  if (c.is_active === false) return 'Disabled';
  if (c.end_date && new Date(c.end_date) < now) return 'Expired';
  if (c.usage_limit && (c.usage_count || 0) >= c.usage_limit) return 'Used up';
  if (c.start_date && new Date(c.start_date) > now) return 'Scheduled';
  return 'Active';
}

const toNumberOrNull = (s: string): number | null => {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const formatGhs = (n: number) => `GH₵ ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AdminCouponsPage() {
  const [showModal, setShowModal] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | CouponStatus>('all');
  const [sortBy, setSortBy] = useState<'date' | 'usage' | 'value'>('date');
  const [form, setForm] = useState<CouponForm>(EMPTY_FORM);

  useEffect(() => {
    fetchCoupons();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  const fetchCoupons = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('coupons')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        setLoadError(`Could not load coupons: ${error.message}`);
        return;
      }
      setLoadError('');
      setCoupons((data || []).map((c: any) => ({
        id: c.id,
        code: c.code,
        description: c.description || '',
        type: c.type,
        value: Number(c.value) || 0,
        minPurchase: Number(c.minimum_purchase) || 0,
        maxDiscount: c.maximum_discount != null ? Number(c.maximum_discount) : null,
        usageLimit: c.usage_limit || null,
        perUserLimit: c.per_user_limit ?? null,
        usedCount: c.usage_count || 0,
        createdAt: c.created_at,
        startDate: c.start_date,
        endDate: c.end_date,
        isActive: c.is_active !== false,
        status: couponStatus(c),
      })));
    } catch (err: any) {
      setLoadError(`Could not load coupons: ${err?.message || 'unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const statusColors: Record<CouponStatus, string> = {
    'Active': 'bg-green-100 text-green-800',
    'Scheduled': 'bg-blue-100 text-blue-700',
    'Expired': 'bg-gray-100 text-gray-700',
    'Used up': 'bg-amber-100 text-amber-800',
    'Disabled': 'bg-red-100 text-red-700',
  };

  const openCreate = () => {
    setEditingCoupon(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setShowModal(true);
  };

  const openEdit = (coupon: Coupon) => {
    setEditingCoupon(coupon);
    setForm({
      code: coupon.code,
      description: coupon.description,
      type: coupon.type,
      value: coupon.type === 'free_shipping' ? '' : String(coupon.value),
      minimum_purchase: coupon.minPurchase ? String(coupon.minPurchase) : '',
      maximum_discount: coupon.maxDiscount != null ? String(coupon.maxDiscount) : '',
      usage_limit: coupon.usageLimit ? String(coupon.usageLimit) : '',
      per_user_limit: coupon.perUserLimit != null ? String(coupon.perUserLimit) : '',
      start_date: coupon.startDate ? String(coupon.startDate).slice(0, 10) : '',
      end_date: coupon.endDate ? String(coupon.endDate).slice(0, 10) : '',
      is_active: coupon.isActive,
    });
    setFormError('');
    setShowModal(true);
  };

  const closeModal = () => {
    if (saving) return;
    setShowModal(false);
    setEditingCoupon(null);
  };

  const handleSave = async () => {
    setFormError('');
    const code = form.code.trim().toUpperCase();
    if (!code) return setFormError('Enter a coupon code.');
    if (!/^[A-Z0-9_-]+$/.test(code)) return setFormError('Use only letters, numbers, dashes and underscores in the code.');

    const freeShipping = form.type === 'free_shipping';
    const value = freeShipping ? 0 : toNumberOrNull(form.value);
    if (!freeShipping && (value == null || value <= 0)) return setFormError('Enter a discount value above 0.');
    if (form.type === 'percentage' && (value as number) > 100) return setFormError('A percentage discount cannot be more than 100%.');

    const minimum = toNumberOrNull(form.minimum_purchase) ?? 0;
    const maxDiscount = toNumberOrNull(form.maximum_discount);
    const usageLimit = toNumberOrNull(form.usage_limit);
    const perUser = toNumberOrNull(form.per_user_limit);
    if (minimum < 0 || (maxDiscount != null && maxDiscount < 0)) return setFormError('Amounts cannot be negative.');
    if ((usageLimit != null && (usageLimit < 0 || !Number.isInteger(usageLimit))) || (perUser != null && (perUser < 0 || !Number.isInteger(perUser)))) {
      return setFormError('Limits must be whole numbers.');
    }
    if (form.start_date && form.end_date && form.end_date < form.start_date) {
      return setFormError('The last valid day is before the start day.');
    }

    if (coupons.some(c => c.code === code && c.id !== editingCoupon?.id)) {
      return setFormError(`A coupon with the code ${code} already exists.`);
    }

    const payload = {
      code,
      description: form.description.trim() || null,
      type: form.type,
      value,
      minimum_purchase: minimum,
      // A cap only makes sense for percentage discounts.
      maximum_discount: form.type === 'percentage' ? maxDiscount : null,
      usage_limit: usageLimit || null,
      per_user_limit: perUser || null,
      // Date inputs give yyyy-mm-dd. Ghana is UTC+0 all year: the start is the
      // beginning of that day and the code stays valid to the END of the last day.
      start_date: form.start_date ? `${form.start_date}T00:00:00Z` : (editingCoupon ? null : new Date().toISOString()),
      end_date: form.end_date ? `${form.end_date}T23:59:59Z` : null,
      is_active: form.is_active,
      updated_at: new Date().toISOString(),
    };

    setSaving(true);
    try {
      const { error } = editingCoupon
        ? await supabase.from('coupons').update(payload).eq('id', editingCoupon.id)
        : await supabase.from('coupons').insert([payload]);
      if (error) {
        setFormError(`Coupon not saved: ${error.message}`);
        return;
      }
      setShowModal(false);
      setEditingCoupon(null);
      setNotice(editingCoupon ? `Saved ${code}.` : `Created ${code}.`);
      fetchCoupons();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (coupon: Coupon) => {
    const used = coupon.usedCount ? ` It has been used ${coupon.usedCount} time${coupon.usedCount === 1 ? '' : 's'}; past orders keep their discount.` : '';
    if (!confirm(`Delete coupon ${coupon.code}? Customers will no longer be able to use it.${used} This cannot be undone. To pause it instead, edit it and untick Active.`)) return;
    const { error } = await supabase.from('coupons').delete().eq('id', coupon.id);
    if (error) {
      alert(`Coupon not deleted: ${error.message}`);
      return;
    }
    setCoupons(prev => prev.filter(c => c.id !== coupon.id));
    setNotice(`Deleted ${coupon.code}.`);
  };

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setNotice(`Copied ${code}.`);
    } catch {
      setNotice('Could not copy. Select the code and copy it by hand.');
    }
  };

  const activeCount = coupons.filter(c => c.status === 'Active').length;
  const disabledCount = coupons.filter(c => c.status === 'Disabled').length;
  const totalUses = coupons.reduce((sum, c) => sum + c.usedCount, 0);
  const visibleCoupons = coupons
    .filter(c => statusFilter === 'all' || c.status === statusFilter)
    .sort((a, b) => {
      if (sortBy === 'usage') return b.usedCount - a.usedCount;
      if (sortBy === 'value') return b.value - a.value;
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });

  const valueLabel = (c: Coupon) => {
    if (c.type === 'percentage') return `${c.value}%${c.maxDiscount ? ` (max ${formatGhs(c.maxDiscount)})` : ''}`;
    if (c.type === 'fixed_amount') return formatGhs(c.value);
    return 'Free delivery';
  };

  const inputClass = 'w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Coupons & Promotions</h1>
          <p className="text-gray-600 mt-1">Create and manage discount codes. Codes are checked again at checkout.</p>
        </div>
        <button
          onClick={openCreate}
          className="bg-blue-700 hover:bg-blue-800 text-white px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer"
        >
          <i className="ri-add-line mr-2"></i>
          Create Coupon
        </button>
      </div>

      {loadError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg" role="alert">
          <i className="ri-error-warning-line text-red-600 mt-0.5"></i>
          <span>{loadError}</span>
        </div>
      )}

      {notice && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white px-4 py-3 rounded-lg shadow-lg text-sm" role="status">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Total Coupons</p>
          <p className="text-2xl font-bold text-gray-900">{coupons.length}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Active now</p>
          <p className="text-2xl font-bold text-blue-700">{activeCount}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Total Uses</p>
          <p className="text-2xl font-bold text-gray-900">{totalUses}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Disabled</p>
          <p className="text-2xl font-bold text-gray-700">{disabledCount}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-gray-900">All Coupons</h2>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                aria-label="Filter by status"
                className="px-4 py-2 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium cursor-pointer"
              >
                <option value="all">All Status</option>
                <option value="Active">Active</option>
                <option value="Scheduled">Scheduled</option>
                <option value="Expired">Expired</option>
                <option value="Used up">Used up</option>
                <option value="Disabled">Disabled</option>
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                aria-label="Sort coupons"
                className="px-4 py-2 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium cursor-pointer"
              >
                <option value="date">Sort by Date</option>
                <option value="usage">Sort by Usage</option>
                <option value="value">Sort by Value</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left py-4 px-6 text-sm font-semibold text-gray-700">Code</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Type</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Value</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Min Purchase</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Used / Limit</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Valid Period</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Status</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="p-8 text-center text-gray-500">Loading coupons...</td></tr>
              ) : visibleCoupons.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-gray-500">{coupons.length === 0 ? 'No coupons yet.' : 'No coupons match this filter.'}</td></tr>
              ) : (
                visibleCoupons.map((coupon) => (
                  <tr key={coupon.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-6">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono font-bold text-gray-900 bg-gray-100 px-3 py-1 rounded">{coupon.code}</span>
                        <button
                          onClick={() => handleCopyCode(coupon.code)}
                          className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-900 hover:bg-gray-50 rounded transition-colors cursor-pointer"
                          title="Copy code"
                          aria-label={`Copy ${coupon.code}`}
                        >
                          <i className="ri-file-copy-line"></i>
                        </button>
                      </div>
                      {coupon.description && <p className="text-xs text-gray-500 mt-1 max-w-[16rem] truncate">{coupon.description}</p>}
                    </td>
                    <td className="py-4 px-4 text-gray-700">{TYPE_LABELS[coupon.type] || coupon.type}</td>
                    <td className="py-4 px-4 font-semibold text-gray-900 whitespace-nowrap">{valueLabel(coupon)}</td>
                    <td className="py-4 px-4 text-gray-700 whitespace-nowrap">
                      {coupon.minPurchase > 0 ? formatGhs(coupon.minPurchase) : 'No minimum'}
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-2">
                        <span className="text-gray-900 font-semibold">{coupon.usedCount}</span>
                        <span className="text-gray-500">/</span>
                        <span className="text-gray-600">{coupon.usageLimit || 'no limit'}</span>
                      </div>
                      {coupon.usageLimit && (
                        <div className="w-24 h-2 bg-gray-200 rounded-full mt-2">
                          <div
                            className="h-full bg-blue-600 rounded-full"
                            style={{ width: `${Math.min((coupon.usedCount / coupon.usageLimit) * 100, 100)}%` }}
                          ></div>
                        </div>
                      )}
                      {coupon.perUserLimit ? <p className="text-xs text-gray-500 mt-1">{coupon.perUserLimit} per customer</p> : null}
                    </td>
                    <td className="py-4 px-4">
                      <p className="text-sm text-gray-700 whitespace-nowrap">{coupon.startDate ? new Date(coupon.startDate).toLocaleDateString('en-GB') : 'Any time'}</p>
                      <p className="text-sm text-gray-500 whitespace-nowrap">{coupon.endDate ? `to ${new Date(coupon.endDate).toLocaleDateString('en-GB')}` : 'No expiry'}</p>
                    </td>
                    <td className="py-4 px-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${statusColors[coupon.status]}`}>
                        {coupon.status}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => openEdit(coupon)}
                          title="Edit coupon"
                          aria-label={`Edit ${coupon.code}`}
                          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                        >
                          <i className="ri-edit-line text-lg"></i>
                        </button>
                        <button
                          onClick={() => handleDelete(coupon)}
                          title="Delete coupon"
                          aria-label={`Delete ${coupon.code}`}
                          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <i className="ri-delete-bin-line text-lg"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={closeModal}>
          <div className="bg-white p-6 rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="coupon-modal-title">
            <h2 id="coupon-modal-title" className="text-xl font-bold text-gray-900 mb-6">
              {editingCoupon ? `Edit ${editingCoupon.code}` : 'Create New Coupon'}
            </h2>
            <div className="space-y-4">
              <div>
                <label htmlFor="c-code" className="block text-sm font-semibold text-gray-700 mb-1">Coupon Code *</label>
                <input
                  id="c-code"
                  type="text"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="e.g. SAVE20"
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label htmlFor="c-desc" className="block text-sm font-semibold text-gray-700 mb-1">Description (staff only)</label>
                <input
                  id="c-desc"
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="e.g. Christmas promo"
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="c-type" className="block text-sm font-semibold text-gray-700 mb-1">Discount Type</label>
                  <select
                    id="c-type"
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className={`${inputClass} cursor-pointer`}
                  >
                    <option value="percentage">Percentage (%)</option>
                    <option value="fixed_amount">Fixed Amount (GH₵)</option>
                    <option value="free_shipping">Free Delivery</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="c-value" className="block text-sm font-semibold text-gray-700 mb-1">
                    {form.type === 'percentage' ? 'Percentage (%)' : form.type === 'fixed_amount' ? 'Amount (GH₵)' : 'Value'}
                  </label>
                  <input
                    id="c-value"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={form.value}
                    onChange={(e) => setForm({ ...form, value: e.target.value })}
                    className={`${inputClass} disabled:bg-gray-100`}
                    disabled={form.type === 'free_shipping'}
                    placeholder={form.type === 'free_shipping' ? 'Not needed' : ''}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="c-min" className="block text-sm font-semibold text-gray-700 mb-1">Minimum purchase (GH₵)</label>
                  <input
                    id="c-min"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={form.minimum_purchase}
                    onChange={(e) => setForm({ ...form, minimum_purchase: e.target.value })}
                    placeholder="Blank = no minimum"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="c-max" className="block text-sm font-semibold text-gray-700 mb-1">Maximum discount (GH₵)</label>
                  <input
                    id="c-max"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={form.type === 'percentage' ? form.maximum_discount : ''}
                    onChange={(e) => setForm({ ...form, maximum_discount: e.target.value })}
                    placeholder={form.type === 'percentage' ? 'Blank = no cap' : 'Percentage only'}
                    disabled={form.type !== 'percentage'}
                    className={`${inputClass} disabled:bg-gray-100`}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="c-limit" className="block text-sm font-semibold text-gray-700 mb-1">Total uses allowed</label>
                  <input
                    id="c-limit"
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={form.usage_limit}
                    onChange={(e) => setForm({ ...form, usage_limit: e.target.value })}
                    placeholder="Blank = no limit"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="c-peruser" className="block text-sm font-semibold text-gray-700 mb-1">Uses per customer</label>
                  <input
                    id="c-peruser"
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={form.per_user_limit}
                    onChange={(e) => setForm({ ...form, per_user_limit: e.target.value })}
                    placeholder="Blank = no limit"
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="c-start" className="block text-sm font-semibold text-gray-700 mb-1">First day valid</label>
                  <input
                    id="c-start"
                    type="date"
                    value={form.start_date}
                    onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="c-end" className="block text-sm font-semibold text-gray-700 mb-1">Last day valid</label>
                  <input
                    id="c-end"
                    type="date"
                    value={form.end_date}
                    onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500 -mt-2">Both optional. The code works until 23:59 Ghana time on the last day.</p>
              {editingCoupon && (
                <p className="text-sm text-gray-600">
                  Used {editingCoupon.usedCount} time{editingCoupon.usedCount === 1 ? '' : 's'}
                  {editingCoupon.usageLimit ? ` of ${editingCoupon.usageLimit}` : ' (no limit)'}.
                </p>
              )}
              <label className="flex items-center space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="w-5 h-5 text-blue-700 rounded"
                />
                <span className="text-sm font-medium text-gray-700">Active (customers can use it)</span>
              </label>
              {formError && (
                <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert">{formError}</p>
              )}
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={closeModal}
                disabled={saving}
                className="flex-1 border-2 border-gray-300 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-blue-700 hover:bg-blue-800 text-white py-3 rounded-lg font-semibold transition-colors cursor-pointer disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingCoupon ? 'Save Changes' : 'Create Coupon'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
