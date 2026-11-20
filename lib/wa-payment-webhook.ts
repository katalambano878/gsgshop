import { query } from '@/lib/db/pool';

/**
 * "Payment confirmed" webhook for orders placed by the GSG AI WhatsApp agent.
 *
 * On Supabase this was the `wa_payment_confirmed` trigger on public.orders
 * (notify_wa_payment_confirmed, via pg_net). pg_net does not exist on the new
 * server, so the app sends it instead, from every place that turns an order
 * paid: lib/payment-finalize.ts (Moolre / Paystack verify and callbacks), the
 * mark_order_paid RPC over /rest/v1/rpc (POS), and PATCH /rest/v1/orders.
 *
 * Rules:
 *   - only a transition to payment_status 'paid', only for
 *     metadata.source = 'whatsapp_ai', only while wa_agent_webhook_config
 *     (id 'singleton') is enabled;
 *   - the URL must be https: and its host must be in WA_WEBHOOK_ALLOWED_HOSTS
 *     (comma-separated, default ai.gsgbrands.com.gh); redirects are refused;
 *   - every attempt is recorded in orders.metadata.wa_webhook
 *     ({ attempts, last_attempt_at, last_error?, delivered_at? }); a failed send
 *     is retried in-process with backoff, and again by the payment-reminders
 *     cron (retryPendingWaWebhooks) until MAX_ATTEMPTS;
 *   - never throws and never holds up the payment.
 */

export type PaidOrder = {
    id: string;
    order_number?: string | null;
    payment_status?: string | null;
    total?: number | string | null;
    updated_at?: string | null;
    metadata?: Record<string, unknown> | null;
};

const TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 8;
/** In-process retry delays after the first failure. */
const BACKOFF_MS = [5_000, 30_000];

/**
 * Inside a transaction: lock one order (by order_number) and return its
 * payment_status before the caller changes it, so concurrent payment
 * confirmations cannot both see "not paid yet". null: no such order;
 * undefined: the lookup itself failed (the caller's transaction is unharmed).
 */
export async function lockOrderPaymentStatus(orderNumber: string): Promise<string | null | undefined> {
    try {
        await query('SAVEPOINT wa_paid_check');
        const { rows } = await query<{ s: string | null }>(
            `SELECT payment_status::text AS s FROM public.orders WHERE order_number = $1 FOR UPDATE`,
            [orderNumber]
        );
        await query('RELEASE SAVEPOINT wa_paid_check');
        return rows.length ? rows[0].s : null;
    } catch (e: any) {
        await query('ROLLBACK TO SAVEPOINT wa_paid_check').catch(() => {});
        console.warn('[wa-webhook] could not read the order before payment:', e?.message);
        return undefined;
    }
}

/** True when an order went from not-paid to paid. An unknown "before" counts as not paid. */
export function becamePaid(before: string | null | undefined, after: PaidOrder | null | undefined): boolean {
    return !!after && after.payment_status === 'paid' && before !== 'paid';
}

function allowedHosts(): string[] {
    const raw = process.env.WA_WEBHOOK_ALLOWED_HOSTS || 'ai.gsgbrands.com.gh';
    return raw
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean);
}

