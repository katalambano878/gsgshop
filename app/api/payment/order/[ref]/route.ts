import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';

/**
 * GET /api/payment/order/[ref] — what the /pay/[orderId] page needs to show
 * an unpaid order and start its payment.
 *
 * Guests can't read `orders` through the anon client (RLS), so the pay page
 * links sent over WhatsApp always showed "Order Not Found". This returns only
 * the amounts, status and first name — no email, phone or address.
 */

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, { params }: { params: Promise<{ ref: string }> }) {
    const rate = checkRateLimit(`pay-order:${getClientIdentifier(req)}`, RATE_LIMITS.payment);
    if (!rate.success) {
        return NextResponse.json({ success: false, message: 'Too many requests' }, { status: 429 });
    }

    const { ref } = await params;
    const key = decodeURIComponent(ref || '').trim();
    if (!key || key.length > 80) {
        return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
    }

    const query = supabaseAdmin
        .from('orders')
        .select('id, order_number, subtotal, shipping_total, discount_total, total, payment_status, payment_method, metadata, shipping_address');
    const { data, error } = UUID_RE.test(key)
        ? await query.eq('id', key).maybeSingle()
        : await query.eq('order_number', key).maybeSingle();

    if (error || !data) {
        return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
    }

    const meta = (data.metadata as Record<string, any> | null) ?? {};
    const address = (data.shipping_address as Record<string, any> | null) ?? {};

    return NextResponse.json({
        success: true,
        order: {
            order_number: data.order_number,
            subtotal: Number(data.subtotal) || 0,
            shipping_total: Number(data.shipping_total) || 0,
            discount_total: Number(data.discount_total) || 0,
            total: Number(data.total) || 0,
            payment_status: data.payment_status,
            payment_method: data.payment_method,
            metadata: {
                first_name: meta.first_name || address.firstName || null,
                payment_method: meta.payment_method ?? null,
            },
        },
    });
}
