import type { Metadata } from 'next';
import { createClient } from '@supabase/supabase-js';
import ShopClient from './ShopClient';
import { createPageMetadata } from '@/lib/seo';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Each category gets its own title, description and canonical URL, so Google
// treats /shop?category=rice-grains as a page of its own instead of folding
// every category into /shop. Sort, page and search variations stay out.
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  const categorySlug = firstParam(params.category);
  const search = firstParam(params.search);

  if (search) {
    return createPageMetadata({
      title: `Search results for "${search}"`,
      path: '/shop',
      noindex: true,
    });
  }

  if (categorySlug && categorySlug !== 'all') {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: category } = await supabase
      .from('categories')
      .select('name, description')
      .eq('slug', categorySlug)
      .eq('status', 'active')
      .maybeSingle();

    if (category) {
      const name = category.name.trim();
      return createPageMetadata({
        title: `${name}: Buy Online in Ghana`,
        description:
          category.description?.trim() ||
          `Shop ${name} online at GSG Convenience Goods & More. Order in Ghana with pickup in Accra or delivery nationwide.`,
        path: `/shop?category=${encodeURIComponent(categorySlug)}`,
        keywords: [name, `buy ${name} Ghana`, `${name} Accra`],
      });
    }
  }

  return createPageMetadata({
    title: 'Shop All Products',
    description:
      'Browse groceries, household essentials, personal care, stationery, electronics and fashion. Filter by category, price and rating. Shop online with delivery across Ghana.',
    path: '/shop',
    keywords: ['shop online Ghana', 'GSG products', 'buy groceries Accra', 'online store'],
  });
}

export default function ShopPage() {
  return <ShopClient />;
}
