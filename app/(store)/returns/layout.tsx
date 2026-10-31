import { createPageMetadata } from '@/lib/seo';

export const metadata = createPageMetadata({
  title: 'Returns & Refunds',
  description:
    'How to return or exchange items at GSG Convenience Goods & More. 24-hour return policy, refund timelines and who pays return shipping in Ghana.',
  path: '/returns',
});

export default function ReturnsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
