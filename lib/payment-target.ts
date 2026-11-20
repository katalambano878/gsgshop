/**
 * Resolves a payment "merchant reference" to either an `orders` row or a
 * `shopper_requests` row, and holds the shared rules every payment route
 * (start, verify, callback) applies to it.
 *
 * Conventions:
 *   - orders.order_number            starts with `ORD-`
 *   - shopper_requests.request_number starts with `SR-`
 *   - The unique reference sent to a payment gateway is `<merchantRef>-R<ms>`,
 *     so the suffix can be stripped to recover the merchant ref.
 *   - Every reference handed to a gateway is recorded on the row
 *     (metadata.payment_refs, newest last), so verify routes only ever ask the
 *     gateway about this order's own references.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { query } from '@/lib/db/pool';
import { verifyAuth } from '@/lib/auth';
import { phoneLast9 } from '@/lib/phone';
import { shopperUrl } from '@/lib/site-urls';

export type PaymentKind = 'order' | 'shopper_request';
export type PaymentProvider = 'moolre' | 'paystack';

export type PaymentTarget = {
    kind: PaymentKind;
    id: string; // primary key (uuid)
    ref: string; // merchant reference (ORD-... or SR-...)
    /** Stored server amount in GHS (orders.total / shopper_requests.total_final). 0 means not billable. */
    amount: number;
    email: string | null;
    phone: string | null;
    user_id: string | null;
    /** orders.status or shopper_requests.status */
    status: string | null;
    payment_status: string | null;
    payment_method: string | null;
    metadata: Record<string, any>;
    /** shopper_requests.last_payment_ref (column); null for orders. */
    last_payment_ref_column?: string | null;
};

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF_RE = /^[A-Za-z0-9-]{1,80}$/;

export function refKind(ref: string | null | undefined): PaymentKind | null {
    if (!ref || typeof ref !== 'string') return null;
    if (ref.startsWith('SR-')) return 'shopper_request';
    if (ref.startsWith('ORD-')) return 'order';
    return null;
}

/** Strip a `-R<ts>` retry suffix off a payment-gateway reference. */
export function stripRetrySuffix(ref: string): string {
    return ref.replace(/-R\d+$/, '');
}

/** Money to the pesewa. */
export function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

/** A gateway amount as a number, or null when it is missing or not a number. */
export function parseAmount(raw: unknown): number | null {
    if (raw === null || raw === undefined || raw === '') return null;
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
}

/** True when `paid` (GHS) covers the expected amount, with one pesewa of slack. */
export function paidCovers(paid: number | null, expected: number): boolean {
    if (paid === null || !Number.isFinite(paid)) return false;
    if (!Number.isFinite(expected) || expected <= 0) return false;
    return paid + 0.01 >= round2(expected);
}

/** Order or request that can no longer be paid. */
export function isClosed(target: PaymentTarget): boolean {
    const s = String(target.status || '').toLowerCase();
    const p = String(target.payment_status || '').toLowerCase();
    return s === 'cancelled' || s === 'refunded' || p === 'refunded' || p === 'partially_refunded';
}

const ORDER_SELECT = 'id, order_number, total, email, phone, user_id, status, payment_status, payment_method, metadata, shipping_address';
const SHOPPER_SELECT =
    'id, request_number, total_final, contact_email, contact_phone, user_id, status, payment_status, payment_method, last_payment_ref, metadata';

function orderToTarget(data: any): PaymentTarget {
    const meta = (data.metadata as any) ?? {};
    return {
        kind: 'order',
        id: data.id,
        ref: data.order_number,
        amount: Number(data.total) || 0,
        email: data.email ?? null,
        phone: data.phone ?? data.shipping_address?.phone ?? null,
        user_id: data.user_id ?? null,
        status: data.status ?? null,
        payment_status: data.payment_status ?? null,
        payment_method: meta.payment_method ?? data.payment_method ?? null,
        metadata: meta,
    };
}

