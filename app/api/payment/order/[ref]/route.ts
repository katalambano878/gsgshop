import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import { maskPhone } from '@/lib/payment-target';

/**
 * GET /api/payment/order/[ref] — what the /pay/[orderId] page needs to show
 * an unpaid order and start its payment. [ref] is the order number or the
 * row uuid. Returns amounts, status and first name only; the phone is masked
 * and no email, address or row id is returned.
 */

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF_RE = /^[A-Za-z0-9-]{1,80}$/;

export async function GET(req: Request, { params }: { params: Promise<{ ref: string }> }) {
    const rate = checkRateLimit(`pay-order:${getClientIdentifier(req)}`, RATE_LIMITS.lookup ?? RATE_LIMITS.payment);
    if (!rate.success) {
        return NextResponse.json({ success: false, message: 'Too many requests' }, { status: 429 });
    }

    const { ref } = await params;
    const key = decodeURIComponent(ref || '').trim();
    if (!key || !REF_RE.test(key)) {
        return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
    }

    const q = supabaseAdmin
        .from('orders')
        .select('order_number, subtotal, shipping_total, discount_total, total, status, payment_status, payment_method, metadata, shipping_address, phone');
    const { data, error } = UUID_RE.test(key) ? await q.eq('id', key).maybeSingle() : await q.eq('order_number', key).maybeSingle();

    if (error || !data) {
        return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
    }

    const meta = (data.metadata as Record<string, any> | null) ?? {};
    const address = (data.shipping_address as Record<string, any> | null) ?? {};

    return NextResponse.json(
        {
            success: true,
            order: {
                order_number: data.order_number,
                subtotal: Number(data.subtotal) || 0,
                shipping_total: Number(data.shipping_total) || 0,
                discount_total: Number(data.discount_total) || 0,
                total: Number(data.total) || 0,
                status: data.status,
                payment_status: data.payment_status,
                payment_method: data.payment_method,
                phone_masked: maskPhone(data.phone || address.phone),
                metadata: {
                    first_name: meta.first_name || address.firstName || null,
                    payment_method: meta.payment_method ?? null,
                },
            },
        },
        { headers: { 'Cache-Control': 'no-store' } },
    );
}
