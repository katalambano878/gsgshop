import { supabaseAdmin } from '@/lib/supabase-admin';
import { absoluteUrl } from '@/lib/seo';
import { META_PRODUCT_SELECT, metaItemId, toMetaItem, type MetaSourceProduct } from '@/lib/meta-catalog';
import { getMetaSettings, metaGraph, recordMetaFeedId, recordMetaSync, type MetaSyncResult } from '@/lib/meta-settings';

/**
 * Pushes products to the Meta catalogue set in Admin → Meta & WhatsApp. The
 * same catalogue feeds Facebook, Instagram and (once connected) the WhatsApp
 * Business catalogue, so one sync updates all three. Server-only.
 *
 * Two paths keep it current:
 *   1. Instant: the admin product form calls syncProducts([id]) after a save.
 *   2. Hourly: Meta fetches /feed/meta.csv on the schedule ensureHourlyFeed()
 *      creates, which also catches stock changes from sales.
 */

export const META_FEED_URL = absoluteUrl('/feed/meta.csv');

type BatchRequest = { method: 'UPDATE' | 'DELETE'; data: Record<string, string> };

async function sendBatch(catalogId: string, requests: BatchRequest[]): Promise<void> {
    // items_batch accepts up to 5000 requests per call.
    for (let i = 0; i < requests.length; i += 1000) {
        await metaGraph(`${catalogId}/items_batch`, {
            method: 'POST',
            body: { item_type: 'PRODUCT_ITEM', requests: requests.slice(i, i + 1000) },
        });
    }
}

/** Retailer ids currently in the catalogue (to remove ones we no longer list). */
async function listCatalogIds(catalogId: string): Promise<string[]> {
    const ids: string[] = [];
    let after: string | undefined;
    for (let page = 0; page < 50; page++) {
        const res: any = await metaGraph(`${catalogId}/products`, {
            body: { fields: 'retailer_id', limit: '500', ...(after ? { after } : {}) },
        });
        for (const p of res?.data ?? []) if (p.retailer_id) ids.push(String(p.retailer_id));
        after = res?.paging?.cursors?.after;
        if (!res?.paging?.next || !after) break;
    }
    return ids;
}

/**
 * Sync to the catalogue. With `productIds`, only those products (an admin
 * edit); without, every product, and anything in the catalogue that the shop
 * no longer lists is removed.
 */
export async function syncProducts(productIds?: string[]): Promise<MetaSyncResult> {
    const settings = await getMetaSettings();
    if (!settings.catalogId || !settings.accessToken) {
        return { at: new Date().toISOString(), ok: false, sent: 0, message: 'Catalogue ID or access token missing.' };
    }

    let query = supabaseAdmin.from('products').select(META_PRODUCT_SELECT);
    query = productIds?.length ? query.in('id', productIds) : query.eq('status', 'active');
    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const products = (data || []) as unknown as MetaSourceProduct[];
    const requests: BatchRequest[] = [];
    const listed = new Set<string>();
    for (const p of products) {
        const item = toMetaItem(p);
        if (item) {
            listed.add(item.id);
            requests.push({ method: 'UPDATE', data: item });
        } else if (productIds?.length) {
            // Edited into something Meta can't list (hidden, no price/photo): take it down.
            requests.push({ method: 'DELETE', data: { id: metaItemId(p) } });
        }
    }

    let removed = 0;
    if (!productIds?.length) {
        const stale = (await listCatalogIds(settings.catalogId)).filter((id) => !listed.has(id));
        removed = stale.length;
        for (const id of stale) requests.push({ method: 'DELETE', data: { id } });
    }

    const result: MetaSyncResult = { at: new Date().toISOString(), ok: true, sent: listed.size, removed };
    try {
        if (requests.length) await sendBatch(settings.catalogId, requests);
    } catch (err: any) {
        result.ok = false;
        result.message = err?.message || 'Sync failed';
    }
    await recordMetaSync(result).catch(() => {});
    return result;
}

