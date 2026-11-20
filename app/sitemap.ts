import { MetadataRoute } from 'next';
import { createServerSupabase } from '@/lib/supabase-server';
import { absoluteMediaUrl } from '@/lib/media-url';
import { getShopperBaseUrl } from '@/lib/site-urls';
import { absoluteUrl, STORE_STATIC_ROUTES } from '@/lib/seo';

// Built per request from the live catalogue (never at build time: the
// build has no database).
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const shopperUrl = getShopperBaseUrl();
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = STORE_STATIC_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  const shopperPages: MetadataRoute.Sitemap = [
    { url: shopperUrl, lastModified: now, changeFrequency: 'weekly', priority: 0.95 },
    { url: `${shopperUrl}/how-it-works`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${shopperUrl}/shopping-list`, lastModified: now, changeFrequency: 'weekly', priority: 0.85 },
    { url: `${shopperUrl}/track`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${shopperUrl}/faqs`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${shopperUrl}/customer-experience`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${shopperUrl}/privacy-policy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${shopperUrl}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${shopperUrl}/cookies`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];

  const blogPages: MetadataRoute.Sitemap = ['1', '2', '3'].map((id) => ({
    url: absoluteUrl(`/blog/${id}`),
    lastModified: now,
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }));

  let productPages: MetadataRoute.Sitemap = [];
  let categoryPages: MetadataRoute.Sitemap = [];

  try {
    const supabase = createServerSupabase('anon');

    const { data: products } = await supabase
      .from('products')
      .select('slug, updated_at, product_images(url, position)')
      .eq('status', 'active');

    if (products) {
      productPages = products.map((product: any) => {
        const images = (product.product_images || [])
          .sort((a: { position: number }, b: { position: number }) => a.position - b.position)
          .map((img: { url: string }) => img.url)
          .filter(Boolean)
          .map((url: string) => absoluteMediaUrl(url));

        return {
          url: absoluteUrl(`/product/${product.slug}`),
          lastModified: product.updated_at ? new Date(product.updated_at) : now,
          changeFrequency: 'weekly' as const,
          priority: 0.8,
          ...(images.length ? { images } : {}),
        };
      });
    }

    const { data: categories } = await supabase
      .from('categories')
      .select('slug, updated_at')
      .eq('status', 'active');

    if (categories) {
      categoryPages = categories.map((category: any) => ({
        url: absoluteUrl(`/shop?category=${category.slug}`),
        lastModified: category.updated_at ? new Date(category.updated_at) : now,
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      }));
    }

  } catch (error) {
    console.error('Error generating sitemap:', error);
  }

  return [...staticPages, ...shopperPages, ...productPages, ...categoryPages, ...blogPages];
}
