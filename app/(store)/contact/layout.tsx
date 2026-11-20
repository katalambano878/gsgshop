import { createPageMetadata } from '@/lib/seo';

export const metadata = createPageMetadata({
  title: 'Contact Us',
  description:
    'Contact GSG Convenience Goods & More in Accra by WhatsApp, phone or the contact form. Help with orders, delivery, pickup and payment.',
  path: '/contact',
  keywords: ['contact GSG Ghana', 'customer support Accra', 'GSG phone number'],
});

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
