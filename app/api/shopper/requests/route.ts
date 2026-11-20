import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { withTransaction } from '@/lib/db/pool';
import { verifyAuth } from '@/lib/auth';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';
import { calculateDeliveryFee } from '@/lib/delivery-pricing';
import { getDeliverySettings, shopperMarkupAmount } from '@/lib/delivery-settings';
import { deliveryKmForPin, isGhanaPin } from '@/lib/google-maps-delivery';
import { isGhanaPhone, normalizeGhanaPhone, phoneLast9 } from '@/lib/phone';
import { findRequest, isBrainCaller, loadItemsAndHistory, publicRequest, SR_RE, UUID_RE, viewerFor } from '../_lib';

export const dynamic = 'force-dynamic';

/**
 * POST /api/shopper/requests — submit a shopping list.
 *   Body: { items: [{ nameBrand, qtySizeRange, remark?, estimatedPrice, sourceType? }],
 *           contactName, contactPhone, contactEmail?, deliveryAddress: { text, location_label?, lat?, lng? } | string,
 *           preferredTime?, notes?, deliveryMethod?: 'sole-express' | 'joint-express', deliveryKm? }
 *   The server computes the estimate (items clamped at 0 or above, markup from
 *   the live setting, delivery from the pin); any client subtotal/markup/total
 *   is ignored. The customer pays this estimate up front (total_final).
 *   200 → { success: true, id, requestNumber, total, request_number, subtotal_est,
 *           markup, markup_pct, delivery_fee, total_est }
 *   4xx → { success: false, message, error, code? }  code: invalid_phone | distance_required | invalid_items
 *
 * GET /api/shopper/requests
 *   ?requestNumber=SR-…&phone=…  or  ?id=<uuid or SR-…>&phone=…  (guest: both must match)
 *   A signed-in owner or staff may omit the phone. A phone-only lookup → 400.
 *   200 → { request: {...} }  · unknown → 404 { error }
 *   No parameters: staff list (admin or staff) → array of full rows.
 */

const MAX_ITEMS = 100;
const MAX_PRICE = 100_000;

function bad(message: string, status = 400, code?: string) {
    return NextResponse.json({ success: false, message, error: message, ...(code ? { code } : {}) }, { status });
}

