import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import { isPlaceholderEmail } from '@/lib/placeholder-email';
import { maskEmail, maskPhone } from '@/lib/payment-target';

/**
 * GET /api/payment/order/[ref]/receipt — what /order-success shows a guest.
 * Items, totals and status for the order number; contact details only masked
 * (first name, city and region; phone and email masked; no street address).
 * The old `?reference=` full-details mode is gone.
 */

export const dynamic = 'force-dynamic';

const REF_RE = /^[A-Za-z0-9-]{1,80}$/;

export async function GET(req: Request, { params }: { params: Promise<{ ref: string }> }) {
    const rate = checkRateLimit(`order-receipt:${getClientIdentifier(req)}`, RATE_LIMITS.lookup ?? RATE_LIMITS.payment);
    if (!rate.success) {
        return NextResponse.json({ success: false, message: 'Too many requests' }, { status: 429 });
    }

    const { ref } = await params;
    const key = decodeURIComponent(ref || '').trim();
    if (!key || !REF_RE.test(key)) {
        return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin
        .from('orders')
        .select('order_number, created_at, subtotal, shipping_total, discount_total, total, status, payment_status, payment_method, shipping_method, shipping_address, phone, email, metadata, order_items (id, product_name, variant_name, sku, quantity, unit_price, total_price, metadata, products (sku))')
        .eq('order_number', key)
        .maybeSingle();

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
                created_at: data.created_at,
                subtotal: Number(data.subtotal) || 0,
                shipping_total: Number(data.shipping_total) || 0,
                discount_total: Number(data.discount_total) || 0,
                total: Number(data.total) || 0,
                status: data.status,
                payment_status: data.payment_status,
                payment_method: data.payment_method,
                shipping_method: data.shipping_method,
                tracking_number: meta.tracking_number ?? null,
                metadata: {
                    payment_method: meta.payment_method ?? null,
                    payment_verified_at: meta.payment_verified_at ?? null,
                    tracking_number: meta.tracking_number ?? null,
                },
                order_items: (data.order_items ?? []).map((i: any) => ({
                    id: i.id,
                    sku: i.sku || i.products?.sku || null,
                    product_name: i.product_name,
                    variant_name: i.variant_name,
                    quantity: i.quantity,
                    unit_price: Number(i.unit_price) || 0,
                    total_price: Number(i.total_price) || 0,
                    metadata: {
                        image: i.metadata?.image ?? null,
                        preorder_shipping: i.metadata?.preorder_shipping ?? null,
                    },
                })),
                shipping_address: {
                    firstName: address.firstName ?? meta.first_name ?? null,
                    city: address.city ?? null,
                    region: address.region ?? null,
                },
                phone: null,
                email: null,
                phone_masked: maskPhone(data.phone || address.phone),
                email_masked: isPlaceholderEmail(data.email) ? null : maskEmail(data.email),
            },
        },
        { headers: { 'Cache-Control': 'no-store' } },
    );
}
