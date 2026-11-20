import { NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/db/pool';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';
import { EMAIL_RE, emailsMatch, phonesMatch } from '@/app/api/storefront/_lib/mask';
import { phoneLast9 } from '@/lib/phone';
import { RETURN_REASONS } from '@/app/api/storefront/_lib/return-reasons';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Report a problem with an order (returns form).
 *
 * POST { orderNumber, email? | phone?, lookupOnly?: true, reason, description }
 *   lookupOnly: true → checks the order and the contact only:
 *     200 { order: { order_number, created_at, status, items: [{ product_name, variant_name, quantity }] } }
 *   otherwise → creates a pending return_requests row:
 *     200 { reference: 'RET-XXXXXXXX' }
 *     or  { reference, duplicate: true } when the order already has an open request.
 * 400 bad input, 404 no matching order (wrong number or contact), 409 order
 * unpaid or cancelled, 429 rate-limited.
 *
 * The shop's rule is 24 hours after delivery. Late requests are still saved
 * (staff decide) with a note for staff saying how late they are. Nothing is
 * emailed: staff see the request in the dashboard and reply by SMS/WhatsApp.
 */

const IP_LIMIT = { maxRequests: 10, windowSeconds: 600 };
const ORDER_REF_RE = /^[A-Z0-9][A-Z0-9-]{2,63}$/i;
const RETURN_WINDOW_HOURS = 24;


function fail(message: string, status: number) {
    return NextResponse.json({ error: message }, { status });
}

/** RET- + first 8 characters of the request id, upper-case. */
function referenceFor(id: string): string {
    return `RET-${id.slice(0, 8).toUpperCase()}`;
}

const NOT_FOUND = 'We could not find an order with that order number and contact detail. Check both and try again.';
const SHOP_WHATSAPP = '+233 24 603 3792';

export async function POST(request: Request) {
    const ip = getClientIdentifier(request);
    if (!checkRateLimit(`returns:ip:${ip}`, IP_LIMIT).success) {
        return fail('Too many attempts. Please wait a few minutes and try again.', 429);
    }

    let body: any;
    try {
        body = await request.json();
    } catch {
        return fail('Invalid request.', 400);
    }

    const orderNumber = typeof body?.orderNumber === 'string' ? body.orderNumber.trim().toUpperCase() : '';
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
    const lookupOnly = body?.lookupOnly === true;

    if (!orderNumber || !ORDER_REF_RE.test(orderNumber)) return fail('Please enter your order number.', 400);
    if (!email && !phone) return fail('Enter the email or phone number used on the order.', 400);
    if (email && (email.length > 254 || !EMAIL_RE.test(email))) return fail('Please enter a valid email address.', 400);
    if (phone && !phoneLast9(phone)) return fail('Please enter a valid phone number.', 400);

    let reason = '';
    let description = '';
    if (!lookupOnly) {
        reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
        description = typeof body?.description === 'string' ? body.description.trim().slice(0, 2000) : '';
        if (!(RETURN_REASONS as readonly string[]).includes(reason)) return fail('Please choose a reason.', 400);
        if (description.length < 5) return fail('Please tell us which item and what happened.', 400);
    }

    try {
        const { rows } = await query<any>(
            `SELECT id, order_number, user_id, email, phone, shipping_address->>'phone' AS shipping_phone,
                    status::text AS status, payment_status::text AS payment_status, created_at
               FROM orders WHERE order_number = $1 LIMIT 1`,
            [orderNumber],
        );
        const order = rows[0];
        const contactOk =
            !!order &&
            ((!!email && emailsMatch(order.email, email)) ||
                (!!phone && (phonesMatch(order.phone, phone) || phonesMatch(order.shipping_phone, phone))));
        if (!order || !contactOk) return fail(NOT_FOUND, 404);

        if (order.status === 'cancelled') {
            return fail(`This order was cancelled, so there is nothing to return. If you think this is wrong, WhatsApp us on ${SHOP_WHATSAPP}.`, 409);
        }
        if (order.payment_status === 'pending' || order.payment_status === 'failed') {
            return fail(`This order has not been paid, so there is nothing to return. If you think this is wrong, WhatsApp us on ${SHOP_WHATSAPP}.`, 409);
        }

        const { rows: items } = await query<any>(
            `SELECT product_name, variant_name, quantity FROM order_items WHERE order_id = $1 ORDER BY created_at LIMIT 200`,
            [order.id],
        );

        if (lookupOnly) {
            return NextResponse.json({
                order: {
                    order_number: order.order_number,
                    created_at: order.created_at,
                    status: order.status,
                    items: items.map((i) => ({ product_name: i.product_name, variant_name: i.variant_name, quantity: i.quantity })),
                },
            });
        }

        const result = await withTransaction(async () => {
            // Two submits at once for one order must not create two requests.
            await query('SELECT pg_advisory_xact_lock(hashtext($1))', [`return-request:${order.id}`]);

            const { rows: open } = await query<{ id: string }>(
                `SELECT id FROM return_requests
                  WHERE order_id = $1 AND status IN ('pending', 'approved', 'processing')
                  ORDER BY created_at LIMIT 1`,
                [order.id],
            );
            if (open[0]) return { id: open[0].id, duplicate: true };

            // When was it delivered? Only used to tell staff how late a report is.
            const { rows: delivered } = await query<{ at: string }>(
                `SELECT max(created_at) AS at FROM order_status_history WHERE order_id = $1 AND status = 'delivered'`,
                [order.id],
            );
            let staffNote: string | null = null;
            const deliveredAt = delivered[0]?.at ? Date.parse(delivered[0].at) : NaN;
            if (Number.isFinite(deliveredAt)) {
                const hours = Math.floor((Date.now() - deliveredAt) / 3_600_000);
                if (hours > RETURN_WINDOW_HOURS) {
                    staffNote = `Reported about ${hours} hours after delivery (shop rule: within ${RETURN_WINDOW_HOURS} hours).`;
                }
            } else if (order.status !== 'delivered') {
                staffNote = `Order status was "${order.status}" (not marked delivered) when this was reported.`;
            }

            const { rows: saved } = await query<{ id: string }>(
                `INSERT INTO return_requests (order_id, user_id, reason, description, status, admin_notes)
                 VALUES ($1, $2, $3, $4, 'pending', $5)
                 RETURNING id`,
                [order.id, order.user_id || null, reason, description, staffNote],
            );
            return { id: saved[0].id, duplicate: false };
        });

        return NextResponse.json(
            result.duplicate
                ? { reference: referenceFor(result.id), duplicate: true }
                : { reference: referenceFor(result.id) },
        );
    } catch (err: any) {
        console.error('[storefront/returns] failed:', err?.message);
        return fail(`We could not save your request right now. Please try again, or WhatsApp us on ${SHOP_WHATSAPP}.`, 500);
    }
}
