import { createShopperPageMetadata } from '@/lib/seo';

export const metadata = createShopperPageMetadata({
  title: 'Customer Experience',
  description:
    'Contact My Personal Shopper by GSG: phone and WhatsApp numbers, email and support hours.',
  path: '/customer-experience',
});

export default function CustomerExperienceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
