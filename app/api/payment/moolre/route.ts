import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import { preparePaymentStart, recordPaymentAttempt, returnUrls } from '@/lib/payment-target';

/**
 * POST /api/payment/moolre — open a Mobile Money payment (Moolre hosted page).
 *
 * Body: { orderId: <ORD-/SR- ref or row uuid>, orderUuid?, customerEmail?, phone? }
 * plus an optional Bearer token. The caller must prove the order is theirs
 * (orderUuid = row id, matching phone or email, or an owner/staff token):
 * otherwise 403. The amount is always the stored server total. Paid → 409,
 * cancelled/refunded → 409. The customer may switch provider and retry.
 *
 * 200 → { success: true, url, reference }
 */
export async function POST(req: Request) {
    try {
        const clientId = getClientIdentifier(req);
        const rateLimitResult = checkRateLimit(`payment:${clientId}`, RATE_LIMITS.payment);
        if (!rateLimitResult.success) {
            return NextResponse.json(
                { success: false, message: 'Too many requests. Please try again later.' },
                { status: 429, headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': rateLimitResult.resetIn.toString() } },
            );
        }

        const body = await req.json().catch(() => ({}));

        if (!process.env.MOOLRE_API_USER || !process.env.MOOLRE_API_PUBKEY || !process.env.MOOLRE_ACCOUNT_NUMBER) {
            console.error('[Moolre] gateway credentials are not configured');
            return NextResponse.json({ success: false, message: 'Payment gateway configuration error' }, { status: 500 });
        }

        const prepared = await preparePaymentStart(req, body || {});
        if (!prepared.ok) {
            return NextResponse.json({ success: false, message: prepared.message }, { status: prepared.status });
        }
        const { target, amount } = prepared;

        const requestUrl = new URL(req.url);
        const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || requestUrl.origin).replace(/\/+$/, '');
        const uniqueRef = `${target.ref}-R${Date.now()}`;
        const urls = returnUrls(target, 'moolre', baseUrl);

        // Recorded before the gateway call so verify/callback always know this reference.
        await recordPaymentAttempt(target, { provider: 'moolre', uniqueRef });

        const payload = {
            type: 1,
            amount: amount.toFixed(2),
            email: process.env.MOOLRE_MERCHANT_EMAIL || 'admin@gsgbrands.com.gh',
            externalref: uniqueRef,
            callback: `${baseUrl}/api/payment/moolre/callback`,
            redirect: urls.success,
            reusable: '0',
            currency: 'GHS',
            accountnumber: process.env.MOOLRE_ACCOUNT_NUMBER,
            metadata: {
                original_order_number: target.ref,
                kind: target.kind,
            },
        };

        console.log('[Moolre] start', target.kind, target.ref, '| amount:', amount);

        const response = await fetch('https://api.moolre.com/embed/link', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-USER': process.env.MOOLRE_API_USER,
                'X-API-PUBKEY': process.env.MOOLRE_API_PUBKEY,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(20000),
        });
        const result = await response.json().catch(() => ({}));

        if (result?.status === 1 && result?.data?.authorization_url) {
            return NextResponse.json({ success: true, url: result.data.authorization_url, reference: uniqueRef });
        }
        console.warn('[Moolre] link not created | HTTP', response.status, '| code:', result?.code ?? 'none');
        return NextResponse.json(
            { success: false, message: 'We could not open Mobile Money payment. Please try again or pay by card.' },
            { status: 502 },
        );
    } catch (error: any) {
        console.error('[Moolre] start error:', error?.name || 'error');
        return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
    }
}
