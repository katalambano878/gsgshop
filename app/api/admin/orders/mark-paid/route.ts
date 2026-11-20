import { NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/db/pool';
import { checkRateLimit } from '@/lib/rate-limit';
import { sendOrderConfirmation } from '@/lib/notifications';
import { notifyWaPaymentConfirmed } from '@/lib/wa-payment-webhook';
import { HttpError, errorResponse, gate, readJson, str } from '@/app/api/admin/_lib/shared';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Staff "Mark as paid" (admin or staff), for money received outside the
 * gateways (cash on collection, a MoMo payment checked by hand).
 *
 * POST { orderNumber, reference? }
 * 200 { success: true, order: { id, order_number, status, payment_status }, alreadyDone?: true }
 * 404 unknown order, 409 cancelled/refunded order, 400 bad input.
 *
 * In one transaction: locks the order, calls mark_order_paid (stock and
 * coupon counted once), records who marked it, writes order_status_history
 * and refreshes the customer's totals. Afterwards the usual paid
 * confirmation (SMS/WhatsApp) is sent once.
 */

const ORDER_REF_RE = /^[A-Z0-9][A-Z0-9-]{2,63}$/i;
const LIMIT = { maxRequests: 60, windowSeconds: 60 };

export async function POST(request: Request) {
  const g = await gate(request, ['admin', 'staff']);
  if (g.response) return g.response;
  const actor = g.actor;

  if (!checkRateLimit(`admin-mark-paid:${actor.id}`, LIMIT).success) {
    return NextResponse.json({ error: 'Too many requests. Wait a moment and try again.' }, { status: 429 });
  }

  const body = await readJson(request);
  const orderNumber = str(body?.orderNumber, 64).toUpperCase();
  if (!ORDER_REF_RE.test(orderNumber)) {
    return NextResponse.json({ error: 'Invalid order number' }, { status: 400 });
  }
  const suppliedRef = str(body?.reference, 120);

  try {
    const result = await withTransaction(async () => {
      const { rows } = await query<any>(
        `SELECT id, order_number, status::text AS status, payment_status::text AS payment_status, metadata
           FROM orders WHERE order_number = $1 FOR UPDATE`,
        [orderNumber],
      );
      const existing = rows[0];
      if (!existing) throw new HttpError(404, 'Order not found');
      if (existing.payment_status === 'paid') {
        return {
          order: { id: existing.id, order_number: existing.order_number, status: existing.status, payment_status: existing.payment_status },
          alreadyDone: true,
          paid: null as any,
        };
      }
      if (['cancelled', 'refunded'].includes(existing.status) || ['refunded', 'partially_refunded'].includes(existing.payment_status)) {
        throw new HttpError(409, 'This order is cancelled or refunded, so it cannot be marked paid.');
      }

      const storedRef = typeof existing.metadata?.moolre_reference === 'string' ? existing.metadata.moolre_reference.trim() : '';
      const ref = storedRef || (suppliedRef ? `manual-${suppliedRef}` : `manual-${actor.id.slice(0, 8)}-${Date.now()}`);

      const { rows: paidRows } = await query<{ j: any }>(`SELECT public.mark_order_paid($1, $2) AS j`, [orderNumber, ref]);
      const paid = paidRows[0]?.j;
      if (!paid || paid.payment_status !== 'paid') throw new Error('mark_order_paid did not mark the order paid');

      await query(
        `UPDATE orders
            SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb, updated_at = now()
          WHERE id = $1`,
        [
          existing.id,
          JSON.stringify({
            marked_paid_by: actor.id,
            marked_paid_at: new Date().toISOString(),
            ...(suppliedRef ? { manual_payment_reference: suppliedRef } : {}),
          }),
        ],
      );
      await query(
        `INSERT INTO order_status_history (order_id, status, notes, created_by)
         VALUES ($1, $2::order_status, $3, $4)`,
        [existing.id, paid.status || 'processing', `Marked paid by staff${suppliedRef ? ` (ref ${suppliedRef})` : ''}`, actor.id],
      );

      await query('SAVEPOINT mark_paid_stats');
      try {
        await query('SELECT public.recompute_customer_stats_for_order($1)', [existing.id]);
        await query('RELEASE SAVEPOINT mark_paid_stats');
      } catch (statsErr: any) {
        await query('ROLLBACK TO SAVEPOINT mark_paid_stats');
        console.error('[admin/orders/mark-paid] customer totals not refreshed:', statsErr?.message);
      }

      return {
        order: { id: paid.id, order_number: paid.order_number, status: paid.status, payment_status: paid.payment_status },
        alreadyDone: false,
        paid,
      };
    });

    if (result.paid) {
      notifyWaPaymentConfirmed(result.paid);
      try {
        await sendOrderConfirmation(result.paid);
      } catch (notifyErr: any) {
        console.error('[admin/orders/mark-paid] confirmation failed:', notifyErr?.message);
      }
    }

    return NextResponse.json({
      success: true,
      order: result.order,
      ...(result.alreadyDone ? { alreadyDone: true } : {}),
    });
  } catch (err) {
    return errorResponse(err, 'Could not mark the order paid', 'admin/orders/mark-paid');
  }
}
