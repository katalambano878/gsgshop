import { NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/db/pool';
import { checkRateLimit } from '@/lib/rate-limit';
import { HttpError, UUID_RE, errorResponse, gate, readJson, str } from '@/app/api/admin/_lib/shared';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Change stock for one product or variant (admin or staff): restock, count
 * correction, damaged goods, CSV import (one call per row).
 *
 * POST { productId, variantId?, delta?: int, setTo?: int, reason? }  (exactly one of delta / setTo)
 * 200 { success: true, quantity, previous, productQuantity }
 *   quantity: the new stock of the variant (or of the product when no variantId)
 *   productQuantity: the product's stock afterwards (re-summed from variants when it has them)
 * 400 bad input or a result below 0; 404 unknown product/variant.
 *
 * Atomic (row locked) and recorded in audit_logs with before/after.
 * A product that has variants must be adjusted per variant.
 */

const LIMIT = { maxRequests: 300, windowSeconds: 60 };
const MAX_QTY = 1_000_000;

export async function POST(request: Request) {
  const g = await gate(request, ['admin', 'staff']);
  if (g.response) return g.response;
  const actor = g.actor;

  if (!checkRateLimit(`admin-inventory:${actor.id}`, LIMIT).success) {
    return NextResponse.json({ error: 'Too many stock changes in a minute. Wait a moment and try again.' }, { status: 429 });
  }

  const body = await readJson(request);
  const productId = str(body?.productId, 40);
  const variantId = body?.variantId ? str(body.variantId, 40) : null;
  if (!UUID_RE.test(productId) || (variantId !== null && !UUID_RE.test(variantId))) {
    return NextResponse.json({ error: 'Invalid product' }, { status: 400 });
  }
  const hasDelta = body?.delta !== undefined && body?.delta !== null && body?.delta !== '';
  const hasSet = body?.setTo !== undefined && body?.setTo !== null && body?.setTo !== '';
  if (hasDelta === hasSet) {
    return NextResponse.json({ error: 'Send either delta or setTo' }, { status: 400 });
  }
  const amount = Number(hasDelta ? body.delta : body.setTo);
  if (!Number.isInteger(amount) || Math.abs(amount) > MAX_QTY || (hasSet && amount < 0)) {
    return NextResponse.json({ error: 'Stock must be a whole number (setTo 0 or more)' }, { status: 400 });
  }
  if (hasDelta && amount === 0) return NextResponse.json({ error: 'The change is 0' }, { status: 400 });
  const reason = str(body?.reason, 300);

  try {
    const result = await withTransaction(async () => {
      const { rows: products } = await query<{ id: string; name: string; quantity: number }>(
        `SELECT id, name, quantity FROM products WHERE id = $1 FOR UPDATE`,
        [productId],
      );
      const product = products[0];
      if (!product) throw new HttpError(404, 'Product not found');

      let previous: number;
      let next: number;
      let label = product.name;

      if (variantId) {
        const { rows } = await query<{ id: string; name: string; quantity: number | null }>(
          `SELECT id, name, quantity FROM product_variants WHERE id = $1 AND product_id = $2 FOR UPDATE`,
          [variantId, productId],
        );
        const variant = rows[0];
        if (!variant) throw new HttpError(404, 'Variant not found');
        previous = Number(variant.quantity) || 0;
        next = hasDelta ? previous + amount : amount;
        if (next < 0) throw new HttpError(400, `Only ${previous} in stock, so ${Math.abs(amount)} cannot be taken off.`);
        if (next > MAX_QTY) throw new HttpError(400, 'That is more stock than the system allows');
        await query(`UPDATE product_variants SET quantity = $2, updated_at = now() WHERE id = $1`, [variantId, next]);
        await query(
          `UPDATE products SET quantity = (SELECT COALESCE(SUM(quantity), 0)::int FROM product_variants WHERE product_id = $1),
                               updated_at = now()
            WHERE id = $1`,
          [productId],
        );
        label = `${product.name} (${variant.name})`;
      } else {
        const { rows: v } = await query(`SELECT 1 FROM product_variants WHERE product_id = $1 LIMIT 1`, [productId]);
        if (v[0]) throw new HttpError(400, 'This product has options (sizes, colours…). Change the stock of each option instead.');
        previous = Number(product.quantity) || 0;
        next = hasDelta ? previous + amount : amount;
        if (next < 0) throw new HttpError(400, `Only ${previous} in stock, so ${Math.abs(amount)} cannot be taken off.`);
        if (next > MAX_QTY) throw new HttpError(400, 'That is more stock than the system allows');
        await query(`UPDATE products SET quantity = $2, updated_at = now() WHERE id = $1`, [productId, next]);
      }

      const { rows: after } = await query<{ quantity: number }>(`SELECT quantity FROM products WHERE id = $1`, [productId]);

      await query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
         VALUES ($1, 'inventory.adjust', $2, $3, $4::jsonb)`,
        [
          actor.id,
          variantId ? 'product_variant' : 'product',
          variantId || productId,
          JSON.stringify({ product_id: productId, variant_id: variantId, item: label, previous, quantity: next, delta: next - previous, reason: reason || null }),
        ],
      );

      return { quantity: next, previous, productQuantity: Number(after[0]?.quantity) || 0 };
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return errorResponse(err, 'The stock was not changed. Try again.', 'admin/inventory/adjust');
  }
}
