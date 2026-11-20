'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useCMS } from '@/context/CMSContext';
import PageHero from '@/components/PageHero';
import { usePageTitle } from '@/hooks/usePageTitle';
import { shopperUrl } from '@/lib/site-urls';

export default function AboutPage() {
  usePageTitle('Our Story');
  const { getSetting } = useCMS();
  const [activeTab, setActiveTab] = useState('story');

  const siteName = getSetting('site_name') || 'GSG Convenience Goods & More';

  const values = [
    {
      icon: 'ri-verified-badge-line',
      title: 'Quality First',
      description: 'We check what we sell and stand behind it: if something arrives wrong or damaged, tell us within 24 hours and we put it right.'
    },
    {
      icon: 'ri-money-dollar-circle-line',
      title: 'Fair Prices',
      description: 'Clear prices in Ghana Cedis, with the delivery fee for your location shown at checkout before you pay.'
    },
    {
      icon: 'ri-global-line',
      title: 'Everyday Essentials',
      description: 'Groceries, household goods and personal-care products from brands you know, local and imported.'
    },
    {
      icon: 'ri-truck-line',
      title: 'Delivery in Accra',
      description: 'Pickup, Free Delivery, Sole Express or Joint Express in and around Accra. For other regions we send your order to an Accra transport station.'
    }
  ];

  return (
    <div className="min-h-screen bg-white">
      <PageHero
        title="More Than Just A Brand"
        subtitle="From Accra to your doorstep — quality goods & more at prices that make sense."
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="flex border-b border-gray-200 mb-12 justify-center">
          {['story', 'mission'].map((tab) => (
            <button
              key={tab}
              type="button"
              aria-pressed={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 sm:px-8 sm:py-4 font-medium transition-colors text-lg cursor-pointer capitalize ${
                activeTab === tab
                  ? 'text-gsg-purple border-b-4 border-gsg-purple font-bold'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'story' ? 'Our Story' : 'Our Mission'}
            </button>
          ))}
        </div>

        {activeTab === 'story' && (
          <div className="grid md:grid-cols-2 gap-16 items-center animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 mb-6">How It All Started</h2>
              <div className="space-y-6 text-lg text-gray-600 leading-relaxed">
                <p>
                  <strong>{siteName}</strong> started with a simple idea: bring quality products to Ghanaians at fair prices. We saw how people were paying too much for items that could be sourced smarter — so we built a bridge between trusted manufacturers, local suppliers, and everyday shoppers.
                </p>
                <p>
                  Today we are an online convenience store in Accra, offering food essentials, groceries, household goods and personal-care products, delivered in and around the city or ready to collect from our pickup point.
                </p>
                <p>
                  Need something we do not stock? Our Personal Shopper service buys it at the market for you. Whether you are shopping for yourself or running a household, <strong>{siteName}</strong> has you covered.
                </p>
              </div>
            </div>
            <div className="relative">
              <div className="aspect-[3/4] rounded-2xl overflow-hidden shadow-2xl bg-gray-100 relative flex items-center justify-center">
                <img
                  src="/fgfg.png"
                  alt={siteName}
                  className="w-2/3 h-auto object-contain opacity-80"
                />
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-8">
                  <p className="text-white font-bold text-xl">{siteName}</p>
                  <p className="text-purple-200">Accra, Ghana</p>
                </div>
              </div>
              <div className="absolute -z-10 top-10 -right-10 w-full h-full border-4 border-purple-100 rounded-2xl hidden md:block"></div>
            </div>
          </div>
        )}

        {activeTab === 'mission' && (
          <div className="grid md:grid-cols-2 gap-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-purple-50 p-10 rounded-3xl border border-purple-100">
              <div className="w-16 h-16 bg-gsg-purple rounded-2xl flex items-center justify-center mb-8 shadow-lg">
                <i className="ri-store-2-line text-3xl text-white"></i>
              </div>
              <h3 className="text-3xl font-bold text-gray-900 mb-4">Everything in One Place</h3>
              <p className="text-gray-600 text-lg leading-relaxed">
                From food essentials to household and personal-care goods, we aim to be the convenience store you reach for first, with your order delivered or ready to collect.
              </p>
            </div>
            <div className="bg-amber-50 p-10 rounded-3xl border border-amber-100">
              <div className="w-16 h-16 bg-amber-600 rounded-2xl flex items-center justify-center mb-8 shadow-lg">
                <i className="ri-hand-heart-line text-3xl text-white"></i>
              </div>
              <h3 className="text-3xl font-bold text-gray-900 mb-4">Personal Shopper</h3>
              <p className="text-gray-600 text-lg leading-relaxed">
                Send us your shopping list and we buy the items at the market for you, then deliver them.{' '}
                <a href={shopperUrl('/')} className="text-gsg-purple font-semibold hover:underline">Find out more</a>.
              </p>
            </div>
          </div>
        )}

      </div>

      {/* Values Section */}
      <div className="bg-gray-50 py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">Why Shop With Us?</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">Convenience goods and groceries for homes and offices in and around Accra.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {values.map((value) => (
              <div key={value.title} className="bg-white p-8 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
                <div className="w-14 h-14 bg-purple-100 rounded-full flex items-center justify-center mb-6">
                  <i className={`${value.icon} text-2xl text-gsg-purple`} aria-hidden="true"></i>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">{value.title}</h3>
                <p className="text-gray-600 leading-relaxed">{value.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="bg-gsg-purple py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-white">
          <h2 className="text-4xl md:text-5xl font-bold mb-8">Ready to shop smarter?</h2>
          <p className="text-xl text-purple-100 mb-10 leading-relaxed max-w-2xl mx-auto">
            Browse our food essentials, groceries, household goods and more.
          </p>
          <Link
            href="/shop"
            className="inline-flex items-center gap-3 bg-white text-gsg-purple px-10 py-5 rounded-full font-bold text-lg hover:bg-purple-50 transition-colors shadow-lg hover:shadow-xl transform hover:-translate-y-1 transition-all"
          >
            Start Shopping
            <i className="ri-arrow-right-line"></i>
          </Link>
        </div>
      </div>
    </div>
  );
}
