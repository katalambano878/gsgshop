import { getGoodsBaseUrl } from '@/lib/site-urls';

/**
 * Uploaded files are stored with host-relative URLs
 * (`/storage/v1/object/public/products/<name>`), so the same row works on
 * goods.gsgbrands.com.gh, shopper.gsgbrands.com.gh and any test host.
 *
 * Anything that leaves the site (feeds, sitemap, JSON-LD, Open Graph, the
 * WhatsApp agent) needs an absolute URL: build it with absoluteMediaUrl().
 * Already-absolute URLs (https:, http:, data:, protocol-relative) are
 * returned unchanged.
 */
export function absoluteMediaUrl(url: string, base?: string): string;
export function absoluteMediaUrl(url: string | null | undefined, base?: string): string | null;
export function absoluteMediaUrl(url: string | null | undefined, base: string = getGoodsBaseUrl()): string | null {
    if (url == null) return null;
    const value = String(url).trim();
    if (!value) return value;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) return value;
    const origin = base.replace(/\/+$/, '');
    return `${origin}${value.startsWith('/') ? '' : '/'}${value}`;
}

const STORAGE_PATH = '/storage/v1/';

/**
 * Copy of `value` (rows from the data API) with every host-relative storage
 * URL made absolute. Used for responses to the GSG AI WhatsApp agent, which
 * sends product photos to customers and so needs full URLs.
 */
export function absolutizeStorageUrls<T>(value: T, base: string = getGoodsBaseUrl()): T {
    const visit = (v: unknown): unknown => {
        if (typeof v === 'string') return v.startsWith(STORAGE_PATH) ? absoluteMediaUrl(v, base) : v;
        if (Array.isArray(v)) return v.map(visit);
        if (v && typeof v === 'object') {
            const out: Record<string, unknown> = {};
            for (const [k, inner] of Object.entries(v as Record<string, unknown>)) out[k] = visit(inner);
            return out;
        }
        return v;
    };
    return visit(value) as T;
}
