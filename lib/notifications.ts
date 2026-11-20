/**
 * Customer messages. The shop reaches customers by SMS (Taysend, falling back
 * to Moolre SMS). There is no email provider: nothing here sends email, and
 * no caller may report an email as sent.
 *
 * Every send helper builds its text from the row it is given (callers pass
 * database rows, never request bodies) and returns `{ sms }`: true only when
 * the gateway accepted the message.
 */
import { createServerSupabase } from '@/lib/supabase-server';
import { getShopperBaseUrl } from '@/lib/site-urls';
import { isPlaceholderEmail } from '@/lib/placeholder-email';

export { isPlaceholderEmail };

export type SendResult = { sms: boolean };

const BRAND_NAME = 'GSG Convenience Goods & More';

function storeBaseUrl(): string {
    return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

/** "+2332****92" style, for logs only. */
export function maskPhoneForLog(phone: string | null | undefined): string {
    const p = String(phone || '');
    if (p.length < 6) return '***';
    return p.slice(0, 4) + '****' + p.slice(-2);
}

/** E.164 for a Ghana number typed any usual way. */
function formatPhoneNumber(phone: string): string {
    let cleaned = String(phone || '').replace(/\D/g, '');
    if (cleaned.startsWith('00')) cleaned = cleaned.slice(2);
    if (cleaned.startsWith('0')) cleaned = '233' + cleaned.substring(1);
    if (cleaned.length === 9) cleaned = '233' + cleaned;
    return '+' + cleaned;
}

/** Plain text only: strips control characters and caps length (SMS is not HTML). */
function clean(text: unknown, max = 60): string {
    return String(text ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
}

const TAYSEND_SMS_URL = (process.env.TAYSEND_API_URL || 'https://api.taysend.com').replace(/\/+$/, '');
const TAYSEND_FAILED_STATUSES = new Set(['failed', 'rejected', 'undelivered', 'expired']);

async function sendViaTaysend(to: string, message: string, senderFallback?: string) {
    const apiKey = process.env.TAYSEND_API_KEY?.trim();
    const from = (process.env.TAYSEND_SENDER_ID || senderFallback || process.env.MOOLRE_SMS_SENDER_ID || '').trim();
    if (!apiKey || !from) return null;
    try {
        const response = await fetch(`${TAYSEND_SMS_URL}/v1/messages`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': crypto.randomUUID(),
            },
            body: JSON.stringify({ to, sender_id: from, message, type: 'transactional' }),
            signal: AbortSignal.timeout(15000),
        });
        const result: any = await response.json().catch(() => null);
        const status = String(result?.status || '').toLowerCase();
        if (response.ok && result?.id && !TAYSEND_FAILED_STATUSES.has(status)) {
            return { status: 1, code: 'SMS01', provider: 'taysend', messageid: result.id, data: [{ messageid: result.id }] };
        }
        console.warn('[SMS] Taysend failed, falling back | HTTP', response.status, '| status:', status || 'none');
        return null;
    } catch (error: any) {
        console.warn('[SMS] Taysend failed, falling back:', error?.name || 'error');
        return null;
    }
}

/** Raw send. Returns the gateway result (status 1 = accepted) or null. */
export async function sendSMS({ to, message }: { to: string; message: string }) {
    const recipient = formatPhoneNumber(to);
    const viaTaysend = await sendViaTaysend(recipient, message);
    if (viaTaysend) return viaTaysend;

    const smsVasKey = process.env.MOOLRE_SMS_API_KEY || process.env.MOOLRE_API_KEY;
    if (!smsVasKey) {
        console.warn('[SMS] No SMS gateway configured');
        return null;
    }

    try {
        const response = await fetch('https://api.moolre.com/open/sms/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-VASKEY': smsVasKey },
            body: JSON.stringify({
                type: 1,
                senderid: process.env.SMS_SENDER_ID || 'GSGBRANDS',
                messages: [{ recipient, message }],
            }),
            signal: AbortSignal.timeout(15000),
        });
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            console.error('[SMS] Moolre answered non-JSON | HTTP', response.status);
            return { status: 0 };
        }
        const result = await response.json();
        console.log(`[SMS] ${maskPhoneForLog(recipient)}:`, result?.status === 1 ? 'accepted' : 'refused', '| code:', result?.code ?? 'none');
        return result;
    } catch (error: any) {
        console.error('[SMS] Moolre error:', error?.name || 'error');
        return null;
    }
}

export function smsAccepted(result: any): boolean {
    return !!result && (result.status === 1 || result.status === '1');
}

async function sms(to: string | null | undefined, message: string): Promise<SendResult> {
    if (!to || String(to).replace(/\D/g, '').length < 9) return { sms: false };
    const result = await sendSMS({ to: String(to), message });
    return { sms: smsAccepted(result) };
}

function customerName(order: any): string {
    const a = order?.shipping_address || {};
    const m = order?.metadata || {};
    const first = a.firstName || m.first_name || m.customer_name || (a.full_name ? String(a.full_name).split(' ')[0] : '');
    return clean(first, 30) || 'Customer';
}

function orderPhone(order: any): string | null {
    return order?.phone || order?.shipping_address?.phone || null;
}

function trackingUrl(order: any): string {
    return `${storeBaseUrl()}/order-tracking?order=${encodeURIComponent(String(order?.order_number || order?.id || ''))}`;
}

