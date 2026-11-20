import Link from 'next/link';

export default function GiftCardPage() {
  return (
    <div className="min-h-[60vh] bg-gray-50 flex items-center justify-center px-4 py-16">
      <div className="max-w-xl w-full bg-white border border-gray-100 rounded-2xl p-10 text-center shadow-sm">
        <div className="w-20 h-20 bg-purple-50 rounded-full flex items-center justify-center mx-auto mb-6">
          <i className="ri-gift-2-line text-4xl text-gsg-purple" aria-hidden="true"></i>
        </div>
        <h1 className="text-2xl font-bold text-gsg-black mb-3">Gift cards are not available</h1>
        <p className="text-gray-600 mb-8">We do not sell gift cards.</p>
        <Link
          href="/shop"
          className="inline-flex items-center justify-center gap-2 bg-gsg-purple hover:bg-gsg-purple-dark text-white px-8 py-4 rounded-xl font-bold transition-colors"
        >
          <i className="ri-shopping-bag-line" aria-hidden="true"></i>
          Continue Shopping
        </Link>
      </div>
    </div>
  );
}
