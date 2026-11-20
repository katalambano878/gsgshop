import { createPageMetadata } from '@/lib/seo';

export const metadata = createPageMetadata({
  title: 'Blog',
  description:
    'News and shopping tips from GSG Convenience Goods & More in Accra.',
  path: '/blog',
});

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return children;
}
