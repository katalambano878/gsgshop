import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import { isPlaceholderEmail } from '@/lib/placeholder-email';

/**
 * GET /api/payment/order/[ref]/receipt?reference=<gateway ref>
 * What /order-success needs to show an order to a guest.
 *
 * Guests can't read `orders` through the anon client (RLS), so WhatsApp
 * customers landing back from Moolre saw "Order Not Found" right after
 * paying. Items, totals and status come back for anyone with the order
 * number; the delivery details (address, phone, email) only when
 * `reference` matches the payment the gateway just redirected from, so an
 * order number alone never exposes them.
 */

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ ref: string }> }) {
    const rate = checkRateLimit(`order-receipt:${getClientIdentifier(req)}`, RATE_LIMITS.payment);
    if (!rate.success) {
        return NextResponse.json({ success: false, message: 'Too many requests' }, { status: 429 });
    }

    const { ref } = await params;
    const key = decodeURIComponent(ref || '').trim();
    if (!key || key.length > 80) {
        return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin
        .from('orders')
        .select('id, order_number, created_at, subtotal, shipping_total, total, payment_status, payment_method, shipping_method, shipping_address, phone, email, metadata, order_items (id, product_id, product_name, variant_name, sku, quantity, unit_price, metadata, products (sku))')
        .eq('order_number', key)
        .maybeSingle();

    if (error || !data) {
        return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
    }

    const meta = (data.metadata as Record<string, any> | null) ?? {};
    const address = (data.shipping_address as Record<string, any> | null) ?? {};
    const reference = new URL(req.url).searchParams.get('reference') || '';
    const fromPayment = Boolean(reference) && reference === meta.last_payment_ref;

    return NextResponse.json({
        success: true,
        order: {
            order_number: data.order_number,
            created_at: data.created_at,
            subtotal: Number(data.subtotal) || 0,
            shipping_total: Number(data.shipping_total) || 0,
            total: Number(data.total) || 0,
            payment_status: data.payment_status,
            payment_method: data.payment_method,
            shipping_method: data.shipping_method,
            metadata: {
                payment_method: meta.payment_method ?? null,
                payment_verified_at: meta.payment_verified_at ?? null,
            },
            order_items: (data.order_items ?? []).map((i: any) => ({
                id: i.id,
                sku: i.sku || i.products?.sku || null,
                product_name: i.product_name,
                variant_name: i.variant_name,
                quantity: i.quantity,
                unit_price: Number(i.unit_price) || 0,
                metadata: {
                    image: i.metadata?.image ?? null,
                    preorder_shipping: i.metadata?.preorder_shipping ?? null,
                },
            })),
            shipping_address: fromPayment
                ? address
                : { firstName: address.firstName ?? meta.first_name ?? null, city: address.city ?? null, region: address.region ?? null },
            phone: fromPayment ? data.phone : null,
            email: fromPayment && !isPlaceholderEmail(data.email) ? data.email : null,
        },
    });
}
