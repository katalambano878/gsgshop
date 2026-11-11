import { absoluteUrl, productSeoDescription, SITE_NAME } from '@/lib/seo';

/**
 * One product → one Meta catalogue item. Shared by the public CSV feed
 * (/feed/meta.csv) and the live sync to the catalogue (Admin → Meta &
 * WhatsApp), so both always describe a product the same way.
 *
 * id is the product SKU and must never change: the Meta Pixel sends the same
 * value as content_ids (lib/meta-pixel.ts). Meta rejects items without a price
 * or an image, so those products are not listed (same rule as the Google
 * Merchant feed).
 */

export const META_PRODUCT_SELECT =
    'id, name, slug, status, description, seo_description, price, quantity, continue_selling, sku, brand, categories(name), product_images(url, position), product_variants(price, quantity)';

export type MetaSourceProduct = {
    id: string;
    name: string;
    slug: string;
    status?: string | null;
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

export type MetaItem = {
    id: string;
    title: string;
    description: string;
    availability: 'in stock' | 'out of stock';
    condition: 'new';
    price: string;
    link: string;
    image_link: string;
    brand: string;
};

export const META_COLUMNS: (keyof MetaItem)[] = [
    'id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand',
];

/** The catalogue id for a product (its SKU, falling back to the product id). */
export function metaItemId(p: Pick<MetaSourceProduct, 'id' | 'sku'>): string {
    return p.sku || p.id;
}

/** Returns null when the product can't be listed (inactive, no price or no photo). */
export function toMetaItem(p: MetaSourceProduct): MetaItem | null {
    if (p.status && p.status !== 'active') return null;
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
    if (!p.slug || !(price > 0) || !image) return null;
    const category = Array.isArray(p.categories) ? p.categories[0]?.name : p.categories?.name;
    return {
        id: metaItemId(p),
        title: p.name.trim().slice(0, 150),
        description: productSeoDescription({
            name: p.name,
            description: p.description,
            seo_description: p.seo_description,
            price,
            categoryName: category,
        }).slice(0, 5000),
        availability: stock > 0 || p.continue_selling ? 'in stock' : 'out of stock',
        condition: 'new',
        price: `${price.toFixed(2)} GHS`,
        link: absoluteUrl(`/product/${p.slug}`),
        image_link: image,
        // Meta requires a brand; until it's filled in admin, use the store name.
        brand: p.brand?.trim() || SITE_NAME,
    };
}
