import { NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/db/pool';
import { verifyAuth } from '@/lib/auth';
import { sendShopperStatusUpdate } from '@/lib/notifications';
import { UUID_RE } from '../../../_lib';

export const dynamic = 'force-dynamic';

/**
 * POST /api/shopper/requests/[id]/status — admin or staff.
 * Body: { status, note?, refundAmount? }
 *
 * Moves a request along the allowed steps only. PAID is never a target: only
 * the payment callback/verify sets it. Shopping and delivery steps need the
 * request to be paid. Each change writes a shopper_status_history row with the
 * note and created_by = the staff user, and the customer gets an SMS on the
 * key steps (shopping, out for delivery, delivered, cancelled).
 * Cancelling a paid request with `refundAmount` records the refund given
 * outside the app (payment_status refunded / partially_refunded); no money is
 * moved here.
 *
 * 200 → { success: true, request: { id, request_number, status, payment_status }, sms }
 * 4xx → { error }
 */

const ALLOWED: Record<string, string[]> = {
    SUBMITTED: ['REVIEWING', 'SOURCING', 'CANCELLED'],
    PAID: ['REVIEWING', 'SOURCING', 'SHOPPING', 'CANCELLED'],
    REVIEWING: ['SOURCING', 'AWAITING_CONFIRMATION', 'CANCELLED'],
    SOURCING: ['REVIEWING', 'AWAITING_CONFIRMATION', 'SHOPPING', 'CANCELLED'],
    AWAITING_CONFIRMATION: ['SOURCING', 'SHOPPING', 'CANCELLED'],
    SHOPPING: ['OUT_FOR_DELIVERY', 'CANCELLED'],
    OUT_FOR_DELIVERY: ['DELIVERED', 'SHOPPING'],
    DELIVERED: [],
    CANCELLED: [],
};

const NEEDS_PAYMENT = new Set(['SHOPPING', 'OUT_FOR_DELIVERY', 'DELIVERED']);

class HttpError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    const auth = await verifyAuth(request, { requireRole: ['admin', 'staff'] });
    if (!auth.authenticated) {
        return NextResponse.json({ error: auth.user ? 'Forbidden' : 'Unauthorized' }, { status: auth.user ? 403 : 401 });
    }
    const staffId = String(auth.user?.id || '') || null;

    const { id } = await context.params;
    if (!UUID_RE.test(id || '')) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const next = typeof body?.status === 'string' ? body.status.trim().toUpperCase() : '';
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 1000) : '';
    const refundAmount = Number(body?.refundAmount);
    if (!next || !(next in ALLOWED)) return NextResponse.json({ error: 'Unknown status' }, { status: 400 });
    if (next === 'PAID') {
        return NextResponse.json({ error: 'PAID is set by the payment provider, not by hand.' }, { status: 400 });
    }

    let updated: any;
    try {
        updated = await withTransaction(async () => {
            const { rows } = await query<any>(
                `SELECT id, request_number, status::text AS status, payment_status, total_final, contact_name, contact_phone
                   FROM public.shopper_requests WHERE id = $1 FOR UPDATE`,
                [id],
            );
            const row = rows[0];
            if (!row) throw new HttpError(404, 'Request not found');
            if (row.status === next) throw new HttpError(400, `The request is already ${next.replace(/_/g, ' ').toLowerCase()}.`);
            if (!(ALLOWED[row.status] || []).includes(next)) {
                throw new HttpError(400, `A request cannot move from ${row.status.replace(/_/g, ' ')} to ${next.replace(/_/g, ' ')}.`);
            }
            if (NEEDS_PAYMENT.has(next) && row.payment_status !== 'paid') {
                throw new HttpError(400, 'This request has not been paid yet.');
            }

            let paymentStatus: string = row.payment_status;
            const metaPatch: Record<string, unknown> = {};
            if (next === 'CANCELLED' && row.payment_status === 'paid' && Number.isFinite(refundAmount) && refundAmount > 0) {
                const total = Number(row.total_final) || 0;
                paymentStatus = refundAmount + 0.01 >= total ? 'refunded' : 'partially_refunded';
                metaPatch.refund = {
                    amount: Math.round(refundAmount * 100) / 100,
                    recorded_by: staffId,
                    recorded_at: new Date().toISOString(),
                };
            }

            const { rows: out } = await query<any>(
                `UPDATE public.shopper_requests
                    SET status = $2::shopper_request_status, payment_status = $3,
                        metadata = coalesce(metadata, '{}'::jsonb) || $4::jsonb, updated_at = now()
                  WHERE id = $1
              RETURNING id, request_number, status::text AS status, payment_status, contact_name, contact_phone`,
                [id, next, paymentStatus, JSON.stringify(metaPatch)],
            );
            await query(
                `INSERT INTO public.shopper_status_history (request_id, status, note, created_by)
                 VALUES ($1, $2::shopper_request_status, $3, $4::uuid)`,
                [id, next, note || null, staffId],
            );
            return out[0];
        });
    } catch (e: any) {
        if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error('[shopper/status] update failed:', e?.code || 'error');
        return NextResponse.json({ error: 'Could not update the request' }, { status: 500 });
    }

    let sms = false;
    try {
        sms = (await sendShopperStatusUpdate(updated, next)).sms;
    } catch {
        sms = false;
    }

    return NextResponse.json({
        success: true,
        request: { id: updated.id, request_number: updated.request_number, status: updated.status, payment_status: updated.payment_status },
        sms,
    });
}
