'use client';

import { useState } from 'react';
import Link from 'next/link';
import { HELP_ARTICLES, HELP_CATEGORIES, STORE_EMAIL, STORE_PHONE, STORE_PHONE_TEL, STORE_WHATSAPP } from './articles';

export default function HelpCenterPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const query = searchQuery.trim().toLowerCase();

  const results = query
    ? HELP_ARTICLES.filter((a) =>
        a.title.toLowerCase().includes(query) ||
        a.summary.toLowerCase().includes(query) ||
        a.sections.some((s) =>
          [...(s.paragraphs || []), ...(s.list || []), s.heading || ''].some((t) => t.toLowerCase().includes(query))
        )
      )
    : [];

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="relative bg-gsg-purple overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(white 1px, transparent 1px)', backgroundSize: '32px 32px' }}></div>
        <div className="absolute inset-0 bg-gradient-to-b from-gsg-purple/90 to-gsg-purple"></div>

        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center z-10">
          <h1 className="text-3xl md:text-5xl font-bold text-white mb-6">
            How can we help you?
          </h1>
          <p className="text-lg md:text-xl text-purple-100 mb-10">
            Answers about ordering, paying, delivery, Personal Shopper, problems with an order and your account.
          </p>

          <div className="relative max-w-2xl mx-auto" role="search">
            <label htmlFor="help-search" className="sr-only">Search help articles</label>
            <input
              id="help-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search, for example “pickup”"
              className="w-full px-6 py-4 pl-14 pr-14 rounded-full text-gsg-black text-lg focus:outline-none focus:ring-4 focus:ring-white/20 shadow-lg border-0"
            />
            <i className="ri-search-line absolute left-5 top-1/2 -translate-y-1/2 text-2xl text-gray-400" aria-hidden="true"></i>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600"
              >
                <i className="ri-close-line text-xl" aria-hidden="true"></i>
              </button>
            )}
          </div>

          {query && (
            <div className="mt-4 bg-white rounded-2xl shadow-xl text-left max-w-2xl mx-auto max-h-96 overflow-y-auto" aria-live="polite">
              {results.length > 0 ? (
                <ul>
                  {results.map((article) => (
                    <li key={article.id} className="border-b border-gray-100 last:border-0">
                      <Link href={`/help/article/${article.id}`} className="block p-4 hover:bg-gray-50 transition-colors">
                        <p className="font-bold text-gsg-black">{article.title}</p>
                        <p className="text-sm text-gray-500 mt-1">{article.summary}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="p-8 text-center">
                  <i className="ri-file-search-line text-4xl text-gray-300 mb-2" aria-hidden="true"></i>
                  <p className="text-gsg-black font-bold">No articles match</p>
                  <p className="text-sm text-gray-500 mt-1">Try other words, or contact us below.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h2 className="text-2xl font-bold text-gsg-black mb-10">Browse by topic</h2>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
          {HELP_CATEGORIES.map((category) => {
            const articles = HELP_ARTICLES.filter((a) => a.category === category.id);
            return (
              <section key={category.id} aria-labelledby={`help-cat-${category.id}`} className="bg-white rounded-2xl shadow-sm p-8 border-2 border-transparent">
                <div className="w-14 h-14 flex items-center justify-center rounded-2xl mb-6 bg-purple-50 text-gsg-purple">
                  <i className={`${category.icon} text-3xl`} aria-hidden="true"></i>
                </div>
                <h3 id={`help-cat-${category.id}`} className="text-xl font-bold text-gsg-black mb-4">{category.title}</h3>
                <ul className="space-y-2">
                  {articles.map((article) => (
                    <li key={article.id}>
                      <Link
                        href={`/help/article/${article.id}`}
                        className="flex items-start gap-2 text-sm text-gray-600 hover:text-gsg-purple font-medium transition-colors py-1"
                      >
                        <i className="ri-file-text-line mt-0.5 text-gray-400" aria-hidden="true"></i>
                        <span>{article.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 sm:p-10 mb-16">
          <h2 className="text-2xl font-bold text-gsg-black mb-2">Still need help?</h2>
          <p className="text-gray-500 mb-6">Talk to our team during opening hours. WhatsApp is the quickest.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <a href={STORE_WHATSAPP} target="_blank" rel="noopener noreferrer" className="p-4 border-2 border-gray-100 rounded-xl hover:border-gsg-purple transition-colors">
              <i className="ri-whatsapp-line text-2xl text-gsg-purple" aria-hidden="true"></i>
              <p className="font-bold text-gsg-black mt-2">WhatsApp</p>
              <p className="text-sm text-gray-500">{STORE_PHONE}</p>
            </a>
            <a href={`tel:${STORE_PHONE_TEL}`} className="p-4 border-2 border-gray-100 rounded-xl hover:border-gsg-purple transition-colors">
              <i className="ri-phone-line text-2xl text-gsg-purple" aria-hidden="true"></i>
              <p className="font-bold text-gsg-black mt-2">Call us</p>
              <p className="text-sm text-gray-500">{STORE_PHONE}</p>
            </a>
            <a href={`mailto:${STORE_EMAIL}`} className="p-4 border-2 border-gray-100 rounded-xl hover:border-gsg-purple transition-colors">
              <i className="ri-mail-line text-2xl text-gsg-purple" aria-hidden="true"></i>
              <p className="font-bold text-gsg-black mt-2">Email</p>
              <p className="text-sm text-gray-500 break-all">{STORE_EMAIL}</p>
            </a>
            <Link href="/support/ticket" className="p-4 border-2 border-gray-100 rounded-xl hover:border-gsg-purple transition-colors">
              <i className="ri-ticket-line text-2xl text-gsg-purple" aria-hidden="true"></i>
              <p className="font-bold text-gsg-black mt-2">Support ticket</p>
              <p className="text-sm text-gray-500">For signed-in customers</p>
            </Link>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <Link
            href="/returns"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 hover:shadow-lg hover:-translate-y-1 transition-all text-center group"
          >
            <div className="w-16 h-16 flex items-center justify-center bg-purple-50 text-purple-600 rounded-full mx-auto mb-6 group-hover:scale-110 transition-transform">
              <i className="ri-arrow-left-right-line text-3xl" aria-hidden="true"></i>
            </div>
            <h3 className="text-lg font-bold text-gsg-black mb-2">Report a Problem</h3>
            <p className="text-gray-500 text-sm mb-6">Within 24 hours of delivery</p>
            <span className="text-purple-600 font-bold text-sm uppercase tracking-wider group-hover:underline">Start</span>
          </Link>

          <Link
            href="/order-tracking"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 hover:shadow-lg hover:-translate-y-1 transition-all text-center group"
          >
            <div className="w-16 h-16 flex items-center justify-center bg-orange-50 text-orange-600 rounded-full mx-auto mb-6 group-hover:scale-110 transition-transform">
              <i className="ri-map-pin-line text-3xl" aria-hidden="true"></i>
            </div>
            <h3 className="text-lg font-bold text-gsg-black mb-2">Track Order</h3>
            <p className="text-gray-500 text-sm mb-6">Check your order status</p>
            <span className="text-orange-600 font-bold text-sm uppercase tracking-wider group-hover:underline">Track Now</span>
          </Link>

          <Link
            href="/faqs"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 hover:shadow-lg hover:-translate-y-1 transition-all text-center group"
          >
            <div className="w-16 h-16 flex items-center justify-center bg-blue-50 text-blue-600 rounded-full mx-auto mb-6 group-hover:scale-110 transition-transform">
              <i className="ri-question-line text-3xl" aria-hidden="true"></i>
            </div>
            <h3 className="text-lg font-bold text-gsg-black mb-2">FAQs</h3>
            <p className="text-gray-500 text-sm mb-6">Quick answers to common questions</p>
            <span className="text-blue-600 font-bold text-sm uppercase tracking-wider group-hover:underline">Read</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
