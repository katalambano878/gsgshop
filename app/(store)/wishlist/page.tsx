'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useCart } from '@/context/CartContext';
import PageHero from '@/components/PageHero';
import { useWishlist } from '@/context/WishlistContext';
import ProductCard from '@/components/ProductCard';
import { usePageTitle } from '@/hooks/usePageTitle';

export default function WishlistPage() {
  usePageTitle('Wishlist');
  const { wishlist: wishlistItems, removeFromWishlist, ready, synced, refreshWishlist } = useWishlist();
  const { addToCart } = useCart();
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [pendingAddAll, setPendingAddAll] = useState(false);

  // Show today's prices and stock, not what was saved.
  useEffect(() => {
    if (!ready) return;
    refreshWishlist().then((ok) => setRefreshFailed(!ok));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, synced]);

  const addAllToCart = async () => {
    setAdding(true);
    setNotice(null);
    const ok = await refreshWishlist();
    setAdding(false);
    if (!ok) {
      setNotice('We could not check the latest prices. Please try again in a moment.');
      return;
    }
    // The fresh list lands on the next render; the effect below adds it.
    setPendingAddAll(true);
  };

  useEffect(() => {
    if (!pendingAddAll) return;
    setPendingAddAll(false);
    const added: string[] = [];
    const needsOptions: string[] = [];
    const unavailable: string[] = [];
    for (const item of wishlistItems) {
      const moq = item.moq || 1;
      if (item.hasVariants) {
        needsOptions.push(item.name);
      } else if (!item.inStock || (item.maxStock ?? 0) < moq) {
        unavailable.push(item.name);
      } else {
        addToCart({
          id: item.id,
          name: item.name,
          price: item.price,
          image: item.image,
          quantity: moq,
          slug: item.slug || item.id,
          maxStock: item.maxStock ?? 0,
          moq,
        });
        added.push(item.name);
      }
    }
    const parts: string[] = [];
    if (added.length > 0) parts.push(`Added ${added.length} ${added.length === 1 ? 'item' : 'items'} to your cart.`);
    if (needsOptions.length > 0) parts.push(`Choose options on the product page for: ${needsOptions.join(', ')}.`);
    if (unavailable.length > 0) parts.push(`Out of stock: ${unavailable.join(', ')}.`);
    setNotice(parts.join(' ') || 'Nothing to add.');
  }, [pendingAddAll, wishlistItems, addToCart]);

  return (
    <main className="min-h-screen bg-gray-50">
      <PageHero title="My Wishlist" />

      <section className="py-8 bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <nav className="flex items-center space-x-2 text-sm mb-2" aria-label="Breadcrumb">
                <Link href="/" className="text-gray-600 hover:text-blue-700 transition-colors">Home</Link>
                <i className="ri-arrow-right-s-line text-gray-400" aria-hidden="true"></i>
                <span className="text-gray-900 font-medium">Wishlist</span>
              </nav>
              <p className="text-gray-600">
                {wishlistItems.length} {wishlistItems.length === 1 ? 'item' : 'items'} saved
                {synced ? ' to your account' : ' on this device'}
              </p>
              {!synced && wishlistItems.length > 0 && (
                <p className="text-sm text-gray-500 mt-1">
                  <Link href="/auth/login?redirect=/wishlist" className="text-blue-700 underline">Sign in</Link> to keep your wishlist on any device.
                </p>
              )}
            </div>
            {wishlistItems.length > 0 && (
              <button
                type="button"
                onClick={addAllToCart}
                disabled={adding}
                className="bg-gray-900 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap disabled:opacity-60"
              >
                {adding ? 'Checking prices…' : 'Add All to Cart'}
              </button>
            )}
          </div>
          {notice && (
            <p className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700" role="status">
              {notice}
            </p>
          )}
          {refreshFailed && (
            <p className="mt-4 text-sm text-gray-500" role="status">
              We could not check the latest prices just now; prices shown may be out of date.
            </p>
          )}
        </div>
      </section>

      {!ready ? (
        <div className="flex justify-center py-24" role="status" aria-live="polite">
          <i className="ri-loader-4-line animate-spin text-4xl text-gray-400" aria-hidden="true"></i>
          <span className="sr-only">Loading your wishlist…</span>
        </div>
      ) : wishlistItems.length === 0 ? (
        <section className="py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 text-center">
            <div className="w-24 h-24 flex items-center justify-center mx-auto mb-6 bg-gray-200 rounded-full">
              <i className="ri-heart-line text-5xl text-gray-400" aria-hidden="true"></i>
            </div>
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Your wishlist is empty</h2>
            <p className="text-gray-600 mb-8 text-lg">Save your favourite items here to easily find them later</p>
            <Link href="/shop" className="inline-block bg-gray-900 hover:bg-blue-700 text-white px-8 py-4 rounded-lg font-semibold transition-colors whitespace-nowrap">
              Explore Products
            </Link>
          </div>
        </section>
      ) : (
        <section className="py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
              {wishlistItems.map((product) => (
                <div key={product.id} className="relative">
                  <ProductCard
                    id={product.id}
                    slug={product.slug || product.id}
                    name={product.name}
                    price={product.price}
                    originalPrice={product.originalPrice}
                    image={product.image}
                    badge={product.badge}
                    inStock={product.inStock}
                    maxStock={product.maxStock ?? 0}
                    moq={product.moq || 1}
                    hasVariants={product.hasVariants}
                    minVariantPrice={product.hasVariants ? product.price : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => removeFromWishlist(product.id)}
                    aria-label={`Remove ${product.name} from wishlist`}
                    className="absolute top-3 right-3 w-10 h-10 flex items-center justify-center bg-white rounded-full shadow-md hover:bg-red-50 transition-colors z-30"
                  >
                    <i className="ri-close-line text-gray-700 text-xl" aria-hidden="true"></i>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
