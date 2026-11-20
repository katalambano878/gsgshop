import { createPageMetadata } from '@/lib/seo';

export const metadata = createPageMetadata({
  title: 'Shipping & Delivery',
  description:
    'Delivery options at GSG: Pickup, Free Delivery, Sole Express, Joint Express and Add to Personal Shopper, in and around Accra. Fees are worked out from distance at checkout.',
  path: '/shipping',
  keywords: ['delivery Accra', 'free delivery Ghana', 'Sole Express', 'GSG shipping'],
});

export default function ShippingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
