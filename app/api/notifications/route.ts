import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { query } from '@/lib/db/pool';
import { verifyAuth } from '@/lib/auth';
import { sendOrderConfirmation, sendOrderStatusUpdate, sendPaymentLink, sendSMS, smsAccepted } from '@/lib/notifications';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import { phoneLast9 } from '@/lib/phone';

export const dynamic = 'force-dynamic';

/**
 * POST /api/notifications — staff only (admin or staff, Bearer token).
 * Messages go by SMS. There is no email provider: nothing here sends email.
 * Every message is built from the database row, never from the request body.
 *
 *   { type: 'order_created', payload: { order_number | id } }
 *       Confirmation SMS for a PAID order, once (metadata.confirmation_sent_at;
 *       paid orders already get one from the payment step).
 *   { type: 'order_updated', payload: { order: { id | order_number } } }
 *   { type: 'order_status',  payload: { orderNumber } }
 *       Status SMS with the order's stored status.
 *   { type: 'payment_link',  payload: { id | order_number } }
 *       Payment link SMS for an unpaid, open order.
 *   { type: 'campaign', payload: { audience: 'all' | 'newsletter', channels: { sms }, message } }
 *       → { success, recipients, sent, failed }
 *   Other responses: { success, message, sms: boolean }
 *
 * Removed public types (410): 'contact' (use /api/storefront/contact),
 * 'welcome'. Any type sent without a staff session → 401/403.
 *
 * GET /api/notifications?audienceCount=all|newsletter (staff) → { count }
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF_RE = /^[A-Za-z0-9-]{1,80}$/;
const REMOVED = new Set(['contact', 'welcome']);
const MAX_CAMPAIGN_RECIPIENTS = 5000;

async function requireStaff(request: Request): Promise<NextResponse | { userId: string | null }> {
    const auth = await verifyAuth(request, { requireRole: ['admin', 'staff'] });
    if (!auth.authenticated) {
        return NextResponse.json(
            { success: false, error: auth.user ? 'Forbidden' : 'Unauthorized' },
            { status: auth.user ? 403 : 401 },
        );
    }
    return { userId: auth.user?.id ? String(auth.user.id) : null };
}

async function loadOrder(ref: unknown): Promise<any | null> {
    if (typeof ref !== 'string' || !REF_RE.test(ref.trim())) return null;
    const key = ref.trim();
    const q = supabaseAdmin
        .from('orders')
        .select('id, order_number, email, phone, status, payment_status, total, shipping_address, metadata, created_at');
    const { data } = UUID_RE.test(key) ? await q.eq('id', key).maybeSingle() : await q.eq('order_number', key).maybeSingle();
    return data ?? null;
}

function smsReply(sms: boolean, sentText: string) {
    return NextResponse.json({
        success: true,
        sms,
        message: sms ? sentText : 'No SMS was sent (no valid phone number on the order, or the SMS gateway refused it).',
    });
}

/** Customers with a real phone, one per number (last 9 digits). */
async function campaignAudience(audience: 'all' | 'newsletter'): Promise<string[]> {
    const sql =
        audience === 'newsletter'
            ? `SELECT c.phone FROM public.customers c
                 JOIN public.newsletter_subscribers n ON lower(n.email) = lower(c.email) AND n.unsubscribed_at IS NULL
                WHERE c.phone IS NOT NULL AND length(regexp_replace(c.phone, '\\D', '', 'g')) >= 9`
            : `SELECT c.phone FROM public.customers c
                WHERE c.phone IS NOT NULL AND length(regexp_replace(c.phone, '\\D', '', 'g')) >= 9`;
    const { rows } = await query<{ phone: string }>(sql);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rows) {
        const key = phoneLast9(r.phone);
        if (!key || !/^[25]\d{8}$/.test(key) || seen.has(key)) continue;
        seen.add(key);
        out.push(`+233${key}`);
    }
    return out;
}

