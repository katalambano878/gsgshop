import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import { preparePaymentStart, recordPaymentAttempt, returnUrls } from '@/lib/payment-target';
import { isPlaceholderEmail } from '@/lib/placeholder-email';

/**
 * POST /api/payment/paystack — open a card payment (Paystack hosted page).
 *
 * Body: { orderId: <ORD-/SR- ref or row uuid>, orderUuid?, customerEmail?, phone? }
 * plus an optional Bearer token. Same ownership, amount and status rules as
 * /api/payment/moolre. Paystack needs an email for its receipt: the one typed
 * now, else the stored one, else the shop's own address (orders placed
 * without an email).
 *
 * 200 → { success: true, url, reference }
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

        const secretKey = process.env.PAYSTACK_SECRET_KEY;
        if (!secretKey) {
            console.error('[Paystack] PAYSTACK_SECRET_KEY is not configured');
            return NextResponse.json({ success: false, message: 'Payment gateway configuration error' }, { status: 500 });
        }

        const prepared = await preparePaymentStart(req, body || {});
        if (!prepared.ok) {
            return NextResponse.json({ success: false, message: prepared.message }, { status: prepared.status });
        }
        const { target, amount } = prepared;
        const amountPesewas = Math.round(amount * 100);

        const typed = typeof body?.customerEmail === 'string' ? body.customerEmail.trim() : '';
        const stored = target.email && !isPlaceholderEmail(target.email) ? target.email : '';
        const receiptEmail =
            (typed && EMAIL_RE.test(typed) ? typed : '') ||
            stored ||
            process.env.PAYSTACK_FALLBACK_EMAIL ||
            'info@gsgbrands.com.gh';

        const requestUrl = new URL(req.url);
        const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || requestUrl.origin).replace(/\/+$/, '');
        const uniqueRef = `${target.ref}-R${Date.now()}`;
        const urls = returnUrls(target, 'paystack', baseUrl);

        await recordPaymentAttempt(target, { provider: 'paystack', uniqueRef });

        const payload = {
            email: receiptEmail,
            amount: amountPesewas,
            currency: 'GHS',
            reference: uniqueRef,
            callback_url: urls.success,
            channels: ['card'],
            metadata: {
                order_number: target.ref,
                original_order_number: target.ref,
                kind: target.kind,
                cancel_action: urls.cancel,
                custom_fields: [
                    {
                        display_name: target.kind === 'shopper_request' ? 'Request Number' : 'Order Number',
                        variable_name: 'order_number',
                        value: target.ref,
                    },
                ],
            },
        };

        console.log('[Paystack] start', target.kind, target.ref, '| pesewas:', amountPesewas);

        const response = await fetch('https://api.paystack.co/transaction/initialize', {
            method: 'POST',
            headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(20000),
        });
        const result = await response.json().catch(() => ({}));

        if (response.ok && result?.status === true && result?.data?.authorization_url) {
            return NextResponse.json({ success: true, url: result.data.authorization_url, reference: uniqueRef });
        }
        console.warn('[Paystack] init refused | HTTP', response.status);
        return NextResponse.json(
            { success: false, message: 'We could not open card payment. Please try again or pay with Mobile Money.' },
            { status: 502 },
        );
    } catch (error: any) {
        console.error('[Paystack] start error:', error?.name || 'error');
        return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
    }
}
