import { NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/db/pool';
import { passwordProblem, signUpWithPassword } from '@/lib/db/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { EMAIL_RE, HttpError, errorResponse, gate, readJson, str } from '@/app/api/admin/_lib/shared';
import { STAFF_SELECT, isStaffRole, loadStaffRow, logStaff, roleLabel } from './_lib';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Staff accounts. ADMIN ONLY.
 *
 * GET  → 200 { staff: [{ id, email, full_name, phone, role, created_at, updated_at, last_sign_in_at, banned }],
 *              counts: { total, admin, staff }, viewerId }
 * POST { email, full_name, password, role: 'admin' | 'staff' }
 *      → 201 { staff, message }                new account created (password rules: lib/db/auth passwordProblem)
 *      → 200 { staff, promoted: true, message } the email already had a customer account: it is
 *                                               given the role and keeps its own password
 *      → 409 the email already belongs to staff; 400 bad input
 */

const LIMIT = { maxRequests: 30, windowSeconds: 60 };

export async function GET(request: Request) {
  const g = await gate(request, 'admin');
  if (g.response) return g.response;

  try {
    const { rows } = await query<any>(
      `SELECT ${STAFF_SELECT}
         FROM profiles p LEFT JOIN auth.users u ON u.id = p.id
        WHERE p.role IN ('admin', 'staff')
        ORDER BY (p.role = 'admin') DESC, p.created_at`,
    );
    return NextResponse.json({
      staff: rows,
      counts: {
        total: rows.length,
        admin: rows.filter((r) => r.role === 'admin').length,
        staff: rows.filter((r) => r.role === 'staff').length,
      },
      viewerId: g.actor.id,
    });
  } catch (err) {
    return errorResponse(err, 'Could not load staff accounts', 'admin/staff GET');
  }
}

export async function POST(request: Request) {
  const g = await gate(request, 'admin');
  if (g.response) return g.response;
  const actor = g.actor;

  if (!checkRateLimit(`admin-staff:${actor.id}`, LIMIT).success) {
    return NextResponse.json({ error: 'Too many changes in a minute. Wait a moment and try again.' }, { status: 429 });
  }

  const body = await readJson(request);
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const email = str(body.email, 254).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const fullName = str(body.full_name, 120);
  const role = str(body.role, 20);
  if (!email || !EMAIL_RE.test(email)) return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
  if (!isStaffRole(role)) return NextResponse.json({ error: 'Role must be admin or staff' }, { status: 400 });
  if (!fullName) return NextResponse.json({ error: 'Enter the staff member’s name' }, { status: 400 });

  try {
    const { rows: existing } = await query<{ id: string; role: string }>(
      `SELECT u.id, COALESCE(p.role::text, 'customer') AS role
         FROM auth.users u LEFT JOIN profiles p ON p.id = u.id
        WHERE lower(u.email) = $1 AND u.deleted_at IS NULL
        LIMIT 1`,
      [email],
    );

    if (existing[0]) {
      const target = existing[0];
      if (target.role !== 'customer') {
        return NextResponse.json({ error: 'This email already belongs to a staff member. Change them in the list instead.' }, { status: 409 });
      }
      // Promote the existing customer account; its password is left alone.
      const staff = await withTransaction(async () => {
        await query(
          `INSERT INTO profiles (id, email, full_name, role)
           VALUES ($1, $2, $3, $4::user_role)
           ON CONFLICT (id) DO UPDATE
             SET role = EXCLUDED.role,
                 full_name = COALESCE(NULLIF(profiles.full_name, ''), EXCLUDED.full_name),
                 updated_at = now()`,
          [target.id, email, fullName, role],
        );
        await logStaff(actor, 'staff.promote', target.id, { email, from_role: 'customer', to_role: role });
        return loadStaffRow(target.id);
      });
      const notes = ['This person already had a customer account, so they keep their own password.'];
      if (password) notes.push('The password you typed was not used.');
      if (staff?.banned) notes.push('Their sign-in is blocked; it must be unblocked before they can sign in.');
      return NextResponse.json({ staff, promoted: true, message: notes.join(' ') });
    }

    const weak = passwordProblem(password);
    if (weak) return NextResponse.json({ error: weak.message }, { status: 400 });

    // New sign-in (bcrypt hash; handle_new_user makes the customer profile).
    const { user, error } = await signUpWithPassword({ email, password, data: { full_name: fullName } });
    if (error || !user) {
      throw new HttpError(400, error?.message || 'Could not create the account');
    }
    // Sign-up answers the same for an address that already has an account
    // (it returns a stand-in user), so confirm the account really is this one.
    const { rows: made } = await query<{ id: string }>(
      `SELECT id FROM auth.users WHERE lower(email) = $1 AND deleted_at IS NULL LIMIT 1`,
      [email],
    );
    if (!made[0] || made[0].id !== user.id) {
      return NextResponse.json({ error: 'An account with this email was just created. Refresh and try again.' }, { status: 409 });
    }

    try {
      const staff = await withTransaction(async () => {
        await query(
          `INSERT INTO profiles (id, email, full_name, role)
           VALUES ($1, $2, $3, $4::user_role)
           ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, full_name = EXCLUDED.full_name, updated_at = now()`,
          [user.id, email, fullName, role],
        );
        await logStaff(actor, 'staff.create', user.id, { email, role });
        return loadStaffRow(user.id);
      });
      return NextResponse.json({ staff, message: `${roleLabel(role)} account created.` }, { status: 201 });
    } catch (roleErr: any) {
      console.error('[admin/staff POST] role not set on new account:', roleErr?.message);
      return NextResponse.json(
        { error: 'The sign-in was created but could not be given a staff role. Add the same email again to finish.' },
        { status: 500 },
      );
    }
  } catch (err) {
    return errorResponse(err, 'Could not add this staff member', 'admin/staff POST');
  }
}
