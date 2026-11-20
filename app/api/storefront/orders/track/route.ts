import { NextResponse } from 'next/server';
import { query } from '@/lib/db/pool';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';
import { EMAIL_RE, TRACKING_RE, emailsMatch, phonesMatch } from '@/app/api/storefront/_lib/mask';
import { phoneLast9 } from '@/lib/phone';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Order tracking for customers (guests included).
 *
 * POST { orderNumber, email?, phone? }
 *   orderNumber: the ORD-… order number or the SLI-… tracking number.
 *   email or phone: must match the order (phone compared on its last 9 digits).
 *
 * 200 { orders: [{ order_number, status, payment_status, subtotal, shipping_total,
 *        discount_total, total, created_at, shipping_method, tracking_number,
 *        items: [{ product_name, variant_name, quantity, unit_price, total_price, image }],
 *        status_history: [{ status, created_at }] }] }
 * No street address, email or phone is returned.
 * 400 when the number or a contact is missing; 404 when nothing matches
 * (same answer for a wrong number and a wrong contact); 429 when rate-limited.
 */

const IP_LIMIT = { maxRequests: 10, windowSeconds: 60 };
const ORDER_REF_RE = /^[A-Z0-9][A-Z0-9-]{2,63}$/i;

function fail(message: string, status: number, headers?: Record<string, string>) {
    return NextResponse.json({ error: message }, { status, headers });
}

function notFound() {
    return fail('No order found. Check your order number and the email or phone you used, then try again.', 404);
}

export async function POST(request: Request) {
    const rl = checkRateLimit(`track:${getClientIdentifier(request)}`, IP_LIMIT);
    if (!rl.success) {
        return fail('Too many requests. Please try again in a minute.', 429, { 'Retry-After': String(rl.resetIn) });
    }

    let body: any;
    try {
        body = await request.json();
    } catch {
        return fail('Invalid request', 400);
    }

    const ref = typeof body?.orderNumber === 'string' ? body.orderNumber.trim().toUpperCase() : '';
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';

    if (!ref || (!email && !phone)) {
        return fail('Enter your order number (or tracking number) and the email or phone number you ordered with.', 400);
    }
    if (!ORDER_REF_RE.test(ref)) return fail('Please check the order or tracking number.', 400);
    if (email && (email.length > 254 || !EMAIL_RE.test(email))) return fail('Please enter a valid email address.', 400);
    if (phone && !phoneLast9(phone)) return fail('Please enter a valid phone number.', 400);

    try {
        const { rows } = await query<any>(
            `SELECT id, order_number, status::text AS status, payment_status::text AS payment_status,
                    subtotal, shipping_total, discount_total, total, created_at, shipping_method,
                    email, phone, shipping_address->>'phone' AS shipping_phone,
                    metadata->>'tracking_number' AS tracking_number
               FROM orders
              WHERE ${TRACKING_RE.test(ref) ? `upper(metadata->>'tracking_number') = $1` : `order_number = $1`}
              ORDER BY created_at DESC
              LIMIT 5`,
            [ref],
        );

        const order = rows.find(
            (o) =>
                (!!email && emailsMatch(o.email, email)) ||
                (!!phone && (phonesMatch(o.phone, phone) || phonesMatch(o.shipping_phone, phone))),
        );
        if (!order) return notFound();

        const [{ rows: items }, { rows: history }] = await Promise.all([
            query<any>(
                `SELECT oi.product_name, oi.variant_name, oi.quantity, oi.unit_price, oi.total_price,
                        COALESCE(NULLIF(oi.metadata->>'image', ''),
                                 (SELECT pi.url FROM product_images pi
                                   WHERE pi.product_id = oi.product_id
                                   ORDER BY pi.position NULLS LAST, pi.created_at LIMIT 1)) AS image
                   FROM order_items oi
                  WHERE oi.order_id = $1
                  ORDER BY oi.created_at
                  LIMIT 200`,
                [order.id],
            ),
            query<any>(
                `SELECT status::text AS status, created_at
                   FROM order_status_history
                  WHERE order_id = $1
                  ORDER BY created_at
                  LIMIT 50`,
                [order.id],
            ),
        ]);

        return NextResponse.json({
            orders: [
                {
                    order_number: order.order_number,
                    status: order.status,
                    payment_status: order.payment_status,
                    subtotal: Number(order.subtotal) || 0,
                    shipping_total: Number(order.shipping_total) || 0,
                    discount_total: Number(order.discount_total) || 0,
                    total: Number(order.total) || 0,
                    created_at: order.created_at,
                    shipping_method: order.shipping_method,
                    tracking_number: order.tracking_number || null,
                    items: items.map((i) => ({
                        product_name: i.product_name,
                        variant_name: i.variant_name,
                        quantity: i.quantity,
                        unit_price: Number(i.unit_price) || 0,
                        total_price: Number(i.total_price) || 0,
                        image: i.image || null,
                    })),
                    status_history: history.map((h) => ({ status: h.status, created_at: h.created_at })),
                },
            ],
        });
    } catch (err: any) {
        console.error('[storefront/orders/track] failed:', err?.message);
        return fail('We could not look up your order right now. Please try again.', 500);
    }
}
