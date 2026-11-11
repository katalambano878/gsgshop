import { NextResponse } from 'next/server';
import { getMetaSettings } from '@/lib/meta-settings';

export const dynamic = 'force-dynamic';

/** GET /api/meta/config — public: the Pixel ID set in Admin → Meta & WhatsApp. */
export async function GET() {
    const { pixelId } = await getMetaSettings();
    return NextResponse.json(
        { pixelId },
        { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' } }
    );
}
