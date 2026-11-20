import { createPageMetadata } from '@/lib/seo';

export const metadata = createPageMetadata({
  title: 'Returns & Refunds',
  description:
    'Report a problem with a GSG Convenience Goods & More order within 24 hours of delivery: wrong, damaged, expired or missing items. Send photos on WhatsApp.',
  path: '/returns',
});

export default function ReturnsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
