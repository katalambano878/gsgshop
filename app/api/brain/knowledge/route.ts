import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getDeliverySettings, SHOPPER_MARKUP_MAX_PCT } from '@/lib/delivery-settings';
import { STORE_FAQS, SHOPPER_FAQS } from '@/lib/faq-content';

/**
 * GET /api/brain/knowledge — public, read-only.
 *
 * The live facts the GSG WhatsApp assistant answers from, so it never drifts
 * from the website: Personal Shopper markup and delivery pricing (both editable
 * in Admin → Delivery Pricing), the store and shopper FAQs, and what the
 * catalogue actually holds per category. Everything here is already public
 * on the websites; nothing customer-specific is returned.
 */

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type CatalogRow = {
  price: number;
  quantity: number;
  categories: { name: string; slug: string } | { name: string; slug: string }[] | null;
  product_variants: { price: number; quantity: number }[] | null;
};

export async function GET() {
  const supabase = createClient(supabaseUrl, supabaseKey);
  const [settings, catalog] = await Promise.all([
    getDeliverySettings(),
    supabase
      .from('products')
      .select('price, quantity, categories(name, slug), product_variants(price, quantity)')
      .eq('status', 'active'),
  ]);

  const byCategory = new Map<string, { name: string; slug: string; products: number; priced: number; inStock: number }>();
  for (const row of (catalog.data || []) as unknown as CatalogRow[]) {
    const cat = Array.isArray(row.categories) ? row.categories[0] : row.categories;
    const key = cat?.slug || 'uncategorised';
    const entry = byCategory.get(key) || {
      name: cat?.name?.trim() || 'Uncategorised',
      slug: key,
      products: 0,
      priced: 0,
      inStock: 0,
    };
    const variants = row.product_variants || [];
    const price = variants.length ? Math.min(...variants.map((v) => v.price || row.price)) : row.price;
    const stock = variants.length ? variants.reduce((s, v) => s + (v.quantity || 0), 0) : row.quantity;
    entry.products += 1;
    if (price > 0) entry.priced += 1;
    if (stock > 0) entry.inStock += 1;
    byCategory.set(key, entry);
  }
  const categories = [...byCategory.values()].sort((a, b) => b.products - a.products);

  const p = settings.pricing;
  const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
  const ghs = (n: number) => `GH₵${n.toFixed(2)}`;
  const promo = p.promoDiscount > 0 ? ` − ${ghs(p.promoDiscount)} promo` : '';

  return NextResponse.json(
    {
      success: true,
      generatedAt: new Date().toISOString(),
      personalShopper: {
        markupPct: settings.shopperMarkupPct,
        markupLabel: `${settings.shopperMarkupPct}% markup on the item subtotal`,
        markupCeilingPct: SHOPPER_MARKUP_MAX_PCT,
      },
      delivery: {
        hub: settings.hub.label,
        feeNote:
          'Delivery fees are calculated from road distance to the GSG hub and shown at checkout before payment. Pickup is free.',
        methods: [
          {
            id: 'sole-express',
            name: 'Sole Express',
            schedule: 'Daily, 2hr / 6hr / 12hr / 24hr / 48hr slots after confirmation',
            formula: `${ghs(p.ratePerKm)} × km × ${p.soleMultiplier} + ${pct(p.expressPurchasePct)} of purchase${promo}`,
            note: 'Required for fresh produce, bakery, meat, frozen food, seafood, fish and poultry.',
          },
          {
            id: 'joint-express',
            name: 'Joint Express',
            schedule: 'Daily, shared with a neighbour or colleague',
            formula: `(${ghs(p.ratePerKm)} × km × ${p.jointMultiplier} + ${pct(p.expressPurchasePct)} of purchase) ÷ 2${promo}`,
            note: 'The fee is split; items stay private to each customer.',
          },
          {
            id: 'free-delivery',
            name: 'Free Delivery',
            schedule: 'Tuesday and Friday only; confirm before noon the preceding day',
            formula: `${ghs(p.ratePerKm)} × km × ${p.freeMultiplier} − ${pct(p.freePurchasePct)} of purchase (never below GH₵0)`,
            note: 'Larger orders can bring the fee down to GH₵0. Not for perishables.',
          },
          {
            id: 'personal-shopper',
            name: 'Add To Personal Shopper',
            schedule: 'Continue shopping on Personal Shopper after checkout',
            formula: 'GH₵0, free delivery for the shop cart',
            note: 'For customers who also want market items: pay for the shop cart with this option, then add the rest on Personal Shopper; the shop items travel with that delivery.',
          },
          {
            id: 'pickup',
            name: 'Pickup',
            schedule: 'Ready within 72 hours of confirmation (excluding Sunday)',
            formula: 'GH₵0, no delivery fee',
            note: 'Collect at the hub shown in the order confirmation.',
          },
        ],
      },
      faqs: {
        store: STORE_FAQS.map((f) => ({ category: f.category, question: f.question, answer: f.answer })),
        // The FAQ copy states the ceiling ("15% or less"); quote the rate the pay
        // page charges today and keep the ceiling.
        personalShopper: SHOPPER_FAQS.map((f) => ({
          question: f.q,
          answer: f.a.replace(/15% or less Markup/gi, `${settings.shopperMarkupPct}% markup (never more than 15%)`),
        })),
      },
      catalog: {
        activeProducts: categories.reduce((s, c) => s + c.products, 0),
        pricedProducts: categories.reduce((s, c) => s + c.priced, 0),
        categories,
      },
    },
    { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=300' } }
  );
}
