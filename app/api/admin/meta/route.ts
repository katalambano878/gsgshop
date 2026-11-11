import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getMetaSettings, saveMetaSettings, toView } from '@/lib/meta-settings';
import { META_FEED_URL } from '@/lib/meta-sync';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/meta — admin: Meta & WhatsApp settings (never the token).
 * PUT /api/admin/meta — admin: save them. accessToken: string replaces it,
 *     null removes it, omitted keeps it.
 */

async function unauthorized(request: Request) {
    const auth = await verifyAuth(request, { requireAdmin: true });
    return auth.authenticated ? null : NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
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
            // A different catalogue needs its own hourly feed.
            ...(body.catalogId !== undefined && newCatalog !== current.catalogId ? { feedId: '' } : {}),
        });
        return NextResponse.json({ success: true, settings: toView(settings), feedUrl: META_FEED_URL });
    } catch (err: any) {
        console.error('[admin/meta] save failed:', err?.message);
        return NextResponse.json({ success: false, error: err?.message || 'Failed to save' }, { status: 500 });
    }
}
