import type { Metadata } from 'next';
import HomePageClient from '@/components/HomePageClient';
import { createPageMetadata, SITE_NAME, SITE_TAGLINE } from '@/lib/seo';

const base = createPageMetadata({
  title: `${SITE_NAME} | ${SITE_TAGLINE}`,
  description:
    'Shop groceries, household essentials, personal care and other everyday convenience goods online. Pickup in Accra or delivery in and around Accra with GSG Convenience Goods & More.',
  path: '/',
  keywords: [
    'buy online Ghana',
    'grocery delivery Accra',
    'convenience goods Ghana',
    'GSG shop',
  ],
});

// `absolute` stops the layout's title template adding the store name a second time.
export const metadata: Metadata = {
  ...base,
  title: { absolute: `${SITE_NAME} | ${SITE_TAGLINE}` },
};

export default function HomePage() {
  return <HomePageClient />;
}
