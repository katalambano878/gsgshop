'use client';

import { useState } from 'react';
import Link from 'next/link';
import PageHero from '@/components/PageHero';

const categories = [
  {
    id: 'orders',
    title: 'Orders & Delivery',
    icon: 'ri-shopping-bag-line',
    count: 12,
    articles: [
      { id: 1, title: 'How do I track my order?', views: 1247 },
      { id: 2, title: 'What are the delivery times?', views: 892 },
      { id: 3, title: 'Can I change my delivery address?', views: 654 },
      { id: 4, title: 'What if my order is delayed?', views: 543 },
      { id: 5, title: 'Do you offer express delivery?', views: 421 }
    ]
  },
  {
    id: 'returns',
    title: 'Returns & Refunds',
    icon: 'ri-arrow-left-right-line',
    count: 10,
    articles: [
      { id: 6, title: 'How do I return an item?', views: 2341 },
      { id: 7, title: 'What is your return policy?', views: 1876 },
      { id: 8, title: 'When will I get my refund?', views: 1432 },
      { id: 9, title: 'Can I exchange instead of return?', views: 987 },
      { id: 10, title: 'How do I print a return label?', views: 765 }
    ]
  },
  {
    id: 'payment',
    title: 'Payment & Pricing',
    icon: 'ri-bank-card-line',
    count: 8,
    articles: [
      { id: 11, title: 'What payment methods do you accept?', views: 1654 },
      { id: 12, title: 'Is my payment information secure?', views: 1234 },
      { id: 13, title: 'No instalment or subscription payments', views: 987 },
      { id: 14, title: 'Do you accept gift cards?', views: 543 },
      { id: 15, title: 'Why was my payment declined?', views: 432 }
    ]
  },
  {
    id: 'account',
    title: 'Account & Profile',
    icon: 'ri-user-line',
    count: 9,
    articles: [
      { id: 16, title: 'How do I create an account?', views: 876 },
      { id: 17, title: 'I forgot my password', views: 1543 },
      { id: 18, title: 'How do I update my email?', views: 654 },
      { id: 19, title: 'Can I delete my account?', views: 432 },
      { id: 20, title: 'How do I manage my addresses?', views: 543 }
    ]
  },
  {
    id: 'products',
    title: 'Products & Stock',
    icon: 'ri-gift-line',
    count: 7,
    articles: [
      { id: 21, title: 'When will items be back in stock?', views: 1987 },
      { id: 22, title: 'How do I use the size guide?', views: 876 },
      { id: 23, title: 'Are your products authentic?', views: 765 },
      { id: 24, title: 'Do you offer gift wrapping?', views: 543 },
      { id: 25, title: 'How do I care for my product?', views: 432 }
    ]
  },
  {
    id: 'loyalty',
    title: 'Loyalty & Rewards',
    icon: 'ri-medal-line',
    count: 6,
    articles: [
      { id: 26, title: 'How do I earn loyalty points?', views: 2134 },
      { id: 27, title: 'How do I redeem my points?', views: 1765 },
      { id: 28, title: 'Do my points expire?', views: 987 },
      { id: 29, title: 'What are the loyalty tiers?', views: 654 },
      { id: 30, title: 'How does the referral program work?', views: 543 }
    ]
  }
];

const popularArticles = [
  { id: 1, title: 'How do I track my order?', category: 'Orders', views: 1247 },
  { id: 6, title: 'How do I return an item?', category: 'Returns', views: 2341 },
  { id: 26, title: 'How do I earn loyalty points?', category: 'Loyalty', views: 2134 },
  { id: 21, title: 'When will items be back in stock?', category: 'Products', views: 1987 },
  { id: 7, title: 'What is your return policy?', category: 'Returns', views: 1876 }
];

