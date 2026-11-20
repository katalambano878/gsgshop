/**
 * Orders without a real email address carry a placeholder, because
 * `orders.email` is NOT NULL and customers are keyed by email:
 *   - WhatsApp AI orders: `<phone>@whatsapp.gsgbrands.com.gh` (owner's call,
 *     3 Nov 2026; keep in sync with the bot's WHATSAPP_PLACEHOLDER_EMAIL_DOMAIN,
 *     gsgai src/contexts/goods/orders.ts);
 *   - checkout without an email: `<phone>@store.local`;
 *   - till sales: `...@pos.local` / `pos-walkin@store.local`;
 *   - older assistant orders: `brain-<phone>@orders.local`.
 * The site never sends email; these addresses are never shown to customers
 * and never counted as contact details.
 */
export const WHATSAPP_PLACEHOLDER_EMAIL_DOMAIN = 'whatsapp.gsgbrands.com.gh';

/** Domain used by checkout when the customer gives no email. */
export const CHECKOUT_PLACEHOLDER_EMAIL_DOMAIN = 'store.local';

const PLACEHOLDER_DOMAINS = [
    WHATSAPP_PLACEHOLDER_EMAIL_DOMAIN,
    'store.local',
    'pos.local',
    'whatsapp.local',
    'orders.local',
];

export function isPlaceholderEmail(email: string | null | undefined): boolean {
    const e = (email || '').trim().toLowerCase();
    if (!e) return false;
    return PLACEHOLDER_DOMAINS.some((d) => e.endsWith(`@${d}`));
}

/** Placeholder for an order with no email, keyed by the phone's digits. */
export function checkoutPlaceholderEmail(phone: string): string {
    const digits = String(phone || '').replace(/\D/g, '') || 'guest';
    return `${digits}@${CHECKOUT_PLACEHOLDER_EMAIL_DOMAIN}`;
}
