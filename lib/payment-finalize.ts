/**
 * Shared "mark as paid" step used by every payment route (verify + callback,
 * Paystack + Moolre), for orders and Personal Shopper requests.
 *
 * Inside one transaction, with the row locked:
 *   1. refuse a closed (cancelled / refunded) row and an amount that does not
 *      cover the stored server total;
 *   2. tag the row with the gateway transaction id. The database allows one
 *      (provider, transaction id) per row, so a transaction that already paid
 *      another order or request fails here and is treated as NOT paid;
 *   3. mark_order_paid / mark_shopper_request_paid, which are idempotent and
 *      say `already_paid: true` on a repeat;
 *   4. on the transition to paid only: a status-history row.
 * After commit, on the transition only: customer record + totals, the SMS
 * confirmation and (orders from the WhatsApp agent) the paid-order webhook.
 * A repeat confirmation (callback and verify racing, a replayed webhook) does
 * none of these again.
 */

import { query, withTransaction } from '@/lib/db/pool';
import { notifyWaPaymentConfirmed } from '@/lib/wa-payment-webhook';
import { sendOrderConfirmation, sendShopperOrderConfirmation } from '@/lib/notifications';
import { isPlaceholderEmail } from '@/lib/placeholder-email';
import { phoneLast9 } from '@/lib/phone';
import { paidCovers, round2, type PaymentTarget } from '@/lib/payment-target';

export type FinalizeOpts = {
    target: PaymentTarget;
    provider: 'moolre' | 'paystack';
    /** Gateway-side transaction id (Paystack data.id, Moolre transactionid). */
    transactionId: string | null;
    /** Amount the gateway says was paid, in GHS. Required. */
    paidAmount: number | null;
};

export type FinalizeResult = {
    /** True when the row is paid after this call (now or before). */
    ok: boolean;
    /** True when this call made it paid (side effects ran). */
    becamePaid: boolean;
    alreadyPaid: boolean;
    /** The row after the update, jsonified. */
    row: any;
    /** Why it was not marked paid. */
    code?: 'not_found' | 'closed' | 'amount' | 'txn_used' | 'db_error';
    error?: string;
};

class Refusal extends Error {
    constructor(public code: NonNullable<FinalizeResult['code']>, message: string) {
        super(message);
    }
}

/** Gateway transaction ids worth storing (placeholders are not unique). */
function realTxnId(id: string | null): string | null {
    if (!id) return null;
    const s = String(id).trim();
    if (!s || s === 'callback' || s.endsWith('-verify') || s.length > 120) return null;
    return s;
}

async function tagTransaction(table: 'orders' | 'shopper_requests', id: string, provider: string, txn: string | null) {
    if (!txn) {
        await query(`UPDATE public.${table} SET payment_provider = $2 WHERE id = $1`, [id, provider]);
        return;
    }
    await query('SAVEPOINT pay_txn');
    try {
        await query(
            `UPDATE public.${table} SET payment_provider = $2, payment_transaction_id = $3 WHERE id = $1`,
            [id, provider, txn],
        );
        await query('RELEASE SAVEPOINT pay_txn');
    } catch (e: any) {
        await query('ROLLBACK TO SAVEPOINT pay_txn').catch(() => {});
        if (e?.code === '23505') {
            throw new Refusal('txn_used', 'This payment was already used for another order');
        }
        throw e;
    }
}

async function closedNote(table: 'orders' | 'shopper_requests', id: string, provider: string, txn: string | null, amount: number | null) {
    await query(
        `UPDATE public.${table} SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('payment_on_closed', $2::jsonb) WHERE id = $1`,
        [id, JSON.stringify({ provider, transaction_id: txn, amount, at: new Date().toISOString() })],
    ).catch(() => {});
}

