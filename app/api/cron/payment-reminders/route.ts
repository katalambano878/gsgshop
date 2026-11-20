import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { query } from '@/lib/db/pool';
import { sendPaymentLink } from '@/lib/notifications';
import { retryPendingWaWebhooks } from '@/lib/wa-payment-webhook';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/payment-reminders — called by the scheduler with
 * `Authorization: Bearer <CRON_SECRET>`. Refused when CRON_SECRET is unset.
 *
 * 1. One payment-reminder SMS per unpaid, open order older than 15 minutes
 *    (and newer than 3 days), claimed atomically so two runs never send twice.
 * 2. Retries undelivered WhatsApp-agent "payment confirmed" webhooks.
 */

function secretMatches(given: string, expected: string): boolean {
    const a = crypto.createHash('sha256').update(given).digest();
    const b = crypto.createHash('sha256').update(expected).digest();
    return crypto.timingSafeEqual(a, b) && given.length === expected.length;
}

export async function GET(request: Request) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        console.error('[Payment Reminders] CRON_SECRET is not set: refused');
        return NextResponse.json({ error: 'Not configured' }, { status: 503 });
    }
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token || !secretMatches(token, cronSecret)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // Claim up to 50 orders in one statement; only claimed rows get an SMS.
        const { rows } = await query<any>(
            `UPDATE public.orders o
                SET payment_reminder_sent = true, payment_reminder_sent_at = now()
              WHERE o.id IN (
                    SELECT id FROM public.orders
                     WHERE payment_status IN ('pending', 'failed')
                       AND status IN ('pending', 'awaiting_payment')
                       AND coalesce(payment_reminder_sent, false) = false
                       AND created_at < now() - interval '15 minutes'
                       AND created_at > now() - interval '3 days'
                     ORDER BY created_at ASC
                     LIMIT 50
                     FOR UPDATE SKIP LOCKED)
            RETURNING o.id, o.order_number, o.phone, o.total, o.shipping_address, o.metadata`,
        );

        let sent = 0;
        let failed = 0;
        for (const order of rows) {
            try {
                const { sms } = await sendPaymentLink(order);
                sms ? sent++ : failed++;
            } catch {
                failed++;
            }
        }

        const webhooksRetried = await retryPendingWaWebhooks();

        return NextResponse.json({ success: true, processed: rows.length, sent, failed, webhooksRetried });
    } catch (error: any) {
        console.error('[Payment Reminders] error:', error?.code || error?.name || 'error');
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
}