function shopperToTarget(row: any): PaymentTarget {
    const totalFinal = row.total_final !== null && row.total_final !== undefined ? Number(row.total_final) : 0;
    return {
        kind: 'shopper_request',
        id: row.id,
        ref: row.request_number,
        // total_final is the billable amount (set from the server estimate at
        // submission and by staff at finalize). Nothing else is ever charged.
        amount: Number.isFinite(totalFinal) ? totalFinal : 0,
        email: row.contact_email ?? null,
        phone: row.contact_phone ?? null,
        user_id: row.user_id ?? null,
        status: row.status ?? null,
        payment_status: row.payment_status ?? null,
        payment_method: row.payment_method ?? null,
        metadata: (row.metadata as any) ?? {},
        last_payment_ref_column: row.last_payment_ref ?? null,
    };
}

/**
 * Look up a payment target by ID (uuid) or merchant ref (ORD-/SR-).
 * Returns null if nothing matches.
 */
export async function loadPaymentTarget(idOrRef: string): Promise<PaymentTarget | null> {
    if (!idOrRef || typeof idOrRef !== 'string') return null;
    const key = idOrRef.trim();
    if (!REF_RE.test(key)) return null;

    const kindHint = refKind(key);
    if (kindHint === 'shopper_request') {
        const { data } = await supabaseAdmin.from('shopper_requests').select(SHOPPER_SELECT).eq('request_number', key).maybeSingle();
        return data ? shopperToTarget(data) : null;
    }
    if (kindHint === 'order') {
        const { data } = await supabaseAdmin.from('orders').select(ORDER_SELECT).eq('order_number', key).maybeSingle();
        return data ? orderToTarget(data) : null;
    }
    if (UUID_RE.test(key)) {
        const { data: order } = await supabaseAdmin.from('orders').select(ORDER_SELECT).eq('id', key).maybeSingle();
        if (order) return orderToTarget(order);
        const { data: req } = await supabaseAdmin.from('shopper_requests').select(SHOPPER_SELECT).eq('id', key).maybeSingle();
        return req ? shopperToTarget(req) : null;
    }
    return null;
}

/**
 * Who may start a payment on this order / request: any ONE of
 *   (a) `orderUuid` (or a uuid `orderId`) equal to the row id,
 *   (b) `phone` matching the stored phone (last 9 digits),
 *   (c) `customerEmail` / `email` matching the stored email,
 *   (d) a bearer token for the row's owner, or for staff.
 */
export async function callerMayPay(req: Request, target: PaymentTarget, body: Record<string, any>): Promise<boolean> {
    const uuid =
        typeof body?.orderUuid === 'string' ? body.orderUuid.trim()
            : typeof body?.orderId === 'string' && UUID_RE.test(body.orderId.trim()) ? body.orderId.trim()
                : '';
    if (uuid && UUID_RE.test(uuid) && uuid.toLowerCase() === String(target.id).toLowerCase()) return true;

    const typedPhone = phoneLast9(body?.phone);
    if (typedPhone && target.phone && phoneLast9(target.phone) === typedPhone) return true;

    const typedEmail =
        typeof body?.customerEmail === 'string' ? body.customerEmail.trim().toLowerCase()
            : typeof body?.email === 'string' ? body.email.trim().toLowerCase()
                : '';
    if (typedEmail && target.email && typedEmail === String(target.email).trim().toLowerCase()) return true;

    if (req.headers.get('authorization')) {
        try {
            const auth = await verifyAuth(req);
            if (auth.authenticated && auth.user?.id) {
                if (target.user_id && String(auth.user.id) === String(target.user_id)) return true;
                const staff = await verifyAuth(req, { requireRole: ['admin', 'staff'] });
                if (staff.authenticated) return true;
            }
        } catch {
            /* not signed in */
        }
    }
    return false;
}

