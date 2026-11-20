import { createShopperPageMetadata } from '@/lib/seo';

export const metadata = createShopperPageMetadata({
  title: 'Track Your Request',
  description:
    'Track your My Personal Shopper by GSG request with your request number (SR-…) and the phone number you used.',
  path: '/track',
  keywords: ['track personal shopper request', 'order status Ghana'],
});

export default function TrackLayout({ children }: { children: React.ReactNode }) {
  return children;
}
