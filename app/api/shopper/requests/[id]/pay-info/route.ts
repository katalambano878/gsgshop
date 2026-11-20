import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';
import { maskEmail } from '@/lib/payment-target';
import { findRequest, SR_RE, UUID_RE, viewerFor } from '../../../_lib';

export const dynamic = 'force-dynamic';

/**
 * GET /api/shopper/requests/[id]/pay-info?phone=…
 *
 * [id] is the row uuid or the SR- number. Proof: the phone used on the
 * request (last 9 digits), or a signed-in owner / staff token. A uuid link
 * (/pay/<uuid>, sent by SMS to the customer) also counts as proof: the uuid
 * is unguessable and only ever given to the customer.
 *
 * 200 → { id, request_number, status, payment_status, total_final, total_est,
 *         markup, delivery_fee, contact_name (first name), contact_email (masked),
 *         contact_email_masked, items: [{ id, name_brand, qty_size_range, price }] }
 * 400 without proof · 404 unknown or wrong phone.
 */
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
    const rl = checkRateLimit(`shopper-payinfo:${getClientIdentifier(req)}`, { maxRequests: 30, windowSeconds: 60 });
    if (!rl.success) return NextResponse.json({ error: 'Too many requests. Please wait a minute.' }, { status: 429 });

    const { id } = await context.params;
    const key = decodeURIComponent(id || '').trim();
    if (!UUID_RE.test(key) && !SR_RE.test(key)) {
        return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }
    const phone = new URL(req.url).searchParams.get('phone');
    const byUuid = UUID_RE.test(key);
    if (!byUuid && !phone && !req.headers.get('authorization')) {
        return NextResponse.json({ error: 'Enter the phone number used on this request.' }, { status: 400 });
    }

    const row = await findRequest(key);
    if (!row) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    if (!byUuid) {
        const viewer = await viewerFor(req, row, phone);
        if (viewer.kind === 'none') return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    const { data: items } = await supabaseAdmin
        .from('shopper_request_items')
        .select('id, name_brand, qty_size_range, market_price, estimated_price, created_at')
        .eq('request_id', row.id)
        .order('created_at', { ascending: true });

    const masked = maskEmail(row.contact_email);
    return NextResponse.json(
        {
            id: row.id,
            request_number: row.request_number,
            status: row.status,
            payment_status: row.payment_status,
            total_final: row.total_final !== null && row.total_final !== undefined ? Number(row.total_final) : null,
            total_est: row.total_est !== null && row.total_est !== undefined ? Number(row.total_est) : null,
            markup: Number(row.markup ?? 0),
            delivery_fee: Number(row.delivery_fee ?? 0),
            contact_name: String(row.contact_name || '').split(' ')[0] || null,
            contact_email: masked,
            contact_email_masked: masked,
            has_email: !!row.contact_email,
            items: (items || []).map((it: any) => ({
                id: it.id,
                name_brand: it.name_brand,
                qty_size_range: it.qty_size_range,
                price:
                    it.market_price !== null && it.market_price !== undefined
                        ? Number(it.market_price)
                        : Number(it.estimated_price),
            })),
        },
        { headers: { 'Cache-Control': 'no-store' } },
    );
}
