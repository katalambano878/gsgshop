import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { connectWhatsAppCatalog, ensureHourlyFeed, removeFromCatalogIfEnabled, syncProducts, syncProductsIfEnabled, testMetaConnection } from '@/lib/meta-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/admin/meta/action — admin buttons on Admin → Meta & WhatsApp,
 * plus the product form's after-save sync.
 *   { action: 'test' }              check the saved IDs and token
 *   { action: 'setup' }             hourly feed + full product sync
 *   { action: 'sync' }              full product sync now
 *   { action: 'whatsapp' }          show the catalogue on the WhatsApp number
 *   { action: 'product', productIds } sync edited products (if auto-sync is on)
 *   { action: 'remove', skus }      take deleted products out (if auto-sync is on)
 */
export async function POST(request: Request) {
    const auth = await verifyAuth(request, { requireAdmin: true });
    if (!auth.authenticated) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    try {
        switch (body?.action) {
            case 'test':
                return NextResponse.json({ success: true, checks: await testMetaConnection() });
            case 'setup': {
                const feedId = await ensureHourlyFeed();
                const sync = await syncProducts();
                return NextResponse.json({ success: sync.ok, feedId, sync, error: sync.ok ? undefined : sync.message });
            }
            case 'sync': {
                const sync = await syncProducts();
                return NextResponse.json({ success: sync.ok, sync, error: sync.ok ? undefined : sync.message });
            }
            case 'whatsapp':
                return NextResponse.json({ success: true, ...(await connectWhatsAppCatalog()) });
            case 'product': {
                const ids = Array.isArray(body.productIds) ? body.productIds.filter((x: unknown) => typeof x === 'string').slice(0, 50) : [];
                if (!ids.length) return NextResponse.json({ success: false, error: 'No productIds' }, { status: 400 });
                return NextResponse.json({ success: true, sync: await syncProductsIfEnabled(ids) });
            }
            case 'remove': {
                const skus = Array.isArray(body.skus) ? body.skus.filter((x: unknown) => typeof x === 'string' && x).slice(0, 500) : [];
                if (!skus.length) return NextResponse.json({ success: false, error: 'No skus' }, { status: 400 });
                return NextResponse.json({ success: true, removed: await removeFromCatalogIfEnabled(skus) });
            }
            default:
                return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
        }
    } catch (err: any) {
        console.error('[admin/meta/action]', body?.action, err?.message);
        return NextResponse.json({ success: false, error: err?.message || 'Meta request failed' }, { status: 502 });
    }
}
