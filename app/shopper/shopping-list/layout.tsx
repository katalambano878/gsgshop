import { createShopperPageMetadata } from '@/lib/seo';

export const metadata = createShopperPageMetadata({
  title: 'Create Your Shopping List',
  description:
    'Build your shopping list and let My Personal Shopper by GSG source it at market price with 15% or less Markup. Same-day delivery across Accra and Ghana.',
  path: '/shopping-list',
  keywords: [
    'shopping list service Ghana',
    'send shopping list Accra',
    'personal shopper request',
  ],
});

export default function ShoppingListLayout({ children }: { children: React.ReactNode }) {
  return children;
}
