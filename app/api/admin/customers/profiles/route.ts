import { NextResponse } from 'next/server';
import { query } from '@/lib/db/pool';
import { UUID_RE, errorResponse, gate } from '@/app/api/admin/_lib/shared';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Names and contacts for a set of user ids (admin or staff), e.g. review
 * authors or ticket owners. Staff cannot read other users' profiles through
 * the data API, so pages use this instead.
 *
 * GET ?ids=<uuid>,<uuid>,...   (at most 200; invalid ids are ignored)
 * 200 { profiles: [{ id, full_name, email, phone }] }
 */

const MAX_IDS = 200;

export async function GET(request: Request) {
  const g = await gate(request, ['admin', 'staff']);
  if (g.response) return g.response;

  const raw = new URL(request.url).searchParams.get('ids') || '';
  const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => UUID_RE.test(s)))];
  if (ids.length > MAX_IDS) return NextResponse.json({ error: `At most ${MAX_IDS} ids` }, { status: 400 });
  if (ids.length === 0) return NextResponse.json({ profiles: [] });

  try {
    const { rows } = await query<any>(
      `SELECT id, full_name, email, phone FROM profiles WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    return NextResponse.json({ profiles: rows });
  } catch (err) {
    return errorResponse(err, 'Could not load profiles', 'admin/customers/profiles');
  }
}
