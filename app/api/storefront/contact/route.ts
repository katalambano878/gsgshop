import { NextResponse } from 'next/server';
import { query } from '@/lib/db/pool';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';
import { EMAIL_RE } from '@/app/api/storefront/_lib/mask';
import { normalizeGhanaPhone, phoneLast9 } from '@/lib/phone';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Contact form.
 * POST { name, email?, phone?, subject, message } (a phone or an email is required)
 * 200 { ok: true, reference }  (reference = the contact_submissions id)
 * 400 bad input, 429 rate-limited, 500 not saved.
 *
 * The message is stored in contact_submissions (status 'new') for staff to
 * answer by phone/WhatsApp. Nothing is emailed: the app has no mail provider.
 */

const IP_LIMIT = { maxRequests: 5, windowSeconds: 900 };
const CONTACT_LIMIT = { maxRequests: 3, windowSeconds: 3600 };

function fail(message: string, status: number) {
    return NextResponse.json({ error: message }, { status });
}

function clean(value: unknown, max: number): string {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export async function POST(request: Request) {
    const ip = getClientIdentifier(request);
    if (!checkRateLimit(`contact:ip:${ip}`, IP_LIMIT).success) {
        return fail('Too many messages. Please wait a few minutes and try again.', 429);
    }

    let body: any;
    try {
        body = await request.json();
    } catch {
        return fail('Invalid request.', 400);
    }

    const name = clean(body?.name, 120);
    const email = clean(body?.email, 254).toLowerCase();
    const phoneRaw = clean(body?.phone, 30);
    const subject = clean(body?.subject, 150);
    const message = clean(body?.message, 5000);

    if (!name) return fail('Please enter your name.', 400);
    if (!email && !phoneRaw) return fail('Please give a phone number or an email address so we can reply.', 400);
    if (email && !EMAIL_RE.test(email)) return fail('Please enter a valid email address.', 400);
    // Keep a Ghana number in +233 form; accept a foreign number as typed (at least 9 digits).
    const phone = phoneRaw ? normalizeGhanaPhone(phoneRaw) || (phoneLast9(phoneRaw) ? phoneRaw : '') : '';
    if (phoneRaw && !phone) return fail('Please enter a valid phone number.', 400);
    if (!subject) return fail('Please choose a subject.', 400);
    if (message.length < 10) return fail('Please write a message of at least 10 characters.', 400);

    const contactKey = email || phoneLast9(phone);
    if (!checkRateLimit(`contact:who:${contactKey}`, CONTACT_LIMIT).success) {
        return fail('You have sent several messages already. We will get back to you soon.', 429);
    }

    try {
        const { rows } = await query<{ id: string }>(
            `INSERT INTO contact_submissions (name, email, phone, subject, message, status)
             VALUES ($1, $2, $3, $4, $5, 'new')
             RETURNING id`,
            [name, email || null, phone || null, subject, message],
        );
        return NextResponse.json({ ok: true, reference: rows[0]?.id ?? null });
    } catch (err: any) {
        console.error('[storefront/contact] insert failed:', err?.message);
        return fail('We could not send your message right now. Please try again, or WhatsApp us on +233 24 603 3792.', 500);
    }
}
