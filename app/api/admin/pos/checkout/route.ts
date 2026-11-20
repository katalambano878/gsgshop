import { NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/db/pool';
import { checkRateLimit } from '@/lib/rate-limit';
import { normalizeGhanaPhone, phoneLast9 } from '@/lib/phone';
import { sendOrderConfirmation } from '@/lib/notifications';
import {
  EMAIL_RE,
  HttpError,
  POS_WALKIN_EMAIL,
  UUID_RE,
  errorResponse,
  fromPesewas,
  gate,
  readJson,
  str,
  toPesewas,
} from '@/app/api/admin/_lib/shared';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Till checkout (admin or staff).
 *
 * POST {
 *   idempotencyKey: string (8-80 of A-Z a-z 0-9 _ -; make it when the checkout opens and reuse it on retry),
 *   items: [{ productId, variantId?, quantity }],
 *   customer: { id?, name?, phone?, email? },
 *   paymentMethod: 'cash' | 'card' | 'momo',
 *   amountTendered?: number (required for cash, at least the total),
 *   cardReference?: string (terminal/slip reference, stored on the order),
 *   deliveryMethod?: 'pickup' | 'delivery' (default 'pickup'; the till charges no delivery),
 *   expectedTotal?: number (the total the till showed; a mismatch returns 409 price_changed),
 *   note?: string
 * }
 *
 * 200 { order, items, replayed, amountTendered, changeDue, oversold: [{ name, available }] }
 *   order: the orders row; items: its order_items rows.
 *   replayed: true when this key already made a sale (that sale is returned; nothing new is sold).
 *   oversold: tracked items sold beyond the stock on record (a warning; the sale still went through).
 * 409 { error, code: 'price_changed', total, prices: [{ productId, variantId, unitPrice }] }
 * 400 { error }  401/403 { error }  429 { error }
 *
 * Prices come from the database. Order, items, stock and customer totals are
 * written in one transaction. Cash and card sales are paid at once
 * (mark_order_paid takes the stock). Mobile Money leaves a pending order: the
 * till then calls POST /api/payment/moolre with { orderId: order.order_number,
 * orderUuid: order.id } and the staff token; a retry with the same key returns
 * the same pending order instead of making another.
 *
 * Walk-in customers are matched by phone (last 9 digits), then email, else
 * created (key email <233XXXXXXXXX>@pos.local when no email is given). The
 * order carries the same email key and phone, so the order and the customer
 * record line up and the customer's totals include till sales.
 */

const KEY_RE = /^[A-Za-z0-9_-]{8,80}$/;
const MAX_LINES = 200;
const MAX_QTY = 10_000;
const CHECKOUT_LIMIT = { maxRequests: 30, windowSeconds: 60 };

type Wanted = { productId: string; variantId: string | null; quantity: number };

function orderNumber() {
  return `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

async function loadOrderWithItems(orderId: string) {
  const { rows: orders } = await query<any>(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  const { rows: items } = await query<any>(
    `SELECT id, product_id, variant_id, product_name, variant_name, sku, quantity, unit_price, total_price, metadata
       FROM order_items WHERE order_id = $1 ORDER BY created_at, id`,
    [orderId],
  );
  return { order: orders[0], items };
}

/**
 * Finds or creates the customer for a till sale. Returns the customer's id,
 * email key and phone, or null when the buyer gave nothing to match on.
 */
async function resolveCustomer(input: {
  id: string | null;
  name: string;
  phone: string | null;
  email: string;
}): Promise<{ id: string; email: string; phone: string | null } | null> {
  const pick = async (sql: string, params: unknown[]) => {
    const { rows } = await query<{ id: string; email: string; phone: string | null }>(sql, params);
    return rows[0] || null;
  };

  let found: { id: string; email: string; phone: string | null } | null = null;
  if (input.id) {
    found = await pick(`SELECT id, email, phone FROM customers WHERE id = $1`, [input.id]);
    if (!found) throw new HttpError(400, 'The chosen customer no longer exists. Pick them again or sell as a walk-in.');
  }
  const last9 = phoneLast9(input.phone);
  if (!found && last9) {
    found = await pick(
      `SELECT id, email, phone FROM customers
        WHERE right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 9) = $1
           OR right(regexp_replace(coalesce(secondary_phone, ''), '\\D', '', 'g'), 9) = $1
        ORDER BY (user_id IS NOT NULL) DESC, created_at
        LIMIT 1`,
      [last9],
    );
  }
  if (!found && input.email) {
    found = await pick(
      `SELECT id, email, phone FROM customers
        WHERE lower(email) = $1 OR lower(coalesce(secondary_email, '')) = $1
        LIMIT 1`,
      [input.email],
    );
  }

  if (found) {
    await query(
      `UPDATE customers
          SET full_name = COALESCE(NULLIF(full_name, ''), NULLIF($2, '')),
              phone = COALESCE(NULLIF(phone, ''), $3),
              updated_at = now()
        WHERE id = $1`,
      [found.id, input.name, input.phone],
    );
    return { id: found.id, email: found.email, phone: found.phone || input.phone };
  }

  if (!input.phone && !input.email) return null;

  const keyEmail = input.email || `${(input.phone || '').replace(/\D/g, '')}@pos.local`;
  const [first, ...rest] = input.name.split(/\s+/).filter(Boolean);
  const { rows } = await query<{ id: string; email: string; phone: string | null }>(
    `INSERT INTO customers (email, phone, full_name, first_name, last_name)
     VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, ''))
     ON CONFLICT (email) DO UPDATE SET updated_at = now()
     RETURNING id, email, phone`,
    [keyEmail, input.phone, input.name, first || '', rest.join(' ')],
  );
  return rows[0] || null;
}

export async function POST(request: Request) {
  const g = await gate(request, ['admin', 'staff']);
  if (g.response) return g.response;
  const actor = g.actor;

  if (!checkRateLimit(`pos-checkout:${actor.id}`, CHECKOUT_LIMIT).success) {
    return NextResponse.json({ error: 'Too many sales in a minute. Wait a moment and try again.' }, { status: 429 });
  }

  const body = await readJson(request);
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  // ---- validate ----------------------------------------------------------
  const idempotencyKey = str(body.idempotencyKey, 80);
  if (!KEY_RE.test(idempotencyKey)) {
    return NextResponse.json({ error: 'Missing or invalid idempotencyKey' }, { status: 400 });
  }

  const paymentMethod = str(body.paymentMethod, 10);
  if (!['cash', 'card', 'momo'].includes(paymentMethod)) {
    return NextResponse.json({ error: 'Payment method must be cash, card or momo' }, { status: 400 });
  }
  const paidNow = paymentMethod !== 'momo';

  const rawItems: any[] = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) return NextResponse.json({ error: 'The cart is empty' }, { status: 400 });
  if (rawItems.length > MAX_LINES) {
    return NextResponse.json({ error: `At most ${MAX_LINES} lines per sale` }, { status: 400 });
  }
  const wanted = new Map<string, Wanted>();
  for (const raw of rawItems) {
    const productId = str(raw?.productId, 40);
    const variantId = raw?.variantId ? str(raw.variantId, 40) : null;
    const quantity = Number(raw?.quantity);
    if (!UUID_RE.test(productId) || (variantId !== null && !UUID_RE.test(variantId))) {
      return NextResponse.json({ error: 'Invalid product in the cart' }, { status: 400 });
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
      return NextResponse.json({ error: 'Each quantity must be a whole number of at least 1' }, { status: 400 });
    }
    const key = `${productId}:${variantId || ''}`;
    const prev = wanted.get(key);
    if (prev) prev.quantity += quantity;
    else wanted.set(key, { productId, variantId, quantity });
  }

  const customerIn = body.customer && typeof body.customer === 'object' ? body.customer : {};
  const customerId = customerIn.id ? str(customerIn.id, 40) : null;
  if (customerId && !UUID_RE.test(customerId)) {
    return NextResponse.json({ error: 'Invalid customer' }, { status: 400 });
  }
  const customerName = str(customerIn.name, 120);
  const customerEmail = str(customerIn.email, 254).toLowerCase();
  if (customerEmail && !EMAIL_RE.test(customerEmail)) {
    return NextResponse.json({ error: 'Customer email is not valid' }, { status: 400 });
  }
  const phoneTyped = str(customerIn.phone, 30);
  const customerPhone = phoneTyped ? normalizeGhanaPhone(phoneTyped) : null;
  if (phoneTyped && !customerPhone) {
    return NextResponse.json({ error: 'Enter a valid Ghana phone number (for example 024 123 4567)' }, { status: 400 });
  }
  if (paymentMethod === 'momo' && !customerPhone && !customerId) {
    return NextResponse.json({ error: 'A phone number is needed for Mobile Money' }, { status: 400 });
  }

  const deliveryMethod = str(body.deliveryMethod, 20) === 'delivery' ? 'delivery' : 'pickup';
  const cardReference = paymentMethod === 'card' ? str(body.cardReference, 80) : '';
  const note = str(body.note, 1000);

  const tenderedP = toPesewas(body.amountTendered);
  const hasTendered = body.amountTendered !== undefined && body.amountTendered !== null && body.amountTendered !== '';
  if (hasTendered && (!Number.isFinite(tenderedP) || tenderedP < 0)) {
    return NextResponse.json({ error: 'Amount tendered is not valid' }, { status: 400 });
  }
  const expectedTotalP = toPesewas(body.expectedTotal);

  try {
    const result = await withTransaction(async () => {
      // Same key: one sale. Serialise concurrent requests with the key.
      await query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pos-checkout:${idempotencyKey}`]);
      const { rows: prior } = await query<{ id: string }>(
        `SELECT id FROM orders WHERE metadata->>'idempotency_key' = $1 LIMIT 1`,
        [idempotencyKey],
      );
      if (prior[0]) {
        return { ...(await loadOrderWithItems(prior[0].id)), replayed: true, oversold: [] as any[], paid: null as any };
      }

      // ---- price every line from the database (rows locked for the stock check)
      const productIds = [...new Set([...wanted.values()].map((w) => w.productId))];
      const { rows: products } = await query<any>(
        `SELECT p.id, p.name, p.price, p.sku, p.status::text AS status, p.quantity,
                COALESCE(p.track_quantity, true) AS track_quantity,
                COALESCE(p.continue_selling, false) AS continue_selling,
                (SELECT url FROM product_images i WHERE i.product_id = p.id
                  ORDER BY i.position NULLS LAST, i.created_at LIMIT 1) AS image
           FROM products p WHERE p.id = ANY($1::uuid[])
           FOR UPDATE`,
        [productIds],
      );
      const { rows: variants } = await query<any>(
        `SELECT id, product_id, name, sku, price, quantity, image_url
           FROM product_variants WHERE product_id = ANY($1::uuid[])
           FOR UPDATE`,
        [productIds],
      );
      const byId = new Map(products.map((p) => [p.id, p]));
      const variantsOf = new Map<string, any[]>();
      for (const v of variants) {
        const list = variantsOf.get(v.product_id) || [];
        list.push(v);
        variantsOf.set(v.product_id, list);
      }

      let subtotalP = 0;
      const oversold: { name: string; available: number }[] = [];
      const lines = [...wanted.values()].map((w) => {
        const product = byId.get(w.productId);
        if (!product) throw new HttpError(400, 'A product in the cart no longer exists. Remove it and try again.');
        if (product.status !== 'active') {
          throw new HttpError(400, `"${product.name}" is not an active product and cannot be sold. Remove it from the cart.`);
        }
        const options = variantsOf.get(product.id) || [];
        let variant: any = null;
        if (w.variantId) {
          variant = options.find((v) => v.id === w.variantId);
          if (!variant) throw new HttpError(400, `An option of "${product.name}" no longer exists. Remove it and add it again.`);
        } else if (options.length > 0) {
          throw new HttpError(400, `Choose an option (size, colour…) for "${product.name}". Remove it and add it again.`);
        }

        const unitP = toPesewas(variant ? variant.price ?? product.price : product.price);
        if (!Number.isFinite(unitP) || unitP <= 0) {
          throw new HttpError(400, `"${product.name}" has no price. Save a price for it first.`);
        }
        const lineP = unitP * w.quantity;
        subtotalP += lineP;

        const name = variant ? `${product.name} (${variant.name})` : product.name;
        if (product.track_quantity && !product.continue_selling) {
          const available = Number(variant ? variant.quantity : product.quantity) || 0;
          if (w.quantity > available) oversold.push({ name, available });
        }

        return {
          product_id: product.id,
          variant_id: variant?.id || null,
          product_name: product.name,
          variant_name: variant ? variant.name : null,
          sku: variant?.sku || product.sku || null,
          quantity: w.quantity,
          unitP,
          lineP,
          image: variant?.image_url || product.image || null,
        };
      });

      const totalP = subtotalP;
      if (Number.isFinite(expectedTotalP) && expectedTotalP !== totalP) {
        throw new HttpError(409, 'A price has changed. The total has been refreshed: check it, then complete the sale again.', {
          code: 'price_changed',
          total: fromPesewas(totalP),
          prices: lines.map((l) => ({ productId: l.product_id, variantId: l.variant_id, unitPrice: fromPesewas(l.unitP) })),
        });
      }
      if (paymentMethod === 'cash' && (!hasTendered || tenderedP < totalP)) {
        throw new HttpError(400, 'The amount tendered is less than the total.');
      }

      // ---- customer: saving it must never cost the sale -----------------
      let customer: { id: string; email: string; phone: string | null } | null = null;
      await query('SAVEPOINT pos_customer');
      try {
        customer = await resolveCustomer({ id: customerId, name: customerName, phone: customerPhone, email: customerEmail });
        await query('RELEASE SAVEPOINT pos_customer');
      } catch (custErr: any) {
        await query('ROLLBACK TO SAVEPOINT pos_customer');
        if (custErr instanceof HttpError) throw custErr;
        console.error('[admin/pos/checkout] customer save failed (sale continues):', custErr?.message);
        customer = null;
      }
      const orderPhone = customerPhone || customer?.phone || null;
      if (paymentMethod === 'momo' && !orderPhone) {
        throw new HttpError(400, 'A phone number is needed for Mobile Money');
      }

      // ---- order + items -------------------------------------------------
      const [firstName, ...restName] = customerName.split(/\s+/).filter(Boolean);
      const address = {
        firstName: firstName || '',
        lastName: restName.join(' '),
        full_name: customerName || null,
        email: customerEmail || null,
        phone: orderPhone,
        pos_sale: true,
      };
      const ref = orderNumber();
      const metadata: Record<string, unknown> = {
        pos_sale: true,
        source: 'pos',
        first_name: address.firstName,
        last_name: address.lastName,
        phone: orderPhone,
        idempotency_key: idempotencyKey,
        pos_cashier_id: actor.id,
        pos_payment_method: paymentMethod,
        ...(customer ? { customer_id: customer.id, customer_email: customer.email } : {}),
        ...(cardReference ? { card_reference: cardReference } : {}),
        ...(paymentMethod === 'cash'
          ? { amount_tendered: fromPesewas(tenderedP), change_due: fromPesewas(tenderedP - totalP) }
          : {}),
        ...(oversold.length ? { oversold } : {}),
      };

      const { rows: inserted } = await query<{ id: string }>(
        `INSERT INTO orders (order_number, user_id, email, phone, status, payment_status, currency,
                             subtotal, tax_total, shipping_total, discount_total, total,
                             shipping_method, payment_method, notes, shipping_address, billing_address, metadata)
         VALUES ($1, NULL, $2, $3, 'pending', 'pending', 'GHS', $4, 0, 0, 0, $4,
                 $5, $6, NULLIF($7, ''), $8::jsonb, $8::jsonb, $9::jsonb)
         RETURNING id`,
        [
          ref,
          customerEmail || customer?.email || POS_WALKIN_EMAIL,
          orderPhone,
          fromPesewas(totalP),
          deliveryMethod,
          paidNow ? paymentMethod : 'moolre',
          note,
          JSON.stringify(address),
          JSON.stringify(metadata),
        ],
      );
      const orderId = inserted[0].id;

      for (const l of lines) {
        await query(
          `INSERT INTO order_items (order_id, product_id, variant_id, product_name, variant_name, sku,
                                    quantity, unit_price, total_price, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
          [
            orderId,
            l.product_id,
            l.variant_id,
            l.product_name,
            l.variant_name,
            l.sku,
            l.quantity,
            fromPesewas(l.unitP),
            fromPesewas(l.lineP),
            JSON.stringify({ image: l.image, pos_sale: true }),
          ],
        );
      }

      let paid: any = null;
      if (paidNow) {
        const { rows: paidRows } = await query<{ j: any }>(`SELECT public.mark_order_paid($1, $2) AS j`, [
          ref,
          `pos-${paymentMethod}-${cardReference || ref}`,
        ]);
        paid = paidRows[0]?.j;
        if (!paid || paid.payment_status !== 'paid') throw new Error('mark_order_paid did not mark the till sale paid');
        await query(
          `INSERT INTO order_status_history (order_id, status, notes, created_by)
           VALUES ($1, $2::order_status, $3, $4)`,
          [orderId, paid.status || 'processing', `Till sale paid by ${paymentMethod}${cardReference ? ` (ref ${cardReference})` : ''}`, actor.id],
        );
        // Customer totals follow paid orders; a missing function must not cost the sale.
        await query('SAVEPOINT pos_stats');
        try {
          await query('SELECT public.recompute_customer_stats_for_order($1)', [orderId]);
          await query('RELEASE SAVEPOINT pos_stats');
        } catch (statsErr: any) {
          await query('ROLLBACK TO SAVEPOINT pos_stats');
          console.error('[admin/pos/checkout] customer totals not refreshed:', statsErr?.message);
        }
      } else {
        await query(
          `INSERT INTO order_status_history (order_id, status, notes, created_by)
           VALUES ($1, 'pending', 'Till sale waiting for Mobile Money payment', $2)`,
          [orderId, actor.id],
        );
      }

      return { ...(await loadOrderWithItems(orderId)), replayed: false, oversold, paid };
    });

    // After commit: the usual paid-order confirmation (SMS) when the buyer gave a phone.
    if (!result.replayed && result.paid && result.order?.phone) {
      try {
        await sendOrderConfirmation(result.order);
      } catch (notifyErr: any) {
        console.error('[admin/pos/checkout] confirmation failed:', notifyErr?.message);
      }
    }

    const order: any = result.order;
    const tendered = Number(order?.metadata?.amount_tendered);
    const changeDue = Number(order?.metadata?.change_due);
    const oversold = result.replayed
      ? Array.isArray(order?.metadata?.oversold) ? order.metadata.oversold : []
      : result.oversold;
    return NextResponse.json({
      order,
      items: result.items,
      replayed: result.replayed,
      amountTendered: Number.isFinite(tendered) ? tendered : null,
      changeDue: Number.isFinite(changeDue) ? changeDue : 0,
      oversold,
    });
  } catch (err) {
    return errorResponse(err, 'The sale was not saved and no stock was taken. Try again.', 'admin/pos/checkout');
  }
}
