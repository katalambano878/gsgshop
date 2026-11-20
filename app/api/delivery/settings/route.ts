import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getDeliverySettings, saveDeliverySettings } from '@/lib/delivery-settings';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/delivery/settings — public: effective pricing config + hub.
 *      Storefront/shopper pages use this so fee previews match what the
 *      server will actually charge.
 * PUT  /api/delivery/settings — ADMIN ONLY (not staff): update the settings.
 */

export async function GET() {
  const settings = await getDeliverySettings();
  return NextResponse.json({ success: true, settings });
}

export async function PUT(request: Request) {
  try {
    const auth = await verifyAuth(request, { requireRole: 'admin' });
    if (!auth.authenticated) {
      return NextResponse.json(
        { success: false, error: auth.user ? 'Administrator access required' : 'Unauthorized' },
        { status: auth.user ? 403 : 401 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Invalid body' }, { status: 400 });
    }

    const settings = await saveDeliverySettings(body);
    return NextResponse.json({ success: true, settings });
  } catch (err: any) {
    console.error('[delivery/settings] save failed:', err?.code || err?.message || 'error');
    return NextResponse.json({ success: false, error: 'Failed to save settings' }, { status: 500 });
  }
}