export async function finalizePayment(opts: FinalizeOpts): Promise<FinalizeResult> {
    const { target, provider } = opts;
    const txn = realTxnId(opts.transactionId);
    const table = target.kind === 'order' ? 'orders' : 'shopper_requests';
    const refCol = target.kind === 'order' ? 'order_number' : 'request_number';

    let outcome: { row: any; alreadyPaid: boolean };
    try {
        outcome = await withTransaction(async () => {
            const { rows } = await query<any>(
                `SELECT id, ${refCol} AS ref, status::text AS status, payment_status::text AS payment_status,
                        ${target.kind === 'order' ? 'total' : 'total_final'} AS amount
                   FROM public.${table} WHERE id = $1 FOR UPDATE`,
                [target.id],
            );
            const locked = rows[0];
            if (!locked) throw new Refusal('not_found', 'Not found');

            if (locked.payment_status === 'paid') {
                const { rows: cur } = await query<any>(`SELECT to_jsonb(t) AS j FROM public.${table} t WHERE id = $1`, [target.id]);
                return { row: cur[0]?.j ?? null, alreadyPaid: true };
            }

            const status = String(locked.status || '').toLowerCase();
            if (status === 'cancelled' || status === 'refunded' || locked.payment_status === 'refunded') {
                throw new Refusal('closed', 'This order is closed');
            }

            const expected = round2(Number(locked.amount) || 0);
            if (!paidCovers(opts.paidAmount, expected)) {
                throw new Refusal('amount', `Paid amount does not cover the total`);
            }

            await tagTransaction(table, target.id, provider, txn);

            const fn = target.kind === 'order' ? 'mark_order_paid' : 'mark_shopper_request_paid';
            const { rows: marked } = await query<{ j: any }>(`SELECT public.${fn}($1, $2) AS j`, [
                locked.ref,
                txn || `${provider}-verify`,
            ]);
            const row = marked[0]?.j ?? null;
            if (!row) throw new Refusal('not_found', 'Not found');
            const alreadyPaid = row.already_paid === true;

            if (!alreadyPaid && target.kind === 'order') {
                await query('SAVEPOINT pay_hist');
                try {
                    await query(
                        `INSERT INTO public.order_status_history (order_id, status, notes) VALUES ($1, $2::order_status, $3)`,
                        [target.id, row.status || 'processing', `Payment confirmed by ${provider === 'moolre' ? 'Mobile Money (Moolre)' : 'card (Paystack)'}`],
                    );
                    await query('RELEASE SAVEPOINT pay_hist');
                } catch (e: any) {
                    await query('ROLLBACK TO SAVEPOINT pay_hist').catch(() => {});
                    console.warn('[finalizePayment] status history row not written:', e?.code || 'error');
                }
            }
            return { row, alreadyPaid };
        });
    } catch (e: any) {
        if (e instanceof Refusal) {
            if (e.code === 'closed') await closedNote(table, target.id, provider, txn, opts.paidAmount);
            console.warn(`[finalizePayment] ${target.ref} not marked paid: ${e.code}`);
            return { ok: false, becamePaid: false, alreadyPaid: false, row: null, code: e.code, error: e.message };
        }
        console.error('[finalizePayment] database error:', e?.code || e?.message || 'error');
        return { ok: false, becamePaid: false, alreadyPaid: false, row: null, code: 'db_error', error: 'Database update failed' };
    }

    if (outcome.alreadyPaid) {
        return { ok: true, becamePaid: false, alreadyPaid: true, row: outcome.row };
    }

    // ---- Transition to paid: side effects, exactly once ----------------------
    if (target.kind === 'order') {
        await upsertCustomerForOrder(outcome.row).catch((e: any) =>
            console.error('[finalizePayment] customer record failed:', e?.code || 'error'),
        );
        try {
            await sendOrderConfirmation(outcome.row);
        } catch (e: any) {
            console.error('[finalizePayment] confirmation failed:', e?.name || 'error');
        }
        notifyWaPaymentConfirmed(outcome.row);
    } else {
        // Customer totals count shop orders only (dashboard revenue rule).
        try {
            await sendShopperOrderConfirmation(outcome.row);
        } catch (e: any) {
            console.error('[finalizePayment] shopper confirmation failed:', e?.name || 'error');
        }
    }

    return { ok: true, becamePaid: true, alreadyPaid: false, row: outcome.row };
}

