import { getColorHex, type ColorVariant } from '@/lib/color-hex';
import { isPurchasable, sellableStock, stockCount } from '@/context/stock';

export const SHOP_PAGE_SIZE = 9;
export const SHOP_SORTS = ['new', 'price-low', 'price-high'] as const;
export type ShopSort = (typeof SHOP_SORTS)[number];

const NO_IMAGE =
  "data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 100 100%27%3E%3Crect width=%27100%27 height=%27100%27 fill=%27%23f3f4f6%27/%3E%3C/svg%3E";

export const ALL_CATEGORY = { id: 'all', name: 'All Products', slug: 'all', parent_id: null as string | null };

export type ShopCategory = {
  id: string;
  name: string;
  slug?: string;
  parent_id?: string | null;
  [key: string]: unknown;
};

export type ShopCatalogQuery = {
  categorySlug?: string;
  search?: string;
  sortBy?: string;
  page?: number;
};

export type ShopProductCard = {
  id: string;
  slug: string;
  name: string;
  price: number;
  originalPrice?: number;
  image: string;
  badge?: string;
  inStock: boolean;
  maxStock: number;
  moq: number;
  category?: string;
  hasVariants: boolean;
  minVariantPrice?: number;
  colorVariants: ColorVariant[];
};


export function normalizeCategorySlug(slug?: string | null): string {
  const trimmed = (slug || '').trim();
  if (!trimmed || trimmed === 'all') return 'all';
  return trimmed.replace(/^\/+/, '') || 'all';
}

export function normalizeSort(sort?: string | null): ShopSort {
  return (SHOP_SORTS as readonly string[]).includes(sort || '') ? (sort as ShopSort) : 'new';
}

export function descendantCategoryIds(categories: ShopCategory[], selected: ShopCategory): string[] {
  const ids = [selected.id];
  let frontier = [selected.id];
  while (frontier.length) {
    const childIds = categories
      .filter((c) => c.parent_id && frontier.includes(c.parent_id as string))
      .map((c) => c.id)
      .filter((id) => !ids.includes(id));
    if (childIds.length === 0) break;
    ids.push(...childIds);
    frontier = childIds;
  }
  return ids;
}

export function formatShopProduct(p: any): ShopProductCard {
  const variants = p.product_variants || [];
  const hasVariants = variants.length > 0;
  const minVariantPrice = hasVariants ? Math.min(...variants.map((v: any) => v.price || p.price)) : undefined;
  const colorVariants: ColorVariant[] = [];
  const seenColors = new Set<string>();
  for (const v of variants) {
    const colorName = v.option2;
    if (colorName && !seenColors.has(colorName.toLowerCase().trim())) {
      const hex = getColorHex(colorName);
      if (hex) {
        seenColors.add(colorName.toLowerCase().trim());
        colorVariants.push({ name: colorName.trim(), hex });
      }
    }
  }
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    price: p.price,
    originalPrice: p.compare_at_price > p.price ? p.compare_at_price : undefined,
    image: p.product_images?.[0]?.url || NO_IMAGE,
    badge: p.compare_at_price > p.price ? 'Sale' : undefined,
    inStock: isPurchasable(p, variants),
    maxStock: sellableStock(stockCount(p, variants), p),
    moq: p.moq || 1,
    category: p.categories?.name,
    hasVariants,
    minVariantPrice,
    colorVariants,
  };
}
