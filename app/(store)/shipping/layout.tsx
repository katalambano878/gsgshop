import { createPageMetadata } from '@/lib/seo';

export const metadata = createPageMetadata({
  title: 'Shipping & Delivery',
  description:
    'Delivery options at GSG: Free Delivery (daily), Sole Express, Joint Express and Pickup. Rates depend on your destination across Ghana.',
  path: '/shipping',
  keywords: ['delivery Accra', 'free delivery Ghana', 'Sole Express', 'GSG shipping'],
});

export default function ShippingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
