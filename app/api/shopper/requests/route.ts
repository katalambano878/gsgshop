import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAuth } from '@/lib/auth';
import { calculateDeliveryFee } from '@/lib/delivery-pricing';
import { getDeliverySettings, shopperMarkupAmount } from '@/lib/delivery-settings';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      items, contactName, contactPhone, contactEmail,
      deliveryAddress, preferredTime, notes,
      subtotalEst,
    } = body;
    // "markup" is the canonical name; we still accept "commission" so any
    // stale client bundle out in the wild keeps working until everyone
    // has re-fetched the new shopping-list page.
    const markup = body.markup ?? body.commission;

    // Optional auth
    const authResult = await verifyAuth(request);
    const userId = authResult.authenticated && authResult.user ? authResult.user.id : null;

    // SECURITY: recompute the delivery fee server-side from the live admin
    // pricing settings — never trust the client's fee. Older client bundles
    // that don't send a method fall back to the pre-fee behaviour (fee 0).
    const deliveryKmRaw = Number(body.deliveryKm);
    const deliveryKm = Number.isFinite(deliveryKmRaw) ? Math.max(0, Math.min(500, deliveryKmRaw)) : 0;
    const deliveryMethod =
      body.deliveryMethod === 'joint-express' || body.deliveryMethod === 'sole-express'
        ? body.deliveryMethod
        : null;

    const settings = await getDeliverySettings();
    let deliveryFee = 0;
    if (deliveryMethod && deliveryKm > 0) {
      deliveryFee = calculateDeliveryFee({
        method: deliveryMethod,
        km: deliveryKm,
        purchaseTotal: Math.max(0, Number(subtotalEst) || 0),
        config: settings.pricing,
      }).fee;
    }

    const safeSubtotal = Math.max(0, Number(subtotalEst) || 0);
    // Ignore the number the browser sent. Markup always follows the admin setting.
    void markup;
    const safeMarkup = shopperMarkupAmount(safeSubtotal, settings.shopperMarkupPct);
    const totalEst = safeSubtotal + safeMarkup + deliveryFee;

    // 1. Create Request
    //
    // Per docs/shopper-implementation-plan.md (section 7): customers pay the
    // total estimate UPFRONT at submission. We lock in
    // total_final = totalEst (items + markup + delivery fee) so the /pay/[id]
    // page treats the request as immediately payable. The admin can still
    // recompute the total later via /api/shopper/requests/[id]/finalize if
    // market prices differ — that endpoint overwrites total_final, which the
    // customer sees on their next /track or /pay load.
    const { data: requestData, error: requestError } = await supabaseAdmin
      .from('shopper_requests')
      .insert({
        user_id: userId,
        status: 'SUBMITTED',
        subtotal_est: safeSubtotal,
        markup: safeMarkup,
        total_est: totalEst,
        total_final: totalEst,
        delivery_fee: deliveryFee,
        notes: notes,
        delivery_address: {
          ...(deliveryAddress && typeof deliveryAddress === 'object' ? deliveryAddress : { text: String(deliveryAddress || '') }),
          km: deliveryKm || undefined,
          method: deliveryMethod || undefined,
        },
        preferred_time: preferredTime,
        contact_name: contactName,
        contact_phone: contactPhone,
        contact_email: contactEmail
      })
      .select('id, request_number')
      .single();

    if (requestError) throw requestError;

    // 2. Create Items
    const itemsToInsert = items.map((item: any) => ({
      request_id: requestData.id,
      name_brand: item.nameBrand,
      qty_size_range: item.qtySizeRange,
      remark: item.remark,
      estimated_price: parseFloat(item.estimatedPrice) || 0,
      source_type: item.sourceType || null
    }));

    const { error: itemsError } = await supabaseAdmin
      .from('shopper_request_items')
      .insert(itemsToInsert);

    if (itemsError) throw itemsError;

    // 3. Create initial status history
    await supabaseAdmin
      .from('shopper_status_history')
      .insert({
        request_id: requestData.id,
        status: 'SUBMITTED',
        note: 'Request submitted by customer',
        created_by: userId
      });

    return NextResponse.json({
      id: requestData.id,
      request_number: requestData.request_number,
      success: true,
    });

  } catch (error: any) {
    console.error('Shopper Request Error:', error);
    return NextResponse.json({ error: error.message || 'Failed to submit request' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const phone = searchParams.get('phone');

    let query = supabaseAdmin
      .from('shopper_requests')
      .select(`
        *,
        items:shopper_request_items(*),
        history:shopper_status_history(*)
      `)
      .order('created_at', { ascending: false });

    if (id) {
      query = query.eq('id', id);
    } else if (phone) {
      query = query.eq('contact_phone', phone);
    } else {
      // Require admin to list all
      const authResult = await verifyAuth(request, { requireAdmin: true });
      if (!authResult.authenticated) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json(id ? data[0] : data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
