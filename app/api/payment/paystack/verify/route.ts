import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import { loadPaymentTarget, paidCovers, providerRefs, refKind } from '@/lib/payment-target';
import { finalizePayment } from '@/lib/payment-finalize';

/**
 * POST /api/payment/paystack/verify — { orderNumber } or { requestNumber }.
 *
 * Asks Paystack only about the references THIS order/request issued; any
 * reference in the body is ignored. Paid only when Paystack says success,
 * echoes the same reference, the currency is GHS and the amount (pesewas) is
 * present and covers the stored total.
 *
 * 200 → { success: <paid?>, payment_status, status, message } (no contact details)
 */
export async function POST(req: Request) {
    try {
        const clientId = getClientIdentifier(req);
        const rateLimitResult = checkRateLimit(`verify:${clientId}`, RATE_LIMITS.payment);
        if (!rateLimitResult.success) {
            return NextResponse.json({ success: false, message: 'Too many requests' }, { status: 429 });
        }

        const body = await req.json().catch(() => ({}));
        const ref = typeof body?.requestNumber === 'string' ? body.requestNumber.trim()
            : typeof body?.orderNumber === 'string' ? body.orderNumber.trim() : '';
        if (!ref || !refKind(ref)) {
            return NextResponse.json({ success: false, message: 'Missing or invalid order number' }, { status: 400 });
        }

        const target = await loadPaymentTarget(ref);
        if (!target) return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });

        const reply = (paid: boolean, message: string) =>
            NextResponse.json({ success: paid, payment_status: target.payment_status, status: target.status, message });

        if (target.payment_status === 'paid') return reply(true, 'Payment received');

        const secretKey = process.env.PAYSTACK_SECRET_KEY;
        if (!secretKey) {
            console.error('[Paystack/Verify] PAYSTACK_SECRET_KEY is not configured');
            return NextResponse.json(
                { success: false, payment_status: target.payment_status, status: target.status, message: 'Payment check unavailable' },
                { status: 503 },
            );
        }

        const refs = providerRefs(target, 'paystack').slice(0, 5);
        if (refs.length === 0) return reply(false, 'No card payment has been started for this order.');

        for (const candidate of refs) {
            let json: any = null;
            try {
                const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(candidate)}`, {
                    headers: { Authorization: `Bearer ${secretKey}` },
                    signal: AbortSignal.timeout(8000),
                });
                json = await res.json().catch(() => null);
            } catch {
                continue;
            }
            const d = json?.data || {};
            if (json?.status !== true || d?.status !== 'success') continue;
            if (String(d.reference || '') !== candidate) {
                console.warn('[Paystack/Verify] reply reference does not match for', target.ref);
                continue;
            }
            if (String(d.currency || '').toUpperCase() !== 'GHS') {
                console.error('[Paystack/Verify] currency is not GHS for', target.ref);
                continue;
            }
            const pesewas = d.amount === undefined || d.amount === null ? NaN : Number(d.amount);
            const paid = Number.isFinite(pesewas) ? pesewas / 100 : null;
            if (!paidCovers(paid, target.amount)) {
                console.error('[Paystack/Verify] amount missing or short for', target.ref, '| paid:', paid, '| due:', target.amount);
                continue;
            }

            const result = await finalizePayment({
                target,
                provider: 'paystack',
                transactionId: d.id !== undefined && d.id !== null ? String(d.id) : null,
                paidAmount: paid,
            });
            if (result.ok) {
                return NextResponse.json({
                    success: true,
                    payment_status: 'paid',
                    status: result.row?.status ?? target.status,
                    message: 'Payment received',
                });
            }
            if (result.code === 'db_error') {
                return NextResponse.json({ success: false, payment_status: target.payment_status, status: target.status, message: 'Could not update the order' }, { status: 500 });
            }
            return reply(false, result.code === 'closed' ? 'This order is closed. Please contact us about your payment.' : 'Payment could not be applied to this order.');
        }

        return reply(false, 'Payment not yet confirmed by the payment provider');
    } catch (error: any) {
        console.error('[Paystack/Verify] error:', error?.name || 'error');
        return NextResponse.json({ success: false, message: 'Internal error' }, { status: 500 });
    }
}
