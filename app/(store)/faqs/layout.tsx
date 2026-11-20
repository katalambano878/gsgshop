import { createPageMetadata, generateFaqSchema } from '@/lib/seo';
import { STORE_FAQS } from '@/lib/faq-content';

export const metadata = createPageMetadata({
  title: 'Frequently Asked Questions',
  description:
    'Answers about ordering, delivery, shipping costs, returns, exchanges, payments and accounts at GSG Convenience Goods & More in Ghana.',
  path: '/faqs',
  keywords: ['GSG FAQ', 'delivery Ghana', 'returns policy', 'mobile money checkout'],
});

export default function FaqsLayout({ children }: { children: React.ReactNode }) {
  const faqSchema = generateFaqSchema(
    STORE_FAQS.map((faq) => ({ question: faq.question, answer: faq.answer })),
  );

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema).replace(/</g, '\\u003c') }}
      />
      {children}
    </>
  );
}
