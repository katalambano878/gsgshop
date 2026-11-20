/**
 * Shared Personal Shopper helpers for the /api/shopper routes.
 * Guests prove a request is theirs with the reference AND the phone used on
 * it (last 9 digits); a signed-in owner or staff may omit the phone.
 */
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAuth } from '@/lib/auth';
import { phoneLast9 } from '@/lib/phone';
import { maskEmail, maskPhone } from '@/lib/payment-target';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SR_RE = /^SR-[A-Za-z0-9-]{1,60}$/;

export const REQUEST_SELECT =
    'id, request_number, user_id, status, payment_status, subtotal_est, markup, delivery_fee, delivery_fee_est, total_est, total_final, contact_name, contact_phone, contact_email, delivery_address, preferred_time, created_at, updated_at, paid_at, metadata';

/** Load one request by uuid or SR number. */
export async function findRequest(ref: string, select = REQUEST_SELECT): Promise<any | null> {
    const key = (ref || '').trim();
    if (UUID_RE.test(key)) {
        const { data } = await supabaseAdmin.from('shopper_requests').select(select).eq('id', key).maybeSingle();
        return data ?? null;
    }
    if (SR_RE.test(key)) {
        const { data } = await supabaseAdmin.from('shopper_requests').select(select).eq('request_number', key).maybeSingle();
        return data ?? null;
    }
    return null;
}

export type Viewer = { kind: 'staff' | 'owner' | 'guest' | 'none'; userId: string | null };

/** Who is asking: staff, the signed-in owner, a guest with the right phone, or nobody. */
export async function viewerFor(req: Request, row: { user_id?: string | null; contact_phone?: string | null }, phone: string | null): Promise<Viewer> {
    if (req.headers.get('authorization')) {
        try {
            const auth = await verifyAuth(req);
            if (auth.authenticated && auth.user?.id) {
                const uid = String(auth.user.id);
                if (row.user_id && String(row.user_id) === uid) return { kind: 'owner', userId: uid };
                const staff = await verifyAuth(req, { requireRole: ['admin', 'staff'] });
                if (staff.authenticated) return { kind: 'staff', userId: uid };
            }
        } catch {
            /* not signed in */
        }
    }
    const typed = phoneLast9(phone);
    if (typed && row.contact_phone && phoneLast9(row.contact_phone) === typed) return { kind: 'guest', userId: null };
    return { kind: 'none', userId: null };
}

/** True when the bearer is the GSG AI agent's BRAIN_API_KEY. */
export function isBrainCaller(req: Request): boolean {
    const expected = process.env.BRAIN_API_KEY;
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!expected || !token) return false;
    const a = crypto.createHash('sha256').update(token).digest();
    const b = crypto.createHash('sha256').update(expected).digest();
    return crypto.timingSafeEqual(a, b) && token.length === expected.length;
}

/** Prefix for a staff note the customer may read (written by the status route). */
export const CUSTOMER_NOTE_PREFIX = 'Customer: ';

const SYSTEM_NOTES = new Set(['Request submitted by customer', 'Payment confirmed by gateway']);

/** The note a customer may see, or null for internal staff notes. */
function customerNote(note: unknown): string | null {
    if (typeof note !== 'string') return null;
    if (note.startsWith(CUSTOMER_NOTE_PREFIX)) return note.slice(CUSTOMER_NOTE_PREFIX.length);
    return SYSTEM_NOTES.has(note) ? note : null;
}

/** The customer-safe view of a request (no street address, masked contacts). */
export function publicRequest(row: any, items: any[], history: any[]) {
    const addr = row.delivery_address && typeof row.delivery_address === 'object' ? row.delivery_address : {};
    return {
        id: row.id,
        request_number: row.request_number,
        status: row.status,
        payment_status: row.payment_status,
        subtotal_est: Number(row.subtotal_est ?? 0),
        markup: Number(row.markup ?? 0),
        delivery_fee: Number(row.delivery_fee ?? 0),
        total_est: Number(row.total_est ?? 0),
        total_final: row.total_final !== null && row.total_final !== undefined ? Number(row.total_final) : null,
        delivery_method: addr.method ?? null,
        delivery_area: addr.location_label ?? null,
        preferred_time: row.preferred_time ?? null,
        contact_name: String(row.contact_name || '').split(' ')[0] || null,
        contact_phone_masked: maskPhone(row.contact_phone),
        contact_email_masked: maskEmail(row.contact_email),
        created_at: row.created_at,
        paid_at: row.paid_at ?? null,
        items: (items || []).map((it: any) => ({
            id: it.id,
            name_brand: it.name_brand,
            qty_size_range: it.qty_size_range,
            remark: it.remark ?? null,
            estimated_price: Number(it.estimated_price ?? 0),
            market_price: it.market_price !== null && it.market_price !== undefined ? Number(it.market_price) : null,
            source_type: it.source_type ?? null,
        })),
        history: (history || [])
            .slice()
            .sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))
            .map((h: any) => ({
                status: h.status,
                created_at: h.created_at,
                // Staff notes are internal unless marked for the customer.
                note: customerNote(h.note),
            })),
    };
}

export async function loadItemsAndHistory(requestId: string) {
    const [{ data: items }, { data: history }] = await Promise.all([
        supabaseAdmin
            .from('shopper_request_items')
            .select('id, name_brand, qty_size_range, remark, estimated_price, market_price, source_type, created_at')
            .eq('request_id', requestId)
            .order('created_at', { ascending: true }),
        supabaseAdmin
            .from('shopper_status_history')
            .select('status, note, created_at')
            .eq('request_id', requestId)
            .order('created_at', { ascending: true }),
    ]);
    return { items: items || [], history: history || [] };
}
