import { createShopperPageMetadata } from '@/lib/seo';

export const metadata = createShopperPageMetadata({
  title: 'Create Your Shopping List',
  description:
    'Build your shopping list, see your estimate and pay by Mobile Money or card. My Personal Shopper by GSG buys at the market price and delivers in Accra.',
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
