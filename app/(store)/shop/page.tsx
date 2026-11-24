import type { Metadata } from 'next';
import { createServerSupabase } from '@/lib/supabase-server';
import ShopClient from './ShopClient';
import { createPageMetadata } from '@/lib/seo';
import {
  fetchShopCatalog,
  normalizeCategorySlug,
  normalizeSort,
} from '@/lib/shop-catalog';

// Never prerender an empty catalogue at build time (no database during build).
export const dynamic = 'force-dynamic';

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
    const supabase = createServerSupabase('anon');
    const { data: category } = await supabase
      .from('categories')
      .select('name, description')
      .eq('slug', normalizeCategorySlug(categorySlug))
      .eq('status', 'active')
      .maybeSingle();

    if (category) {
      const name = category.name.trim();
      return createPageMetadata({
        title: `${name}: Buy Online in Ghana`,
        description:
          category.description?.trim() ||
          `Shop ${name} online at GSG Convenience Goods & More. Pickup in Accra or delivery in and around Accra.`,
        path: `/shop?category=${encodeURIComponent(normalizeCategorySlug(categorySlug))}`,
        keywords: [name, `buy ${name} Ghana`, `${name} Accra`],
      });
    }
  }

  return createPageMetadata({
    title: 'Shop All Products',
    description:
      'Browse groceries, household essentials, personal care and other everyday convenience goods. Filter by category and price. Pickup in Accra or delivery in and around Accra.',
    path: '/shop',
    keywords: ['shop online Ghana', 'GSG products', 'buy groceries Accra', 'online store'],
  });
}

export default async function ShopPage({ searchParams }: Props) {
  const params = await searchParams;
  const categorySlug = normalizeCategorySlug(firstParam(params.category));
  const search = (firstParam(params.search) || '').trim();
  const sortBy = normalizeSort(firstParam(params.sort));

  let catalog;
  try {
    catalog = await fetchShopCatalog({ categorySlug, search, sortBy, page: 1 });
  } catch (err) {
    console.error('Shop catalogue SSR failed:', err);
    catalog = {
      products: [],
      total: 0,
      categories: undefined,
      categorySlug,
      search,
      sortBy,
      page: 1,
    };
  }

  return (
    <ShopClient
      initialProducts={catalog.products}
      initialTotal={catalog.total}
      initialCategories={catalog.categories}
      initialQuery={{ category: catalog.categorySlug, search: catalog.search, sort: catalog.sortBy }}
    />
  );
}
