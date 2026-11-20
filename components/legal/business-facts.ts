/**
 * The shop's contact details and opening hours, in one place, so the
 * information pages, header, footer, FAQ and structured data all say the
 * same thing. Hours match app/shopper/customer-experience/page.tsx.
 */

export const SHOP_NAME = 'GSG Convenience Goods & More';

export const PHONE_PRIMARY_DISPLAY = '+233 24 603 3792';
export const PHONE_PRIMARY_TEL = '+233246033792';
export const PHONE_SECONDARY_DISPLAY = '+233 57 903 3792';
export const PHONE_SECONDARY_TEL = '+233579033792';

export const WHATSAPP_NUMBER = '233246033792';
export const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}`;

/** WhatsApp link with a prefilled message. */
export function whatsappLink(message?: string): string {
  return message ? `${WHATSAPP_URL}?text=${encodeURIComponent(message)}` : WHATSAPP_URL;
}

/** Shown as a contact address only: the site never sends email. */
export const CONTACT_EMAIL = 'info@gsgbrands.com.gh';

export const TELEGRAM_URL = 'https://t.me/gsgbrandsgh';

export const OPENING_HOURS = [
  { days: 'Monday to Friday', hours: '05:00 to 14:00' },
  { days: 'Saturday and public holidays', hours: '05:00 to 09:00' },
] as const;

export const EXTENDED_HOURS = [
  { days: 'Monday to Friday', hours: '14:01 to 18:00' },
  { days: 'Saturday and public holidays', hours: '09:01 to 14:00' },
] as const;

/** One-line summary for small spaces. */
export const HOURS_SUMMARY = 'Mon–Fri 05:00–14:00, Sat and holidays 05:00–09:00';

/** Return window, from delivery. */
export const RETURN_WINDOW_HOURS = 24;
