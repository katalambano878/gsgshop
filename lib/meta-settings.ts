import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * Meta (Facebook / Instagram / WhatsApp) integration settings, edited in
 * Admin → Meta & WhatsApp. Server-only: import it from API routes, never from
 * a client component.
 *
 * Stored in site_settings under META_SETTINGS_KEY. site_settings is publicly
 * readable (RLS), so the access tokens are AES-256-GCM encrypted with a key
 * derived from SUPABASE_SERVICE_ROLE_KEY, which only the server has. The
 * plaintext tokens never leave the server; the admin page only sees the last
 * four characters.
 *
 * Meta issues separate tokens for the catalogue (Pixel, catalogue, feeds) and
 * for WhatsApp (WhatsApp Business account, phone number), so there are two.
 */

export const META_SETTINGS_KEY = 'meta_integration';
export const DEFAULT_META_PIXEL_ID = '1864260301673937';
export const META_GRAPH = 'https://graph.facebook.com/v21.0';

export type MetaSyncResult = {
    at: string;
    ok: boolean;
    sent: number;
    removed?: number;
    message?: string;
};

type StoredMetaSettings = {
    pixelId?: string;
    catalogId?: string;
    feedId?: string;
    wabaId?: string;
    phoneNumberId?: string;
    autoSync?: boolean;
    /** Catalogue token. Named accessToken* from when there was only one. */
    accessTokenEnc?: string;
    tokenLast4?: string;
    whatsappTokenEnc?: string;
    whatsappTokenLast4?: string;
    lastSync?: MetaSyncResult;
    updatedAt?: string;
};

export type MetaSettings = {
    pixelId: string;
    catalogId: string;
    feedId: string;
    wabaId: string;
    phoneNumberId: string;
    autoSync: boolean;
    /** Catalogue token: Pixel, catalogue, product feeds. */
    accessToken: string;
    tokenLast4: string;
    /** WhatsApp token: WhatsApp Business account and phone number. */
    whatsappToken: string;
    whatsappTokenLast4: string;
    lastSync: MetaSyncResult | null;
    updatedAt: string | null;
};

/** What the admin page may see: everything except the tokens themselves. */
export type MetaSettingsView = Omit<MetaSettings, 'accessToken' | 'whatsappToken'> & {
    tokenSet: boolean;
    whatsappTokenSet: boolean;
};

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');

function encryptionKey(): Buffer {
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
    return createHash('sha256').update(`meta-integration:${secret}`).digest();
}

function encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

function decrypt(payload: string | undefined): string {
    if (!payload) return '';
    try {
        const [version, iv, tag, data] = payload.split(':');
        if (version !== 'v1') return '';
        const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    } catch {
        // Key rotated or data tampered with: treat as "no token saved".
        return '';
    }
}

async function readStored(): Promise<StoredMetaSettings> {
    const { data } = await supabaseAdmin
        .from('site_settings')
        .select('value')
        .eq('key', META_SETTINGS_KEY)
        .maybeSingle();
    return ((data?.value as StoredMetaSettings | null) ?? {}) as StoredMetaSettings;
}

async function writeStored(value: StoredMetaSettings): Promise<void> {
    const { error } = await supabaseAdmin
        .from('site_settings')
        .upsert(
            { key: META_SETTINGS_KEY, value, category: 'integrations', updated_at: new Date().toISOString() },
            { onConflict: 'key' }
        );
    if (error) throw new Error(error.message);
    cache = null;
}