export default function HelpCenterPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const filteredCategories = selectedCategory
    ? categories.filter(cat => cat.id === selectedCategory)
    : categories;

  const filteredArticles = searchQuery
    ? categories.flatMap(cat => 
        cat.articles.filter(article => 
          article.title.toLowerCase().includes(searchQuery.toLowerCase())
        ).map(article => ({ ...article, category: cat.title }))
      )
    : [];

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="relative bg-gsg-purple overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(white 1px, transparent 1px)', backgroundSize: '32px 32px' }}></div>
        <div className="absolute inset-0 bg-gradient-to-b from-gsg-purple/90 to-gsg-purple"></div>
        
        {/* Abstract Shapes */}
        <div className="absolute top-0 right-0 w-1/3 h-full bg-gradient-to-bl from-white/10 to-transparent rounded-bl-[100px] -z-0"></div>
        <div className="absolute bottom-0 left-0 w-1/4 h-1/2 bg-gradient-to-tr from-black/10 to-transparent rounded-tr-[100px] -z-0"></div>

        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center z-10">
          <h1 className="text-3xl md:text-5xl font-bold text-white mb-6 animate-fade-in-up">
            How can we help you?
          </h1>
          <p className="text-lg md:text-xl text-purple-100 mb-10 animate-fade-in-up animate-delay-100">
            Search our help center or browse by category
          </p>
          
          <div className="relative max-w-2xl mx-auto animate-fade-in-up animate-delay-200">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search for articles..."
              className="w-full px-6 py-4 pl-14 rounded-full text-gsg-black text-lg focus:outline-none focus:ring-4 focus:ring-white/20 shadow-lg border-0"
            />
            <i className="ri-search-line absolute left-5 top-1/2 -translate-y-1/2 text-2xl text-gray-400"></i>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600"
              >
                <i className="ri-close-line text-xl"></i>
              </button>
            )}
          </div>

          {searchQuery && filteredArticles.length > 0 && (
            <div className="mt-4 bg-white rounded-2xl shadow-xl text-left max-w-2xl mx-auto max-h-96 overflow-y-auto absolute left-0 right-0 z-50 animate-fade-in-up">
              {filteredArticles.map((article) => (
                <Link
                  key={article.id}
                  href={`/help/article/${article.id}`}
                  className="block p-4 hover:bg-gray-50 border-b border-gray-100 last:border-0 transition-colors"
                >
                  <p className="font-bold text-gsg-black">{article.title}</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {article.category} • {article.views.toLocaleString()} views
                  </p>
                </Link>
              ))}
            </div>
          )}

          {searchQuery && filteredArticles.length === 0 && (
            <div className="mt-4 bg-white rounded-2xl shadow-xl p-8 text-center max-w-2xl mx-auto absolute left-0 right-0 z-50 animate-fade-in-up">
              <i className="ri-file-search-line text-4xl text-gray-300 mb-2"></i>
              <p className="text-gsg-black font-bold">No results found</p>
              <p className="text-sm text-gray-500 mt-1">Try different keywords or browse categories below</p>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="mb-10 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gsg-black">Browse by Category</h2>
          {selectedCategory && (
            <button
              onClick={() => setSelectedCategory(null)}
              className="text-gsg-purple hover:text-gsg-purple-dark font-bold whitespace-nowrap flex items-center gap-2 transition-colors"
            >
              <i className="ri-arrow-left-line"></i>
              All Categories
            </button>
          )}
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
          {filteredCategories.map((category) => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`bg-white rounded-2xl shadow-sm p-8 text-left hover:shadow-lg transition-all border-2 group ${selectedCategory === category.id ? 'border-gsg-purple ring-4 ring-gsg-purple/10' : 'border-transparent hover:border-gsg-purple/30'}`}
            >
              <div className={`w-14 h-14 flex items-center justify-center rounded-2xl mb-6 transition-colors ${selectedCategory === category.id ? 'bg-gsg-purple text-white' : 'bg-purple-50 text-gsg-purple group-hover:bg-gsg-purple group-hover:text-white'}`}>
                <i className={`${category.icon} text-3xl`}></i>
              </div>
              <h3 className="text-xl font-bold text-gsg-black mb-2">{category.title}</h3>
              <p className="text-gray-500 font-medium">{category.count} articles</p>
              
              {selectedCategory === category.id && (
                <div className="mt-6 pt-6 border-t border-gray-100 space-y-3 animate-fade-in">
                  {category.articles.map((article) => (
                    <Link
                      key={article.id}
                      href={`/help/article/${article.id}`}
                      className="block text-sm text-gray-600 hover:text-gsg-purple font-medium transition-colors py-1"
                    >
                      • {article.title}
                    </Link>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 sm:p-10 mb-16">
          <h2 className="text-2xl font-bold text-gsg-black mb-8">Popular Articles</h2>
          <div className="space-y-2">
            {popularArticles.map((article, index) => (
              <Link
                key={article.id}
                href={`/help/article/${article.id}`}
                className="flex items-center justify-between p-4 hover:bg-gray-50 rounded-xl transition-colors group"
              >
                <div className="flex items-center space-x-4">
                  <div className="w-8 h-8 flex items-center justify-center bg-gray-100 text-gray-500 rounded-full font-bold text-sm group-hover:bg-gsg-purple group-hover:text-white transition-colors">
                    {index + 1}
                  </div>
                  <div>
                    <p className="font-bold text-gsg-black group-hover:text-gsg-purple transition-colors">{article.title}</p>
                    <p className="text-xs text-gray-500 font-medium mt-0.5">{article.category}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <span className="text-xs text-gray-400 font-medium hidden sm:inline-block">{article.views.toLocaleString()} views</span>
                  <i className="ri-arrow-right-s-line text-2xl text-gray-300 group-hover:text-gsg-purple transition-colors"></i>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <Link
            href="/support/ticket"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 hover:shadow-lg hover:-translate-y-1 transition-all text-center group"
          >
            <div className="w-16 h-16 flex items-center justify-center bg-blue-50 text-blue-600 rounded-full mx-auto mb-6 group-hover:scale-110 transition-transform">
              <i className="ri-customer-service-2-line text-3xl"></i>
            </div>
            <h3 className="text-lg font-bold text-gsg-black mb-2">Contact Support</h3>
            <p className="text-gray-500 text-sm mb-6">Get help from our support team</p>
            <span className="text-blue-600 font-bold text-sm uppercase tracking-wider group-hover:underline">Create Ticket</span>
          </Link>

          <Link
            href="/returns"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 hover:shadow-lg hover:-translate-y-1 transition-all text-center group"
          >
            <div className="w-16 h-16 flex items-center justify-center bg-purple-50 text-purple-600 rounded-full mx-auto mb-6 group-hover:scale-110 transition-transform">
              <i className="ri-arrow-left-right-line text-3xl"></i>
            </div>
            <h3 className="text-lg font-bold text-gsg-black mb-2">Start a Return</h3>
            <p className="text-gray-500 text-sm mb-6">Return or exchange your item</p>
            <span className="text-purple-600 font-bold text-sm uppercase tracking-wider group-hover:underline">Initiate Return</span>
          </Link>

          <Link
            href="/order-tracking"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 hover:shadow-lg hover:-translate-y-1 transition-all text-center group"
          >
            <div className="w-16 h-16 flex items-center justify-center bg-orange-50 text-orange-600 rounded-full mx-auto mb-6 group-hover:scale-110 transition-transform">
              <i className="ri-map-pin-line text-3xl"></i>
            </div>
            <h3 className="text-lg font-bold text-gsg-black mb-2">Track Order</h3>
            <p className="text-gray-500 text-sm mb-6">Check your order status</p>
            <span className="text-orange-600 font-bold text-sm uppercase tracking-wider group-hover:underline">Track Now</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
