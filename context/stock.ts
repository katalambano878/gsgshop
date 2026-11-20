/**
 * The shop's sellable-stock rule, shared by the shop grid, product page, cart,
 * checkout and wishlist (the server applies the same rule in /api/checkout).
 *
 * A product can be bought when it is active and stock is not tracked, or the
 * shop keeps selling at zero, or the available quantity is above zero. The
 * available quantity is the chosen variant's when the product has variants,
 * otherwise the product's own. Quantity is only capped when stock is tracked
 * and continue_selling is off.
 *
 * Plain module (no 'use client') so server components can use it too.
 */

/** Cap used when stock does not limit how many can be bought. */
export const UNLIMITED_STOCK = 999;

export type StockFlags = {
  status?: string | null;
  track_quantity?: boolean | null;
  continue_selling?: boolean | null;
};

/** True when stock does not limit sales for this product. */
export function stockIsUnlimited(product: StockFlags | null | undefined): boolean {
  return product?.track_quantity === false || product?.continue_selling === true;
}

/**
 * How many units can be sold, given the relevant stock count (the variant's
 * when a variant is chosen, else the product's).
 */
export function sellableStock(stock: number | null | undefined, product: StockFlags | null | undefined): number {
  if (product?.status && product.status !== 'active') return 0;
  if (stockIsUnlimited(product)) return UNLIMITED_STOCK;
  return Math.max(0, Math.floor(Number(stock) || 0));
}

type VariantStock = { quantity?: number | null };

/**
 * Whether the product can be bought at all. For a product with variants this
 * is true when any variant has sellable stock (the shopper still has to pick
 * one); without variants it uses the product's own quantity.
 */
export function isPurchasable(
  product: (StockFlags & { quantity?: number | null }) | null | undefined,
  variants?: VariantStock[] | null,
): boolean {
  if (!product) return false;
  if (product.status && product.status !== 'active') return false;
  if (stockIsUnlimited(product)) return true;
  if (variants && variants.length > 0) {
    return variants.some((v) => (Number(v.quantity) || 0) > 0);
  }
  return (Number(product.quantity) || 0) > 0;
}

/** Total stock shown for a product: the variants' sum when it has variants. */
export function stockCount(
  product: { quantity?: number | null } | null | undefined,
  variants?: VariantStock[] | null,
): number {
  if (variants && variants.length > 0) {
    return variants.reduce((sum, v) => sum + Math.max(0, Number(v.quantity) || 0), 0);
  }
  return Math.max(0, Number(product?.quantity) || 0);
}
