import { createPageMetadata } from '@/lib/seo';

export const metadata = createPageMetadata({
  title: 'Gift cards not available',
  description: 'GSG Convenience Goods & More does not sell gift cards.',
  path: '/gift-card',
  noindex: true,
});

export default function GiftCardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
