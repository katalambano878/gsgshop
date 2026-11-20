import { NextResponse } from 'next/server';
import { verifyRecaptcha } from '@/lib/recaptcha';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';

/**
 * POST /api/recaptcha/verify — { token, action? }
 * 200 → { success: true, verified: true, score }            (Google verified it)
 * 200 → { success: true, verified: false, skipped: true }    (no secret configured: not verified)
 * 403 → { success: false, verified: false, error }
 * Routes that write data should verify the token themselves (lib/recaptcha).
 */
export async function POST(request: Request) {
    const rl = checkRateLimit(`recaptcha:${getClientIdentifier(request)}`, { maxRequests: 20, windowSeconds: 60 });
    if (!rl.success) {
        return NextResponse.json({ success: false, verified: false, error: 'Too many requests' }, { status: 429 });
    }
    try {
        const body = await request.json().catch(() => ({}));
        const token = typeof body?.token === 'string' ? body.token : '';
        const action = typeof body?.action === 'string' ? body.action.slice(0, 100) : undefined;
        const result = await verifyRecaptcha(token, action);
        if (result.skipped) return NextResponse.json({ success: true, verified: false, skipped: true });
        if (!token) {
            return NextResponse.json({ success: false, verified: false, error: 'Missing reCAPTCHA token' }, { status: 400 });
        }
        if (!result.success) {
            return NextResponse.json({ success: false, verified: false, error: result.error || 'Verification failed' }, { status: 403 });
        }
        return NextResponse.json({ success: true, verified: true, score: result.score });
    } catch {
        return NextResponse.json({ success: false, verified: false, error: 'Internal server error' }, { status: 500 });
    }
}