let cache: { value: MetaSettings; expires: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function getMetaSettings(): Promise<MetaSettings> {
    if (cache && cache.expires > Date.now()) return cache.value;
    const s = await readStored().catch(() => ({} as StoredMetaSettings));
    const value: MetaSettings = {
        pixelId: digits(s.pixelId) || DEFAULT_META_PIXEL_ID,
        catalogId: digits(s.catalogId),
        feedId: digits(s.feedId),
        wabaId: digits(s.wabaId),
        phoneNumberId: digits(s.phoneNumberId),
        autoSync: s.autoSync !== false,
        accessToken: decrypt(s.accessTokenEnc),
        tokenLast4: s.tokenLast4 || '',
        whatsappToken: decrypt(s.whatsappTokenEnc),
        whatsappTokenLast4: s.whatsappTokenLast4 || '',
        lastSync: s.lastSync ?? null,
        updatedAt: s.updatedAt ?? null,
    };
    cache = { value, expires: Date.now() + CACHE_TTL_MS };
    return value;
}

export function toView(s: MetaSettings): MetaSettingsView {
    const { accessToken, whatsappToken, ...rest } = s;
    return { ...rest, tokenSet: Boolean(accessToken), whatsappTokenSet: Boolean(whatsappToken) };
}

/**
 * Save the admin form. For `accessToken` (catalogue) and `whatsappToken`: a
 * non-empty string replaces the saved token, `null` removes it,
 * undefined/empty keeps the current one.
 */
export async function saveMetaSettings(input: {
    pixelId?: string;
    catalogId?: string;
    feedId?: string;
    wabaId?: string;
    phoneNumberId?: string;
    autoSync?: boolean;
    accessToken?: string | null;
    whatsappToken?: string | null;
}): Promise<MetaSettings> {
    const current = await readStored();
    const next: StoredMetaSettings = {
        ...current,
        pixelId: input.pixelId !== undefined ? digits(input.pixelId) : current.pixelId,
        catalogId: input.catalogId !== undefined ? digits(input.catalogId) : current.catalogId,
        feedId: input.feedId !== undefined ? digits(input.feedId) : current.feedId,
        wabaId: input.wabaId !== undefined ? digits(input.wabaId) : current.wabaId,
        phoneNumberId: input.phoneNumberId !== undefined ? digits(input.phoneNumberId) : current.phoneNumberId,
        autoSync: input.autoSync !== undefined ? Boolean(input.autoSync) : current.autoSync,
        updatedAt: new Date().toISOString(),
    };
    if (input.accessToken === null) {
        delete next.accessTokenEnc;
        delete next.tokenLast4;
    } else if (typeof input.accessToken === 'string' && input.accessToken.trim()) {
        const token = input.accessToken.trim();
        next.accessTokenEnc = encrypt(token);
        next.tokenLast4 = token.slice(-4);
    }
    if (input.whatsappToken === null) {
        delete next.whatsappTokenEnc;
        delete next.whatsappTokenLast4;
    } else if (typeof input.whatsappToken === 'string' && input.whatsappToken.trim()) {
        const token = input.whatsappToken.trim();
        next.whatsappTokenEnc = encrypt(token);
        next.whatsappTokenLast4 = token.slice(-4);
    }
    await writeStored(next);
    return getMetaSettings();
}

export async function recordMetaSync(result: MetaSyncResult): Promise<void> {
    const current = await readStored();
    await writeStored({ ...current, lastSync: result });
}

/** Store the feed id once the hourly feed has been created in the catalogue. */
export async function recordMetaFeedId(feedId: string): Promise<void> {
    const current = await readStored();
    await writeStored({ ...current, feedId: digits(feedId) });
}

/**
 * Call the Graph API with a saved token: the catalogue token by default,
 * `use: 'whatsapp'` for WhatsApp Business account / phone number calls.
 * Throws with Meta's own message on failure.
 */
export async function metaGraph<T = any>(
    path: string,
    init: {
        method?: 'GET' | 'POST' | 'DELETE';
        body?: Record<string, unknown>;
        token?: string;
        use?: 'catalog' | 'whatsapp';
    } = {}
): Promise<T> {
    let token = init.token;
    if (!token) {
        const s = await getMetaSettings();
        token = init.use === 'whatsapp' ? s.whatsappToken : s.accessToken;
    }
    if (!token) {
        throw new Error(init.use === 'whatsapp' ? 'No WhatsApp access token saved yet.' : 'No Catalogue access token saved yet.');
    }
    const method = init.method ?? 'GET';
    const url = new URL(`${META_GRAPH}/${path.replace(/^\//, '')}`);
    let body: string | undefined;
    if (method === 'GET') {
        for (const [k, v] of Object.entries(init.body ?? {})) url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    } else if (init.body) {
        body = JSON.stringify(init.body);
    }
    const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body,
        cache: 'no-store',
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || json?.error) {
        throw new Error(json?.error?.error_user_msg || json?.error?.message || `Meta returned HTTP ${res.status}`);
    }
    return json as T;
}
