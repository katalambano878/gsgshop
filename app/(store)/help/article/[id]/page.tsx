'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { sanitizeHtml } from '@/lib/sanitize';
import PageHero from '@/components/PageHero';

const articles: any = {
  '1': {
    id: 1,
    title: 'How do I track my order?',
    category: 'Orders & Delivery',
    views: 1247,
    helpful: 234,
    updated: 'January 15, 2024',
    content: `
      <h2>Tracking Your Order</h2>
      <p>We make it easy to track your order every step of the way. Here's how:</p>
      
      <h3>Method 1: Track via Email</h3>
      <ol>
        <li>Check your email for the order confirmation</li>
        <li>Click on the "Track Order" button in the email</li>
        <li>You'll be redirected to the tracking page with real-time updates</li>
      </ol>
      
      <h3>Method 2: Track on Website</h3>
      <ol>
        <li>Go to the <a href="/order-tracking">Order Tracking</a> page</li>
        <li>Enter your order number and email address</li>
        <li>Click "Track Order" to see your delivery status</li>
      </ol>
      
      <h3>Method 3: Track in Your Account</h3>
      <ol>
        <li>Log in to your account</li>
        <li>Go to "Order History"</li>
        <li>Click on any order to see detailed tracking information</li>
      </ol>
      
      <h2>Understanding Tracking Statuses</h2>
      <ul>
        <li><strong>Order Confirmed:</strong> We've received your order</li>
        <li><strong>Processing:</strong> We're preparing your items</li>
        <li><strong>Packaged:</strong> Your order has been packaged</li>
        <li><strong>Out for Delivery:</strong> Your order will arrive today</li>
        <li><strong>Delivered:</strong> Your order has been delivered</li>
      </ul>
      
      <h2>Need More Help?</h2>
      <p>If you can't find your tracking information or have questions about your delivery, please <a href="/support/ticket">contact our support team</a>.</p>
    `
  },
  '6': {
    id: 6,
    title: 'How do I return an item?',
    category: 'Returns & Refunds',
    views: 2341,
    helpful: 456,
    updated: 'January 20, 2024',
    content: `
      <h2>Our Return Process</h2>
      <p>We want you to love your purchase! If you're not satisfied, returns are easy.</p>
      
      <h3>Step 1: Start Your Return</h3>
      <ol>
        <li>Go to the <a href="/returns">Returns Portal</a></li>
        <li>Enter your order number and email</li>
        <li>Select the items you want to return</li>
        <li>Choose a return reason</li>
      </ol>
      
      <h3>Step 2: Print Your Return Label</h3>
      <p>After submitting your return request, you'll receive a prepaid return label via email. Simply print it and attach it to your package.</p>
      
      <h3>Step 3: Ship Your Return</h3>
      <p>Drop off your package at any authorized shipping location. You can find locations near you on our returns page.</p>
      
      <h3>Step 4: Get Your Refund</h3>
      <p>Once we receive your return, we'll process it within 3-5 business days. Your refund will be issued to your original payment method.</p>
      
      <h2>Return Policy Details</h2>
      <ul>
        <li>You have 24 hours from delivery to start a return</li>
        <li>Items must be unused and in original packaging</li>
        <li>Return shipping is free for defective items</li>
        <li>Standard returns have a small shipping fee</li>
      </ul>
      
      <h2>Exchange Instead?</h2>
      <p>Looking for a different size or color? You can choose to exchange your item instead of returning it for a refund.</p>
    `
  }
};

const relatedArticles = [
  { id: 7, title: 'What is your return policy?', category: 'Returns' },
  { id: 8, title: 'When will I get my refund?', category: 'Returns' },
  { id: 9, title: 'Can I exchange instead of return?', category: 'Returns' },
  { id: 10, title: 'How do I print a return label?', category: 'Returns' }
];