/** Take deleted products out of the catalogue, if auto-sync is on. Never throws. */
export async function removeFromCatalogIfEnabled(skus: string[]): Promise<boolean> {
    try {
        const settings = await getMetaSettings();
        if (!settings.autoSync || !settings.catalogId || !settings.accessToken || !skus.length) return false;
        await sendBatch(settings.catalogId, skus.map((id) => ({ method: 'DELETE' as const, data: { id } })));
        return true;
    } catch (err: any) {
        console.warn('[meta-sync] remove failed:', err?.message);
        return false;
    }
}

/** Fire-and-forget sync after an admin edit, if auto-sync is on. Never throws. */
export async function syncProductsIfEnabled(productIds: string[]): Promise<MetaSyncResult | null> {
    try {
        const settings = await getMetaSettings();
        if (!settings.autoSync || !settings.catalogId || !settings.accessToken) return null;
        return await syncProducts(productIds);
    } catch (err: any) {
        console.warn('[meta-sync] product sync failed:', err?.message);
        return null;
    }
}

/** Make sure the catalogue fetches /feed/meta.csv every hour. Returns the feed id. */
export async function ensureHourlyFeed(): Promise<string> {
    const settings = await getMetaSettings();
    if (!settings.catalogId) throw new Error('Save the catalogue ID first.');
    if (settings.feedId) return settings.feedId;

    const feeds: any = await metaGraph(`${settings.catalogId}/product_feeds`, { body: { fields: 'id,name,schedule' } });
    const existing = (feeds?.data ?? []).find((f: any) => f?.schedule?.url === META_FEED_URL);
    const feedId = existing?.id
        ? String(existing.id)
        : String(
            (
                await metaGraph<{ id: string }>(`${settings.catalogId}/product_feeds`, {
                    method: 'POST',
                    body: {
                        name: 'GSG website (hourly)',
                        default_currency: 'GHS',
                        country: 'GH',
                        schedule: { interval: 'HOURLY', url: META_FEED_URL },
                    },
                })
            ).id
        );
    await recordMetaFeedId(feedId);
    return feedId;
}

/** Link the catalogue to the WhatsApp Business account and show it on the number. */
export async function connectWhatsAppCatalog(): Promise<{ number: string | null }> {
    const s = await getMetaSettings();
    if (!s.catalogId || !s.wabaId || !s.phoneNumberId) {
        throw new Error('Save the catalogue ID, WhatsApp Business Account ID and phone number ID first.');
    }
    await metaGraph(`${s.wabaId}/product_catalogs`, { method: 'POST', body: { catalog_id: s.catalogId } });
    await metaGraph(`${s.phoneNumberId}/whatsapp_commerce_settings`, {
        method: 'POST',
        body: { is_catalog_visible: true, is_cart_enabled: true },
    });
    const phone: any = await metaGraph(s.phoneNumberId, { body: { fields: 'display_phone_number' } }).catch(() => null);
    return { number: phone?.display_phone_number ?? null };
}

/** Check each saved ID against Meta with the saved token. */
export async function testMetaConnection() {
    const s = await getMetaSettings();
    const check = async (label: string, id: string, fields: string) => {
        if (!id) return { label, ok: false, detail: 'Not filled in' };
        try {
            const res: any = await metaGraph(id, { body: { fields } });
            const name = res?.name || res?.verified_name || res?.display_phone_number || id;
            const extra = res?.product_count !== undefined ? ` (${res.product_count} products)` : '';
            return { label, ok: true, detail: `${name}${extra}` };
        } catch (err: any) {
            return { label, ok: false, detail: err?.message || 'Not reachable' };
        }
    };
    if (!s.accessToken) {
        return [{ label: 'Access token', ok: false, detail: 'Not saved yet' }];
    }
    return Promise.all([
        check('Pixel', s.pixelId, 'name'),
        check('Catalogue', s.catalogId, 'name,product_count'),
        check('WhatsApp Business Account', s.wabaId, 'name'),
        check('WhatsApp number', s.phoneNumberId, 'display_phone_number,verified_name'),
    ]);
}