/**
 * Every gateway reference this row has issued for `provider`, newest first.
 * Includes the legacy single `last_payment_ref` when the row's last attempt
 * used this provider (payments opened before references were listed).
 */
export function providerRefs(target: PaymentTarget, provider: PaymentProvider): string[] {
    const meta = target.metadata || {};
    const out: string[] = [];
    const list = Array.isArray(meta.payment_refs) ? meta.payment_refs : [];
    for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        if (e && e.provider === provider && typeof e.ref === 'string') out.push(e.ref);
    }
    const own = meta[`${provider}_last_ref`];
    if (typeof own === 'string') out.push(own);
    const lastProvider = meta.payment_method ?? target.payment_method;
    if (lastProvider === provider) {
        if (typeof meta.last_payment_ref === 'string') out.push(meta.last_payment_ref);
        if (typeof target.last_payment_ref_column === 'string') out.push(target.last_payment_ref_column);
    }
    // Only references that belong to this row.
    return Array.from(new Set(out)).filter((r) => REF_RE.test(r) && stripRetrySuffix(r) === target.ref);
}

/** The newest gateway reference this row issued, any provider. */
export function latestRef(target: PaymentTarget): string | null {
    const meta = target.metadata || {};
    if (typeof meta.last_payment_ref === 'string') return meta.last_payment_ref;
    return target.last_payment_ref_column ?? null;
}

/**
 * Record a payment attempt (before the gateway is called). Merges into the
 * stored metadata on the server (`metadata || jsonb`), keeping the last 10
 * references, and never touches a paid row.
 */
export async function recordPaymentAttempt(
    target: PaymentTarget,
    opts: { provider: PaymentProvider; uniqueRef: string },
): Promise<void> {
    const { provider, uniqueRef } = opts;
    const table = target.kind === 'order' ? 'orders' : 'shopper_requests';
    const patch = {
        payment_method: provider,
        last_payment_ref: uniqueRef,
        last_payment_attempt_at: new Date().toISOString(),
        [`${provider}_last_ref`]: uniqueRef,
    };
    const entry = { provider, ref: uniqueRef, at: new Date().toISOString() };
    // Every placeholder must be used in both shapes (Postgres cannot type an
    // unused parameter), so the orders shape casts $4 without storing it.
    const extraCols =
        target.kind === 'order'
            ? `payment_method = $3::text, payment_provider = CASE WHEN $4::text IS NULL THEN payment_provider ELSE $3::text END`
            : `payment_method = $3::text, payment_provider = $3::text, last_payment_ref = $4::text, last_payment_attempt_at = now()`;
    await query(
        `UPDATE public.${table}
            SET ${extraCols},
                metadata = coalesce(metadata, '{}'::jsonb) || $2::jsonb || jsonb_build_object('payment_refs', (
                    SELECT coalesce(jsonb_agg(e ORDER BY o), '[]'::jsonb) FROM (
                        SELECT e, o FROM jsonb_array_elements(
                            (CASE WHEN jsonb_typeof(metadata->'payment_refs') = 'array' THEN metadata->'payment_refs' ELSE '[]'::jsonb END)
                            || jsonb_build_array($5::jsonb)
                        ) WITH ORDINALITY AS t(e, o)
                        ORDER BY o DESC LIMIT 10
                    ) s
                )),
                updated_at = now()
          WHERE id = $1 AND payment_status IS DISTINCT FROM 'paid'`,
        [target.id, JSON.stringify(patch), provider, uniqueRef, JSON.stringify(entry)],
    );
}

/**
 * A gateway reported this attempt failed. Marks the row failed only when the
 * failing reference is the row's newest attempt and the row is not paid;
 * metadata is merged, never replaced.
 */
