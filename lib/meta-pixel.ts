/**
 * Meta (Facebook) Pixel for goods. and shopper.gsgbrands.com.gh.
 *
 * The base code is loaded once by components/MetaPixel.tsx (every page except
 * /admin). These helpers fire the standard events; they are no-ops on the
 * server, in admin, and before the pixel script has loaded.
 *
 * content_ids must equal the `id` column of /feed/meta.csv (the product SKU)
 * so Meta can match events to catalogue items for dynamic ads.
 */

export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || '1864260301673937';

type FbqParams = Record<string, unknown>;

declare global {
    interface Window {
        fbq?: (...args: unknown[]) => void;
    }
}

export function trackPixel(event: string, params?: FbqParams, eventId?: string, attempt = 0): void {
    if (typeof window === 'undefined') return;
    if (window.location.pathname.startsWith('/admin')) return;
    if (typeof window.fbq !== 'function') {
        // The base code loads afterInteractive; events fired on first render
        // (ViewContent, Purchase) can beat it. Retry for ~5s, then give up.
        if (attempt < 20) setTimeout(() => trackPixel(event, params, eventId, attempt + 1), 250);
        return;
    }
    try {
        if (eventId) window.fbq('track', event, params || {}, { eventID: eventId });
        else window.fbq('track', event, params || {});
    } catch {
        /* never let tracking break the page */
    }
}

/** Fire an event only once per browser tab session (e.g. Purchase on a reloaded thank-you page). */
export function trackPixelOnce(key: string, event: string, params?: FbqParams, eventId?: string): void {
    if (typeof window === 'undefined') return;
    const storageKey = `meta-pixel:${event}:${key}`;
    try {
        if (window.sessionStorage.getItem(storageKey)) return;
        window.sessionStorage.setItem(storageKey, '1');
    } catch {
        /* storage blocked: fall through and track anyway */
    }
    trackPixel(event, params, eventId);
}
