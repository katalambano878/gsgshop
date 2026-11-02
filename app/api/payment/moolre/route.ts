import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import { loadPaymentTarget, recordPaymentAttempt } from '@/lib/payment-target';

export async function POST(req: Request) {
    try {
        const clientId = getClientIdentifier(req);
        const rateLimitResult = checkRateLimit(`payment:${clientId}`, RATE_LIMITS.payment);

        if (!rateLimitResult.success) {
            return NextResponse.json(
                { success: false, message: 'Too many requests. Please try again later.' },
                {
                    status: 429,
                    headers: {
                        'X-RateLimit-Remaining': '0',
                        'X-RateLimit-Reset': rateLimitResult.resetIn.toString()
                    }
                }
            );
        }

        const body = await req.json();
        const { orderId, customerEmail } = body;

        if (!orderId || typeof orderId !== 'string') {
            return NextResponse.json({ success: false, message: 'Missing or invalid orderId' }, { status: 400 });
        }

        if (!process.env.MOOLRE_API_USER || !process.env.MOOLRE_API_PUBKEY || !process.env.MOOLRE_ACCOUNT_NUMBER) {
            console.error('Missing Moolre credentials');
            return NextResponse.json({ success: false, message: 'Payment gateway configuration error' }, { status: 500 });
        }

        // SECURITY: Fetch the target from the database and use its total.
        // NEVER trust the amount from the client.
        // The reference may be a UUID, an ORD-... order number, or an SR-...
        // shopper-request number — lib/payment-target dispatches.
        const target = await loadPaymentTarget(orderId);
        if (!target) {
            console.error('[Payment] Target not found:', orderId);
            return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
        }

        if (target.payment_status === 'paid') {
            return NextResponse.json({ success: false, message: 'Order is already paid' }, { status: 400 });
        }

        // Moolre rejects amounts with float noise (116.33999999999999), so
        // send whole pesewas.
        const amount = Math.round(Number(target.amount) * 100) / 100;
        if (!amount || amount <= 0) {
            return NextResponse.json(
                {
                    success: false,
                    message:
                        target.kind === 'shopper_request'
                            ? 'This request is not yet ready for payment'
                            : 'Invalid order amount',
                },
                { status: 400 }
            );
        }

        const orderRef = target.ref;

        const requestUrl = new URL(req.url);
        const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || requestUrl.origin).replace(/\/+$/, '');

        const uniqueRef = `${orderRef}-R${Date.now()}`;

        // Shopper-request payments redirect back into the shopper subdomain so
        // branding stays consistent for that customer. The &provider= hint
        // lets the landing page pick the right verify endpoint without a guess.
        const redirectPath =
            target.kind === 'shopper_request'
                ? `/shopper/payment-complete?ref=${orderRef}&payment_success=true&provider=moolre`
                : `/order-success?order=${orderRef}&payment_success=true&provider=moolre`;

        const payload = {
            type: 1,
            amount: amount.toFixed(2),
            email: process.env.MOOLRE_MERCHANT_EMAIL || 'admin@gsgbrands.com.gh',
            externalref: uniqueRef,
            callback: `${baseUrl}/api/payment/moolre/callback`,
            redirect: `${baseUrl}${redirectPath}`,
            reusable: "0",
            currency: "GHS",
            accountnumber: process.env.MOOLRE_ACCOUNT_NUMBER,
            metadata: {
                customer_email: customerEmail || target.email,
                original_order_number: orderRef,
                kind: target.kind,
            }
        };

        console.log('[Payment] Initiating for', target.kind, orderRef, '| Amount from DB:', amount, '| Callback:', payload.callback);

        const response = await fetch('https://api.moolre.com/embed/link', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-USER': process.env.MOOLRE_API_USER,
                'X-API-PUBKEY': process.env.MOOLRE_API_PUBKEY
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        console.log('[Payment] Response status:', result.status, '| Has URL:', !!result.data?.authorization_url);

        if (result.status === 1 && result.data?.authorization_url) {
            try {
                await recordPaymentAttempt(target, { provider: 'moolre', uniqueRef });
            } catch (metaErr: any) {
                console.warn('[Payment] Failed to persist last_payment_ref:', metaErr?.message);
            }

            return NextResponse.json({ success: true, url: result.data.authorization_url, reference: uniqueRef });
        } else {
            return NextResponse.json({ success: false, message: result.message || 'Failed to generate payment link' }, { status: 400 });
        }

    } catch (error: any) {
        console.error('Payment API Error:', error);
        return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
    }
}
