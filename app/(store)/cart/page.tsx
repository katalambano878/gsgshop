'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useCart } from '@/context/CartContext';
import PageHero from '@/components/PageHero';
import { usePageTitle } from '@/hooks/usePageTitle';

export default function CartPage() {
  usePageTitle('Shopping Cart');
  const { cart: cartItems, removeFromCart, updateQuantity, subtotal, ready, refreshCart } = useCart();
  const [cartChanges, setCartChanges] = useState<string[]>([]);
  const [refreshFailed, setRefreshFailed] = useState(false);

  // Re-read current prices and stock once the saved cart has loaded.
  useEffect(() => {
    if (!ready) return;
    let active = true;
    refreshCart().then((changes) => {
      if (!active) return;
      if (changes === null) setRefreshFailed(true);
      else if (changes.length > 0) setCartChanges(changes.map((c) => c.message));
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Same sum as checkout before delivery and coupon: items only.
  const total = subtotal;

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHero title="Shopping Cart" subtitle="Review your items and proceed to checkout" />
      <div className="py-12 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {cartChanges.length > 0 && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
            <p className="font-semibold">Your cart was updated</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {cartChanges.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          </div>
        )}
        {refreshFailed && (
          <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700" role="status">
            We could not check the latest prices just now. Checkout will confirm the final price before you pay.
          </div>
        )}

        {!ready ? (
          <div className="flex justify-center py-24" role="status" aria-live="polite">
            <i className="ri-loader-4-line animate-spin text-4xl text-gray-400" aria-hidden="true"></i>
            <span className="sr-only">Loading your cart…</span>
          </div>
        ) : cartItems.length === 0 ? (
          <section className="py-20">
            <div className="max-w-2xl mx-auto text-center bg-white rounded-3xl p-12 shadow-sm border border-gray-100">
              <div className="w-24 h-24 flex items-center justify-center mx-auto mb-6 bg-purple-50 rounded-full">
                <i className="ri-shopping-cart-2-line text-5xl text-gsg-purple"></i>
              </div>
              <h2 className="text-3xl font-bold text-gsg-black mb-4">Your cart is empty</h2>
              <p className="text-gray-500 mb-8 text-lg">Looks like you haven't added anything to your cart yet. Explore our products to find something you love.</p>
              <Link href="/shop" className="inline-flex items-center gap-2 bg-gsg-purple hover:bg-gsg-purple-dark text-white px-8 py-4 rounded-full font-bold transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5">
                <span>Start Shopping</span>
                <i className="ri-arrow-right-line"></i>
              </Link>
            </div>
          </section>
        ) : (
          <section className="py-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                    <h2 className="text-xl font-bold text-gsg-black flex items-center gap-2">
                      <i className="ri-shopping-bag-3-line text-gsg-purple"></i>
                      Cart Items ({cartItems.length})
                    </h2>
                  </div>

                  <div className="p-6 space-y-8">
                    {cartItems.map((item) => {
                      const minQty = item.moq || 1;
                      const atMax = item.quantity >= item.maxStock;
                      const lineTotal = Math.round(item.price * item.quantity * 100) / 100;
                      return (
                      <div key={`${item.id}-${item.variantId || item.variant || ''}`} className="flex flex-col sm:flex-row gap-6 pb-8 border-b border-gray-100 last:border-0 last:pb-0">
                        <Link href={`/product/${item.slug || item.id}`} aria-label={`View ${item.name}`} className="relative w-full sm:w-32 h-32 flex-shrink-0 bg-gray-50 rounded-xl overflow-hidden border border-gray-100">
                          <Image src={item.image} alt={item.name} fill className="object-cover" sizes="(max-width: 640px) 100vw, 128px" quality={80} />
                        </Link>

                        <div className="flex-1 flex flex-col justify-between">
                          <div>
                            <div className="flex justify-between items-start mb-2">
                              <Link href={`/product/${item.slug || item.id}`} className="text-lg font-bold text-gsg-black hover:text-gsg-purple transition-colors line-clamp-2">
                                {item.name}
                              </Link>
                              <button
                                type="button"
                                onClick={() => removeFromCart(item.id, item.variant, item.variantId)}
                                className="text-gray-400 hover:text-red-500 transition-colors p-1"
                                aria-label={`Remove ${item.name} from cart`}
                              >
                                <i className="ri-delete-bin-line text-xl" aria-hidden="true"></i>
                              </button>
                            </div>

                            <div className="text-sm text-gray-500 mb-4 space-y-1">
                              {item.variant && <p className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-gray-300" aria-hidden="true"></span> Variant: {item.variant}</p>}
                            </div>
                          </div>

                          <div className="flex items-center justify-between flex-wrap gap-4">
                            <div className="flex items-center border border-gray-200 rounded-lg bg-gray-50">
                              <button
                                type="button"
                                onClick={() => updateQuantity(item.id, item.quantity - 1, item.variant, item.variantId)}
                                className="w-10 h-10 flex items-center justify-center text-gray-600 hover:bg-white hover:text-gsg-purple rounded-l-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                disabled={item.quantity <= minQty}
                                aria-label={`Decrease quantity of ${item.name}`}
                              >
                                <i className="ri-subtract-line" aria-hidden="true"></i>
                              </button>
                              <input
                                type="number"
                                inputMode="numeric"
                                value={item.quantity}
                                onChange={(e) => {
                                  const n = parseInt(e.target.value, 10);
                                  // Typing never removes a line; use the remove button for that.
                                  updateQuantity(item.id, Number.isFinite(n) ? Math.max(n, minQty) : minQty, item.variant, item.variantId);
                                }}
                                className="w-12 h-10 text-center bg-transparent border-x border-gray-200 focus:outline-none font-bold text-gsg-black text-sm"
                                min={minQty}
                                max={item.maxStock}
                                aria-label={`Quantity of ${item.name}`}
                              />
                              <button
                                type="button"
                                onClick={() => updateQuantity(item.id, item.quantity + 1, item.variant, item.variantId)}
                                disabled={atMax}
                                className="w-10 h-10 flex items-center justify-center text-gray-600 hover:bg-white hover:text-gsg-purple rounded-r-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                aria-label={`Increase quantity of ${item.name}`}
                              >
                                <i className="ri-add-line" aria-hidden="true"></i>
                              </button>
                            </div>

                            <div className="text-right">
                              <p className="text-xs text-gray-500">GH₵{item.price.toFixed(2)} × {item.quantity}</p>
                              <p className="text-xl font-bold text-gsg-black">GH₵{lineTotal.toFixed(2)}</p>
                            </div>
                          </div>

                          {minQty > 1 && (
                            <p className="text-xs text-orange-500 mt-2 font-medium">
                              Minimum order: {minQty} units
                            </p>
                          )}
                          {atMax && (
                            <p className="text-xs text-amber-600 mt-1 font-medium">Only {item.maxStock} available</p>
                          )}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>

              </div>

              <div className="space-y-6">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sticky top-24">
                  <h3 className="text-xl font-bold text-gsg-black mb-6">Order Summary</h3>

                  <div className="space-y-4 mb-6">
                    <div className="flex justify-between text-gray-600">
                      <span>Subtotal</span>
                      <span className="font-bold text-gsg-black">GH₵{subtotal.toFixed(2)}</span>
                    </div>

                    <div className="flex justify-between text-gray-600 gap-4">
                      <span>Delivery</span>
                      <span className="font-bold text-gsg-black text-right text-sm">
                        Calculated at checkout
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 leading-relaxed">
                      Your delivery total appears after you choose a delivery method at checkout. Have a coupon? Enter it at checkout.
                    </p>
                  </div>

                  <div className="border-t border-dashed border-gray-200 pt-4 mb-6">
                    <div className="flex justify-between items-end">
                      <span className="text-gray-900 font-bold">Subtotal</span>
                      <span className="text-2xl font-extrabold text-gsg-purple">GH₵{total.toFixed(2)}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1 text-right">Delivery added at checkout</p>
                  </div>

                  <Link
                    href="/checkout"
                    className="block w-full bg-gsg-black hover:bg-gsg-purple text-white py-4 rounded-xl font-bold text-center transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 mt-6 mb-3"
                  >
                    Proceed to Checkout
                  </Link>

                  <Link
                    href="/shop"
                    className="block w-full text-center text-gray-500 hover:text-gsg-purple font-semibold py-2 transition-colors"
                  >
                    Continue Shopping
                  </Link>

                  <div className="mt-8 pt-6 border-t border-gray-100 grid grid-cols-3 gap-2 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center text-green-600">
                        <i className="ri-shield-check-line"></i>
                      </div>
                      <span className="text-[10px] font-medium text-gray-500">Secure</span>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                        <i className="ri-truck-line"></i>
                      </div>
                      <span className="text-[10px] font-medium text-gray-500">Fast</span>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-8 h-8 rounded-full bg-orange-50 flex items-center justify-center text-orange-600">
                        <i className="ri-customer-service-2-line"></i>
                      </div>
                      <span className="text-[10px] font-medium text-gray-500">Support</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
