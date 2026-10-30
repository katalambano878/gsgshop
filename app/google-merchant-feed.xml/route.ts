import { createClient } from '@supabase/supabase-js';
import { absoluteUrl, productSeoDescription, SITE_NAME, DEFAULT_DESCRIPTION } from '@/lib/seo';

// Google Merchant Center product feed (RSS 2.0 + g: namespace).
// Add https://goods.gsgbrands.com.gh/google-merchant-feed.xml as a scheduled
// fetch in Merchant Center so products show in Google Shopping / free listings.
// Only products Google accepts are listed: a real price and at least one photo.

export const revalidate = 3600;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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
  barcode: string | null;
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
      'id, name, slug, description, seo_description, price, quantity, continue_selling, sku, barcode, brand, categories(name), product_images(url, position), product_variants(price, quantity)'
    )
    .eq('status', 'active');

  if (error) {
    console.error('[merchant-feed] query failed:', error.message);
    return new Response('Feed temporarily unavailable', { status: 503 });
  }

  const items = ((data || []) as unknown as FeedProduct[])
    .map((p) => {
      const variants = p.product_variants || [];
      const price = variants.length
        ? Math.min(...variants.map((v) => v.price || p.price))
        : p.price;
      const stock = variants.length
        ? variants.reduce((sum, v) => sum + (v.quantity || 0), 0)
        : p.quantity;
      const images = [...(p.product_images || [])]
        .sort((a, b) => a.position - b.position)
        .map((img) => img.url)
        .filter(Boolean);
      const category = Array.isArray(p.categories) ? p.categories[0]?.name : p.categories?.name;
      return { p, price, stock, images, category };
    })
    .filter(({ p, price, images }) => p.slug && price > 0 && images.length > 0);

  const itemXml = items
    .map(({ p, price, stock, images, category }) => {
      const description = productSeoDescription({
        name: p.name,
        description: p.description,
        seo_description: p.seo_description,
        price,
        categoryName: category,
      });
      const inStock = stock > 0 || !!p.continue_selling;
      const lines = [
        `<g:id>${xml(p.sku || p.id)}</g:id>`,
        `<g:title>${xml(p.name.trim().slice(0, 150))}</g:title>`,
        `<g:description>${xml(description)}</g:description>`,
        `<g:link>${xml(absoluteUrl(`/product/${p.slug}`))}</g:link>`,
        `<g:image_link>${xml(images[0])}</g:image_link>`,
        ...images.slice(1, 10).map((url) => `<g:additional_image_link>${xml(url)}</g:additional_image_link>`),
        `<g:availability>${inStock ? 'in_stock' : 'out_of_stock'}</g:availability>`,
        `<g:price>${price.toFixed(2)} GHS</g:price>`,
        `<g:condition>new</g:condition>`,
        category ? `<g:product_type>${xml(category.trim())}</g:product_type>` : '',
        p.brand ? `<g:brand>${xml(p.brand)}</g:brand>` : '',
        p.barcode ? `<g:gtin>${xml(p.barcode)}</g:gtin>` : '',
        // Without a brand or barcode Google needs to be told no identifier exists.
        !p.brand && !p.barcode ? '<g:identifier_exists>no</g:identifier_exists>' : '',
      ].filter(Boolean);
      return `<item>${lines.join('')}</item>`;
    })
    .join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>${xml(SITE_NAME)}</title>
<link>${xml(absoluteUrl('/'))}</link>
<description>${xml(DEFAULT_DESCRIPTION)}</description>
${itemXml}
</channel>
</rss>`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=3600',
    },
  });
}
