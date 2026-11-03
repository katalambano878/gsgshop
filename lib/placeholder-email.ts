/**
 * WhatsApp AI orders don't ask the customer for an email (owner's call,
 * 3 Nov 2026). `orders.email` is NOT NULL and customers are keyed by
 * email, so the bot fills in a per-phone placeholder on this domain
 * instead. Nothing is ever mailed to it and the storefront hides it —
 * those customers get SMS and WhatsApp updates.
 *
 * Keep in sync with the bot's WHATSAPP_PLACEHOLDER_EMAIL_DOMAIN (gsgai,
 * src/contexts/goods/orders.ts).
 */
export const WHATSAPP_PLACEHOLDER_EMAIL_DOMAIN = 'whatsapp.gsgbrands.com.gh';

export function isPlaceholderEmail(email: string | null | undefined): boolean {
    return (email || '').trim().toLowerCase().endsWith(`@${WHATSAPP_PLACEHOLDER_EMAIL_DOMAIN}`);
}
