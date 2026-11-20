import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import { loadPaymentTarget, paidCovers, parseAmount, providerRefs, refKind } from '@/lib/payment-target';
import { finalizePayment } from '@/lib/payment-finalize';

/**
 * POST /api/payment/moolre/verify — { orderNumber } or { requestNumber }.
 *
 * Asks Moolre only about the references THIS order/request issued (recorded
 * at payment start); any reference in the body is ignored. Paid only when
 * Moolre says the transaction succeeded, echoes the same externalref and
 * reports an amount that covers the stored total.
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

        const reply = (paid: boolean, message: string, t = target) =>
            NextResponse.json({ success: paid, payment_status: t.payment_status, status: t.status, message });

        if (target.payment_status === 'paid') return reply(true, 'Payment received');

        const apiUser = process.env.MOOLRE_API_USER;
        const apiPubkey = process.env.MOOLRE_API_PUBKEY;
        const accountNumber = process.env.MOOLRE_ACCOUNT_NUMBER;
        if (!apiUser || !apiPubkey || !accountNumber) {
            console.error('[Moolre/Verify] gateway credentials are not configured');
            return NextResponse.json(
                { success: false, payment_status: target.payment_status, status: target.status, message: 'Payment check unavailable' },
                { status: 503 },
            );
        }

        const refs = providerRefs(target, 'moolre').slice(0, 5);
        if (refs.length === 0) return reply(false, 'No Mobile Money payment has been started for this order.');

        for (const candidate of refs) {
            let json: any = null;
            try {
                const res = await fetch('https://api.moolre.com/open/transact/status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-API-USER': apiUser, 'X-API-PUBKEY': apiPubkey },
                    body: JSON.stringify({ type: 1, idtype: 1, id: candidate, accountnumber: accountNumber }),
                    signal: AbortSignal.timeout(8000),
                });
                json = await res.json().catch(() => null);
            } catch {
                continue;
            }
            const d = json?.data || {};
            const tx = d.txstatus ?? d.txtstatus;
            if (json?.status !== 1 || !(tx === 1 || tx === '1')) continue;
            if (String(d.externalref || '') !== candidate) {
                console.warn('[Moolre/Verify] reply reference does not match for', target.ref);
                continue;
            }
            const paid = parseAmount(d.amount);
            if (!paidCovers(paid, target.amount)) {
                console.error('[Moolre/Verify] amount missing or short for', target.ref, '| paid:', paid, '| due:', target.amount);
                continue;
            }

            const result = await finalizePayment({
                target,
                provider: 'moolre',
                transactionId: d.transactionid ? String(d.transactionid) : null,
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
        console.error('[Moolre/Verify] error:', error?.name || 'error');
        return NextResponse.json({ success: false, message: 'Internal error' }, { status: 500 });
    }
}
