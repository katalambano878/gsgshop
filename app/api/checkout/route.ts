import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import {
  calculateDeliveryFee,
  methodNeedsDistance,
} from '@/lib/delivery-pricing';
import { getDeliverySettings } from '@/lib/delivery-settings';

/**
 * POST /api/checkout — server-side order creation.
 *
 * Why this exists:
 *   The client cannot create orders directly via the supabase-js anon client.
 *   The orders RLS combination (INSERT WITH CHECK + the SELECT policy that
 *   `INSERT ... RETURNING` enforces, plus the order_items WITH CHECK that
 *   joins back through orders) makes guest checkout impossible from the
 *   browser. We also do not want to trust client-supplied prices for an
 *   endpoint that drives real card payments. So this route owns order
 *   creation end to end, using the service role client to bypass RLS, and
 *   recomputes the totals from the products table.
 *
 * Request body (JSON):
 *   {
 *     items: Array<{ id: string; quantity: number; variant?: string }>,
 *     shipping: {
 *       firstName, lastName, email, phone, address, city, region
 *     },
 *     deliveryMethod: string,
 *     deliveryKm?: number,   // required for Sole/Joint/Free Delivery
 *     paymentMethod: 'moolre' | 'paystack',
 *     jointExpressNeighbor?: { name?: string; phone?: string },
 *   }
 *
 * Optional Authorization header (Bearer <jwt>) — when present and valid we
 * bind the order to that user's auth.uid().
 *
 * Response:
 *   { success: true, orderId, orderNumber, total, trackingNumber }
 *   { success: false, message }
 */

type CartItemInput = { id: string; quantity: number; variant?: string };

type ShippingInput = {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    region?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(message: string, status = 400) {
    return NextResponse.json({ success: false, message }, { status });
}

function generateOrderNumber() {
    const ts = Date.now();
    const rand = Math.floor(Math.random() * 1000);
    return `ORD-${ts}-${rand}`;
}

function generateTrackingNumber() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 6; i++) {
        id += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return `SLI-${id}`;
}

async function resolveAuthUserId(req: Request): Promise<string | null> {
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    if (!authHeader?.toLowerCase().startsWith('bearer ')) return null;
    const token = authHeader.slice(7).trim();
    if (!token) return null;

    try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
        const userScoped = createClient(url, anon, {
            auth: { autoRefreshToken: false, persistSession: false },
            global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data, error } = await userScoped.auth.getUser(token);
        if (error || !data.user) return null;
        return data.user.id;
    } catch {
        return null;
    }
}