export default function ArticlePage() {
  const params = useParams();
  const articleId = params.id as string;
  const article = articles[articleId] || articles['1'];
  
  const [wasHelpful, setWasHelpful] = useState<boolean | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);

  const handleHelpful = (helpful: boolean) => {
    setWasHelpful(helpful);
    setShowFeedback(true);
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <PageHero 
        title={article.title} 
        subtitle={`Updated ${article.updated} • ${article.views.toLocaleString()} views`}
      />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link
          href="/help"
          className="inline-flex items-center text-gsg-purple hover:text-gsg-purple-dark font-bold mb-8 whitespace-nowrap transition-colors"
        >
          <i className="ri-arrow-left-line mr-2"></i>
          Back to Help Center
        </Link>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 sm:p-12 mb-8">
          <div className="mb-8 pb-8 border-b border-gray-100">
            <div className="flex items-center space-x-3 mb-6">
              <span className="px-4 py-1.5 bg-purple-50 text-gsg-purple rounded-full text-sm font-bold whitespace-nowrap">
                {article.category}
              </span>
              <div className="flex items-center space-x-2 text-sm text-gray-500 font-medium">
                <i className="ri-thumb-up-line"></i>
                <span>{article.helpful} found this helpful</span>
              </div>
            </div>
            
            <article
              className="prose prose-lg prose-headings:font-bold prose-headings:text-gsg-black prose-p:text-gray-600 prose-a:text-gsg-purple prose-a:font-bold prose-strong:text-gsg-black max-w-none"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(article.content) }}
            />
          </div>

          <div>
            <h3 className="text-xl font-bold text-gsg-black mb-6 text-center">Was this article helpful?</h3>
            {!showFeedback ? (
              <div className="flex justify-center gap-4">
                <button
                  onClick={() => handleHelpful(true)}
                  className="py-3 px-8 border-2 border-gsg-purple text-gsg-purple hover:bg-gsg-purple hover:text-white rounded-xl font-bold transition-colors whitespace-nowrap flex items-center gap-2"
                >
                  <i className="ri-thumb-up-line"></i>
                  Yes, it was helpful
                </button>
                <button
                  onClick={() => handleHelpful(false)}
                  className="py-3 px-8 border-2 border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50 rounded-xl font-bold transition-colors whitespace-nowrap flex items-center gap-2"
                >
                  <i className="ri-thumb-down-line"></i>
                  No, I need more help
                </button>
              </div>
            ) : (
              <div className="text-center animate-fade-in">
                {wasHelpful ? (
                  <>
                    <div className="w-16 h-16 flex items-center justify-center bg-green-50 rounded-full mx-auto mb-4">
                      <i className="ri-check-line text-3xl text-green-600"></i>
                    </div>
                    <p className="text-xl font-bold text-gsg-black mb-2">
                      Thank you for your feedback!
                    </p>
                    <p className="text-gray-600">
                      We're glad we could help. Have a great day!
                    </p>
                  </>
                ) : (
                  <>
                    <div className="w-16 h-16 flex items-center justify-center bg-orange-50 rounded-full mx-auto mb-4">
                      <i className="ri-customer-service-line text-3xl text-orange-600"></i>
                    </div>
                    <p className="text-xl font-bold text-gsg-black mb-2">
                      Sorry we couldn't help
                    </p>
                    <p className="text-gray-600 mb-6">
                      Our support team is here for you!
                    </p>
                    <Link
                      href="/support/ticket"
                      className="inline-block bg-gsg-purple hover:bg-gsg-purple-dark text-white px-8 py-3 rounded-xl font-bold transition-colors whitespace-nowrap shadow-lg shadow-purple-200"
                    >
                      Contact Support
                    </Link>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 sm:p-10">
          <h3 className="text-xl font-bold text-gsg-black mb-6">Related Articles</h3>
          <div className="space-y-4">
            {relatedArticles.map((related) => (
              <Link
                key={related.id}
                href={`/help/article/${related.id}`}
                className="flex items-center justify-between p-4 hover:bg-purple-50 rounded-xl transition-colors group border border-transparent hover:border-purple-100"
              >
                <div className="flex items-center space-x-4">
                  <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-gray-500 group-hover:bg-gsg-purple group-hover:text-white transition-colors">
                    <i className="ri-file-text-line text-xl"></i>
                  </div>
                  <div>
                    <p className="font-bold text-gsg-black group-hover:text-gsg-purple transition-colors">{related.title}</p>
                    <p className="text-sm text-gray-500 font-medium">{related.category}</p>
                  </div>
                </div>
                <i className="ri-arrow-right-s-line text-2xl text-gray-300 group-hover:text-gsg-purple transition-colors"></i>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
