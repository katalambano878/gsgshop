/**
 * Shared "mark-as-paid" logic used by every payment route (verify + webhook,
 * Paystack + Moolre). Handles the table-specific RPC call, provider column
 * tagging, customer-stats update, and confirmation notification so each route
 * stays focused on the gateway-side verification.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { withTransaction } from '@/lib/db/pool';
import { becamePaid, lockOrderPaymentStatus, notifyWaPaymentConfirmed } from '@/lib/wa-payment-webhook';
import { sendOrderConfirmation, sendShopperOrderConfirmation } from '@/lib/notifications';
import type { PaymentTarget } from '@/lib/payment-target';

export type FinalizeOpts = {
    target: PaymentTarget;
    provider: 'moolre' | 'paystack';
    /** Gateway-side transaction id (Paystack data.id, Moolre transactionid). */
    transactionId: string | null;
};

export type FinalizeResult = {
    ok: boolean;
    /** The post-update row, jsonified. Useful for caller-side logging. */
    row: any;
    error?: string;
};

export async function finalizePayment(opts: FinalizeOpts): Promise<FinalizeResult> {
    const { target, provider, transactionId } = opts;

    if (target.kind === 'order') {
        // The order row is locked while it is marked paid, so two confirmations
        // arriving together (callback + verify) agree on which one made it paid.
        const { data: orderJson, error: updateError, before } = await withTransaction(async () => {
            const before = await lockOrderPaymentStatus(target.ref);
            const res = await supabaseAdmin.rpc('mark_order_paid', {
                order_ref: target.ref,
                moolre_ref: transactionId || `${provider}-verify`,
            });
            return { ...res, before };
        });
        if (updateError) {
            console.error('[finalizePayment] mark_order_paid RPC error:', updateError.message);
            return { ok: false, row: null, error: updateError.message };
        }

        // WhatsApp-agent orders: "payment confirmed" webhook (was a DB trigger).
        if (becamePaid(before, orderJson)) notifyWaPaymentConfirmed(orderJson);

        try {
            await supabaseAdmin
                .from('orders')
                .update({
                    payment_provider: provider,
                    payment_transaction_id: transactionId,
                })
                .eq('order_number', target.ref);
        } catch (tagErr: any) {
            console.warn('[finalizePayment] tag provider columns failed:', tagErr?.message);
        }

        if (orderJson?.email) {
            try {
                await supabaseAdmin.rpc('update_customer_stats', {
                    p_customer_email: orderJson.email,
                    p_order_total: orderJson.total,
                });
            } catch (statsError: any) {
                console.error('[finalizePayment] update_customer_stats failed:', statsError.message);
            }
        }

        if (orderJson) {
            try {
                await sendOrderConfirmation(orderJson);
            } catch (notifyError: any) {
                console.error('[finalizePayment] sendOrderConfirmation failed:', notifyError.message);
            }
        }

        return { ok: true, row: orderJson };
    }

    // Shopper request
    const { data: requestJson, error: updateError } = await supabaseAdmin.rpc(
        'mark_shopper_request_paid',
        { request_ref: target.ref, txn_ref: transactionId || `${provider}-verify` }
    );
    if (updateError) {
        console.error('[finalizePayment] mark_shopper_request_paid RPC error:', updateError.message);
        return { ok: false, row: null, error: updateError.message };
    }

    try {
        await supabaseAdmin
            .from('shopper_requests')
            .update({
                payment_provider: provider,
                payment_transaction_id: transactionId,
            })
            .eq('request_number', target.ref);
    } catch (tagErr: any) {
        console.warn('[finalizePayment] tag provider columns (shopper) failed:', tagErr?.message);
    }

    if (requestJson?.contact_email) {
        try {
            await supabaseAdmin.rpc('update_customer_stats', {
                p_customer_email: requestJson.contact_email,
                p_order_total: requestJson.total_final ?? requestJson.total_est ?? 0,
            });
        } catch (statsError: any) {
            console.error('[finalizePayment] update_customer_stats (shopper) failed:', statsError.message);
        }
    }

    if (requestJson) {
        try {
            await sendShopperOrderConfirmation(requestJson);
        } catch (notifyError: any) {
            console.error('[finalizePayment] sendShopperOrderConfirmation failed:', notifyError.message);
        }
    }

    return { ok: true, row: requestJson };
}
