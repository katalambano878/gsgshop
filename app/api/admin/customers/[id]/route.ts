import { NextResponse } from 'next/server';
import { query } from '@/lib/db/pool';
import { UUID_RE, errorResponse, gate } from '@/app/api/admin/_lib/shared';
import { phoneLast9 } from '@/lib/phone';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * One customer for the dashboard (admin or staff).
 *
 * GET /api/admin/customers/<customers.id>   (a profiles/user id also works: it finds customers.user_id)
 * 200 {
 *   customer: { id, email, phone, full_name, first_name, last_name, user_id, default_address, notes, tags,
 *               secondary_email, secondary_phone, created_at, updated_at, is_placeholder_email },
 *   orders: [{ id, order_number, status, payment_status, total, created_at, payment_method,
 *              shipping_method, item_count, pos_sale }],        // newest first, at most 200
 *   totals: { paidOrders, totalSpent, lastOrderAt }            // paid and not cancelled/refunded
 * }
 * 404 { error } when there is no such customer.
 *
 * Orders are matched by the customer's user id, email or secondary email, or
 * phone / secondary phone (last 9 digits).
 */

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const g = await gate(request, ['admin', 'staff']);
  if (g.response) return g.response;

  const { id } = await context.params;
  if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid customer id' }, { status: 400 });

  try {
    const { rows } = await query<any>(
      `SELECT id, email, phone, full_name, first_name, last_name, user_id, default_address, notes, tags,
              secondary_email, secondary_phone, created_at, updated_at
         FROM customers
        WHERE id = $1 OR user_id = $1
        ORDER BY (id = $1) DESC
        LIMIT 1`,
      [id],
    );
    const customer = rows[0];
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });

    const emails = [customer.email, customer.secondary_email]
      .filter((e) => typeof e === 'string' && e.trim())
      .map((e: string) => e.trim().toLowerCase());
    const phones = [phoneLast9(customer.phone), phoneLast9(customer.secondary_phone)].filter(Boolean);

    const { rows: orders } = await query<any>(
      `SELECT o.id, o.order_number, o.status::text AS status, o.payment_status::text AS payment_status,
              o.total, o.created_at, o.payment_method, o.shipping_method,
              (SELECT COALESCE(SUM(oi.quantity), 0)::int FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
              COALESCE((o.metadata->>'pos_sale')::boolean, false) AS pos_sale
         FROM orders o
        WHERE ($1::uuid IS NOT NULL AND o.user_id = $1::uuid)
           OR lower(o.email) = ANY($2::text[])
           OR (cardinality($3::text[]) > 0 AND (
                right(regexp_replace(coalesce(o.phone, ''), '\\D', '', 'g'), 9) = ANY($3::text[])
             OR right(regexp_replace(coalesce(o.shipping_address->>'phone', ''), '\\D', '', 'g'), 9) = ANY($3::text[])))
        ORDER BY o.created_at DESC
        LIMIT 500`,
      [customer.user_id || null, emails, phones],
    );

    let paidOrders = 0;
    let spentP = 0;
    let lastOrderAt: string | null = null;
    for (const o of orders) {
      if (o.payment_status === 'paid' && o.status !== 'cancelled' && o.status !== 'refunded') {
        paidOrders += 1;
        spentP += Math.round((Number(o.total) || 0) * 100);
        if (!lastOrderAt || o.created_at > lastOrderAt) lastOrderAt = o.created_at;
      }
    }

    const email = String(customer.email || '').toLowerCase();
    return NextResponse.json({
      customer: {
        ...customer,
        is_placeholder_email: /@(pos|store)\.local$/.test(email) || email.endsWith('@whatsapp.gsgbrands.com.gh'),
      },
      orders: orders.slice(0, 200).map((o) => ({ ...o, total: Number(o.total) || 0 })),
      totals: { paidOrders, totalSpent: spentP / 100, lastOrderAt },
    });
  } catch (err) {
    return errorResponse(err, 'Could not load this customer', 'admin/customers/[id]');
  }
}
