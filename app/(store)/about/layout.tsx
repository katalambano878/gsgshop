import { createPageMetadata } from '@/lib/seo';

export const metadata = createPageMetadata({
  title: 'About Us',
  description:
    'About GSG Convenience Goods & More: an online convenience store in Accra for groceries, household goods and everyday essentials, with delivery in and around Accra.',
  path: '/about',
});

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
