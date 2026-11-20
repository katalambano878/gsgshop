import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import { loadPaymentTarget, paidCovers, recordPaymentFailure, refKind, stripRetrySuffix } from '@/lib/payment-target';
import { finalizePayment } from '@/lib/payment-finalize';

/**
 * Paystack webhook (https://paystack.com/docs/payments/webhooks/).
 *
 * Paystack signs the raw body with HMAC-SHA512 (secret key) in
 * `x-paystack-signature`; it is checked before anything is read.
 * charge.success → paid only when the currency is GHS and the amount
 * (pesewas, required) covers the stored total. charge.failed → marks the row
 * failed only for its newest attempt, never a paid row, metadata merged.
 *
 * Webhook URL: https://<host>/api/payment/paystack/callback
 */
export async function POST(req: Request) {
    try {
        const clientId = getClientIdentifier(req);
        const rateLimitResult = checkRateLimit(`callback:${clientId}`, RATE_LIMITS.callback);
        if (!rateLimitResult.success) {
            return NextResponse.json({ success: false, message: 'Too many requests' }, { status: 429 });
        }

        const secretKey = process.env.PAYSTACK_SECRET_KEY;
        if (!secretKey) {
            console.error('[Paystack/Callback] PAYSTACK_SECRET_KEY is not configured: refused');
            return NextResponse.json({ success: false, message: 'Webhook not configured' }, { status: 500 });
        }

        const rawBody = await req.text();
        const signature = req.headers.get('x-paystack-signature') || '';
        const expectedSignature = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');
        if (!signature || !timingSafeEqual(signature, expectedSignature)) {
            console.warn('[Paystack/Callback] invalid signature: refused');
            return NextResponse.json({ success: false, message: 'Invalid signature' }, { status: 401 });
        }

        let body: any;
        try {
            body = JSON.parse(rawBody);
        } catch {
            return NextResponse.json({ success: false, message: 'Invalid body' }, { status: 400 });
        }

        const event = body?.event;
        const data = body?.data || {};
        const reference = typeof data.reference === 'string' ? data.reference : '';
        const merchantRef = reference ? stripRetrySuffix(reference) : '';
        if (!reference || !refKind(merchantRef)) {
            // Not one of ours (another integration on the same account): acknowledge.
            return NextResponse.json({ success: true, message: 'Event acknowledged' });
        }

        console.log('[Paystack/Callback] event:', event, '|', merchantRef, '| status:', data?.status);

        const target = await loadPaymentTarget(merchantRef);
        if (!target) return NextResponse.json({ success: false, message: 'Order not found' });

        if (event === 'charge.success' && data?.status === 'success') {
            if (target.payment_status === 'paid') {
                return NextResponse.json({ success: true, message: 'Order already processed' });
            }
            if (String(data.currency || '').toUpperCase() !== 'GHS') {
                console.error('[Paystack/Callback] currency is not GHS for', merchantRef);
                return NextResponse.json({ success: false, message: 'Currency mismatch' }, { status: 400 });
            }
            const pesewas = data.amount === undefined || data.amount === null ? NaN : Number(data.amount);
            const paid = Number.isFinite(pesewas) ? pesewas / 100 : null;
            if (!paidCovers(paid, target.amount)) {
                console.error('[Paystack/Callback] amount missing or short for', merchantRef, '| paid:', paid, '| due:', target.amount);
                return NextResponse.json({ success: false, message: 'Payment amount does not match order total' }, { status: 400 });
            }

            const result = await finalizePayment({
                target,
                provider: 'paystack',
                transactionId: data.id !== undefined && data.id !== null ? String(data.id) : null,
                paidAmount: paid,
            });
            if (!result.ok) {
                if (result.code === 'db_error') {
                    return NextResponse.json({ success: false, message: 'Database update failed' }, { status: 500 });
                }
                // Refused for good (closed order, transaction already used): do not make Paystack retry.
                return NextResponse.json({ success: false, message: 'Payment not applied' });
            }
            return NextResponse.json({ success: true, message: 'Payment verified and order updated' });
        }

        if (event === 'charge.failed') {
            if (target.payment_status !== 'paid') {
                await recordPaymentFailure(target, {
                    provider: 'paystack',
                    ref: reference,
                    reason: String(data?.gateway_response || 'Payment failed'),
                }).catch(() => {});
            }
            return NextResponse.json({ success: false, message: 'Payment not successful' });
        }

        return NextResponse.json({ success: true, message: 'Event acknowledged' });
    } catch (error: any) {
        console.error('[Paystack/Callback] error:', error?.name || 'error');
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}

export async function GET() {
    return NextResponse.json({ message: 'Paystack callback endpoint ready' });
}

function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
    } catch {
        return false;
    }
}
