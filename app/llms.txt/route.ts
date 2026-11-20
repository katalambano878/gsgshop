import { getGoodsBaseUrl, getShopperBaseUrl } from '@/lib/site-urls';
import { createServerSupabase } from '@/lib/supabase-server';
import { getDeliverySettings } from '@/lib/delivery-settings';

// Serves /llms.txt — an emerging standard that gives AI assistants
// (ChatGPT, Claude, Perplexity, etc.) a concise, authoritative map of the
// site so the brand is summarised and cited accurately in AI answers.
// Rendered per request (the build has no database); browsers and proxies
// may cache it for a day.
export const dynamic = 'force-dynamic';

export async function GET() {
  const goods = getGoodsBaseUrl();
  const { shopperMarkupPct } = await getDeliverySettings();
  const shopper = getShopperBaseUrl();

  // List what the store actually sells right now, so AI answers can cite
  // real Convenience Goods products, not only the Personal Shopper pages.
  const supabase = createServerSupabase('anon');
  const { data: products } = await supabase
    .from('products')
    .select('name, slug, price, quantity, track_quantity, continue_selling, product_variants(quantity), categories(name)')
    .eq('status', 'active')
    .gt('price', 0)
    .order('name');
  const productLines = (products || [])
    .map((p: any) => {
      const cat = (Array.isArray(p.categories) ? p.categories[0] : p.categories) as { name: string } | null;
      const variants: { quantity: number | null }[] = Array.isArray(p.product_variants) ? p.product_variants : [];
      const available = variants.length > 0
        ? variants.some((v) => (Number(v.quantity) || 0) > 0)
        : (Number(p.quantity) || 0) > 0;
      const sellable = p.track_quantity === false || p.continue_selling === true || available;
      const stock = sellable ? 'available' : 'out of stock';
      return `- ${p.name.trim()}: GH₵${Number(p.price).toFixed(2)}, ${stock}${cat?.name ? `, ${cat.name.trim()}` : ''} (${goods}/product/${p.slug})`;
    })
    .join('\n');

  const body = `# GSG Convenience Goods & More

> GSG Convenience Goods & More is an online convenience store in Accra, Ghana,
> selling groceries, household essentials and personal-care goods, with pickup
> or delivery in and around Accra (other regions via an Accra transport station).
> It also runs a Personal Shopper service that buys items at the market for a
> markup on the item subtotal (currently ${shopperMarkupPct}%).

## About
- Name: GSG Convenience Goods & More
- Country: Ghana
- City: Accra
- Storefront: ${goods}
- Personal Shopper: ${shopper}
- Payments: Mobile Money (MTN, Telecel Cash, AirtelTigo) through Moolre, and cards (Visa, Mastercard, Verve) through Paystack. No cash on delivery, no bank transfer.
- Phone / WhatsApp: +233 24 603 3792 (second line +233 57 903 3792)
- Hours: Mon–Fri 05:00–14:00, Saturday and public holidays 05:00–09:00
- Updates: by SMS and WhatsApp
- Delivery: Pickup (free), Free Delivery (daily), Sole Express, Joint Express, Add to Personal Shopper

## Storefront (${goods})
- Home: ${goods}
- Shop all products: ${goods}/shop
- Shop by category: ${goods}/categories
- About us: ${goods}/about
- Contact: ${goods}/contact
- Shipping & delivery: ${goods}/shipping
- Returns & refunds: ${goods}/returns
- FAQ: ${goods}/faqs
- Help centre: ${goods}/help
- Blog: ${goods}/blog

## Personal Shopper (${shopper})
- Home: ${shopper}
- How it works: ${shopper}/how-it-works
- Create a shopping list: ${shopper}/shopping-list
- Track a request: ${shopper}/track
- FAQ: ${shopper}/faqs
- Customer experience: ${shopper}/customer-experience

## Key facts
- Personal Shopper: the customer pays the estimate (items, markup of currently ${shopperMarkupPct}%, delivery) when submitting the list; any difference after market pricing is settled with staff on WhatsApp.
- Delivery fee is calculated from distance and shown at checkout before payment. Pickup is free.
- Outside Greater Accra, orders are delivered to an Accra transport station; the onward fare is paid to the transport company.
- Problems with an order must be reported within 24 hours of delivery (returns form or WhatsApp, with photos).
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
