import Link from 'next/link';
import Image from 'next/image';
import { createShopperPageMetadata } from '@/lib/seo';

export const metadata = createShopperPageMetadata({
  title: 'How It Works',
  description:
    'See how My Personal Shopper by GSG works — create your list, we source at market price with 15% or less Markup, then deliver to your door in Ghana.',
  path: '/how-it-works',
  keywords: [
    'how personal shopper works Ghana',
    'shopping service steps',
    'source price shopping Accra',
  ],
});

const STEPS = [
  {
    id: '01',
    title: 'Create Your List',
    icon: 'ri-list-check-3',
    content:
      'Start from the Shopping List page. Add item names, quantities, and your estimated prices. For produce, you can also choose Local Market, Imported, or Controlled Environment.',
  },
  {
    id: '02',
    title: 'We Source at Market Price',
    icon: 'ri-store-2-line',
    content:
      'After submission, our team reviews your list and starts sourcing. We buy at the exact source market price with no hidden markups on the goods.',
  },
  {
    id: '03',
    title: 'Transparent Fees',
    icon: 'ri-percent-line',
    content:
      'We charge a 15% or less Markup on item subtotal. Delivery fee is based on distance. If a rare sourcing fee is needed, we always agree with you first.',
  },
  {
    id: '04',
    title: 'Pay & Schedule Delivery',
    icon: 'ri-secure-payment-line',
    content:
      'Once totals are confirmed, you pay securely online. Your personal shopper buys the items and delivers to your preferred location and time.',
  },
];

export default function HowItWorks() {
  return (
    <div className="bg-gray-50 min-h-screen">
      <section className="relative overflow-hidden py-24 md:py-32 flex items-center justify-center min-h-[400px]">
        <div className="absolute inset-0 z-0">
          <Image
            src="/shopper/shopper_image_8.webp"
            alt="How It Works Background"
            fill
            className="object-cover"
            priority
            sizes="100vw"
          />
        </div>
        <div className="absolute inset-0 bg-black/30 z-[1]" />
        <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/15 text-white text-sm font-medium mb-6">
            <i className="ri-magic-line" />
            My Personal Shopper by GSG
          </span>
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-4">How It Works</h1>
          <p className="text-lg md:text-xl text-white/85 max-w-2xl mx-auto">
            Straightforward process, transparent pricing, and delivery you can trust.
          </p>
        </div>
      </section>

      <section className="pt-8 md:pt-10 pb-12 md:pb-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-5 md:gap-6">
            {STEPS.map((step) => (
              <div
                key={step.id}
                className="group bg-white border border-gray-200 rounded-2xl p-6 md:p-7 shadow-sm hover:shadow-xl hover:border-gsg-purple/30 transition-all duration-300"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 shrink-0 rounded-xl bg-gsg-purple/10 text-gsg-purple flex items-center justify-center group-hover:bg-gsg-purple group-hover:text-white transition-colors">
                    <i className={`${step.icon} text-xl`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-xs font-bold tracking-[0.2em] text-gsg-purple">{step.id}</span>
                      <div className="h-px bg-gray-200 flex-1" />
                    </div>
                    <h3 className="text-xl md:text-2xl font-bold text-gsg-black mb-2">{step.title}</h3>
                    <p className="text-gray-600 leading-relaxed text-sm md:text-base">{step.content}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 md:mt-10 bg-white border border-gsg-purple/20 rounded-2xl p-6 md:p-8 flex flex-col md:flex-row md:items-center md:justify-between gap-6 shadow-sm">
            <div>
              <h3 className="text-xl md:text-2xl font-bold text-gsg-black mb-2">Important Note</h3>
              <p className="text-gray-600 max-w-2xl">
                We advise timely placement of your shopping list ahead of your preferred delivery time so we can source the freshest and best quality items.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 md:shrink-0">
              <Link
                href="/shopper/shopping-list"
                className="inline-flex items-center justify-center gap-2 bg-gsg-purple text-white min-w-[160px] px-7 py-3.5 rounded-full font-bold whitespace-nowrap hover:bg-gsg-purple-dark transition-colors"
              >
                <i className="ri-list-check-2" />
                Create List
              </Link>
              <Link
                href="/shopper/track"
                className="inline-flex items-center justify-center gap-2 bg-white text-gsg-purple border border-gsg-purple/30 min-w-[160px] px-7 py-3.5 rounded-full font-bold whitespace-nowrap hover:bg-gsg-purple/5 transition-colors"
              >
                <i className="ri-map-pin-line" />
                Track Request
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