/**
 * Customer record for a newly paid order, written by the server only.
 * Never re-points or rewrites another customer's record: an existing record
 * matched by email or phone only gets its EMPTY fields filled (and its
 * account link only when it has none and the order was placed signed in);
 * no secondary email/phone is ever added. Totals are then recomputed from
 * paid orders.
 */
async function upsertCustomerForOrder(order: any): Promise<void> {
    if (!order?.id) return;
    const addr = order.shipping_address || {};
    const meta = order.metadata || {};
    const first = String(addr.firstName || meta.first_name || '').slice(0, 80) || null;
    const last = String(addr.lastName || meta.last_name || '').slice(0, 80) || null;
    const full = [first, last].filter(Boolean).join(' ') || null;
    const email = typeof order.email === 'string' ? order.email.trim() : '';
    const realEmail = email && !isPlaceholderEmail(email) ? email : '';
    const phone = order.phone || addr.phone || null;
    const last9 = phoneLast9(phone);
    const userId = order.user_id || null;
    const isPos = meta.pos_sale === true;
    if (isPos) {
        // The till keeps its own customer bookkeeping.
        await recomputeStats(order);
        return;
    }

    let customer: { id: string } | undefined;
    let ownRecord = false;
    if (userId) {
        const { rows } = await query<{ id: string }>(
            `SELECT id FROM public.customers WHERE user_id = $1::uuid ORDER BY created_at LIMIT 1`,
            [userId],
        );
        customer = rows[0];
        ownRecord = !!customer;
    }
    if (!customer && realEmail) {
        const { rows } = await query<{ id: string }>(
            `SELECT id FROM public.customers WHERE lower(email) = lower($1) ORDER BY created_at LIMIT 1`,
            [realEmail],
        );
        customer = rows[0];
    }
    if (!customer && last9) {
        const { rows } = await query<{ id: string }>(
            `SELECT id FROM public.customers
              WHERE length(regexp_replace(coalesce(phone, ''), '\\D', '', 'g')) >= 9
                AND right(regexp_replace(phone, '\\D', '', 'g'), 9) = $1
              ORDER BY created_at LIMIT 1`,
            [last9],
        );
        customer = rows[0];
    }

    if (customer) {
        // Only the signed-in customer's own record gets its empty fields filled.
        // A record matched by an (unverified) email or phone is left as it is.
        if (ownRecord) {
            await query(
                `UPDATE public.customers SET
                    full_name = coalesce(nullif(full_name, ''), $2),
                    first_name = coalesce(nullif(first_name, ''), $3),
                    last_name = coalesce(nullif(last_name, ''), $4),
                    phone = coalesce(nullif(phone, ''), $5),
                    default_address = coalesce(default_address, $6::jsonb),
                    updated_at = now()
                  WHERE id = $1`,
                [customer.id, full, first, last, phone, JSON.stringify(addr)],
            );
        }
    } else {
        await query(
            `INSERT INTO public.customers (email, phone, full_name, first_name, last_name, user_id, default_address)
             VALUES ($1, $2, $3, $4, $5, $6::uuid, $7::jsonb)
             ON CONFLICT (email) DO NOTHING`,
            [email || `${last9 || 'guest'}@store.local`, phone, full, first, last, userId, JSON.stringify(addr)],
        );
    }
    await recomputeStats(order);
}

async function recomputeStats(order: any): Promise<void> {
    // Totals are recalculated from paid orders; never an increment that can drift.
    await query(`SELECT public.recompute_customer_stats_for_order($1)`, [order.id]).catch((e: any) =>
        console.warn('[finalizePayment] customer totals not recomputed:', e?.code || 'error'),
    );
}
