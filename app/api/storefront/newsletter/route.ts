import { NextResponse } from 'next/server';
import { query } from '@/lib/db/pool';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';
import { EMAIL_RE } from '@/app/api/storefront/_lib/mask';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Newsletter sign-up: stores the address, nothing else (no email is sent,
 * no discount is given).
 * POST { email, source? } → 200 { ok: true }
 * Same answer whether or not the address was already on the list; an address
 * that had unsubscribed is subscribed again. 400 bad email, 429 rate-limited.
 */

const IP_LIMIT = { maxRequests: 5, windowSeconds: 600 };
const EMAIL_LIMIT = { maxRequests: 3, windowSeconds: 3600 };
const SOURCE_RE = /^[a-z0-9_-]{1,40}$/;

function fail(message: string, status: number) {
    return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
    const ip = getClientIdentifier(request);
    if (!checkRateLimit(`newsletter:ip:${ip}`, IP_LIMIT).success) {
        return fail('Too many attempts. Please try again in a few minutes.', 429);
    }

    let body: any;
    try {
        body = await request.json();
    } catch {
        return fail('Invalid request.', 400);
    }

    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const rawSource = typeof body?.source === 'string' ? body.source.trim().toLowerCase() : '';
    const source = SOURCE_RE.test(rawSource) ? rawSource : 'website';

    if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
        return fail('Please enter a valid email address.', 400);
    }
    if (!checkRateLimit(`newsletter:email:${email}`, EMAIL_LIMIT).success) {
        return fail('Too many attempts for this email. Please try again later.', 429);
    }

    try {
        const { rows } = await query<{ id: string; unsubscribed_at: string | null }>(
            `SELECT id, unsubscribed_at FROM newsletter_subscribers WHERE lower(email) = $1 LIMIT 1`,
            [email],
        );
        const existing = rows[0];
        if (existing) {
            if (existing.unsubscribed_at) {
                await query(`UPDATE newsletter_subscribers SET unsubscribed_at = NULL, source = $2 WHERE id = $1`, [existing.id, source]);
            }
            return NextResponse.json({ ok: true });
        }
        try {
            await query(`INSERT INTO newsletter_subscribers (email, source) VALUES ($1, $2)`, [email, source]);
        } catch (e: any) {
            // 23505: the same address was subscribed at the same moment.
            if (e?.code !== '23505') throw e;
        }
        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error('[storefront/newsletter] subscribe failed:', err?.message);
        return fail('We could not save your email right now. Please try again.', 500);
    }
}
