import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAuth } from '@/lib/auth';
import { sendShopperPaymentLink } from '@/lib/notifications';
import { getDeliverySettings, shopperMarkupAmount } from '@/lib/delivery-settings';

/**
 * Admin-only.
 *
 * PATCH /api/shopper/requests/[id]/finalize
 *
 * Body:
 *   {
 *     deliveryFee?: number;        // GHS, defaults to whatever is on the row
 *     totalFinal?: number;         // explicit override; otherwise computed
 *     setStatus?: boolean;         // flip status to AWAITING_CONFIRMATION
 *     sendPaymentLink?: boolean;   // email + SMS the customer the pay link
 *   }
 *
 * If totalFinal is not supplied we compute it from:
 *   sum(market_price ?? estimated_price) + markup (admin %) + delivery_fee
 *
 * Always responds with the updated row (or the existing one if no changes).
 */
export async function PATCH(
    request: Request,
    context: { params: Promise<{ id: string }> },
) {
    const auth = await verifyAuth(request, { requireAdmin: true });
    if (!auth.authenticated) {
        return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: 'Missing request id' }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const explicitDeliveryFee = typeof body.deliveryFee === 'number' && Number.isFinite(body.deliveryFee)
        ? Math.max(0, body.deliveryFee)
        : null;
    const explicitTotalFinal = typeof body.totalFinal === 'number' && Number.isFinite(body.totalFinal)
        ? Math.max(0, body.totalFinal)
        : null;
    const setStatus = body.setStatus !== false; // default true
    const wantSendLink = !!body.sendPaymentLink;

    const { data: req0, error: req0Err } = await supabaseAdmin
        .from('shopper_requests')
        .select('id, request_number, status, payment_status, markup, delivery_fee, total_est, total_final, contact_email, contact_phone, contact_name, items:shopper_request_items(id, estimated_price, market_price)')
        .eq('id', id)
        .single();

    if (req0Err || !req0) {
        return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    if (req0.payment_status === 'paid') {
        return NextResponse.json({ error: 'Request is already paid' }, { status: 400 });
    }

    // Compute the canonical total from the line items, using market_price when
    // present (admin has confirmed it) and falling back to estimated_price.
    const itemsSubtotal = (req0.items || []).reduce((sum: number, it: any) => {
        const price = it.market_price !== null && it.market_price !== undefined
            ? Number(it.market_price)
            : Number(it.estimated_price);
        return sum + (Number.isFinite(price) ? price : 0);
    }, 0);

    // Re-derive markup off the (possibly updated) subtotal so we don't ship
    // an outdated markup number from when the customer first submitted the
    // list. Falls back to the row's stored markup if subtotal is zero.
    const { shopperMarkupPct } = await getDeliverySettings();
    const markup = itemsSubtotal > 0
        ? shopperMarkupAmount(itemsSubtotal, shopperMarkupPct)
        : Number(req0.markup ?? 0);

    const deliveryFee = explicitDeliveryFee !== null
        ? explicitDeliveryFee
        : Number(req0.delivery_fee ?? 0);

    const computed = Math.round((itemsSubtotal + markup + deliveryFee) * 100) / 100;
    const totalFinal = explicitTotalFinal !== null ? explicitTotalFinal : computed;

    if (totalFinal <= 0) {
        return NextResponse.json({ error: 'Computed total is 0 — set market prices first' }, { status: 400 });
    }

    const update: Record<string, any> = {
        markup,
        delivery_fee: deliveryFee,
        total_final: totalFinal,
        updated_at: new Date().toISOString(),
    };
    if (setStatus && req0.status !== 'PAID' && req0.status !== 'AWAITING_CONFIRMATION') {
        update.status = 'AWAITING_CONFIRMATION';
    } else if (setStatus && req0.status !== 'PAID') {
        update.status = 'AWAITING_CONFIRMATION';
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
        .from('shopper_requests')
        .update(update)
        .eq('id', id)
        .select('id, request_number, status, payment_status, markup, delivery_fee, total_est, total_final, contact_email, contact_phone, contact_name')
        .single();

    if (updateErr || !updated) {
        console.error('[shopper/finalize] update failed:', updateErr?.message);
        return NextResponse.json({ error: 'Failed to update request' }, { status: 500 });
    }

    if (update.status === 'AWAITING_CONFIRMATION') {
        try {
            await supabaseAdmin
                .from('shopper_status_history')
                .insert({
                    request_id: updated.id,
                    status: 'AWAITING_CONFIRMATION',
                    note: `Total finalized at GH₵${totalFinal.toFixed(2)} by ${auth.user?.email || 'admin'}`,
                });
        } catch (e: any) {
            console.warn('[shopper/finalize] history insert failed:', e?.message);
        }
    }

    if (wantSendLink) {
        try {
            await sendShopperPaymentLink(updated);
        } catch (e: any) {
            console.error('[shopper/finalize] sendShopperPaymentLink failed:', e?.message);
            return NextResponse.json({
                success: true,
                request: updated,
                warning: `Total saved but payment link failed: ${e?.message}`,
            });
        }
    }

    return NextResponse.json({ success: true, request: updated });
}
