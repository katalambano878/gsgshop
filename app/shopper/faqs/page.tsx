import { createShopperPageMetadata, generateFaqSchema } from '@/lib/seo';
import { SHOPPER_FAQS } from '@/lib/faq-content';

export const metadata = createShopperPageMetadata({
  title: 'FAQ',
  description:
    'Answers about My Personal Shopper by GSG — how the service works, the 5% or less Markup, delivery fees, payments, produce sourcing and tracking your request in Ghana.',
  path: '/faqs',
  keywords: ['personal shopper FAQ Ghana', 'markup fee', 'delivery fee Accra'],
});

export default function ShopperFAQs() {
  const faqs = SHOPPER_FAQS;

  const faqSchema = generateFaqSchema(
    faqs.map((faq) => ({ question: faq.q, answer: faq.a })),
  );

  return (
    <div className="bg-gray-50 min-h-screen py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h1 className="text-3xl md:text-5xl font-bold text-gsg-black mb-4">Frequently Asked Questions</h1>
          <p className="text-xl text-gray-600">Everything you need to know about our service.</p>
        </div>

        <div className="space-y-6">
          {faqs.map((faq, i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 md:p-8">
              <h3 className="text-lg font-bold text-gsg-black mb-3">{faq.q}</h3>
              <p className="text-gray-600 leading-relaxed">{faq.a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