/** The webhook URL when it is https: on an allowed host (default port), else null. */
export function allowedWebhookUrl(raw: unknown): URL | null {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    let url: URL;
    try {
        url = new URL(raw.trim());
    } catch {
        return null;
    }
    if (url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    if (url.port && url.port !== '443') return null;
    if (!allowedHosts().includes(url.hostname.toLowerCase())) return null;
    return url;
}

function isAgentOrder(order: PaidOrder): boolean {
    const source = order.metadata && typeof order.metadata === 'object' ? (order.metadata as any).source : undefined;
    return (source ?? '') === 'whatsapp_ai';
}

async function recordAttempt(orderId: string, result: { ok: boolean; error?: string }): Promise<number> {
    try {
        const { rows } = await query<{ attempts: number }>(
            `UPDATE public.orders
                SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('wa_webhook',
                    coalesce(CASE WHEN jsonb_typeof(metadata->'wa_webhook') = 'object' THEN metadata->'wa_webhook' END, '{}'::jsonb)
                    || jsonb_build_object(
                        'attempts', coalesce((metadata->'wa_webhook'->>'attempts')::int, 0) + 1,
                        'last_attempt_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                    )
                    || (CASE WHEN $2::boolean
                        THEN jsonb_build_object('delivered_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'last_error', NULL)
                        ELSE jsonb_build_object('last_error', $3::text) END))
              WHERE id = $1
              RETURNING coalesce((metadata->'wa_webhook'->>'attempts')::int, 0) AS attempts`,
            [orderId, result.ok, (result.error || '').slice(0, 200)]
        );
        return rows[0]?.attempts ?? MAX_ATTEMPTS;
    } catch (e: any) {
        console.warn('[wa-webhook] could not record the attempt:', e?.message);
        return MAX_ATTEMPTS;
    }
}

/** One delivery attempt. Returns ok, or a short reason. Never throws. */
async function sendOnce(order: PaidOrder): Promise<{ ok: boolean; error?: string; skip?: boolean }> {
    let cfg: { webhook_url: string; webhook_secret: string } | undefined;
    try {
        const { rows } = await query<{ webhook_url: string; webhook_secret: string }>(
            `SELECT webhook_url, webhook_secret FROM public.wa_agent_webhook_config WHERE id = 'singleton' AND enabled = true`
        );
        cfg = rows[0];
    } catch (e: any) {
        return { ok: false, error: 'config lookup failed' };
    }
    if (!cfg?.webhook_url) return { ok: false, skip: true };

    const url = allowedWebhookUrl(cfg.webhook_url);
    if (!url) {
        console.warn('[wa-webhook] configured URL is not on the allow-list; not sent');
        return { ok: false, error: 'url not allowed', skip: true };
    }

    const payload = {
        event: 'payment_confirmed',
        order_id: String(order.id),
        order_number: order.order_number ?? null,
        payment_status: order.payment_status ?? null,
        total: order.total ?? null,
        updated_at: order.updated_at ?? null,
    };

    try {
        const res = await fetch(url.toString(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-WA-Webhook-Secret': String(cfg.webhook_secret ?? ''),
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(TIMEOUT_MS),
            cache: 'no-store',
            redirect: 'error',
        });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e?.name === 'TimeoutError' ? 'timeout' : 'network error' };
    }
}

async function deliver(order: PaidOrder, retryIndex = 0): Promise<void> {
    const result = await sendOnce(order);
    if (result.skip) return;
    const attempts = await recordAttempt(String(order.id), result);
    if (result.ok) return;
    console.warn(`[wa-webhook] ${order.order_number}: attempt ${attempts} failed (${result.error})`);
    if (attempts >= MAX_ATTEMPTS || retryIndex >= BACKOFF_MS.length) return; // the cron picks it up
    setTimeout(() => {
        void deliver(order, retryIndex + 1).catch(() => {});
    }, BACKOFF_MS[retryIndex]);
}

/** Fire-and-forget: call after the paid state is committed. Never throws. */
export function notifyWaPaymentConfirmed(order: PaidOrder | null | undefined): void {
    if (!order || order.payment_status !== 'paid' || !isAgentOrder(order)) return;
    void deliver(order).catch((e: any) => {
        console.warn('[wa-webhook] webhook failed:', e?.message || e);
    });
}

/**
 * Re-send webhooks that were attempted and not delivered (called by the cron).
 * Only orders the app already tried (metadata.wa_webhook present) are picked
 * up, so older paid orders are never re-announced. Returns how many were tried.
 */
export async function retryPendingWaWebhooks(limit = 20): Promise<number> {
    let rows: PaidOrder[] = [];
    try {
        const res = await query<PaidOrder>(
            `SELECT id, order_number, payment_status::text AS payment_status, total, updated_at, metadata
               FROM public.orders
              WHERE payment_status = 'paid'
                AND metadata->>'source' = 'whatsapp_ai'
                AND jsonb_typeof(metadata->'wa_webhook') = 'object'
                AND metadata->'wa_webhook'->>'delivered_at' IS NULL
                AND coalesce((metadata->'wa_webhook'->>'attempts')::int, 0) < $1
                AND updated_at > now() - interval '3 days'
              ORDER BY updated_at ASC
              LIMIT $2`,
            [MAX_ATTEMPTS, limit]
        );
        rows = res.rows;
    } catch (e: any) {
        console.warn('[wa-webhook] retry scan failed:', e?.message);
        return 0;
    }
    for (const order of rows) {
        const result = await sendOnce(order);
        if (result.skip) continue;
        await recordAttempt(String(order.id), result);
    }
    return rows.length;
}
