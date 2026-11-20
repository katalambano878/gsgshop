import { NextResponse } from 'next/server';
import { verifyAuth, type UserRole } from '@/lib/auth';

/** Helpers shared by the dashboard's server routes (till, orders, products, staff, customers, inventory). */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Placeholder address used when a walk-in buyer gives no phone and no email. */
export const POS_WALKIN_EMAIL = 'pos-walkin@store.local';

export type StaffActor = { id: string; email: string | null; role: string };

/**
 * Checks the bearer token and role. Returns the actor, or a ready 401/403
 * response. Use roles ['admin', 'staff'] for staff routes, 'admin' for admin-only.
 */
export async function gate(
  request: Request,
  roles: UserRole | UserRole[],
): Promise<{ actor: StaffActor; response?: undefined } | { actor?: undefined; response: NextResponse }> {
  const auth = await verifyAuth(request, { requireRole: roles });
  if (!auth.authenticated || !auth.user?.id) {
    const forbidden = !!auth.user;
    const adminOnly = !Array.isArray(roles) || (roles.length === 1 && roles[0] === 'admin');
    return {
      response: NextResponse.json(
        { error: forbidden ? (adminOnly ? 'Only an admin can do this.' : 'Staff access required') : 'Please sign in again.' },
        { status: forbidden ? 403 : 401 },
      ),
    };
  }
  return {
    actor: { id: String(auth.user.id), email: auth.user.email ?? null, role: String(auth.role || '') },
  };
}

export async function readJson(request: Request): Promise<any | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

export function str(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Money in pesewas (integer) so 12.10 x 3 is exactly 36.30. NaN when not a number. */
export function toPesewas(value: unknown): number {
  if (value === null || value === undefined || value === '') return NaN;
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

export function fromPesewas(p: number): number {
  return Math.round(p) / 100;
}

/** Error with an HTTP status and extra JSON fields, thrown inside a transaction to roll it back. */
export class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export function errorResponse(err: unknown, fallback: string, tag: string) {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message, ...err.extra }, { status: err.status });
  }
  console.error(`[${tag}]`, (err as any)?.message || err);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
