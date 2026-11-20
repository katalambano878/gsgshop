import Link from 'next/link';
import { createPageMetadata } from '@/lib/seo';

export const metadata = createPageMetadata({
  title: 'Referral rewards not available',
  description: 'GSG Convenience Goods & More does not run a referral programme.',
  path: '/referral-rewards',
  noindex: true,
});

export default function ReferralRewardsPage() {
  return (
    <div className="min-h-[60vh] bg-white flex items-center justify-center px-4 py-16">
      <div className="max-w-xl w-full bg-white border border-gray-200 rounded-card p-10 text-center">
        <h1 className="text-2xl font-bold text-gsg-black mb-3">Referral rewards are not available</h1>
        <p className="text-gray-600 mb-8">We do not run a referral or rewards programme.</p>
        <Link
          href="/shop"
          className="inline-block bg-gsg-purple hover:bg-gsg-purple-dark text-white px-6 py-3 rounded-pill font-medium"
        >
          Continue Shopping
        </Link>
      </div>
    </div>
  );
}