export async function POST(req: Request) {
    try {
        const clientId = getClientIdentifier(req);
        const rateLimitResult = checkRateLimit(`checkout:${clientId}`, RATE_LIMITS.payment);
        if (!rateLimitResult.success) {
            return NextResponse.json(
                { success: false, message: 'Too many requests. Please try again later.' },
                {
                    status: 429,
                    headers: {
                        'X-RateLimit-Remaining': '0',
                        'X-RateLimit-Reset': rateLimitResult.resetIn.toString(),
                    },
                },
            );
        }

        const body = await req.json().catch(() => null);
        if (!body || typeof body !== 'object') return bad('Invalid request body');

        const items = Array.isArray(body.items) ? (body.items as CartItemInput[]) : [];
        const shipping = (body.shipping || {}) as ShippingInput;
        const deliveryMethod = typeof body.deliveryMethod === 'string' ? body.deliveryMethod : 'pickup';
        const deliveryKmRaw = Number(body.deliveryKm);
        const deliveryKm = Number.isFinite(deliveryKmRaw) ? Math.max(0, deliveryKmRaw) : 0;
        const paymentMethod: 'moolre' | 'paystack' =
            body.paymentMethod === 'paystack' ? 'paystack' : 'moolre';
        const jointExpressNeighbor = body.jointExpressNeighbor || null;
        // Exact map pin (optional) — lets riders navigate to the precise spot.
        const pinLat = Number(body.deliveryPin?.lat);
        const pinLng = Number(body.deliveryPin?.lng);
        const deliveryPin =
            Number.isFinite(pinLat) && Number.isFinite(pinLng) &&
            pinLat >= 4 && pinLat <= 12 && pinLng >= -4 && pinLng <= 2
                ? {
                    lat: pinLat,
                    lng: pinLng,
                    label: typeof body.deliveryPin?.label === 'string' ? body.deliveryPin.label.slice(0, 200) : null,
                }
                : null;

        if (items.length === 0) return bad('Cart is empty');
        for (const it of items) {
            if (!it || typeof it.id !== 'string' || !it.id) return bad('Invalid cart item');
            if (!Number.isInteger(it.quantity) || it.quantity <= 0 || it.quantity > 999) {
                return bad('Invalid item quantity');
            }
        }

        if (!shipping.email || !/\S+@\S+\.\S+/.test(shipping.email)) return bad('Invalid email');
        if (!shipping.firstName || !shipping.lastName) return bad('Missing customer name');
        if (!shipping.phone) return bad('Missing phone number');
        if (!shipping.address || !shipping.city || !shipping.region) return bad('Incomplete shipping address');

        if (methodNeedsDistance(deliveryMethod) && !(deliveryKm > 0)) {
            return bad('Delivery distance (km) is required for this delivery method');
        }
        if (deliveryKm > 500) {
            return bad('Delivery distance looks too high — please check the km value');
        }

        // Resolve product rows for everything in the cart, by UUID for
        // anything that looks like one and by slug for the rest. We use the
        // admin client throughout because the storefront's `products` SELECT
        // policy is fine for browsing but we want one consistent path.
        const uuidIds = items.filter((i) => UUID_RE.test(i.id)).map((i) => i.id);
        const slugIds = items.filter((i) => !UUID_RE.test(i.id)).map((i) => i.id);

        const productMap = new Map<string, { id: string; price: number; name: string; slug: string; metadata: any }>();
        const slugMap = new Map<string, string>(); // slug -> product.id

        if (uuidIds.length > 0) {
            const { data, error } = await supabaseAdmin
                .from('products')
                .select('id, name, slug, price, metadata, status')
                .in('id', uuidIds);
            if (error) {
                console.error('[checkout] products fetch (uuid) failed:', error.message);
                return bad('Failed to validate cart', 500);
            }
            for (const p of data || []) {
                if (p.status && p.status !== 'active') continue;
                productMap.set(p.id, { id: p.id, name: p.name, slug: p.slug, price: Number(p.price), metadata: p.metadata });
            }
        }

        if (slugIds.length > 0) {
            const { data, error } = await supabaseAdmin
                .from('products')
                .select('id, name, slug, price, metadata, status')
                .in('slug', slugIds);
            if (error) {
                console.error('[checkout] products fetch (slug) failed:', error.message);
                return bad('Failed to validate cart', 500);
            }
            for (const p of data || []) {
                if (p.status && p.status !== 'active') continue;
                productMap.set(p.id, { id: p.id, name: p.name, slug: p.slug, price: Number(p.price), metadata: p.metadata });
                slugMap.set(p.slug, p.id);
            }
        }

        // Resolve each cart line back to a product row + authoritative price.
        const orderItemsPayload: Array<{
            product_id: string;
            product_name: string;
            variant_name: string | null;
            quantity: number;
            unit_price: number;
            total_price: number;
            metadata: Record<string, unknown>;
        }> = [];
        let subtotal = 0;

        for (const it of items) {
            const productId = UUID_RE.test(it.id) ? it.id : slugMap.get(it.id);
            const product = productId ? productMap.get(productId) : undefined;
            if (!product) {
                return bad(`Product not available: ${it.id}`, 400);
            }
            const unit = Number(product.price);
            if (!Number.isFinite(unit) || unit < 0) {
                return bad(`Invalid product price for ${product.name}`, 500);
            }
            const lineTotal = unit * it.quantity;
            subtotal += lineTotal;
            orderItemsPayload.push({
                product_id: product.id,
                product_name: product.name,
                variant_name: typeof it.variant === 'string' ? it.variant : null,
                quantity: it.quantity,
                unit_price: unit,
                total_price: lineTotal,
                metadata: {
                    slug: product.slug,
                    image: (product.metadata as any)?.image ?? null,
                    preorder_shipping: (product.metadata as any)?.preorder_shipping ?? null,
                },
            });
        }

        // SECURITY: recompute delivery fee server-side from the live admin
        // pricing settings. Never trust a client-supplied shipping amount.
        const deliverySettings = await getDeliverySettings();
        const delivery = calculateDeliveryFee({
            method: deliveryMethod,
            km: deliveryKm,
            purchaseTotal: subtotal,
            config: deliverySettings.pricing,
        });
        const shippingCost = delivery.fee;
        const tax = 0;
        const total = subtotal + shippingCost + tax;
        if (!Number.isFinite(total) || total <= 0) return bad('Invalid order total', 400);

        const userId = await resolveAuthUserId(req);

        const orderNumber = generateOrderNumber();
        const trackingNumber = generateTrackingNumber();

        const { data: order, error: orderError } = await supabaseAdmin
            .from('orders')
            .insert([
                {
                    order_number: orderNumber,
                    user_id: userId,
                    email: shipping.email,
                    phone: shipping.phone,
                    status: 'pending',
                    payment_status: 'pending',
                    currency: 'GHS',
                    subtotal,
                    tax_total: tax,
                    shipping_total: shippingCost,
                    discount_total: 0,
                    total,
                    shipping_method: deliveryMethod,
                    payment_method: paymentMethod,
                    shipping_address: shipping,
                    billing_address: shipping,
                    metadata: {
                        guest_checkout: !userId,
                        first_name: shipping.firstName,
                        last_name: shipping.lastName,
                        tracking_number: trackingNumber,
                        delivery_km: deliveryKm,
                        ...(deliveryPin ? { delivery_pin: deliveryPin } : {}),
                        delivery_formula: delivery.formulaLabel,
                        delivery_breakdown: {
                            distance_component: delivery.distanceComponent,
                            purchase_component: delivery.purchaseComponent,
                            raw_total: delivery.rawTotal,
                            fee: delivery.fee,
                        },
                        ...(deliveryMethod === 'joint-express' && jointExpressNeighbor
                            ? { joint_express_neighbor: jointExpressNeighbor }
                            : {}),
                    },
                },
            ])
            .select('id, order_number, total')
            .single();

        if (orderError || !order) {
            console.error('[checkout] order insert failed:', orderError?.message, orderError);
            return bad('Failed to create order', 500);
        }

        const itemsRows = orderItemsPayload.map((row) => ({ ...row, order_id: order.id }));
        const { error: itemsError } = await supabaseAdmin.from('order_items').insert(itemsRows);
        if (itemsError) {
            console.error('[checkout] order_items insert failed:', itemsError.message, itemsError);
            // Roll back the order so payment doesn't get initiated against
            // an order with no line items.
            await supabaseAdmin.from('orders').delete().eq('id', order.id);
            return bad('Failed to create order items', 500);
        }

        // Customer record — fire and forget, don't fail the order if this
        // misbehaves.
        try {
            const fullName = `${shipping.firstName ?? ''} ${shipping.lastName ?? ''}`.trim();
            await supabaseAdmin.rpc('upsert_customer_from_order', {
                p_email: shipping.email,
                p_phone: shipping.phone,
                p_full_name: fullName,
                p_first_name: shipping.firstName,
                p_last_name: shipping.lastName,
                p_user_id: userId,
                p_address: shipping,
            });
        } catch (e: any) {
            console.warn('[checkout] upsert_customer_from_order failed:', e?.message);
        }

        return NextResponse.json({
            success: true,
            orderId: order.id,
            orderNumber: order.order_number,
            total: Number(order.total),
            trackingNumber,
        });
    } catch (err: any) {
        console.error('[checkout] error:', err?.message || err);
        return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
    }
}
