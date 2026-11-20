import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { withTransaction } from '@/lib/db/pool';
import { verifyAuth } from '@/lib/auth';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import { calculateDeliveryFee, methodNeedsDistance } from '@/lib/delivery-pricing';
import { getDeliverySettings } from '@/lib/delivery-settings';
import { deliveryKmForPin, isGhanaPin } from '@/lib/google-maps-delivery';
import { isGhanaPhone, normalizeGhanaPhone } from '@/lib/phone';
import { checkoutPlaceholderEmail } from '@/lib/placeholder-email';
import { evaluateCoupon, normalizeCouponCode } from '@/app/api/storefront/coupons/validate-coupon';
import { isBrainCaller } from '@/app/api/shopper/_lib';

export const dynamic = 'force-dynamic';

/**
 * POST /api/checkout — server-side order creation. Everything that decides
 * money is worked out here from the database; the browser's prices, km and
 * totals are ignored (`clientTotal` is only compared, to report priceChanged).
 *
 * Body: { items: [{ id, quantity, variantId?, variant? }],
 *         shipping: { firstName, lastName, email?, phone, address, city, region },
 *         deliveryMethod, deliveryPin?: { lat, lng, label? }, deliveryKm? (ignored),
 *         couponCode?, paymentMethod: 'moolre' | 'paystack',
 *         jointExpressNeighbor?: { name?, phone? }, clientTotal? }
 * Optional `Authorization: Bearer <token>` binds the order to that user.
 *
 * 200 → { success: true, orderId, orderNumber, total, subtotal, shippingTotal,
 *         discountTotal, shippingMethod, trackingNumber, deliveryKm,
 *         priceChanged, items: [{ name, variant, quantity, unitPrice, lineTotal }] }
 * 4xx → { success: false, message, code?, unavailable? }
 *       code: invalid_phone | distance_required | unavailable | out_of_stock |
 *             coupon_invalid | invalid_items
 *
 * No customer record is written here: that happens once, when the order is
 * paid (lib/payment-finalize.ts).
 */

type CartItemInput = { id?: unknown; quantity?: unknown; variantId?: unknown; variant?: unknown };

type ErrCode = 'invalid_phone' | 'distance_required' | 'unavailable' | 'out_of_stock' | 'coupon_invalid' | 'invalid_items';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,199}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LINES = 100;
const MAX_QTY = 999;
const DELIVERY_METHODS = new Set(['pickup', 'free-delivery', 'sole-express', 'joint-express', 'personal-shopper']);

function bad(message: string, status = 400, extra?: { code?: ErrCode; unavailable?: string[] }) {
    return NextResponse.json({ success: false, message, ...(extra || {}) }, { status });
}

function round2(n: number) {
    return Math.round(n * 100) / 100;
}