export async function recordPaymentFailure(
    target: PaymentTarget,
    opts: { provider: PaymentProvider; ref: string; reason: string },
): Promise<boolean> {
    const table = target.kind === 'order' ? 'orders' : 'shopper_requests';
    const isLatest = latestRef(target) === opts.ref;
    const patch = {
        last_payment_failure: {
            provider: opts.provider,
            ref: opts.ref,
            reason: String(opts.reason || 'Payment failed').slice(0, 200),
            at: new Date().toISOString(),
        },
    };
    const setStatus = isLatest ? `payment_status = 'failed',` : '';
    const { rowCount } = await query(
        `UPDATE public.${table}
            SET ${setStatus} metadata = coalesce(metadata, '{}'::jsonb) || $2::jsonb, updated_at = now()
          WHERE id = $1 AND payment_status IS DISTINCT FROM 'paid'`,
        [target.id, JSON.stringify(patch)],
    );
    return isLatest && rowCount > 0;
}

/** Last 4 digits of a phone, for display ("•••• 3792"). */
export function maskPhone(phone: string | null | undefined): string | null {
    const d = String(phone || '').replace(/\D/g, '');
    if (d.length < 4) return null;
    return `•••• ${d.slice(-4)}`;
}

/** "ab•••@domain" for display. */
export function maskEmail(email: string | null | undefined): string | null {
    const e = String(email || '').trim();
    const at = e.indexOf('@');
    if (at < 1) return null;
    return `${e.slice(0, Math.min(2, at))}•••${e.slice(at)}`;
}

// ---------------------------------------------------------------------------
// Payment start: shared checks for POST /api/payment/moolre and /paystack.
// ---------------------------------------------------------------------------

export type PreparedStart =
    | { ok: true; target: PaymentTarget; amount: number }
    | { ok: false; status: number; message: string };

/**
 * Find the order/request, check the caller may pay it and that it can still
 * be paid. The amount is always the stored server total.
 */
export async function preparePaymentStart(req: Request, body: Record<string, any>): Promise<PreparedStart> {
    const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : '';
    const orderUuid = typeof body?.orderUuid === 'string' ? body.orderUuid.trim() : '';
    const key = orderId || orderUuid;
    if (!key || key.length > 80) return { ok: false, status: 400, message: 'Missing or invalid orderId' };

    const target = await loadPaymentTarget(key);
    if (!target) return { ok: false, status: 404, message: 'Order not found' };
    // orderId and orderUuid, when both sent, must name the same row.
    if (orderId && orderUuid && UUID_RE.test(orderUuid) && orderUuid.toLowerCase() !== target.id.toLowerCase()) {
        return { ok: false, status: 403, message: 'We could not confirm this order belongs to you.' };
    }
    if (!(await callerMayPay(req, target, body))) {
        return { ok: false, status: 403, message: 'We could not confirm this order belongs to you.' };
    }
    if (target.payment_status === 'paid') return { ok: false, status: 409, message: 'This order is already paid.' };
    if (isClosed(target)) return { ok: false, status: 409, message: 'This order is closed and can no longer be paid.' };

    const amount = round2(Number(target.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
        return {
            ok: false,
            status: 400,
            message: target.kind === 'shopper_request' ? 'This request is not yet ready for payment.' : 'Invalid order amount',
        };
    }
    return { ok: true, target, amount };
}

/** Where the gateway sends the customer back (no payment_success flag: the page checks the real status). */
export function returnUrls(target: PaymentTarget, provider: PaymentProvider, baseUrl: string): { success: string; cancel: string } {
    const ref = encodeURIComponent(target.ref);
    if (target.kind === 'shopper_request') {
        // Built on the shopper host (lib/site-urls) so the customer stays there.
        return {
            success: shopperUrl(`/payment-complete?ref=${ref}&provider=${provider}`),
            cancel: shopperUrl(`/pay/${ref}?cancelled=1`),
        };
    }
    return {
        success: `${baseUrl}/order-success?order=${ref}&provider=${provider}`,
        cancel: `${baseUrl}/pay/${ref}?cancelled=1`,
    };
}
