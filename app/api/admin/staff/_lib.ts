import { query } from '@/lib/db/pool';
import type { StaffActor } from '@/app/api/admin/_lib/shared';

/** Roles a staff account can have. 'customer' means "no dashboard access". */
export const STAFF_ROLES = ['admin', 'staff'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value);
}

export function roleLabel(role: string): string {
  return role === 'admin' ? 'Admin' : role === 'staff' ? 'Staff' : 'Customer';
}

export const STAFF_SELECT = `
  p.id, p.email, p.full_name, p.phone, p.role::text AS role, p.created_at, p.updated_at,
  u.last_sign_in_at, (u.banned_until IS NOT NULL AND u.banned_until > now()) AS banned`;

export async function loadStaffRow(id: string) {
  const { rows } = await query<any>(
    `SELECT ${STAFF_SELECT} FROM profiles p LEFT JOIN auth.users u ON u.id = p.id WHERE p.id = $1`,
    [id],
  );
  return rows[0] || null;
}

/** Serialises admin-count checks so two demotions cannot both pass the last-admin guard. */
export async function lockAdminCount() {
  await query(`SELECT pg_advisory_xact_lock(hashtext('gsg-staff-admin-count'))`);
}

export async function countAdmins(): Promise<number> {
  const { rows } = await query<{ n: number }>(`SELECT count(*)::int AS n FROM profiles WHERE role = 'admin'`);
  return rows[0]?.n || 0;
}

/** Writes one audit_logs row for a staff change. Never put a password in details. */
export async function logStaff(
  actor: StaffActor,
  action: 'staff.create' | 'staff.promote' | 'staff.update' | 'staff.role_change' | 'staff.remove',
  targetId: string,
  details: Record<string, unknown>,
) {
  await query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, 'staff', $3, $4::jsonb)`,
    [actor.id, action, targetId, JSON.stringify(details)],
  );
}
