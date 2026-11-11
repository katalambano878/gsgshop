import { createClient } from '@supabase/supabase-js';
import { absoluteUrl, productSeoDescription, SITE_NAME } from '@/lib/seo';

// Meta (Facebook / Instagram / WhatsApp) catalogue feed.
// Add https://goods.gsgbrands.com.gh/feed/meta.csv as a scheduled feed in
// Commerce Manager; it reads the live products table on every fetch, so price,
// stock, photo and new-product changes in admin flow through on Meta's next
// scheduled pull. Public, no login.
//
// id is the product SKU and must never change — the Meta Pixel sends the same
// value as content_ids (lib/meta-pixel.ts). Meta rejects items without a price
// or an image, so only products with both are listed (same rule as the Google
// Merchant feed).

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const COLUMNS = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand'] as const;

function csvCell(value: string): string {
  const clean = value.replace(/\r?\n|\r/g, ' ').trim();
  return /[",]/.test(clean) ? `"${clean.replace(/"/g, '""')}"` : clean;
}

type FeedProduct = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  seo_description: string | null;
  price: number;
  quantity: number;
  continue_selling: boolean | null;
  sku: string | null;
  brand: string | null;
  categories: { name: string } | { name: string }[] | null;
  product_images: { url: string; position: number }[] | null;
  product_variants: { price: number; quantity: number }[] | null;
};

export async function GET() {
  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data, error } = await supabase
    .from('products')
    .select(
      'id, name, slug, description, seo_description, price, quantity, continue_selling, sku, brand, categories(name), product_images(url, position), product_variants(price, quantity)'
    )
    .eq('status', 'active')
    .order('name');

  if (error) {
    console.error('[meta-feed] query failed:', error.message);
    return new Response('Feed temporarily unavailable', { status: 503 });
  }

  const rows = ((data || []) as unknown as FeedProduct[])
    .map((p) => {
      const variants = p.product_variants || [];
      const price = variants.length
        ? Math.min(...variants.map((v) => v.price || p.price))
        : Number(p.price);
      const stock = variants.length
        ? variants.reduce((sum, v) => sum + (v.quantity || 0), 0)
        : p.quantity;
      // Direct Supabase storage URLs only — never a /_next/image wrapper.
      const image = [...(p.product_images || [])]
        .sort((a, b) => a.position - b.position)
        .map((img) => img.url)
        .find((url) => /^https?:\/\//.test(url || '') && !url.includes('/_next/image'));
      const category = Array.isArray(p.categories) ? p.categories[0]?.name : p.categories?.name;
      return { p, price, stock, image, category };
    })
    .filter(({ p, price, image }) => p.slug && price > 0 && image)
    .map(({ p, price, stock, image, category }) => [
      p.sku || p.id,
      p.name.trim().slice(0, 150),
      productSeoDescription({
        name: p.name,
        description: p.description,
        seo_description: p.seo_description,
        price,
        categoryName: category,
      }).slice(0, 5000),
      stock > 0 || p.continue_selling ? 'in stock' : 'out of stock',
      'new',
      `${price.toFixed(2)} GHS`,
      absoluteUrl(`/product/${p.slug}`),
      image as string,
      // Meta requires a brand; until it's filled in admin, use the store name.
      p.brand?.trim() || SITE_NAME,
    ]);

  const body = [COLUMNS.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n') + '\n';

  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'inline; filename="meta.csv"',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
