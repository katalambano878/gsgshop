import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import { loadPaymentTarget, refKind, stripRetrySuffix } from '@/lib/payment-target';
import { finalizePayment } from '@/lib/payment-finalize';

/**
 * Moolre Callback Payload Structure (from their actual API):
 * {
 *   "status": 1,
 *   "code": "P01",
 *   "message": "Transaction Successful",
 *   "data": {
 *     "txtstatus": 1,
 *     "amount": "2",
 *     "transactionid": "42252702",
 *     "externalref": "ORD-1770330034217-441" | "SR-1770330034217-441-R<ts>",
 *     "thirdpartyref": "74658410493"
 *   },
 *   "secret": "...",
 *   "ts": "..."
 * }
 */

export async function POST(req: Request) {
    console.log('[Callback] POST received at', new Date().toISOString());

    try {
        const clientId = getClientIdentifier(req);
        const rateLimitResult = checkRateLimit(`callback:${clientId}`, RATE_LIMITS.callback);

        if (!rateLimitResult.success) {
            console.warn('[Callback] Rate limited:', clientId);
            return NextResponse.json({ success: false, message: 'Too many requests' }, { status: 429 });
        }

        let body: any = {};
        const contentType = req.headers.get('content-type') || '';

        try {
            if (contentType.includes('application/json')) {
                body = await req.json();
            } else if (contentType.includes('form')) {
                const formData = await req.formData();
                body = Object.fromEntries(formData.entries());
            } else {
                const rawText = await req.text();
                try {
                    body = JSON.parse(rawText);
                } catch {
                    try {
                        body = Object.fromEntries(new URLSearchParams(rawText).entries());
                    } catch {
                        console.warn('[Callback] Could not parse body');
                    }
                }
            }
        } catch (parseError) {
            console.error('[Callback] Body parsing failed');
            return NextResponse.json({ success: false, message: 'Invalid Request Body' }, { status: 400 });
        }

        console.log('[Callback] Body keys:', Object.keys(body).join(', '));
        console.log('[Callback] Data keys:', body.data ? Object.keys(body.data).join(', ') : 'no data object');

        // SECURITY: Verify callback secret FIRST (mandatory).
        // Moolre sends it inside `data`, not at the top level; checking only
        // body.secret rejected every callback, so WhatsApp orders never got
        // marked paid unless the customer came back to /order-success.
        const expectedSecret = process.env.MOOLRE_CALLBACK_SECRET;
        if (expectedSecret) {
            const receivedSecret = body.data?.secret ?? body.secret;
            if (!receivedSecret || receivedSecret !== expectedSecret) {
                console.error('[Callback] Secret mismatch or missing! Rejecting callback.');
                return NextResponse.json({ success: false, message: 'Invalid callback signature' }, { status: 403 });
            }
        } else {
            console.warn('[Callback] WARNING: MOOLRE_CALLBACK_SECRET not configured. Callback origin cannot be verified.');
        }

        const data = body.data || {};

        const rawExternalRef =
            data.externalref ||
            data.external_reference ||
            data.orderRef ||
            body.externalref ||
            body.orderRef ||
            body.external_reference;

        // Strip retry suffix to recover the merchant ref (ORD-... or SR-...).
        const merchantOrderRef = rawExternalRef
            ? stripRetrySuffix(rawExternalRef)
            : (data.metadata?.original_order_number || body.metadata?.original_order_number);

        const moolreReference =
            data.transactionid ||
            data.thirdpartyref ||
            body.reference ||
            'callback';

        const apiStatus = body.status;
        const txStatus = data.txtstatus ?? data.txstatus;
        const messageStr = String(body.message || '').toLowerCase();

        console.log('[Callback] Order ref:', merchantOrderRef,
            '| API status:', apiStatus,
            '| TX status:', txStatus,
            '| Message:', body.message,
            '| Moolre ref:', moolreReference);

        if (!merchantOrderRef) {
            console.error('[Callback] Missing order reference. Body:', JSON.stringify(body).substring(0, 500));
            return NextResponse.json({ success: false, message: 'Missing order reference' }, { status: 400 });
        }

        const kind = refKind(merchantOrderRef);
        if (!kind) {
            console.error('[Callback] Unknown ref prefix:', merchantOrderRef);
            return NextResponse.json({ success: false, message: 'Unknown reference format' }, { status: 400 });
        }

        const apiOk = (apiStatus === 1 || apiStatus === '1');
        const txOk = (txStatus === 1 || txStatus === '1');
        const isSuccess = (apiOk || txOk) && !messageStr.includes('fail') && !messageStr.includes('error');

        if (!isSuccess) {
            console.log(`[Callback] Payment FAILED for ${merchantOrderRef} | Status: ${apiStatus} | TX: ${txStatus}`);

            if (kind === 'order') {
                await supabaseAdmin
                    .from('orders')
                    .update({
                        payment_status: 'failed',
                        metadata: {
                            moolre_reference: moolreReference,
                            failure_reason: body.message || 'Payment failed',
                        },
                    })
                    .eq('order_number', merchantOrderRef);
            } else {
                await supabaseAdmin
                    .from('shopper_requests')
                    .update({
                        payment_status: 'failed',
                        metadata: {
                            moolre_reference: moolreReference,
                            failure_reason: body.message || 'Payment failed',
                        },
                    })
                    .eq('request_number', merchantOrderRef);
            }

            return NextResponse.json({ success: false, message: 'Payment not successful' });
        }

        console.log(`[Callback] Payment SUCCESS for ${kind} ${merchantOrderRef}`);

        const target = await loadPaymentTarget(merchantOrderRef);
        if (!target) {
            console.error('[Callback] Target not found:', merchantOrderRef);
            return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
        }

        if (target.payment_status === 'paid') {
            console.log('[Callback] Already paid, skipping:', merchantOrderRef);
            return NextResponse.json({ success: true, message: 'Order already processed' });
        }

        if (target.payment_method && target.payment_method !== 'moolre') {
            console.error('[Callback] Provider mismatch — target is', target.payment_method, 'not moolre:', merchantOrderRef);
            return NextResponse.json({ success: false, message: 'Provider mismatch' }, { status: 400 });
        }

        // SECURITY: Verify amount matches.
        const callbackAmount = data.amount ? parseFloat(data.amount) : (body.amount ? parseFloat(body.amount) : null);
        if (callbackAmount !== null && Number.isFinite(callbackAmount)) {
            const expectedAmount = Number(target.amount);
            if (Math.abs(callbackAmount - expectedAmount) > 0.01) {
                console.error('[Callback] AMOUNT MISMATCH — REJECTING! Expected:', expectedAmount, 'Got:', callbackAmount, 'Order:', merchantOrderRef);
                return NextResponse.json({
                    success: false,
                    message: 'Payment amount does not match order total',
                }, { status: 400 });
            }
        }

        const result = await finalizePayment({
            target,
            provider: 'moolre',
            transactionId: String(moolreReference),
        });
        if (!result.ok) {
            return NextResponse.json({ success: false, message: 'Database update failed' }, { status: 500 });
        }

        return NextResponse.json({ success: true, message: 'Payment verified and Order Updated' });
    } catch (error: any) {
        console.error('[Callback] Critical Error:', error.message);
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}

export async function GET() {
    return NextResponse.json({ message: 'Moolre callback endpoint ready', timestamp: new Date().toISOString() });
}
