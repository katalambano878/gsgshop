import { createServerSupabase } from '@/lib/supabase-server';
import {
  ALL_CATEGORY,
  formatShopProduct,
  descendantCategoryIds,
  normalizeCategorySlug,
  normalizeSort,
  SHOP_PAGE_SIZE,
  type ShopCatalogQuery,
  type ShopCategory,
  type ShopProductCard,
  type ShopSort,
} from '@/lib/shop-catalog-shared';

export {
  ALL_CATEGORY,
  SHOP_PAGE_SIZE,
  SHOP_SORTS,
  descendantCategoryIds,
  formatShopProduct,
  normalizeCategorySlug,
  normalizeSort,
  type ShopCatalogQuery,
  type ShopCategory,
  type ShopProductCard,
  type ShopSort,
} from '@/lib/shop-catalog-shared';

const PRODUCT_SELECT = `
  id, name, slug, price, compare_at_price, quantity, track_quantity, continue_selling, status, moq, category_id,
  categories!inner(name, slug),
  product_images!product_id(url, position),
  product_variants(id, name, price, quantity, option1, option2, image_url)
`;

export async function fetchShopCategories(): Promise<ShopCategory[]> {
  const supabase = createServerSupabase('anon');
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, slug, image_url, parent_id, position, metadata')
    .eq('status', 'active')
    .order('position', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new Error(`Category lookup failed: ${error.message || error}`);
  return [ALL_CATEGORY, ...((data || []) as ShopCategory[])];
}

export async function fetchShopCatalog(query: ShopCatalogQuery = {}): Promise<{
  products: ShopProductCard[];
  total: number;
  categories: ShopCategory[];
  categorySlug: string;
  search: string;
  sortBy: ShopSort;
  page: number;
}> {
  const categorySlug = normalizeCategorySlug(query.categorySlug);
  const search = (query.search || '').trim();
  const sortBy = normalizeSort(query.sortBy);
  const page = Math.max(1, query.page || 1);
  const categories = await fetchShopCategories();
  const supabase = createServerSupabase('anon');

  let q = supabase
    .from('products')
    .select(PRODUCT_SELECT, { count: 'exact' })
    .eq('status', 'active')
    .order('position', { foreignTable: 'product_images', ascending: true });

  if (search) {
    q = q.ilike('name', `%${search}%`);
  }

  if (categorySlug !== 'all') {
    const categoryObj = categories.find((c) => c.slug === categorySlug);
    if (categoryObj && categoryObj.id !== 'all') {
      q = q.in('category_id', descendantCategoryIds(categories, categoryObj));
    } else {
      // Unknown / inactive slug — empty result, not the full catalogue.
      q = q.eq('category_id', '00000000-0000-0000-0000-000000000000');
    }
  }

  switch (sortBy) {
    case 'price-low':
      q = q.order('price', { ascending: true });
      break;
    case 'price-high':
      q = q.order('price', { ascending: false });
      break;
    default:
      q = q.order('created_at', { ascending: false });
      break;
  }

  const from = (page - 1) * SHOP_PAGE_SIZE;
  const to = from + SHOP_PAGE_SIZE - 1;
  q = q.range(from, to);

  const { data, count, error } = await q;
  if (error) throw new Error(`Product lookup failed: ${error.message || error}`);

  return {
    products: (data || []).map(formatShopProduct),
    total: count || 0,
    categories,
    categorySlug,
    search,
    sortBy,
    page,
  };
}
