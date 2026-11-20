'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { adminFetch } from '@/components/admin/adminFetch';

const statusLabel = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function AdminReviewsPage() {
  // New reviews arrive as pending, so open on the queue that needs action.
  const [statusFilter, setStatusFilter] = useState('pending');
  const [sortBy, setSortBy] = useState('date');
  const [selectedReviews, setSelectedReviews] = useState<string[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchReviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const fetchReviews = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('reviews')
        .select('*, products:product_id (name, product_images (url, position))')
        .order('created_at', { ascending: false })
        .limit(1000);

      if (error) {
        setLoadError(`Could not load reviews: ${error.message}`);
        return;
      }
      const rows = data || [];

      // Staff cannot read other people's profiles through the data API:
      // reviewer names come from the staff route.
      const userIds = Array.from(new Set(rows.map((r: any) => r.user_id).filter(Boolean))) as string[];
      const profileById = new Map<string, any>();
      let namesFailed = false;
      for (let i = 0; i < userIds.length; i += 100) {
        const chunk = userIds.slice(i, i + 100);
        const res = await adminFetch<{ profiles: any[] }>(`/api/admin/customers/profiles?ids=${chunk.join(',')}`);
        if (!res.ok) { namesFailed = true; break; }
        (res.data.profiles || []).forEach((p: any) => profileById.set(p.id, p));
      }
      setLoadError(namesFailed ? 'Reviews loaded, but customer names could not be loaded.' : '');

      const formatted = rows.map((r: any) => {
        const profile = profileById.get(r.user_id);
        const images = [...(r.products?.product_images || [])].sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
        const status = String(r.status || 'pending').toLowerCase();
        return {
          id: r.id,
          customer: {
            name: profile?.full_name || (r.user_id ? 'Customer' : 'Anonymous'),
            email: profile?.email || '',
            avatar: getInitials(profile?.full_name || profile?.email || '')
          },
          product: {
            name: r.products?.name || 'Unknown product',
            image: images[0]?.url || ''
          },
          rating: r.rating,
          title: r.title,
          comment: r.content,
          date: new Date(r.created_at).toLocaleDateString('en-GB'),
          createdAt: r.created_at,
          status, // lowercase review_status enum value
          helpful: r.helpful_votes || 0,
          verified: !!r.verified_purchase,
        };
      });
      setReviews(formatted);
    } catch (error: any) {
      setLoadError(`Could not load reviews: ${error?.message || 'unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const getInitials = (name: string) => {
    if (!name) return '??';
    return name
      .replace(/[^a-zA-Z ]/g, '')
      .split(' ')
      .map(n => n?.[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '??';
  };

  const filteredReviews = reviews.filter(r =>
    statusFilter === 'all' || r.status === statusFilter
  ).sort((a, b) => {
    switch (sortBy) {
      case 'rating': return (b.rating || 0) - (a.rating || 0);
      case 'helpful': return (b.helpful || 0) - (a.helpful || 0);
      default: return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    }
  });

  const stats = {
    total: reviews.length,
    pending: reviews.filter(r => r.status === 'pending').length,
    approved: reviews.filter(r => r.status === 'approved').length,
    rejected: reviews.filter(r => r.status === 'rejected').length
  };

  const statusColors: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    approved: 'bg-blue-100 text-blue-700',
    rejected: 'bg-red-100 text-red-700'
  };

  const changeFilter = (f: string) => {
    setStatusFilter(f);
    setSelectedReviews([]);
  };

  // Only rows the current tab shows can be acted on.
  const visibleSelected = selectedReviews.filter(id => filteredReviews.some(r => r.id === id));

  const handleSelectAll = () => {
    if (visibleSelected.length === filteredReviews.length) {
      setSelectedReviews([]);
    } else {
      setSelectedReviews(filteredReviews.map(r => r.id));
    }
  };

  const handleSelectReview = (reviewId: string) => {
    if (selectedReviews.includes(reviewId)) {
      setSelectedReviews(selectedReviews.filter(id => id !== reviewId));
    } else {
      setSelectedReviews([...selectedReviews, reviewId]);
    }
  };

  const setStatus = async (ids: string[], newStatus: 'approved' | 'rejected') => {
    if (ids.length === 0 || busy) return;
    setBusy(true);
    try {
      // review_status enum values are lowercase.
      const { error } = await supabase
        .from('reviews')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .in('id', ids);
      if (error) throw error;
      setReviews(prev => prev.map(r => (ids.includes(r.id) ? { ...r, status: newStatus } : r)));
      setSelectedReviews(prev => prev.filter(id => !ids.includes(id)));
    } catch (err: any) {
      alert('Reviews not updated: ' + (err?.message || 'unknown error'));
    } finally {
      setBusy(false);
    }
  };

  const deleteReviews = async (ids: string[]) => {
    if (ids.length === 0 || busy) return;
    const ok = window.confirm(
      ids.length === 1
        ? 'Delete this review? It is removed for good and cannot be brought back.'
        : `Delete ${ids.length} reviews? They are removed for good and cannot be brought back.`
    );
    if (!ok) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('reviews').delete().in('id', ids);
      if (error) throw error;
      setReviews(prev => prev.filter(r => !ids.includes(r.id)));
      setSelectedReviews(prev => prev.filter(id => !ids.includes(id)));
    } catch (err: any) {
      alert('Reviews not deleted: ' + (err?.message || 'unknown error'));
    } finally {
      setBusy(false);
    }
  };

  const renderStars = (rating: number) => {
    return (
      <div className="flex items-center space-x-1" aria-label={`${rating} out of 5 stars`}>
        {[1, 2, 3, 4, 5].map((star) => (
          <i
            key={star}
            className={`${star <= rating ? 'ri-star-fill text-amber-500' : 'ri-star-line text-gray-300'} text-lg`}
          ></i>
        ))}
      </div>
    );
  };

  const tab = (key: string, value: number, label: string, active: string, valueColour: string) => (
    <button
      onClick={() => changeFilter(key)}
      className={`p-4 rounded-xl border-2 transition-all text-left ${statusFilter === key ? active : 'border-gray-200 bg-white'}`}
    >
      <p className={`text-2xl font-bold ${valueColour}`}>{value}</p>
      <p className="text-sm text-gray-600 mt-1">{label}</p>
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Reviews</h1>
          <p className="text-gray-600 mt-1">
            New customer reviews stay hidden on the shop until approved.
            {!loading && ` ${stats.pending} waiting for approval.`}
          </p>
        </div>
      </div>

      {loadError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg" role="alert">
          <i className="ri-error-warning-line text-red-600 mt-0.5"></i>
          <span>{loadError}</span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {tab('pending', stats.pending, 'Waiting for approval', 'border-amber-700 bg-amber-50', 'text-amber-700')}
        {tab('approved', stats.approved, 'Approved', 'border-blue-700 bg-blue-50', 'text-blue-700')}
        {tab('rejected', stats.rejected, 'Rejected', 'border-red-700 bg-red-50', 'text-red-700')}
        {tab('all', stats.total, 'All reviews', 'border-blue-700 bg-blue-50', 'text-gray-900')}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <div className="flex flex-wrap gap-3 items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900 capitalize">
              {statusFilter === 'all' ? 'All Reviews' : `${statusFilter} Reviews`}
            </h2>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              aria-label="Sort reviews"
              className="px-4 py-2 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium cursor-pointer"
            >
              <option value="date">Sort by Date</option>
              <option value="rating">Sort by Rating</option>
              <option value="helpful">Sort by Helpful votes</option>
            </select>
          </div>
        </div>

        {visibleSelected.length > 0 && (
          <div className="p-4 bg-blue-50 border-b border-blue-200 flex flex-wrap gap-2 items-center justify-between">
            <p className="text-blue-800 font-semibold">
              {visibleSelected.length} review{visibleSelected.length > 1 ? 's' : ''} selected
            </p>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setStatus(visibleSelected, 'approved')}
                disabled={busy}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                <i className="ri-check-line mr-2"></i>
                Approve
              </button>
              <button
                onClick={() => setStatus(visibleSelected, 'rejected')}
                disabled={busy}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                <i className="ri-close-line mr-2"></i>
                Reject
              </button>
              <button
                onClick={() => deleteReviews(visibleSelected)}
                disabled={busy}
                className="px-4 py-2 border border-red-300 text-red-700 hover:bg-red-50 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                <i className="ri-delete-bin-line mr-2"></i>
                Delete
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
                    checked={visibleSelected.length === filteredReviews.length && filteredReviews.length > 0}
                    onChange={handleSelectAll}
                    aria-label="Select all reviews shown"
                    className="w-4 h-4 text-blue-700 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                  />
                </th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 w-1/4">Product</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 w-1/4">Customer</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 w-1/3">Review</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Date</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Status</th>
                <th className="text-right py-4 px-4 text-sm font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="p-8 text-center text-gray-500">Loading reviews...</td></tr>
              ) : filteredReviews.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-gray-500">No reviews here.</td></tr>
              ) : (
                filteredReviews.map((review) => (
                  <tr key={review.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-6">
                      <input
                        type="checkbox"
                        checked={selectedReviews.includes(review.id)}
                        onChange={() => handleSelectReview(review.id)}
                        aria-label={`Select review of ${review.product.name}`}
                        className="w-4 h-4 text-blue-700 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                      />
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-3">
                        {review.product.image ? (
                          <img
                            src={review.product.image}
                            alt={review.product.name}
                            className="w-12 h-12 rounded-lg object-cover border border-gray-100"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-gray-100 border border-gray-100 flex items-center justify-center text-gray-400">
                            <i className="ri-image-line"></i>
                          </div>
                        )}
                        <span className="text-sm font-medium text-gray-900 line-clamp-2">{review.product.name}</span>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 flex items-center justify-center bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                          {review.customer.avatar}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{review.customer.name}</p>
                          {review.customer.email && <p className="text-xs text-gray-500">{review.customer.email}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="space-y-1">
                        {renderStars(review.rating)}
                        <p className="text-sm font-bold text-gray-900">{review.title}</p>
                        <p className="text-sm text-gray-600 line-clamp-2">{review.comment}</p>
                        {(review.verified || review.helpful > 0) && (
                          <p className="text-xs text-gray-500">
                            {review.verified && <span className="mr-3"><i className="ri-shield-check-line mr-1"></i>Verified purchase</span>}
                            {review.helpful > 0 && <span>{review.helpful} found this helpful</span>}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-4 text-sm text-gray-600 whitespace-nowrap">{review.date}</td>
                    <td className="py-4 px-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${statusColors[review.status] || 'bg-gray-100 text-gray-700'}`}>
                        {statusLabel(review.status)}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center justify-end gap-1">
                        {review.status !== 'approved' && (
                          <button
                            onClick={() => setStatus([review.id], 'approved')}
                            disabled={busy}
                            aria-label="Approve review"
                            title="Approve"
                            className="w-8 h-8 flex items-center justify-center text-blue-700 hover:bg-blue-50 rounded-lg disabled:opacity-50 cursor-pointer"
                          >
                            <i className="ri-check-line text-lg"></i>
                          </button>
                        )}
                        {review.status !== 'rejected' && (
                          <button
                            onClick={() => setStatus([review.id], 'rejected')}
                            disabled={busy}
                            aria-label="Reject review"
                            title="Reject"
                            className="w-8 h-8 flex items-center justify-center text-amber-700 hover:bg-amber-50 rounded-lg disabled:opacity-50 cursor-pointer"
                          >
                            <i className="ri-close-line text-lg"></i>
                          </button>
                        )}
                        <button
                          onClick={() => deleteReviews([review.id])}
                          disabled={busy}
                          aria-label="Delete review"
                          title="Delete"
                          className="w-8 h-8 flex items-center justify-center text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50 cursor-pointer"
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

        <div className="p-6 border-t border-gray-200">
          <p className="text-gray-600 text-sm">Showing {filteredReviews.length} of {reviews.length} reviews</p>
        </div>
      </div>
    </div>
  );
}
