import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyBrainBearer } from '../../_lib';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const authError = verifyBrainBearer(request);
  if (authError) return authError;

  try {
    const { id: orderId } = await context.params;

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, order_number, status, payment_status, total, created_at, phone')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const { data: items, error: itemsError } = await supabaseAdmin
      .from('order_items')
      .select('product_id, product_name, quantity, unit_price, total_price')
      .eq('order_id', orderId);

    if (itemsError) {
      return (console.error('[brain] database error:', itemsError.code || 'error'), NextResponse.json({ error: 'Failed to load order' }, { status: 500 }));
    }

    return NextResponse.json({
      order: {
        order_id: order.id,
        status: order.status,
        payment_status: order.payment_status,
        total: Number(order.total ?? 0),
        created_at: order.created_at,
        customer_phone: order.phone,
        items: (items || []).map((i: any) => ({
          product_id: i.product_id,
          name: i.product_name,
          quantity: i.quantity,
          unit_price: Number(i.unit_price ?? 0),
          total_price: Number(i.total_price ?? 0),
        })),
      },
    });
  } catch (error: any) {
    return (console.error('[brain] Failed to load order:', error?.code || error?.name || 'error'), NextResponse.json({ error: 'Failed to load order' }, { status: 500 }));
  }
}
