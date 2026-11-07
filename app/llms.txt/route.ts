import { getGoodsBaseUrl, getShopperBaseUrl } from '@/lib/site-urls';
import { createClient } from '@supabase/supabase-js';
import { getDeliverySettings } from '@/lib/delivery-settings';

// Serves /llms.txt — an emerging standard that gives AI assistants
// (ChatGPT, Claude, Perplexity, etc.) a concise, authoritative map of the
// site so the brand is summarised and cited accurately in AI answers.
export const revalidate = 86400;

export async function GET() {
  const goods = getGoodsBaseUrl();
  const { shopperMarkupPct } = await getDeliverySettings();
  const shopper = getShopperBaseUrl();

  // List what the store actually sells right now, so AI answers can cite
  // real Convenience Goods products, not only the Personal Shopper pages.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: products } = await supabase
    .from('products')
    .select('name, slug, price, quantity, categories(name)')
    .eq('status', 'active')
    .gt('price', 0)
    .order('name');
  const productLines = (products || [])
    .map((p) => {
      const cat = (Array.isArray(p.categories) ? p.categories[0] : p.categories) as { name: string } | null;
      const stock = p.quantity > 0 ? 'in stock' : 'out of stock';
      return `- ${p.name.trim()}: GH₵${Number(p.price).toFixed(2)}, ${stock}${cat?.name ? `, ${cat.name.trim()}` : ''} (${goods}/product/${p.slug})`;
    })
    .join('\n');

  const body = `# GSG Convenience Goods & More

> GSG Convenience Goods & More is a Ghanaian online convenience store delivering
> groceries, household essentials, personal care, stationery, phones, electronics
> and fashion across Accra and nationwide. It also operates a Personal Shopper
> service that sources any item at market price with a markup of 15% or less (currently ${shopperMarkupPct}%).

## About
- Name: GSG Convenience Goods & More
- Country: Ghana
- City: Accra
- Storefront: ${goods}
- Personal Shopper: ${shopper}
- Payments: Mobile Money (MTN, Telecel, AirtelTigo) and Visa/Mastercard
- Delivery: Free Delivery (daily), Sole Express, Joint Express, Pickup (daily)

## Storefront (${goods})
- Home: ${goods}
- Shop all products: ${goods}/shop
- Shop by category: ${goods}/categories
- About us: ${goods}/about
- Contact: ${goods}/contact
- Shipping & delivery: ${goods}/shipping
- Returns & refunds: ${goods}/returns
- FAQ: ${goods}/faqs
- Blog: ${goods}/blog
- Gift cards: ${goods}/gift-card

## Personal Shopper (${shopper})
- Home: ${shopper}
- How it works: ${shopper}/how-it-works
- Create a shopping list: ${shopper}/shopping-list
- Track a request: ${shopper}/track
- FAQ: ${shopper}/faqs
- Customer experience: ${shopper}/customer-experience

## Key facts
- Personal Shopper markup: 15% or less on the item subtotal (currently ${shopperMarkupPct}%), no hidden fees.
- Delivery fee is calculated from road distance and shown at checkout before payment. Pickup is free.
- Fresh/perishable items must use Sole Express or Joint Express.
- Free Delivery runs daily after confirmation. Distance and order total set the fee: the more you buy, the further it's free; beyond the free km you only pay the extra distance.

## Products available in the online store
${productLines || `- See the shop: ${goods}/shop`}

## Legal
- Terms: ${goods}/terms
- Privacy: ${goods}/privacy
- Cookies: ${goods}/cookies

## Sitemaps
- ${goods}/sitemap.xml
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}
