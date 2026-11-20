import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';
import { evaluateCoupon } from '../validate-coupon';

export const dynamic = 'force-dynamic';

const VALIDATE_RATE_LIMIT = { maxRequests: 15, windowSeconds: 60 };

/**
 * POST /api/storefront/coupons/validate
 * Body: { code: string, subtotal: number, email?: string, phone?: string, shippingTotal?: number }
 * → { valid, code, type, value, discount, message }
 *
 * Preview only: /api/checkout re-validates the code and computes the discount
 * itself from server prices; the subtotal sent here only sets the preview.
 */
export async function POST(req: Request) {
    const clientId = getClientIdentifier(req);
    const rl = checkRateLimit(`coupon-validate:${clientId}`, VALIDATE_RATE_LIMIT);
    if (!rl.success) {
        return NextResponse.json(
            { valid: false, code: '', type: null, value: null, discount: 0, message: 'Too many attempts. Please wait a moment.' },
            { status: 429 },
        );
    }

    let body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json(
            { valid: false, code: '', type: null, value: null, discount: 0, message: 'Invalid request.' },
            { status: 400 },
        );
    }

    const subtotal = Number(body?.subtotal);
    const shipping = Number(body?.shippingTotal);
    try {
        const result = await evaluateCoupon(body?.code, Number.isFinite(subtotal) ? subtotal : 0, {
            mode: 'checkout',
            email: typeof body?.email === 'string' ? body.email : null,
            phone: typeof body?.phone === 'string' ? body.phone : null,
            shippingTotal: Number.isFinite(shipping) && body?.shippingTotal !== undefined ? shipping : null,
        });
        return NextResponse.json(result);
    } catch (e: any) {
        console.error('[CouponValidate] error:', e?.code || 'error');
        return NextResponse.json(
            { valid: false, code: '', type: null, value: null, discount: 0, message: 'Could not check this coupon right now.' },
            { status: 500 },
        );
    }
}
