import { NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/db/pool';
import { bumpSessionVersion } from '@/lib/db/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { normalizeGhanaPhone } from '@/lib/phone';
import { HttpError, UUID_RE, errorResponse, gate, readJson, str } from '@/app/api/admin/_lib/shared';
import { countAdmins, isStaffRole, loadStaffRow, lockAdminCount, logStaff, roleLabel } from '../_lib';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * One staff account. ADMIN ONLY.
 *
 * PUT { role?: 'admin' | 'staff', full_name?, phone? } → 200 { staff }
 *   Nobody can change their own role; the last admin cannot be demoted.
 * DELETE → 200 { ok: true }
 *   Removes dashboard access: role back to 'customer' and every session of
 *   that account revoked (session_version bumped). The account and its order
 *   history stay. Nobody can remove themselves; the last admin stays.
 */

type RouteContext = { params: Promise<{ id: string }> };
const LIMIT = { maxRequests: 30, windowSeconds: 60 };

async function setup(request: Request, context: RouteContext) {
  const g = await gate(request, 'admin');
  if (g.response) return { response: g.response };
  if (!checkRateLimit(`admin-staff:${g.actor.id}`, LIMIT).success) {
    return { response: NextResponse.json({ error: 'Too many changes in a minute. Wait a moment and try again.' }, { status: 429 }) };
  }
  const { id } = await context.params;
  if (!id || !UUID_RE.test(id)) {
    return { response: NextResponse.json({ error: 'Invalid staff id' }, { status: 400 }) };
  }
  return { actor: g.actor, id };
}

async function loadStaffForUpdate(id: string) {
  const { rows } = await query<any>(
    `SELECT id, email, full_name, phone, role::text AS role FROM profiles WHERE id = $1 FOR UPDATE`,
    [id],
  );
  const row = rows[0];
  if (!row || !isStaffRole(row.role)) throw new HttpError(404, 'Staff member not found');
  return row as { id: string; email: string | null; full_name: string | null; phone: string | null; role: 'admin' | 'staff' };
}

export async function PUT(request: Request, context: RouteContext) {
  const s = await setup(request, context);
  if (s.response) return s.response;
  const { actor, id } = s as { actor: NonNullable<typeof s.actor>; id: string };

  const body = await readJson(request);
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  try {
    const staff = await withTransaction(async () => {
      const existing = await loadStaffForUpdate(id);
      const sets: string[] = [];
      const params: unknown[] = [id];
      const changed: string[] = [];

      if (body.full_name !== undefined) {
        const name = str(body.full_name, 120);
        if (!name) throw new HttpError(400, 'The name cannot be empty');
        if (name !== existing.full_name) {
          params.push(name);
          sets.push(`full_name = $${params.length}`);
          changed.push('full_name');
        }
      }
      if (body.phone !== undefined) {
        const typed = str(body.phone, 30);
        const phone = typed ? normalizeGhanaPhone(typed) : null;
        if (typed && !phone) throw new HttpError(400, 'Enter a valid Ghana phone number');
        if (phone !== existing.phone) {
          params.push(phone);
          sets.push(`phone = $${params.length}`);
          changed.push('phone');
        }
      }
      let roleChange: { from: string; to: string } | null = null;
      if (body.role !== undefined) {
        const role = str(body.role, 20);
        if (!isStaffRole(role)) throw new HttpError(400, 'Role must be admin or staff. To remove access, use Remove.');
        if (role !== existing.role) {
          if (id === actor.id) throw new HttpError(400, 'You cannot change your own role');
          if (existing.role === 'admin') {
            await lockAdminCount();
            if ((await countAdmins()) <= 1) throw new HttpError(409, 'The shop must keep at least one admin');
          }
          params.push(role);
          sets.push(`role = $${params.length}::user_role`);
          roleChange = { from: existing.role, to: role };
        }
      }
      if (sets.length === 0) throw new HttpError(400, 'Nothing to change');

      sets.push('updated_at = now()');
      await query(`UPDATE profiles SET ${sets.join(', ')} WHERE id = $1`, params);

      if (roleChange) {
        await logStaff(actor, 'staff.role_change', id, {
          email: existing.email,
          from_role: roleChange.from,
          to_role: roleChange.to,
          summary: `${roleLabel(roleChange.from)} → ${roleLabel(roleChange.to)}`,
        });
      }
      if (changed.length) await logStaff(actor, 'staff.update', id, { email: existing.email, fields: changed });
      return loadStaffRow(id);
    });
    return NextResponse.json({ staff });
  } catch (err) {
    return errorResponse(err, 'Could not update this staff member', 'admin/staff PUT');
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const s = await setup(request, context);
  if (s.response) return s.response;
  const { actor, id } = s as { actor: NonNullable<typeof s.actor>; id: string };

  if (id === actor.id) {
    return NextResponse.json({ error: 'You cannot remove your own access' }, { status: 400 });
  }

  try {
    await withTransaction(async () => {
      const existing = await loadStaffForUpdate(id);
      if (existing.role === 'admin') {
        await lockAdminCount();
        if ((await countAdmins()) <= 1) throw new HttpError(409, 'The shop must keep at least one admin');
      }
      await query(`UPDATE profiles SET role = 'customer'::user_role, updated_at = now() WHERE id = $1`, [id]);
      // Every token issued before now stops working (runs on this transaction).
      await bumpSessionVersion(id);
      await logStaff(actor, 'staff.remove', id, { email: existing.email, from_role: existing.role });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, 'Could not remove this staff member', 'admin/staff DELETE');
  }
}
