import { query } from '@/lib/db/pool';
import { createServerSupabase } from '@/lib/supabase-server';

/**
 * "Payment confirmed" webhook for orders placed by the GSG AI WhatsApp agent.
 *
 * On Supabase this was the `wa_payment_confirmed` trigger on public.orders
 * (notify_wa_payment_confirmed, via pg_net). pg_net does not exist on the new
 * server, so the app sends it instead, from every place that turns an order
 * paid: lib/payment-finalize.ts (Moolre / Paystack verify and callbacks), the
 * mark_order_paid RPC over /rest/v1/rpc (POS), and PATCH /rest/v1/orders.
 *
 * Same rules as the trigger: only a transition to payment_status 'paid', only
 * for metadata.source = 'whatsapp_ai', only while wa_agent_webhook_config
 * (id 'singleton') is enabled; 5 second timeout; never throws and never holds
 * up the payment.
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

async function send(order: PaidOrder): Promise<void> {
    const source = order.metadata && typeof order.metadata === 'object' ? (order.metadata as any).source : undefined;
    if ((source ?? '') !== 'whatsapp_ai') return;

    const { data: cfg, error } = await createServerSupabase('service')
        .from('wa_agent_webhook_config')
        .select('webhook_url, webhook_secret')
        .eq('id', 'singleton')
        .eq('enabled', true)
        .maybeSingle();
    if (error) {
        console.warn('[wa-webhook] config lookup failed:', error.message);
        return;
    }
    if (!cfg?.webhook_url) return;

    const payload = {
        event: 'payment_confirmed',
        order_id: String(order.id),
        order_number: order.order_number ?? null,
        payment_status: order.payment_status ?? null,
        total: order.total ?? null,
        updated_at: order.updated_at ?? null,
    };

    const res = await fetch(String(cfg.webhook_url), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-WA-Webhook-Secret': String(cfg.webhook_secret ?? ''),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
    });
    if (!res.ok) console.warn(`[wa-webhook] ${order.order_number}: webhook answered ${res.status}`);
}

/** Fire-and-forget: call after the paid state is committed. Never throws. */
export function notifyWaPaymentConfirmed(order: PaidOrder | null | undefined): void {
    if (!order || order.payment_status !== 'paid') return;
    void send(order).catch((e: any) => {
        console.warn('[wa-webhook] webhook failed:', e?.message || e);
    });
}
