/**
 * Columns the product page reads, server and browser alike. Explicit so
 * cost prices (cost_per_item) never reach a page.
 */
export const PRODUCT_DETAIL_COLUMNS = `
  id, name, slug, description, short_description, price, compare_at_price, sku,
  quantity, track_quantity, continue_selling, category_id, brand, status,
  seo_title, seo_description, rating_avg, review_count, moq,
  categories(name, slug),
  product_variants(id, name, sku, price, compare_at_price, quantity, option1, option2, option3, image_url, metadata),
  product_images(url, position, alt_text)
`;

/** Columns for product cards (related products, shop, home). */
export const PRODUCT_CARD_COLUMNS =
  'id, name, slug, price, compare_at_price, quantity, track_quantity, continue_selling, status, moq, rating_avg, review_count, product_images(url, position), product_variants(id, name, price, quantity, option2)';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Escape JSON for a <script type="application/ld+json"> block. */
export function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
