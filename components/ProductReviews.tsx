'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { cachedQuery, invalidateCache } from '@/lib/query-cache';
import { useRecaptcha } from '@/hooks/useRecaptcha';

interface Review {
  id: string;
  rating: number;
  date: string;
  verified: boolean;
  title: string;
  content: string;
  user_id: string;
  status: string;
}

interface ProductReviewsProps {
  productId: string;
}

const REVIEW_COLUMNS = 'id, user_id, rating, title, content, status, verified_purchase, created_at';

function toReview(r: any): Review {
  return {
    id: r.id,
    rating: Number(r.rating) || 0,
    date: r.created_at,
    verified: r.verified_purchase === true,
    title: r.title || '',
    content: r.content || '',
    user_id: r.user_id,
    status: String(r.status || ''),
  };
}

export default function ProductReviews({ productId }: ProductReviewsProps) {
  const [filter, setFilter] = useState('all');
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [ownReview, setOwnReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const [reviewForm, setReviewForm] = useState({
    rating: 5,
    title: '',
    content: '',
  });
  const { getToken } = useRecaptcha();

  const fetchReviews = useCallback(async () => {
    setLoadError(false);
    try {
      // Approved reviews are public (cached for 5 minutes; failures are never cached).
      const { data, error } = await cachedQuery<{ data: any; error: any }>(
        `reviews:${productId}`,
        (() =>
          supabase
            .from('reviews')
            .select(REVIEW_COLUMNS)
            .eq('product_id', productId)
            .eq('status', 'approved')
            .order('created_at', { ascending: false })) as any,
        5 * 60 * 1000
      );
      if (error) throw error;
      setReviews((data || []).map(toReview));

      // A signed-in customer also sees their own review while it awaits approval.
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      setUser(session?.user || null);
      if (uid) {
        const { data: mine } = await supabase
          .from('reviews')
          .select(REVIEW_COLUMNS)
          .eq('product_id', productId)
          .eq('user_id', uid)
          .order('created_at', { ascending: false })
          .limit(1);
        setOwnReview(mine && mine[0] ? toReview(mine[0]) : null);
      } else {
        setOwnReview(null);
      }
    } catch (err) {
      console.error('Error fetching reviews:', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    setLoading(true);
    fetchReviews();
  }, [fetchReviews]);

  const averageRating = reviews.length > 0 ? reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length : 0;

  const ratingDistribution = [5, 4, 3, 2, 1].map((star) => {
    const count = reviews.filter((r) => r.rating === star).length;
    return {
      star,
      count,
      percentage: reviews.length > 0 ? (count / reviews.length) * 100 : 0,
    };
  });

  const filteredReviews = filter === 'all' ? reviews : reviews.filter((r) => r.rating === parseInt(filter));
  const ownPending = ownReview && ownReview.status !== 'approved' ? ownReview : null;
  const canWrite = !ownReview && !submitted;

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!user) {
      setFormError('Please sign in to write a review.');
      return;
    }
    if (!reviewForm.title.trim() || !reviewForm.content.trim()) {
      setFormError('Please add a title and a few words about the product.');
      return;
    }

    const isHuman = await getToken('review');
    if (!isHuman) {
      setFormError('Security check failed. Please try again.');
      return;
    }

    setIsSubmitting(true);
    try {
      // No status, verified flag or vote count is sent: the database sets the
      // review to pending and works out "verified purchase" from orders.
      const { error } = await supabase.from('reviews').insert([
        {
          product_id: productId,
          user_id: user.id,
          rating: reviewForm.rating,
          title: reviewForm.title.trim().slice(0, 120),
          content: reviewForm.content.trim().slice(0, 2000),
        },
      ]);
      if (error) throw error;

      setSubmitted(true);
      setShowReviewForm(false);
      setReviewForm({ rating: 5, title: '', content: '' });
      invalidateCache(`reviews:${productId}`);
      fetchReviews();
    } catch (err: any) {
      console.error('Submit review error:', err);
      setFormError('We could not save your review. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="py-8 text-center text-gray-500" role="status">
        Loading reviews...
      </div>
    );
  }

  const writeButton = canWrite ? (
    user ? (
      <button
        type="button"
        onClick={() => setShowReviewForm(true)}
        className="bg-blue-700 hover:bg-blue-800 text-white px-6 py-2 rounded-lg font-semibold transition-colors whitespace-nowrap"
      >
        Write a Review
      </button>
    ) : (
      <Link
        href="/auth/login"
        className="bg-blue-700 hover:bg-blue-800 text-white px-6 py-2 rounded-lg font-semibold transition-colors whitespace-nowrap inline-block"
      >
        Sign in to write a review
      </Link>
    )
  ) : null;

  return (
    <div className="bg-white rounded-xl shadow-sm p-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Customer Reviews</h2>

      {loadError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
          We couldn&apos;t load reviews.{' '}
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              fetchReviews();
            }}
            className="font-semibold underline"
          >
            Retry
          </button>
        </div>
      )}

      {(submitted || ownPending) && (
        <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900" role="status">
          Thank you. Your review has been received and will appear here after the shop approves it.
        </div>
      )}

      {reviews.length === 0 && !showReviewForm ? (
        <div className="text-center py-8 mb-8 border-b border-gray-200">
          <p className="text-gray-500 mb-4">No reviews yet.</p>
          {writeButton}
        </div>
      ) : reviews.length > 0 ? (
        <>
          <div className="grid md:grid-cols-3 gap-8 mb-8 pb-8 border-b border-gray-200">
            <div className="text-center">
              <div className="text-5xl font-bold text-gray-900 mb-2">{averageRating.toFixed(1)}</div>
              <div className="flex items-center justify-center mb-2" aria-hidden="true">
                {[1, 2, 3, 4, 5].map((star) => (
                  <i
                    key={star}
                    className={`ri-star-${star <= Math.round(averageRating) ? 'fill' : 'line'} text-xl ${
                      star <= Math.round(averageRating) ? 'text-yellow-400' : 'text-gray-300'
                    }`}
                  ></i>
                ))}
              </div>
              <p className="text-gray-600">
                Based on {reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}
              </p>
            </div>

            <div className="md:col-span-2">
              <div className="space-y-2">
                {ratingDistribution.map((dist) => (
                  <div key={dist.star} className="flex items-center space-x-3">
                    <button
                      type="button"
                      onClick={() => setFilter(dist.star.toString())}
                      aria-pressed={filter === dist.star.toString()}
                      aria-label={`Show ${dist.star}-star reviews (${dist.count})`}
                      className="flex items-center space-x-1 hover:text-blue-700 transition-colors"
                    >
                      <span className="text-sm font-medium w-6">{dist.star}</span>
                      <i className="ri-star-fill text-yellow-400 text-sm" aria-hidden="true"></i>
                    </button>
                    <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden" aria-hidden="true">
                      <div
                        className="h-full bg-yellow-400 transition-all duration-300"
                        style={{ width: `${dist.percentage}%` }}
                      ></div>
                    </div>
                    <span className="text-sm text-gray-600 w-8">{dist.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => setFilter('all')}
              aria-pressed={filter === 'all'}
              className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
                filter === 'all' ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              All Reviews ({reviews.length})
            </button>

            {!showReviewForm && writeButton}
          </div>
        </>
      ) : null}

      {showReviewForm && (
        <form onSubmit={handleSubmitReview} className="bg-gray-50 rounded-xl p-6 mb-8" noValidate>
          <h3 className="text-lg font-bold text-gray-900 mb-1">Write Your Review</h3>
          <p className="text-sm text-gray-600 mb-4">Reviews appear on the page after the shop approves them.</p>

          <fieldset className="mb-4">
            <legend className="block text-sm font-semibold text-gray-900 mb-2">Your Rating *</legend>
            <div className="flex space-x-2" role="radiogroup" aria-label="Your rating">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  role="radio"
                  aria-checked={reviewForm.rating === star}
                  aria-label={`${star} ${star === 1 ? 'star' : 'stars'}`}
                  onClick={() => setReviewForm({ ...reviewForm, rating: star })}
                  className="w-10 h-10 flex items-center justify-center rounded focus-visible:ring-2 focus-visible:ring-blue-600 outline-none"
                >
                  <i
                    aria-hidden="true"
                    className={`ri-star-${star <= reviewForm.rating ? 'fill' : 'line'} text-3xl ${
                      star <= reviewForm.rating ? 'text-yellow-400' : 'text-gray-300'
                    }`}
                  ></i>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="mb-4">
            <label htmlFor="review-title" className="block text-sm font-semibold text-gray-900 mb-2">
              Review Title *
            </label>
            <input
              id="review-title"
              type="text"
              value={reviewForm.title}
              onChange={(e) => setReviewForm({ ...reviewForm, title: e.target.value })}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Sum up your experience"
              maxLength={120}
              required
            />
          </div>

          <div className="mb-4">
            <label htmlFor="review-content" className="block text-sm font-semibold text-gray-900 mb-2">
              Your Review *
            </label>
            <textarea
              id="review-content"
              value={reviewForm.content}
              onChange={(e) => setReviewForm({ ...reviewForm, content: e.target.value })}
              rows={4}
              maxLength={2000}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Share your experience with this product"
              required
            ></textarea>
          </div>

          {formError && (
            <p className="mb-4 text-sm text-red-600" role="alert">
              {formError}
            </p>
          )}

          <div className="flex space-x-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className="bg-blue-700 hover:bg-blue-800 text-white px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap disabled:opacity-50"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Review'}
            </button>
            <button
              type="button"
              onClick={() => setShowReviewForm(false)}
              className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="space-y-6">
        {filteredReviews.map((review) => {
          const author = review.verified ? 'Verified buyer' : 'Customer';
          return (
            <article key={review.id} className="pb-6 border-b border-gray-200 last:border-0">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <div
                    className="w-12 h-12 flex items-center justify-center bg-blue-100 rounded-full text-blue-700 font-bold text-lg"
                    aria-hidden="true"
                  >
                    <i className="ri-user-3-line"></i>
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-gray-900">
                        {user && review.user_id === user.id ? 'You' : author}
                      </span>
                      {review.verified && (
                        <span className="flex items-center text-xs text-blue-700 bg-blue-50 px-2 py-1 rounded">
                          <i className="ri-checkbox-circle-fill mr-1" aria-hidden="true"></i>
                          Verified Purchase
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600">
                      {new Date(review.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-1" role="img" aria-label={`${review.rating} out of 5 stars`}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <i
                      key={star}
                      aria-hidden="true"
                      className={`ri-star-${star <= review.rating ? 'fill' : 'line'} text-lg ${
                        star <= review.rating ? 'text-yellow-400' : 'text-gray-300'
                      }`}
                    ></i>
                  ))}
                </div>
              </div>

              {review.title && <h4 className="font-semibold text-gray-900 mb-2">{review.title}</h4>}
              <p className="text-gray-700 whitespace-pre-line">{review.content}</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}