function text(v: unknown, max: number): string {
    return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
function randomCode(len: number): string {
    const bytes = randomBytes(len);
    let out = '';
    for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
    return out;
}

/** Unguessable order number (the old ORD-<ms>-<0..999> could be enumerated). */
function generateOrderNumber() {
    return `ORD-${randomCode(12)}`;
}

function generateTrackingNumber() {
    return `SLI-${randomCode(8)}`;
}

async function resolveAuthUserId(req: Request): Promise<string | null> {
    if (!req.headers.get('authorization')) return null;
    try {
        const auth = await verifyAuth(req);
        if (!auth.authenticated || !auth.user?.id) return null;
        return String(auth.user.id);
    } catch {
        return null;
    }
}

/** Sellable-stock rule: only tracked, no-oversell products are limited. */
function stockLimit(product: any, variant: any | null): number | null {
    if (product.track_quantity === false || product.continue_selling === true) return null;
    const q = Number(variant ? variant.quantity : product.quantity);
    return Number.isFinite(q) ? Math.max(0, Math.floor(q)) : 0;
}

export async function POST(req: Request) {
    try {
        // The WhatsApp agent (GSG AI) places orders for many customers from one
        // address and works the distance out through /api/brain/delivery-quote.
        const trustedAgent = isBrainCaller(req);
        const clientId = getClientIdentifier(req);
        const rateLimitResult = trustedAgent
            ? { success: true, resetIn: 0 }
            : checkRateLimit(`checkout:${clientId}`, RATE_LIMITS.payment);
        if (!rateLimitResult.success) {
            return NextResponse.json(
                { success: false, message: 'Too many requests. Please try again later.' },
                {
                    status: 429,
                    headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': rateLimitResult.resetIn.toString() },
                },
            );
        }

        const body = await req.json().catch(() => null);
        if (!body || typeof body !== 'object') return bad('Invalid request body');

        // ---- Items -------------------------------------------------------------
        const rawItems: CartItemInput[] = Array.isArray(body.items) ? body.items : [];
        if (rawItems.length === 0) return bad('Your basket is empty.', 400, { code: 'invalid_items' });
        if (rawItems.length > MAX_LINES) return bad('Too many items in one order.', 400, { code: 'invalid_items' });

        type Line = { key: string; quantity: number; variantId: string | null; variantLabel: string | null };
        const lines: Line[] = [];
        for (const it of rawItems) {
            const key = typeof it?.id === 'string' ? it.id.trim() : '';
            const qty = Number(it?.quantity);
            if (!key || !(UUID_RE.test(key) || SLUG_RE.test(key))) return bad('An item in your basket is not valid.', 400, { code: 'invalid_items' });
            if (!Number.isInteger(qty) || qty <= 0 || qty > MAX_QTY) return bad('An item quantity is not valid.', 400, { code: 'invalid_items' });
            const variantId = typeof it?.variantId === 'string' && UUID_RE.test(it.variantId.trim()) ? it.variantId.trim() : null;
            const variantLabel = text(it?.variant, 120) || null;
            lines.push({ key, quantity: qty, variantId, variantLabel });
        }

        // ---- Customer details ------------------------------------------------------
        const s = (body.shipping && typeof body.shipping === 'object' ? body.shipping : {}) as Record<string, unknown>;
        const firstName = text(s.firstName, 80);
        const lastName = text(s.lastName, 80);
        const emailRaw = text(s.email, 200);
        const address = text(s.address, 300);
        const city = text(s.city, 100);
        const region = text(s.region, 100);
        if (!firstName || !lastName) return bad('Please enter your first and last name.');
        if (!isGhanaPhone(s.phone)) {
            return bad('Please enter a valid Ghana mobile number, for example 024 123 4567.', 400, { code: 'invalid_phone' });
        }
        const phone = normalizeGhanaPhone(s.phone)!;
        if (emailRaw && !EMAIL_RE.test(emailRaw)) return bad('Please enter a valid email address, or leave it blank.');
        if (!address || !city || !region) return bad('Please complete your delivery address.');
        const email = emailRaw ? emailRaw.toLowerCase() : '';

        const deliveryMethod = typeof body.deliveryMethod === 'string' ? body.deliveryMethod : 'pickup';
        if (!DELIVERY_METHODS.has(deliveryMethod)) return bad('Please choose a delivery method.');
        const paymentMethod: 'moolre' | 'paystack' = body.paymentMethod === 'paystack' ? 'paystack' : 'moolre';

        let jointExpressNeighbor: { name: string | null; phone: string | null } | null = null;
        if (deliveryMethod === 'joint-express' && body.jointExpressNeighbor && typeof body.jointExpressNeighbor === 'object') {
            const n = body.jointExpressNeighbor as Record<string, unknown>;
            jointExpressNeighbor = {
                name: text(n.name, 80) || null,
                phone: isGhanaPhone(n.phone) ? normalizeGhanaPhone(n.phone) : null,
            };
        }

        const pin =
            body.deliveryPin && isGhanaPin(body.deliveryPin.lat, body.deliveryPin.lng)
                ? {
                      lat: Number(body.deliveryPin.lat),
                      lng: Number(body.deliveryPin.lng),
                      label: text(body.deliveryPin.label, 200) || null,
                  }
                : null;

        // ---- Catalogue -----------------------------------------------------------------
        const uuidKeys = Array.from(new Set(lines.filter((l) => UUID_RE.test(l.key)).map((l) => l.key)));
        const slugKeys = Array.from(new Set(lines.filter((l) => !UUID_RE.test(l.key)).map((l) => l.key)));
        const cols = 'id, name, slug, price, status, quantity, track_quantity, continue_selling, moq, metadata';
        const products: any[] = [];
        if (uuidKeys.length) {
            const { data, error } = await supabaseAdmin.from('products').select(cols).in('id', uuidKeys);
            if (error) {
                console.error('[checkout] products lookup failed:', error.code || 'error');
                return bad('We could not check your basket. Please try again.', 500);
            }
            products.push(...(data || []));
        }
        if (slugKeys.length) {
            const { data, error } = await supabaseAdmin.from('products').select(cols).in('slug', slugKeys);
            if (error) {
                console.error('[checkout] products lookup failed:', error.code || 'error');
                return bad('We could not check your basket. Please try again.', 500);
            }
            products.push(...(data || []));
        }
        const byId = new Map<string, any>(products.map((p) => [String(p.id), p]));
        const bySlug = new Map<string, any>(products.map((p) => [String(p.slug), p]));

        const productIds = Array.from(new Set(products.map((p) => String(p.id))));
        const variantsByProduct = new Map<string, any[]>();
        if (productIds.length) {
            const { data: variants, error } = await supabaseAdmin
                .from('product_variants')
                .select('id, product_id, name, price, quantity')
                .in('product_id', productIds);
            if (error) {
                console.error('[checkout] variants lookup failed:', error.code || 'error');
                return bad('We could not check your basket. Please try again.', 500);
            }
            for (const v of variants || []) {
                const list = variantsByProduct.get(String(v.product_id)) || [];
                list.push(v);
                variantsByProduct.set(String(v.product_id), list);
            }
        }

        // ---- Price every line ----------------------------------------------------------
        type Priced = { product: any; variant: any | null; quantity: number };
        const merged = new Map<string, Priced>();
        const unavailable: string[] = [];
        for (const l of lines) {
            const product = UUID_RE.test(l.key) ? byId.get(l.key) : bySlug.get(l.key);
            if (!product) {
                unavailable.push('An item in your basket');
                continue;
            }
            if (product.status !== 'active') {
                unavailable.push(product.name);
                continue;
            }
            const pvs = variantsByProduct.get(String(product.id)) || [];
            let variant: any | null = null;
            if (pvs.length > 0) {
                if (l.variantId) {
                    variant = pvs.find((v) => v.id === l.variantId) || null;
                } else if (l.variantLabel) {
                    const label = l.variantLabel.toLowerCase();
                    variant = pvs.find((v) => String(v.name).trim().toLowerCase() === label) || null;
                }
                if (!variant) {
                    if (l.variantId || l.variantLabel) {
                        unavailable.push(`${product.name} (${l.variantLabel || 'chosen option'})`);
                        continue;
                    }
                    return bad(`Please choose an option for ${product.name}.`, 400, { code: 'invalid_items' });
                }
            } else if (l.variantId) {
                unavailable.push(product.name);
                continue;
            }
            const key = `${product.id}:${variant?.id || ''}`;
            const prev = merged.get(key);
            merged.set(key, { product, variant, quantity: (prev?.quantity || 0) + l.quantity });
        }
        if (unavailable.length) {
            return bad(
                `Some items are no longer available: ${unavailable.join(', ')}. Please remove them and try again.`,
                400,
                { code: 'unavailable', unavailable },
            );
        }

        const outOfStock: string[] = [];
        const orderItems: Array<{
            product_id: string;
            variant_id: string | null;
            product_name: string;
            variant_name: string | null;
            sku: string | null;
            quantity: number;
            unit_price: number;
            total_price: number;
            metadata: Record<string, unknown>;
        }> = [];
        let subtotal = 0;
        for (const { product, variant, quantity } of merged.values()) {
            const label = variant ? `${product.name} (${variant.name})` : product.name;
            const moq = Math.max(1, Number(product.moq) || 1);
            if (quantity < moq) {
                return bad(`${label}: the minimum order is ${moq}.`, 400, { code: 'invalid_items' });
            }
            const limit = stockLimit(product, variant);
            if (limit !== null && quantity > limit) {
                outOfStock.push(limit > 0 ? `${label} (only ${limit} left)` : label);
                continue;
            }
            const unit = round2(Number(variant ? variant.price : product.price));
            if (!Number.isFinite(unit) || unit < 0) {
                console.error('[checkout] product has no valid price:', product.id);
                return bad(`${label} cannot be bought online right now.`, 400, { code: 'unavailable', unavailable: [label] });
            }
            const lineTotal = round2(unit * quantity);
            subtotal += lineTotal;
            orderItems.push({
                product_id: product.id,
                variant_id: variant?.id || null,
                product_name: product.name,
                variant_name: variant?.name || null,
                sku: null,
                quantity,
                unit_price: unit,
                total_price: lineTotal,
                metadata: {
                    slug: product.slug,
                    image: (product.metadata as any)?.image ?? null,
                    preorder_shipping: (product.metadata as any)?.preorder_shipping ?? null,
                },
            });
        }
        if (outOfStock.length) {
            return bad(`Not enough stock for: ${outOfStock.join(', ')}.`, 400, { code: 'out_of_stock', unavailable: outOfStock });
        }
        subtotal = round2(subtotal);

        // ---- Delivery (distance worked out here, from the pin) -------------------------
        const settings = await getDeliverySettings();
        let deliveryKm = 0;
        let distanceInfo: { km: number; destinationKm: number; outsideGreaterAccra: boolean; method: string } | null = null;
        if (methodNeedsDistance(deliveryMethod)) {
            const agentKm = Number(body.deliveryKm);
            if (!pin && trustedAgent && agentKm > 0) {
                deliveryKm = Math.round(agentKm * 100) / 100;
            } else if (!pin) {
                return bad('Please drop a pin on the map so we can work out the delivery distance.', 400, { code: 'distance_required' });
            } else {
                distanceInfo = await deliveryKmForPin({ lat: pin.lat, lng: pin.lng }, settings.hub, settings.transportStation);
                deliveryKm = distanceInfo.km;
            }
            if (!(deliveryKm > 0) || deliveryKm > 500) {
                return bad('That location looks outside our delivery area. Please check the pin.', 400, { code: 'distance_required' });
            }
        }
        const delivery = calculateDeliveryFee({
            method: deliveryMethod,
            km: deliveryKm,
            purchaseTotal: subtotal,
            config: settings.pricing,
        });
        const shippingTotal = round2(delivery.fee);

        // ---- Coupon ----------------------------------------------------------------------
        let discountTotal = 0;
        let couponCode: string | null = null;
        const rawCoupon = normalizeCouponCode(body.couponCode);
        if (rawCoupon) {
            const ev = await evaluateCoupon(rawCoupon, subtotal, {
                mode: 'checkout',
                email: email || null,
                phone,
                shippingTotal,
            });
            if (!ev.valid) return bad(ev.message, 400, { code: 'coupon_invalid' });
            discountTotal = round2(Math.min(ev.discount, subtotal + shippingTotal));
            couponCode = ev.code;
        }

        const total = round2(Math.max(0, subtotal + shippingTotal - discountTotal));
        if (!Number.isFinite(total) || total <= 0) return bad('This order has nothing to pay for.', 400, { code: 'invalid_items' });

        const clientTotal = Number(body.clientTotal);
        const priceChanged = body.clientTotal !== undefined && body.clientTotal !== null && Number.isFinite(clientTotal)
            ? Math.abs(clientTotal - total) >= 0.01
            : false;

        // ---- Write order + items in one transaction --------------------------------------
        const userId = await resolveAuthUserId(req);
        const orderNumber = generateOrderNumber();
        const trackingNumber = generateTrackingNumber();
        const shippingAddress = {
            firstName,
            lastName,
            ...(email ? { email } : {}),
            phone,
            address,
            city,
            region,
        };

        let order: { id: string; order_number: string; total: number };
        try {
            order = await withTransaction(async () => {
                const { data, error } = await supabaseAdmin
                    .from('orders')
                    .insert([
                        {
                            order_number: orderNumber,
                            user_id: userId,
                            email: email || checkoutPlaceholderEmail(phone),
                            phone,
                            status: 'pending',
                            payment_status: 'pending',
                            currency: 'GHS',
                            subtotal,
                            tax_total: 0,
                            shipping_total: shippingTotal,
                            discount_total: discountTotal,
                            total,
                            shipping_method: deliveryMethod,
                            payment_method: paymentMethod,
                            shipping_address: shippingAddress,
                            billing_address: shippingAddress,
                            metadata: {
                                source: 'storefront',
                                guest_checkout: !userId,
                                first_name: firstName,
                                last_name: lastName,
                                tracking_number: trackingNumber,
                                payment_method: paymentMethod,
                                delivery_km: deliveryKm,
                                ...(distanceInfo
                                    ? {
                                          delivery_km_source: distanceInfo.method,
                                          delivery_destination_km: distanceInfo.destinationKm,
                                          outside_greater_accra: distanceInfo.outsideGreaterAccra,
                                      }
                                    : {}),
                                ...(pin ? { delivery_pin: pin } : {}),
                                delivery_formula: delivery.formulaLabel,
                                delivery_breakdown: {
                                    distance_component: delivery.distanceComponent,
                                    purchase_component: delivery.purchaseComponent,
                                    raw_total: delivery.rawTotal,
                                    fee: delivery.fee,
                                },
                                ...(couponCode ? { coupon_code: couponCode, coupon_discount: discountTotal } : {}),
                                ...(priceChanged ? { client_total_attempt: clientTotal } : {}),
                                ...(jointExpressNeighbor ? { joint_express_neighbor: jointExpressNeighbor } : {}),
                            },
                        },
                    ])
                    .select('id, order_number, total')
                    .single();
                if (error || !data) throw new Error(`order insert: ${error?.code || 'no row'}`);
                const { error: itemsError } = await supabaseAdmin
                    .from('order_items')
                    .insert(orderItems.map((row) => ({ ...row, order_id: data.id })));
                if (itemsError) throw new Error(`items insert: ${itemsError.code || 'error'}`);
                return data as any;
            });
        } catch (e: any) {
            console.error('[checkout] order not saved:', e?.message || 'error');
            return bad('We could not place your order. Please try again.', 500);
        }

        return NextResponse.json({
            success: true,
            orderId: order.id,
            orderNumber: order.order_number,
            total,
            subtotal,
            shippingTotal,
            discountTotal,
            shippingMethod: deliveryMethod,
            trackingNumber,
            deliveryKm,
            priceChanged,
            items: orderItems.map((i) => ({
                name: i.product_name,
                variant: i.variant_name,
                quantity: i.quantity,
                unitPrice: i.unit_price,
                lineTotal: i.total_price,
            })),
        });
    } catch (err: any) {
        console.error('[checkout] error:', err?.name || 'error');
        return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
    }
}
