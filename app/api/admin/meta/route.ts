import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getMetaSettings, saveMetaSettings, toView } from '@/lib/meta-settings';
import { META_FEED_URL } from '@/lib/meta-sync';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/meta — administrators only: Meta & WhatsApp settings
 *     (never the tokens; only whether each is set and its last four characters).
 * PUT /api/admin/meta — administrators only: save them. accessToken
 *     (catalogue) and whatsappToken: a string replaces it, null removes it,
 *     omitted keeps it.
 * Staff get 403: the tokens control the store's WhatsApp number and catalogue.
 */

async function unauthorized(request: Request) {
    const auth = await verifyAuth(request, { requireRole: 'admin' });
    if (auth.authenticated) return null;
    return NextResponse.json(
        { success: false, error: auth.user ? 'Only an administrator can manage Meta and WhatsApp settings.' : 'Unauthorized' },
        { status: auth.user ? 403 : 401, headers: { 'Cache-Control': 'no-store' } }
    );
}

export async function GET(request: Request) {
    const denied = await unauthorized(request);
    if (denied) return denied;
    const settings = await getMetaSettings();
    return NextResponse.json({ success: true, settings: toView(settings), feedUrl: META_FEED_URL });
}

export async function PUT(request: Request) {
    const denied = await unauthorized(request);
    if (denied) return denied;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
        return NextResponse.json({ success: false, error: 'Invalid body' }, { status: 400 });
    }
    try {
        const current = await getMetaSettings();
        const newCatalog = String(body.catalogId ?? '').replace(/\D/g, '');
        const settings = await saveMetaSettings({
            pixelId: body.pixelId,
            catalogId: body.catalogId,
            wabaId: body.wabaId,
            phoneNumberId: body.phoneNumberId,
            autoSync: body.autoSync,
            accessToken: body.accessToken === null ? null : typeof body.accessToken === 'string' ? body.accessToken : undefined,
            whatsappToken: body.whatsappToken === null ? null : typeof body.whatsappToken === 'string' ? body.whatsappToken : undefined,
            // A different catalogue needs its own hourly feed.
            ...(body.catalogId !== undefined && newCatalog !== current.catalogId ? { feedId: '' } : {}),
        });
        return NextResponse.json({ success: true, settings: toView(settings), feedUrl: META_FEED_URL });
    } catch (err: any) {
        console.error('[admin/meta] save failed:', err?.message);
        return NextResponse.json({ success: false, error: 'The settings could not be saved. Please try again.' }, { status: 500 });
    }
}
