/**
 * Server-side coupon evaluation (ported from RNH Imports), shared by:
 *   - POST /api/storefront/coupons/validate   (checkout preview)
 *   - POST /api/checkout                       (authoritative: writes the
 *                                               discount and metadata.coupon_code)
 *
 * Coupons are readable only by staff and the server, so this must run on the
 * server. Usage is counted by mark_order_paid, once, when the order is paid.
 *
 * GSG charges delivery at checkout, so a `free_shipping` coupon takes the
 * delivery fee off (pass `shippingTotal`); without a fee it reduces nothing.
 */
import { createServerSupabase } from '@/lib/supabase-server';
import { query } from '@/lib/db/pool';
import { phoneLast9 } from '@/lib/phone';

const supabase = createServerSupabase('service');

export type CouponType = 'percentage' | 'fixed_amount' | 'free_shipping';

export interface CouponEvaluation {
    valid: boolean;
    code: string;
    type: CouponType | null;
    value: number | null;
    discount: number;
    message: string;
}

/**
 * 'checkout' — every rule: active, start/end date, usage limit, per-customer
 *              limit, minimum purchase, maximum discount.
 * 'payment'  — only the amount rules (the code was accepted at checkout).
 */
export type CouponMode = 'checkout' | 'payment';

const CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

function invalid(code: string, message: string, extra?: Partial<CouponEvaluation>): CouponEvaluation {
    return { valid: false, code, type: null, value: null, discount: 0, message, ...(extra || {}) };
}

export function normalizeCouponCode(raw: unknown): string {
    return typeof raw === 'string' ? raw.trim() : '';
}

/** Escapes LIKE wildcards so the code matches literally (case-insensitive). */
function likeLiteral(s: string): string {
    return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function evaluateCoupon(
    rawCode: unknown,
    rawSubtotal: number,
    opts: {
        mode?: CouponMode;
        email?: string | null;
        phone?: string | null;
        /** Delivery fee on this order; needed for free_shipping coupons. Omit for a preview. */
        shippingTotal?: number | null;
    } = {},
): Promise<CouponEvaluation> {
    const mode: CouponMode = opts.mode || 'checkout';
    const code = normalizeCouponCode(rawCode);
    if (!code) return invalid('', 'Enter a coupon code.');
    if (!CODE_RE.test(code)) return invalid(code, 'This coupon code is not valid.');

    const subtotal = Number.isFinite(rawSubtotal) && rawSubtotal > 0 ? round2(rawSubtotal) : 0;

    const { data: rows, error } = await supabase
        .from('coupons')
        .select('id, code, type, value, minimum_purchase, maximum_discount, usage_limit, usage_count, per_user_limit, start_date, end_date, is_active')
        .ilike('code', likeLiteral(code))
        .limit(5);
    if (error) {
        console.error('[Coupon] lookup failed:', error.code || 'error');
        return invalid(code, 'Could not check this coupon right now. Please try again.');
    }
    const list = (rows || []) as any[];
    const coupon = list.find((c) => c.code === code) || list.find((c) => String(c.code).toLowerCase() === code.toLowerCase());
    if (!coupon) return invalid(code, 'This coupon code is not valid.');

    const type = String(coupon.type) as CouponType;
    const value = Number(coupon.value) || 0;
    const canonical = String(coupon.code);
    const base = { code: canonical, type, value };

    if (mode === 'checkout') {
        if (coupon.is_active === false) return invalid(canonical, 'This coupon is no longer active.', base);
        const now = Date.now();
        if (coupon.start_date && new Date(coupon.start_date).getTime() > now) {
            return invalid(canonical, 'This coupon is not active yet.', base);
        }
        if (coupon.end_date && new Date(coupon.end_date).getTime() < now) {
            return invalid(canonical, 'This coupon has expired.', base);
        }
        const limit = coupon.usage_limit != null ? Number(coupon.usage_limit) : null;
        if (limit != null && limit >= 0 && (Number(coupon.usage_count) || 0) >= limit) {
            return invalid(canonical, 'This coupon has reached its usage limit.', base);
        }
        const perUser = coupon.per_user_limit != null ? Number(coupon.per_user_limit) : null;
        const email = typeof opts.email === 'string' ? opts.email.trim() : '';
        const last9 = phoneLast9(opts.phone);
        if (perUser != null && perUser > 0 && (email || last9)) {
            try {
                const { rows: used } = await query<{ n: number }>(
                    `SELECT count(*)::int AS n FROM public.orders
                      WHERE upper(metadata->>'coupon_code') = upper($1)
                        AND payment_status = 'paid'
                        AND status NOT IN ('cancelled', 'refunded')
                        AND (($2 <> '' AND lower(email) = lower($2))
                          OR ($3 <> '' AND length(regexp_replace(coalesce(phone, ''), '\\D', '', 'g')) >= 9
                              AND right(regexp_replace(phone, '\\D', '', 'g'), 9) = $3))`,
                    [canonical, email, last9],
                );
                if ((used[0]?.n || 0) >= perUser) {
                    return invalid(canonical, 'You have already used this coupon.', base);
                }
            } catch (e: any) {
                console.error('[Coupon] per-customer check failed:', e?.code || 'error');
                return invalid(canonical, 'Could not check this coupon right now. Please try again.', base);
            }
        }
    }

    const minimum = Number(coupon.minimum_purchase) || 0;
    if (minimum > 0 && subtotal < minimum) {
        return invalid(canonical, `Spend at least GH₵${minimum.toFixed(2)} to use this coupon.`, base);
    }

    if (type === 'free_shipping') {
        const shipping = opts.shippingTotal;
        if (shipping === undefined || shipping === null) {
            // Preview before a delivery fee is known.
            return { valid: true, code: canonical, type, value, discount: 0, message: 'Coupon accepted: the delivery fee is taken off at checkout.' };
        }
        let discount = Math.max(0, Number(shipping) || 0);
        const maxDiscount = coupon.maximum_discount != null ? Number(coupon.maximum_discount) : null;
        if (maxDiscount != null && Number.isFinite(maxDiscount) && maxDiscount >= 0) discount = Math.min(discount, maxDiscount);
        discount = round2(discount);
        if (discount <= 0) return invalid(canonical, 'This coupon takes off the delivery fee, and this order has none.', base);
        return { valid: true, code: canonical, type, value, discount, message: `Coupon applied: delivery fee of GH₵${discount.toFixed(2)} taken off.` };
    }
    if (type !== 'percentage' && type !== 'fixed_amount') {
        return invalid(canonical, 'This coupon code is not valid.', base);
    }

    let discount =
        type === 'percentage'
            ? subtotal * (Math.min(Math.max(value, 0), 100) / 100)
            : Math.max(value, 0);
    const maxDiscount = coupon.maximum_discount != null ? Number(coupon.maximum_discount) : null;
    if (maxDiscount != null && Number.isFinite(maxDiscount) && maxDiscount >= 0) {
        discount = Math.min(discount, maxDiscount);
    }
    discount = round2(Math.min(discount, subtotal));

    if (discount <= 0) {
        return invalid(canonical, 'This coupon doesn’t reduce this order.', base);
    }

    return {
        valid: true,
        code: canonical,
        type,
        value,
        discount,
        message: `Coupon applied: you save GH₵${discount.toFixed(2)}.`,
    };
}
