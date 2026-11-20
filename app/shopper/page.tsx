import type { ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import ShopperMarkup from '@/components/ShopperMarkup';
import { REFUND_NOTE } from './_lib/copy';

const STEPS: Array<{ step: string; title: string; text: ReactNode; image: string }> = [
  {
    step: '01',
    title: 'Create your list',
    text: 'Add item names, quantities, and your estimated prices. Add notes for anything specific. You can drop everything in our easy-to-use list builder.',
    image: '/shopper/shopper_image_5.webp',
  },
  {
    step: '02',
    title: 'Pay the estimate',
    text: (
      <>
        We work out your estimate from your list: item prices, a <ShopperMarkup /> markup on the item subtotal and the
        delivery fee for your distance. You pay it up front by Mobile Money or card.
      </>
    ),
    image: '/shopper/shopper_image_9.webp',
  },
  {
    step: '03',
    title: 'We shop & deliver',
    text: 'Our shoppers buy your items at the market price and deliver to your chosen location. If the market prices differ from the estimate, our staff settle the difference with you on WhatsApp.',
    image: '/shopper/shopper_image_4.webp',
  },
];

const SOURCE_CATEGORIES = [
  {
    name: 'Convenience Goods',
    desc: 'Everyday essentials from trusted shops and markets across the city.',
    examples: ['Groceries', 'Toiletries', 'Drinks'],
    image: '/shopper/shopper_image_8.webp',
  },
  {
    name: 'Specialty Goods',
    desc: 'Unique, imported, and brand-specific items hard to find elsewhere.',
    examples: ['Imported brands', 'Gifts', 'Custom finds'],
    image: '/shopper/shopper_image_7.webp',
  },
  {
    name: 'Urgent Runs',
    desc: 'Medicines and urgent essentials that just need to arrive — fast.',
    examples: ['Pharmacy items', 'First-aid', 'Emergency'],
    image: '/shopper/shopper_image_1.webp',
  },
];

const STATS: Array<{ value: ReactNode; unit: string; label: string }> = [
  { value: <ShopperMarkup fallback="—" />, unit: '', label: 'Markup on the item subtotal, from our live settings' },
  { value: 'Daily', unit: '', label: 'Sole and Joint Express delivery in Accra' },
  { value: '2–48', unit: 'hr', label: 'Delivery slots to choose from' },
  { value: 'MoMo', unit: '+ card', label: 'Mobile Money or card, paid up front' },
];

const FAQS: Array<{ q: string; a: ReactNode }> = [
  {
    q: 'How is the price calculated?',
    a: (
      <>
        You pay the market price for each item, plus a <ShopperMarkup /> markup on the item subtotal, plus a delivery
        fee based on distance. You pay the estimate when you send your list; if the market prices differ, our staff
        settle the difference with you on WhatsApp.
      </>
    ),
  },
  {
    q: 'What if an item is unavailable?',
    a: `We message you on WhatsApp with the closest substitute, or we drop that item and refund it. ${REFUND_NOTE}`,
  },
  {
    q: 'How fast is delivery?',
    a: 'Sole and Joint Express run daily in Accra, in 2-hour to 48-hour slots. Outside Greater Accra we drop your items at an Accra transport station and the onward fare is extra.',
  },
];

export default function ShopperHome() {
  return (
    <div className="bg-white">
      {/* ============================================================
          HERO
          ============================================================ */}
      <section className="relative overflow-hidden bg-gsg-black min-h-[600px] flex items-center">
        <div className="absolute inset-0 z-0">
          <Image
            src="/shopper/shopper_image_2.webp"
            alt="Professional personal shopper"
            fill
            className="object-cover"
            priority
            sizes="100vw"
          />
        </div>
        <div className="absolute inset-0 bg-black/30 z-[1]" />
        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 z-10 w-full">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-md text-white text-sm font-medium mb-8 ring-1 ring-white/30 shadow-lg">
              <i className="ri-shopping-basket-line text-gsg-accent" />
              <span>Your Premium Personal Shopper</span>
            </div>

            <h1 className="text-5xl md:text-7xl font-bold mb-6 text-white leading-[1.1] tracking-tight">
              List them.<br />
              <span className="text-gsg-accent">We shop</span> for you.
            </h1>

            <p className="text-xl md:text-2xl mb-10 text-white/90 font-light leading-relaxed max-w-xl">
              Quality, fresh, hard-to-find — bought <strong className="font-semibold text-white">at the market price</strong> and delivered to your door in Accra. Time saved.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 mb-12">
              <Link
                href="/shopper/shopping-list"
                className="inline-flex items-center justify-center gap-2 bg-gsg-accent text-gsg-purple-dark px-8 py-4 rounded-full text-lg font-bold hover:bg-orange-400 transition-all shadow-xl hover:-translate-y-1"
              >
                <i className="ri-list-check-2" />
                Create Shopping List
              </Link>
              <Link
                href="/shopper/how-it-works"
                className="inline-flex items-center justify-center gap-2 bg-white/10 backdrop-blur-md text-white px-8 py-4 rounded-full text-lg font-bold hover:bg-white/20 transition-all border border-white/20 hover:-translate-y-1"
              >
                <i className="ri-information-line" />
                How it works
              </Link>
            </div>

            {/* Trust strip */}
            <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm text-white/80 font-medium">
              <div className="flex items-center gap-2">
                <i className="ri-shield-check-fill text-xl text-green-400" />
                <span>Market price on the goods</span>
              </div>
              <div className="flex items-center gap-2">
                <i className="ri-percent-fill text-xl text-green-400" aria-hidden="true" />
                <span><ShopperMarkup fallback="Clear" /> markup, shown before you pay</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================
          HOW IT WORKS — Grid Layout
          ============================================================ */}
      <section className="py-24 bg-white overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16 max-w-3xl mx-auto">
            <span className="inline-block text-sm font-bold tracking-[0.2em] text-gsg-purple mb-3">
              THE PROCESS
            </span>
            <h2 className="text-4xl md:text-5xl font-bold text-gsg-black tracking-tight mb-4">
              How your shopping gets done
            </h2>
            <p className="text-lg text-gray-600">
              Three simple steps to reclaim your time. We handle the rest.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 lg:gap-12 relative">
            {/* Connecting line for desktop */}
            <div className="hidden md:block absolute top-[120px] left-[15%] right-[15%] h-[2px] bg-gradient-to-r from-transparent via-gray-200 to-transparent z-0" />

            {STEPS.map((s, idx) => (
              <div key={s.step} className="relative z-10 flex flex-col items-center text-center group">
                <div className="relative w-full aspect-[4/3] md:aspect-square max-w-[280px] rounded-3xl overflow-hidden shadow-lg mb-8 transition-transform duration-500 group-hover:-translate-y-2 group-hover:shadow-2xl">
                  <Image
                    src={s.image}
                    alt={s.title}
                    fill
                    className="object-cover transition-transform duration-700 group-hover:scale-110"
                    sizes="(max-width: 768px) 100vw, 33vw"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="absolute bottom-4 left-0 right-0 flex justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 translate-y-4 group-hover:translate-y-0">
                    <span className="bg-white/90 backdrop-blur-sm text-gsg-purple text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full">
                      Step {s.step}
                    </span>
                  </div>
                </div>

                <div className="w-12 h-12 rounded-full bg-gsg-purple text-white flex items-center justify-center text-xl font-bold mb-5 shadow-md ring-4 ring-white">
                  {idx + 1}
                </div>

                <h3 className="font-bold text-gsg-black text-2xl mb-3">{s.title}</h3>
                <p className="text-gray-600 leading-relaxed">
                  {s.text}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-16 text-center">
            <Link
              href="/shopper/shopping-list"
              className="inline-flex items-center gap-2 bg-gsg-purple text-white px-8 py-4 rounded-full text-lg font-bold hover:bg-gsg-purple-dark transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
            >
              Start your list now <i className="ri-arrow-right-line" />
            </Link>
          </div>
        </div>
      </section>

      {/* ============================================================
          WHAT WE SOURCE — Large Image Cards
          ============================================================ */}
      <section className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-16">
            <div className="max-w-2xl">
              <span className="inline-block text-sm font-bold tracking-[0.2em] text-gsg-purple mb-3">
                WHAT WE SOURCE
              </span>
              <h2 className="text-4xl md:text-5xl font-bold text-gsg-black tracking-tight mb-4">
                Anything on your list.<br />Anywhere in the city.
              </h2>
              <p className="text-xl text-gray-600">
                Three broad categories, one trusted service. Tell us what you need and we'll look for it.
              </p>
            </div>
            <Link
              href="/shopper/how-it-works"
              className="shrink-0 inline-flex items-center gap-2 text-gsg-purple font-bold hover:underline text-lg"
            >
              See how it works <i className="ri-arrow-right-line" aria-hidden="true" />
            </Link>
          </div>

          <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
            {SOURCE_CATEGORIES.map((category) => (
              <div
                key={category.name}
                className="group relative h-[400px] rounded-3xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-500"
              >
                <Image
                  src={category.image}
                  alt={category.name}
                  fill
                  className="object-cover group-hover:scale-105 transition-transform duration-700"
                  sizes="(max-width: 768px) 100vw, 33vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
                <div className="absolute inset-0 p-8 flex flex-col justify-end">
                  <h3 className="font-bold text-3xl text-white mb-3 group-hover:text-gsg-accent transition-colors">
                    {category.name}
                  </h3>
                  <p className="text-gray-200 text-lg mb-6 max-w-md">
                    {category.desc}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {category.examples.map((ex) => (
                      <span
                        key={ex}
                        className="backdrop-blur-md bg-white/20 text-white border border-white/30 text-sm font-medium px-3 py-1.5 rounded-full"
                      >
                        {ex}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================
          BY THE NUMBERS — Stats strip
          ============================================================ */}
      <section className="py-20 md:py-24 bg-gsg-black text-white relative overflow-hidden">
        <div className="absolute inset-0 z-0">
          <Image
            src="/shopper/shopper_image_4.webp"
            alt="Personal Shopper Delivery"
            fill
            className="object-cover"
            sizes="100vw"
          />
        </div>
        <div className="absolute inset-0 bg-black/35 z-[1]" />
        
        <div
          className="absolute inset-0 opacity-[0.1] pointer-events-none z-[2]"
          style={{
            backgroundImage: 'radial-gradient(white 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 max-w-3xl mx-auto">
            <span className="inline-block text-xs md:text-sm font-bold tracking-[0.2em] text-gsg-accent mb-3">
              AT A GLANCE
            </span>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              Clear prices,{' '}
              <span className="text-gsg-accent">no guesswork.</span>
            </h2>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10 md:gap-y-0">
            {STATS.map((s, idx) => (
              <div
                key={s.label}
                className={`text-left pl-5 md:pl-6 border-l border-white/20 ${
                  idx === 0 ? '' : 'lg:border-l'
                }`}
              >
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-4xl md:text-5xl font-black tracking-tight leading-none text-white drop-shadow-md">
                    {s.value}
                  </span>
                  <span className="text-xl md:text-2xl font-bold text-gsg-accent leading-none drop-shadow-md">
                    {s.unit}
                  </span>
                </div>
                <p className="text-gray-200 text-xs md:text-sm leading-relaxed max-w-[160px] font-medium drop-shadow">
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================
          FREQUENTLY ASKED — Numbered card layout (no accordion)
          ============================================================ */}
      <section className="py-24 bg-gray-50 border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16 max-w-3xl mx-auto">
            <span className="inline-block text-sm font-bold tracking-[0.2em] text-gsg-purple mb-3">
              FREQUENTLY ASKED
            </span>
            <h2 className="text-4xl md:text-5xl font-bold text-gsg-black tracking-tight mb-4">
              Everything you need to know.
            </h2>
            <p className="text-lg text-gray-600">
              Quick answers — and we're a WhatsApp message away for the rest.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-5 lg:gap-6 mb-12">
            {FAQS.map((f, idx) => (
              <div
                key={f.q}
                className="bg-white rounded-2xl p-7 md:p-8 border border-gray-200 hover:border-gsg-purple/30 hover:shadow-lg transition-all flex flex-col"
              >
                <div className="flex items-center gap-3 mb-4">
                  <span className="w-9 h-9 rounded-full bg-gsg-purple/10 text-gsg-purple flex items-center justify-center font-bold text-sm">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span className="text-[11px] font-bold tracking-[0.2em] text-gsg-purple uppercase">
                    Question
                  </span>
                </div>
                <h3 className="font-bold text-gsg-black text-lg md:text-xl mb-3 leading-snug">
                  {f.q}
                </h3>
                <p className="text-gray-600 text-base leading-relaxed">
                  {f.a}
                </p>
              </div>
            ))}
          </div>

          <div className="text-center">
            <div className="inline-flex flex-wrap items-center justify-center gap-3 bg-white border border-gray-200 rounded-full p-2 pl-6 shadow-sm">
              <span className="text-sm font-medium text-gray-700">
                Still got a question?
              </span>
              <a
                href="https://wa.me/233246033792"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-gsg-purple text-white px-5 py-2.5 rounded-full font-bold text-sm hover:bg-gsg-purple-dark transition-colors"
              >
                <i className="ri-whatsapp-line text-lg" />
                Chat with us
              </a>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}