export async function GET(request: Request) {
    const staff = await requireStaff(request);
    if (staff instanceof NextResponse) return staff;
    const audience = new URL(request.url).searchParams.get('audienceCount');
    if (audience !== 'all' && audience !== 'newsletter') {
        return NextResponse.json({ error: 'audienceCount must be all or newsletter' }, { status: 400 });
    }
    try {
        const list = await campaignAudience(audience);
        return NextResponse.json({ count: list.length });
    } catch (e: any) {
        console.error('[notifications] audience count failed:', e?.code || 'error');
        return NextResponse.json({ error: 'Could not count the audience' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const clientId = getClientIdentifier(request);
        const rateLimitResult = checkRateLimit(`notification:${clientId}`, RATE_LIMITS.notification);
        if (!rateLimitResult.success) {
            return NextResponse.json(
                { success: false, error: 'Too many requests. Please try again later.' },
                { status: 429, headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': rateLimitResult.resetIn.toString() } },
            );
        }

        const body = await request.json().catch(() => ({}));
        const type = typeof body?.type === 'string' ? body.type : '';
        const payload = body?.payload && typeof body.payload === 'object' ? body.payload : {};

        if (REMOVED.has(type)) {
            return NextResponse.json({ success: false, error: 'This notification type is no longer available' }, { status: 410 });
        }

        const staff = await requireStaff(request);
        if (staff instanceof NextResponse) return staff;

        if (type === 'order_created') {
            const order = await loadOrder(payload.order_number || payload.orderNumber || payload.id);
            if (!order) return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
            if (order.payment_status !== 'paid') {
                return NextResponse.json({ success: true, sms: false, message: 'Not sent: the order is not paid yet.' });
            }
            // Claim the send once.
            const { rowCount } = await query(
                `UPDATE public.orders SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('confirmation_sent_at', now())
                  WHERE id = $1 AND NOT (coalesce(metadata, '{}'::jsonb) ? 'confirmation_sent_at')`,
                [order.id],
            );
            if (rowCount === 0) {
                return NextResponse.json({ success: true, sms: false, message: 'Already sent for this order.' });
            }
            const { sms } = await sendOrderConfirmation(order);
            return smsReply(sms, 'Confirmation SMS sent.');
        }

        if (type === 'order_updated' || type === 'order_status') {
            const ref =
                type === 'order_updated'
                    ? payload.order?.id || payload.order?.order_number
                    : payload.orderNumber || payload.orderId;
            const order = await loadOrder(ref);
            if (!order) return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
            const { sms } = await sendOrderStatusUpdate(order, String(order.status || ''));
            return smsReply(sms, 'Status SMS sent.');
        }

        if (type === 'payment_link') {
            const order = await loadOrder(payload.id || payload.order_number || payload.orderNumber);
            if (!order) return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
            if (order.payment_status === 'paid') {
                return NextResponse.json({ success: false, error: 'This order is already paid' }, { status: 409 });
            }
            if (order.status === 'cancelled' || order.status === 'refunded' || order.payment_status === 'refunded') {
                return NextResponse.json({ success: false, error: 'This order is closed' }, { status: 409 });
            }
            const { sms } = await sendPaymentLink(order);
            return smsReply(sms, 'Payment link sent by SMS.');
        }

        if (type === 'campaign') {
            const audience = payload.audience === 'newsletter' ? 'newsletter' : payload.audience === 'all' ? 'all' : null;
            const message = typeof payload.message === 'string' ? payload.message.trim() : '';
            if (!audience) return NextResponse.json({ success: false, error: 'Choose an audience' }, { status: 400 });
            if (!message) return NextResponse.json({ success: false, error: 'Message required' }, { status: 400 });
            if (message.length > 640) return NextResponse.json({ success: false, error: 'Message is too long for SMS (640 characters at most)' }, { status: 400 });
            if (payload.channels?.sms !== true) {
                return NextResponse.json({ success: false, error: 'Campaigns are sent by SMS: tick SMS.' }, { status: 400 });
            }

            let recipients: string[];
            try {
                recipients = await campaignAudience(audience);
            } catch (e: any) {
                console.error('[campaign] audience failed:', e?.code || 'error');
                return NextResponse.json({ success: false, error: 'Could not build the audience' }, { status: 500 });
            }
            if (recipients.length > MAX_CAMPAIGN_RECIPIENTS) {
                return NextResponse.json(
                    { success: false, error: `The audience has ${recipients.length} numbers; campaigns are limited to ${MAX_CAMPAIGN_RECIPIENTS}.` },
                    { status: 400 },
                );
            }

            let sent = 0;
            let failed = 0;
            const CONCURRENCY = 5;
            for (let i = 0; i < recipients.length; i += CONCURRENCY) {
                const batch = recipients.slice(i, i + CONCURRENCY);
                const results = await Promise.all(
                    batch.map((to) => sendSMS({ to, message }).then(smsAccepted).catch(() => false)),
                );
                for (const ok of results) ok ? sent++ : failed++;
            }

            // Campaign log (who, when, how many; never the numbers).
            await supabaseAdmin
                .from('audit_logs')
                .insert({
                    user_id: staff.userId,
                    action: 'sms_campaign',
                    entity_type: 'campaign',
                    details: { audience, recipients: recipients.length, sent, failed, length: message.length },
                })
                .then(({ error }) => {
                    if (error) console.warn('[campaign] log not written:', error.code || 'error');
                });

            console.log(`[campaign] ${audience}: ${sent} sent, ${failed} failed of ${recipients.length}`);
            return NextResponse.json({ success: true, recipients: recipients.length, sent, failed });
        }

        return NextResponse.json({ success: false, error: 'Invalid notification type' }, { status: 400 });
    } catch (error: any) {
        console.error('[notifications] error:', error?.name || 'error');
        return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
    }
}
