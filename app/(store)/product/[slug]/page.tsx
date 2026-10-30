import { Metadata } from 'next';
import { createClient } from '@supabase/supabase-js';
import ProductDetailClient from './ProductDetailClient';
import {
  absoluteUrl,
  createPageMetadata,
  generateBreadcrumbSchema,
  generateProductSchema,
  productSeoDescription,
} from '@/lib/seo';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

type Props = {
  params: Promise<{ slug: string }>;
};

function resolveCategory(categories: { name: string; slug: string } | { name: string; slug: string }[] | null | undefined) {
  if (!categories) return { name: 'Shop', slug: 'shop' };
  if (Array.isArray(categories)) return categories[0] || { name: 'Shop', slug: 'shop' };
  return categories;
}

// Same shape ProductDetailClient fetches, so the server can hand the product
// over and the first HTML Google receives already shows name, price and photos.
async function fetchProduct(slug: string) {
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);

  let query = supabase
    .from('products')
    .select(`
      *,
      categories(name, slug),
      product_variants(*),
      product_images(url, position, alt_text)
    `)
    .eq('status', 'active');

  if (isUUID) {
    query = query.or(`id.eq.${slug},slug.eq.${slug}`);
  } else {
    query = query.eq('slug', slug);
  }

  const { data } = await query.single();
  return data;
}

function sortedImageUrls(product: { product_images?: { url: string; position: number }[] | null }): string[] {
  return [...(product.product_images || [])]
    .sort((a, b) => a.position - b.position)
    .map((img) => img.url)
    .filter(Boolean);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await fetchProduct(slug);

  if (!product) {
    return {
      title: 'Product Not Found',
      description: 'The requested product could not be found.',
      robots: { index: false, follow: false },
    };
  }

  const mainImage = sortedImageUrls(product)[0];
  const category = resolveCategory(product.categories);
  const description = productSeoDescription({
    name: product.name,
    description: product.description,
    seo_description: product.seo_description,
    price: product.price,
    categoryName: category.name,
  });

  // The layout's title template adds the store name, so drop it if an admin
  // already typed it into the product's SEO title.
  const seoTitle = (product.seo_title || '').split('|')[0].trim();

  return createPageMetadata({
    title: seoTitle || product.name,
    description,
    path: `/product/${product.slug || slug}`,
    keywords: [
      product.name,
      category.name || '',
      product.brand || '',
      `buy ${product.name} Ghana`,
      `${product.name} price in Ghana`,
      'buy online Ghana',
      'GSG shop',
    ].filter(Boolean),
    ogImage: mainImage || '/og-image.png',
  });
}

export default async function ProductDetailPage({ params }: Props) {
  const { slug } = await params;
  const product = await fetchProduct(slug);

  if (!product) {
    return <ProductDetailClient slug={slug} />;
  }

  const images = sortedImageUrls(product);
  const variants: { price: number; quantity: number }[] = product.product_variants || [];
  const hasVariants = variants.length > 0;
  const minVariantPrice = hasVariants
    ? Math.min(...variants.map((v) => v.price || product.price))
    : product.price;
  const totalVariantStock = hasVariants
    ? variants.reduce((sum, v) => sum + (v.quantity || 0), 0)
    : 0;
  const effectiveStock = hasVariants ? totalVariantStock : product.quantity;
  const category = resolveCategory(product.categories);
  const categoryName = category.name || 'Shop';
  const categorySlug = category.slug || 'shop';
  const productSlug = product.slug || slug;
  const description = productSeoDescription({
    name: product.name,
    description: product.description,
    seo_description: product.seo_description,
    price: hasVariants ? minVariantPrice : product.price,
    categoryName,
  });

  const productSchema = generateProductSchema({
    name: product.name,
    description,
    image: images.length ? images : absoluteUrl('/og-image.png'),
    price: hasVariants ? minVariantPrice : product.price,
    currency: 'GHS',
    sku: product.sku || product.id,
    slug: productSlug,
    rating: product.rating_avg || undefined,
    reviewCount: product.review_count || undefined,
    availability: effectiveStock > 0 || product.continue_selling ? 'in_stock' : 'out_of_stock',
    brand: product.brand || undefined,
    category: categoryName,
  });

  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: 'Home', url: absoluteUrl('/') },
    { name: 'Shop', url: absoluteUrl('/shop') },
    { name: categoryName, url: absoluteUrl(`/shop?category=${categorySlug}`) },
    { name: product.name, url: absoluteUrl(`/product/${productSlug}`) },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <ProductDetailClient slug={slug} initialProduct={product} />
    </>
  );
}
