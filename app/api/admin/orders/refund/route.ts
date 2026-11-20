import { NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/db/pool';
import { checkRateLimit } from '@/lib/rate-limit';
import { HttpError, UUID_RE, errorResponse, gate, readJson } from '@/app/api/admin/_lib/shared';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Cancel or refund an order (admin or staff).
 *
 * POST { orderId: uuid, action: 'cancel' | 'refund' }
 * 200 { success: true, order: { id, order_number, status, payment_status }, stockRestored, alreadyDone? }
 * 404 unknown order; 409 refund of an unpaid order, or cancel of a refunded one.
 *
 * In one transaction:
 *  - status becomes 'cancelled' or 'refunded'; a refund sets payment_status 'refunded'
 *  - stock taken at payment (metadata.stock_reduced) goes back exactly once, the
 *    same way mark_order_paid took it (variant by id, else by name, else the
 *    product; products with variants are re-summed), and metadata.stock_restored
 *    is set so it can never run twice
 *  - the change is recorded in metadata.status_changes and order_status_history
 * Then the customer's totals are recomputed (paid, not cancelled/refunded orders only).
 * Card/MoMo money is not sent back by this route: staff return it through the
 * gateway or by hand; this records it.
 */

// Bulk actions call this once per order, so allow more than the payment limit.
const LIMIT = { maxRequests: 120, windowSeconds: 60 };

export async function POST(request: Request) {
  const g = await gate(request, ['admin', 'staff']);
  if (g.response) return g.response;
  const actor = g.actor;

  if (!checkRateLimit(`admin-order-refund:${actor.id}`, LIMIT).success) {
    return NextResponse.json({ error: 'Too many requests. Wait a moment and try again.' }, { status: 429 });
  }

  const body = await readJson(request);
  const orderId = body?.orderId;
  const action = body?.action;
  if (typeof orderId !== 'string' || !UUID_RE.test(orderId)) {
    return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });
  }
  if (action !== 'cancel' && action !== 'refund') {
    return NextResponse.json({ error: "action must be 'cancel' or 'refund'" }, { status: 400 });
  }

  let actorName = actor.email?.split('@')[0] || 'Staff';
  try {
    const { rows } = await query<{ full_name: string | null }>(`SELECT full_name FROM profiles WHERE id = $1`, [actor.id]);
    if (rows[0]?.full_name?.trim()) actorName = rows[0].full_name.trim();
  } catch {
    /* the name is cosmetic */
  }

  const newStatus = action === 'refund' ? 'refunded' : 'cancelled';

  try {
    const result = await withTransaction(async () => {
      const { rows } = await query<any>(
        `SELECT id, order_number, status::text AS status, payment_status::text AS payment_status, metadata
           FROM orders WHERE id = $1 FOR UPDATE`,
        [orderId],
      );
      const order = rows[0];
      if (!order) throw new HttpError(404, 'Order not found');

      const wasPaid = order.payment_status === 'paid' || order.payment_status === 'partially_refunded';
      const newPaymentStatus = action === 'refund' && wasPaid ? 'refunded' : order.payment_status;

      if (order.status === newStatus && order.payment_status === newPaymentStatus) {
        return {
          order: { id: order.id, order_number: order.order_number, status: order.status, payment_status: order.payment_status },
          stockRestored: false,
          alreadyDone: true,
        };
      }
      if (action === 'refund' && !wasPaid && order.payment_status !== 'refunded') {
        throw new HttpError(409, 'This order was never paid, so there is nothing to refund. Cancel it instead.');
      }
      if (order.status === 'refunded' && action === 'cancel') {
        throw new HttpError(409, 'This order is already refunded');
      }

      const meta = order.metadata && typeof order.metadata === 'object' ? order.metadata : {};
      const stockTaken = meta.stock_reduced != null && meta.stock_reduced !== false && !meta.stock_restored;
      let stockRestored = false;

      if (stockTaken) {
        // 1. Variants by variant_id
        await query(
          `UPDATE product_variants pv
              SET quantity = COALESCE(pv.quantity, 0) + oi.qty, updated_at = now()
             FROM (SELECT variant_id, SUM(quantity)::int AS qty
                     FROM order_items
                    WHERE order_id = $1 AND variant_id IS NOT NULL
                    GROUP BY variant_id) oi
            WHERE pv.id = oi.variant_id`,
          [orderId],
        );
        // 2. Variants by name when the item has no variant_id
        await query(
          `UPDATE product_variants pv
              SET quantity = COALESCE(pv.quantity, 0) + oi.qty, updated_at = now()
             FROM (SELECT product_id, variant_name, SUM(quantity)::int AS qty
                     FROM order_items
                    WHERE order_id = $1 AND variant_id IS NULL
                      AND product_id IS NOT NULL AND variant_name IS NOT NULL
                    GROUP BY product_id, variant_name) oi
            WHERE pv.product_id = oi.product_id AND pv.name = oi.variant_name`,
          [orderId],
        );
        // 3. Products without variants
        await query(
          `UPDATE products p
              SET quantity = COALESCE(p.quantity, 0) + oi.qty, updated_at = now()
             FROM (SELECT product_id, SUM(quantity)::int AS qty
                     FROM order_items
                    WHERE order_id = $1 AND product_id IS NOT NULL
                    GROUP BY product_id) oi
            WHERE p.id = oi.product_id
              AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id)`,
          [orderId],
        );
        // 4. Re-sum products that have variants
        await query(
          `UPDATE products p
              SET quantity = s.total, updated_at = now()
             FROM (SELECT v.product_id, COALESCE(SUM(v.quantity), 0)::int AS total
                     FROM product_variants v
                    WHERE v.product_id IN (SELECT DISTINCT product_id FROM order_items
                                            WHERE order_id = $1 AND product_id IS NOT NULL)
                    GROUP BY v.product_id) s
            WHERE p.id = s.product_id`,
          [orderId],
        );
        stockRestored = true;
      }

      const changedAt = new Date().toISOString();
      const changeEntry = {
        status: newStatus,
        changed_at: changedAt,
        changed_by_name: actorName,
        changed_by_id: actor.id,
      };
      const extra: Record<string, unknown> = {};
      if (stockRestored) {
        extra.stock_restored = true;
        extra.stock_restored_at = changedAt;
      }
      if (action === 'refund' && wasPaid) {
        extra.refunded_at = changedAt;
        extra.refunded_by = actorName;
      }

      const { rows: updated } = await query<any>(
        `UPDATE orders
            SET status = $2::order_status,
                payment_status = $3::payment_status,
                updated_at = now(),
                metadata = jsonb_set(
                    (COALESCE(metadata, '{}'::jsonb) - (CASE WHEN $6 THEN 'stock_reduced' ELSE '' END)) || $4::jsonb,
                    '{status_changes}',
                    COALESCE(
                      CASE WHEN jsonb_typeof(metadata->'status_changes') = 'array'
                           THEN metadata->'status_changes' END,
                      '[]'::jsonb
                    ) || jsonb_build_array($5::jsonb)
                )
          WHERE id = $1
          RETURNING id, order_number, status::text AS status, payment_status::text AS payment_status`,
        [orderId, newStatus, newPaymentStatus, JSON.stringify(extra), JSON.stringify(changeEntry), stockRestored],
      );

      const note =
        action === 'refund'
          ? `Refunded by ${actorName}${wasPaid ? ' (payment marked refunded)' : ''}${stockRestored ? '; stock returned' : ''}`
          : `Cancelled by ${actorName}${stockRestored ? '; stock returned' : ''}`;
      await query(
        `INSERT INTO order_status_history (order_id, status, notes, created_by)
         VALUES ($1, $2::order_status, $3, $4)`,
        [orderId, newStatus, note, actor.id],
      );

      return { order: updated[0], stockRestored, alreadyDone: false };
    });

    if (!result.alreadyDone) {
      try {
        await query('SELECT public.recompute_customer_stats_for_order($1)', [orderId]);
      } catch (statsErr: any) {
        console.error('[admin/orders/refund] customer totals not refreshed:', statsErr?.message);
      }
    }

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return errorResponse(err, 'Could not update the order', 'admin/orders/refund');
  }
}
