import { createPageMetadata } from '@/lib/seo';

export const metadata = createPageMetadata({
  title: 'Shop All Products',
  description:
    'Browse groceries, household essentials, personal care and other everyday convenience goods. Filter by category and price. Pickup in Accra or delivery in and around Accra.',
  path: '/shop',
  keywords: ['shop online Ghana', 'GSG products', 'buy groceries Accra', 'online store'],
});

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return children;
}
