import { isPlaceholderEmail } from '@/lib/placeholder-email';
import { phoneLast9 } from '@/lib/phone';

/** Display-only masking for contact details returned by public order routes. */

export function maskEmail(email: unknown): string | null {
    if (typeof email !== 'string' || !email.includes('@')) return null;
    const [local, domain] = email.trim().split('@');
    if (!local || !domain) return null;
    const head = local.slice(0, Math.min(2, local.length));
    return `${head}${'*'.repeat(Math.max(1, local.length - head.length))}@${domain}`;
}

export function maskPhone(phone: unknown): string | null {
    const digits = String(phone || '').replace(/\D+/g, '');
    if (digits.length < 4) return null;
    return `${'*'.repeat(Math.max(0, digits.length - 3))}${digits.slice(-3)}`;
}

/**
 * Addresses that are not the customer's own: the WhatsApp bot's per-phone
 * placeholder and the till's walk-in keys. They never count as a match and
 * are never shown.
 */
export function isPlaceholder(email: unknown): boolean {
    if (typeof email !== 'string') return true;
    const e = email.trim().toLowerCase();
    return !e || isPlaceholderEmail(e) || /@(pos|store)\.local$/.test(e);
}

/** True when the typed phone and a stored phone have the same last 9 digits. */
export function phonesMatch(stored: unknown, typed: unknown): boolean {
    const a = phoneLast9(stored);
    const b = phoneLast9(typed);
    return !!a && !!b && a === b;
}

/** True when the typed email equals a real (non-placeholder) stored email. */
export function emailsMatch(stored: unknown, typed: string): boolean {
    if (!typed || isPlaceholder(stored)) return false;
    return String(stored).trim().toLowerCase() === typed.trim().toLowerCase();
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const ORDER_NUMBER_RE = /^ORD-\d+-\d+$/i;
export const TRACKING_RE = /^SLI-[A-Z0-9]{4,12}$/i;