function text(v: unknown, max: number): string {
    return typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
function requestNumber(): string {
    const bytes = randomBytes(10);
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
    return `SR-${out}`;
}

export async function POST(request: Request) {
    try {
        const brain = isBrainCaller(request);
        const ip = getClientIdentifier(request);
        if (!brain) {
            const rl = checkRateLimit(`shopper-create:${ip}`, { maxRequests: 6, windowSeconds: 600 });
            if (!rl.success) return bad('Too many requests. Please wait a few minutes and try again.', 429);
        }

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') return bad('Invalid request.');

        // ---- Contact ---------------------------------------------------------------
        const contactName = text(body.contactName, 100);
        if (!contactName) return bad('Please enter your name.');
        if (!isGhanaPhone(body.contactPhone)) {
            return bad('Please enter a valid Ghana mobile number, for example 024 123 4567.', 400, 'invalid_phone');
        }
        const contactPhone = normalizeGhanaPhone(body.contactPhone)!;
        const contactEmail = text(body.contactEmail, 200).toLowerCase();
        if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return bad('Please enter a valid email address, or leave it blank.');

        if (!brain) {
            const perPhone = checkRateLimit(`shopper-create-phone:${phoneLast9(contactPhone)}`, { maxRequests: 5, windowSeconds: 3600 });
            if (!perPhone.success) return bad('Too many requests for this number. Please contact us on WhatsApp.', 429);
        }

        // ---- Items -----------------------------------------------------------------
        const rawItems = Array.isArray(body.items) ? body.items : [];
        if (rawItems.length === 0) return bad('Please add at least one item.', 400, 'invalid_items');
        if (rawItems.length > MAX_ITEMS) return bad(`Please keep one list to ${MAX_ITEMS} items.`, 400, 'invalid_items');
        const items: Array<{ name_brand: string; qty_size_range: string; remark: string | null; estimated_price: number; source_type: string | null }> = [];
        for (const it of rawItems) {
            const name = text(it?.nameBrand, 150);
            const qty = text(it?.qtySizeRange, 100);
            if (!name || !qty) return bad('Please fill in the name and quantity of every item.', 400, 'invalid_items');
            const price = Number(it?.estimatedPrice);
            items.push({
                name_brand: name,
                qty_size_range: qty,
                remark: text(it?.remark, 300) || null,
                estimated_price: Number.isFinite(price) ? Math.round(Math.min(MAX_PRICE, Math.max(0, price)) * 100) / 100 : 0,
                source_type: text(it?.sourceType, 50) || null,
            });
        }
        const subtotal = Math.round(items.reduce((s, i) => s + i.estimated_price, 0) * 100) / 100;

        // ---- Delivery ----------------------------------------------------------------
        const settings = await getDeliverySettings();
        const addrIn = body.deliveryAddress && typeof body.deliveryAddress === 'object' ? body.deliveryAddress : { text: body.deliveryAddress };
        const addressText = text(addrIn.text, 300);
        if (!addressText) return bad('Please enter your delivery address.');
        const deliveryMethod =
            body.deliveryMethod === 'joint-express' || body.deliveryMethod === 'sole-express' ? body.deliveryMethod : null;
        const pin = isGhanaPin(addrIn.lat, addrIn.lng) ? { lat: Number(addrIn.lat), lng: Number(addrIn.lng) } : null;

        let deliveryKm = 0;
        let kmSource: string | null = null;
        if (deliveryMethod) {
            if (pin) {
                const d = await deliveryKmForPin(pin, settings.hub, settings.transportStation);
                deliveryKm = d.km;
                kmSource = d.method;
            } else if (brain) {
                // The WhatsApp agent quotes km from /api/brain/delivery-quote.
                const km = Number(body.deliveryKm);
                deliveryKm = Number.isFinite(km) ? Math.max(0, Math.min(500, km)) : 0;
                kmSource = 'agent';
            }
            if (!(deliveryKm > 0)) {
                return bad('Please choose your location on the map so we can work out the delivery distance.', 400, 'distance_required');
            }
        }
        const deliveryFee = deliveryMethod
            ? calculateDeliveryFee({ method: deliveryMethod, km: deliveryKm, purchaseTotal: subtotal, config: settings.pricing }).fee
            : 0;
        const markup = shopperMarkupAmount(subtotal, settings.shopperMarkupPct);
        const totalEst = Math.round((subtotal + markup + deliveryFee) * 100) / 100;

        // Optional sign-in binds the request to the account.
        let userId: string | null = null;
        if (!brain && request.headers.get('authorization')) {
            const auth = await verifyAuth(request);
            userId = auth.authenticated && auth.user?.id ? String(auth.user.id) : null;
        }

        const deliveryAddress = {
            text: addressText,
            location_label: text(addrIn.location_label, 200) || null,
            lat: pin?.lat ?? null,
            lng: pin?.lng ?? null,
            km: deliveryKm || undefined,
            km_source: kmSource || undefined,
            method: deliveryMethod || undefined,
        };

        let created: { id: string; request_number: string };
        try {
            created = await withTransaction(async () => {
                const { data, error } = await supabaseAdmin
                    .from('shopper_requests')
                    .insert({
                        request_number: requestNumber(),
                        user_id: userId,
                        status: 'SUBMITTED',
                        subtotal_est: subtotal,
                        markup,
                        total_est: totalEst,
                        // Customers pay the estimate up front; staff can re-finalize before payment.
                        total_final: totalEst,
                        delivery_fee: deliveryFee,
                        notes: text(body.notes, 2000) || null,
                        delivery_address: deliveryAddress,
                        preferred_time: text(body.preferredTime, 100) || null,
                        contact_name: contactName,
                        contact_phone: contactPhone,
                        contact_email: contactEmail || null,
                        metadata: { source: brain ? 'whatsapp_ai' : 'shopper_site' },
                    })
                    .select('id, request_number')
                    .single();
                if (error || !data) throw new Error(`request insert: ${error?.code || 'no row'}`);
                const { error: itemsError } = await supabaseAdmin
                    .from('shopper_request_items')
                    .insert(items.map((i) => ({ ...i, request_id: data.id })));
                if (itemsError) throw new Error(`items insert: ${itemsError.code || 'error'}`);
                const { error: histError } = await supabaseAdmin
                    .from('shopper_status_history')
                    .insert({ request_id: data.id, status: 'SUBMITTED', note: 'Request submitted by customer', created_by: userId });
                if (histError) throw new Error(`history insert: ${histError.code || 'error'}`);
                return data as any;
            });
        } catch (e: any) {
            console.error('[shopper/requests] not saved:', e?.message || 'error');
            return bad('We could not save your list. Please try again.', 500);
        }

        return NextResponse.json({
            success: true,
            id: created.id,
            requestNumber: created.request_number,
            total: totalEst,
            // Older field names (the WhatsApp assistant reads these).
            request_number: created.request_number,
            subtotal_est: subtotal,
            markup,
            markup_pct: settings.shopperMarkupPct,
            delivery_fee: deliveryFee,
            total_est: totalEst,
        });
    } catch (error: any) {
        console.error('[shopper/requests] error:', error?.name || 'error');
        return bad('Failed to submit request', 500);
    }
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const ref = (searchParams.get('requestNumber') || searchParams.get('ref') || searchParams.get('id') || '').trim();
        const phone = searchParams.get('phone');

        if (!ref) {
            // The WhatsApp agent (GSG AI) has already identified the customer by
            // the number they are messaging from, so it may look requests up by
            // phone alone. It gets the short summary it has always used.
            if (phone && isBrainCaller(request)) {
                const last9 = phoneLast9(phone);
                if (last9.length < 9) return NextResponse.json([]);
                const { data, error } = await supabaseAdmin
                    .from('shopper_requests')
                    .select('id, request_number, status, payment_status, total_est, total_final, created_at, contact_phone, items:shopper_request_items(id)')
                    .order('created_at', { ascending: false })
                    .limit(1000);
                if (error) {
                    console.error('[shopper/requests] agent lookup failed:', error.code || 'error');
                    return NextResponse.json({ error: 'Could not load requests' }, { status: 500 });
                }
                return NextResponse.json(
                    (data || [])
                        .filter((r: any) => phoneLast9(r.contact_phone) === last9)
                        .slice(0, 20)
                        .map(({ contact_phone: _phone, ...r }: any) => r),
                );
            }
            if (phone) return NextResponse.json({ error: 'Enter your request number as well as your phone number.' }, { status: 400 });
            // Staff list.
            const auth = await verifyAuth(request, { requireRole: ['admin', 'staff'] });
            if (!auth.authenticated) {
                return NextResponse.json({ error: auth.user ? 'Forbidden' : 'Unauthorized' }, { status: auth.user ? 403 : 401 });
            }
            const { data, error } = await supabaseAdmin
                .from('shopper_requests')
                .select('*, items:shopper_request_items(*), history:shopper_status_history(*)')
                .order('created_at', { ascending: false })
                .limit(500);
            if (error) {
                console.error('[shopper/requests] list failed:', error.code || 'error');
                return NextResponse.json({ error: 'Could not load requests' }, { status: 500 });
            }
            return NextResponse.json(data || []);
        }

        const rl = checkRateLimit(`shopper-lookup:${getClientIdentifier(request)}`, { maxRequests: 20, windowSeconds: 60 });
        if (!rl.success) return NextResponse.json({ error: 'Too many requests. Please wait a minute.' }, { status: 429 });

        if (!UUID_RE.test(ref) && !SR_RE.test(ref)) {
            return NextResponse.json({ error: 'Request not found' }, { status: 404 });
        }
        if (!phone && !request.headers.get('authorization')) {
            return NextResponse.json({ error: 'Enter the phone number used on this request.' }, { status: 400 });
        }
        const row = await findRequest(ref);
        const viewer = row ? await viewerFor(request, row, phone) : { kind: 'none' as const, userId: null };
        if (!row || viewer.kind === 'none') {
            // Same answer for "no such request" and "wrong phone".
            return NextResponse.json({ error: 'Request not found' }, { status: 404 });
        }

        const { items, history } = await loadItemsAndHistory(row.id);
        return NextResponse.json({ request: publicRequest(row, items, history) }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error: any) {
        console.error('[shopper/requests] lookup error:', error?.name || 'error');
        return NextResponse.json({ error: 'Could not load the request' }, { status: 500 });
    }
}