/** Payment confirmation SMS. Pass the order row (as stored). */
export async function sendOrderConfirmation(order: any): Promise<SendResult> {
    if (!order) return { sms: false };
    const ref = clean(order.order_number || order.id, 40);
    const name = customerName(order);
    const trackingNumber = clean(order.metadata?.tracking_number, 30);

    // Preorder shipping notes (service client: order_items are not public).
    let notes = '';
    try {
        if (order.id) {
            const { data: items } = await createServerSupabase('service')
                .from('order_items')
                .select('product_name, metadata')
                .eq('order_id', order.id);
            const lines = (items || [])
                .filter((i: any) => i?.metadata?.preorder_shipping)
                .map((i: any) => `${clean(i.product_name, 40)}: ${clean(i.metadata.preorder_shipping, 60)}`);
            if (lines.length) notes = ` Note: ${lines.join('; ')}.`;
        }
    } catch {
        /* notes are optional */
    }

    const message = trackingNumber
        ? `Hi ${name}, payment received: your order #${ref} is confirmed. Tracking: ${trackingNumber}. Track here: ${trackingUrl(order)}${notes}`
        : `Hi ${name}, payment received: your order #${ref} at ${BRAND_NAME} is confirmed. Track here: ${trackingUrl(order)}${notes}`;
    return sms(orderPhone(order), message.slice(0, 600));
}

/** Status update SMS from the stored order row and its stored status. */
export async function sendOrderStatusUpdate(order: any, newStatus: string): Promise<SendResult> {
    if (!order) return { sms: false };
    const ref = clean(order.order_number || order.id, 40);
    const name = customerName(order);
    const trackingNumber = clean(order.metadata?.tracking_number, 30);
    const url = trackingUrl(order);
    const status = clean(newStatus, 30);

    let message: string;
    if (status === 'shipped') {
        message = trackingNumber
            ? `Good news ${name}! Order #${ref} has been packed and is on its way. Tracking: ${trackingNumber}. Track: ${url}`
            : `Good news ${name}! Order #${ref} has been packed and is on its way. Track: ${url}`;
    } else if (status === 'delivered') {
        message = `Hi ${name}, your order #${ref} has been delivered. Any problem? Tell us on WhatsApp within 24 hours.`;
    } else if (status === 'processing') {
        message = trackingNumber
            ? `Hi ${name}, your order #${ref} is being prepared. Tracking: ${trackingNumber}. Track: ${url}`
            : `Hi ${name}, your order #${ref} is being prepared. Track: ${url}`;
    } else if (status === 'cancelled') {
        message = `Hi ${name}, your order #${ref} has been cancelled. Questions? WhatsApp us on +233 24 603 3792.`;
    } else {
        message = `Hi ${name}, order #${ref} status: ${status.replace(/_/g, ' ')}. Track: ${url}`;
    }
    return sms(orderPhone(order), message);
}

/** Payment link SMS for an unpaid order (link by row id, which is the payment proof). */
export async function sendPaymentLink(order: any): Promise<SendResult> {
    if (!order?.id) return { sms: false };
    const ref = clean(order.order_number || order.id, 40);
    const name = customerName(order);
    const total = Number(order.total) || 0;
    const paymentUrl = `${storeBaseUrl()}/pay/${order.id}`;
    return sms(orderPhone(order), `Hi ${name}, complete your order #${ref} (GH₵${total.toFixed(2)}) here: ${paymentUrl}`);
}

// ============================================================
// Personal Shopper
// ============================================================

function shopperPayUrl(req: any): string {
    return `${getShopperBaseUrl()}/pay/${req.id}`;
}

function shopperTrackUrl(req: any): string {
    // The track page sends `id` to /api/shopper/requests, which accepts an SR number there.
    return `${getShopperBaseUrl()}/track?id=${encodeURIComponent(String(req.request_number || req.id))}`;
}

function shopperName(req: any): string {
    return clean(String(req?.contact_name || '').split(' ')[0], 30) || 'Customer';
}

export async function sendShopperPaymentLink(req: any): Promise<SendResult> {
    if (!req?.id) return { sms: false };
    const total = Number(req.total_final ?? req.total_est ?? 0);
    const reqRef = clean(req.request_number || req.id, 40);
    return sms(
        req.contact_phone,
        `Hi ${shopperName(req)}, your GSG Personal Shopper request ${reqRef} is ready. Total GH₵${total.toFixed(2)}. Pay here: ${shopperPayUrl(req)}`,
    );
}

export async function sendShopperOrderConfirmation(req: any): Promise<SendResult> {
    if (!req) return { sms: false };
    const total = Number(req.total_final ?? req.total_est ?? 0);
    const reqRef = clean(req.request_number || req.id, 40);
    return sms(
        req.contact_phone,
        `Payment received! Your GSG Personal Shopper request ${reqRef} (GH₵${total.toFixed(2)}) is now being processed. Track: ${shopperTrackUrl(req)}`,
    );
}

const SHOPPER_STATUS_TEXT: Record<string, string> = {
    SHOPPING: 'our shopper is buying your items now',
    OUT_FOR_DELIVERY: 'your items are on the way',
    DELIVERED: 'your items have been delivered. Any problem? Tell us on WhatsApp within 24 hours',
    CANCELLED: 'your request has been cancelled. Questions? WhatsApp us on +233 24 603 3792',
    AWAITING_CONFIRMATION: 'we have confirmed market prices; please check your request',
};

/** Status SMS for the key shopper steps; other steps send nothing. */
export async function sendShopperStatusUpdate(req: any, status: string): Promise<SendResult> {
    const text = SHOPPER_STATUS_TEXT[status];
    if (!req || !text) return { sms: false };
    const reqRef = clean(req.request_number || req.id, 40);
    return sms(req.contact_phone, `Hi ${shopperName(req)}, GSG Personal Shopper ${reqRef}: ${text}. Track: ${shopperTrackUrl(req)}`);
}
