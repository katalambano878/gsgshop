// GoTrue-compatible auth against plain Postgres auth.users (bcrypt hashes).

import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "crypto";
import { getSharedPool, query } from "./pool";
import { authJwtSecret } from "./mode";

const ACCESS_TTL_SEC = 60 * 60; // matches the Supabase project's jwt_exp
const REFRESH_TTL_SEC = 60 * 60 * 24 * 30; // 30 days
const BCRYPT_ROUNDS = 10;

const BASE_USER_COLUMNS = `id, email, phone, encrypted_password, email_confirmed_at,
  phone_confirmed_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, banned_until`;

// auth.users.session_version (sign-out-everywhere) is added by
// scripts/plain-postgres/auth_session_version.sql. Until it exists every
// token counts as current and sign-out only clears the browser's tokens.
let sessionVersionColumn: Promise<boolean> | null = null;
function hasSessionVersion(): Promise<boolean> {
  // pg_attribute on the shared pool (owner role): never a request's RLS role,
  // which may not see auth.users at all.
  sessionVersionColumn ??= getSharedPool()
    .query(
      `SELECT 1 FROM pg_catalog.pg_attribute
        WHERE attrelid = 'auth.users'::regclass AND attname = 'session_version' AND NOT attisdropped`
    )
    .then(({ rows }) => rows.length > 0)
    .catch((e) => {
      sessionVersionColumn = null;
      throw e;
    });
  return sessionVersionColumn;
}

async function userColumns(): Promise<string> {
  return (await hasSessionVersion())
    ? `${BASE_USER_COLUMNS}, session_version`
    : `${BASE_USER_COLUMNS}, 0 AS session_version`;
}

export interface AuthUser {
  id: string;
  aud: string;
  role: string;
  email: string;
  phone: string;
  email_confirmed_at: string | null;
  phone_confirmed_at: string | null;
  confirmed_at: string | null;
  last_sign_in_at: string | null;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  identities: unknown[];
  created_at: string;
  updated_at: string;
}

/** Error with the GoTrue error code supabase-js surfaces to the app. */
export interface AuthFailure {
  message: string;
  code: string;
  status: number;
}

function fail(message: string, code: string, status = 400): AuthFailure {
  return { message, code, status };
}

export interface SessionTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  token_type: "bearer";
  user: AuthUser;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(authJwtSecret());
}

function isBanned(row: Record<string, any>): boolean {
  return !!row.banned_until && new Date(row.banned_until).getTime() > Date.now();
}

/**
 * The session generation a token was minted for. Tokens from before
 * `session_version` existed carry no `sv` claim and count as generation 0, so
 * the deploy signs nobody out.
 */
function tokenVersion(payload: Record<string, any>): number {
  const sv = Number(payload.sv ?? 0);
  return Number.isFinite(sv) ? sv : 0;
}

function rowVersion(row: Record<string, any>): number {
  return Number(row.session_version ?? 0) || 0;
}

/** Revoke every session of an account: access and refresh tokens minted before now stop working. */
export async function bumpSessionVersion(userId: string): Promise<void> {
  if (!(await hasSessionVersion())) {
    console.warn("[auth] auth.users.session_version is missing: sessions cannot be revoked server-side");
    return;
  }
  await query(
    `UPDATE auth.users SET session_version = session_version + 1, updated_at = now() WHERE id = $1`,
    [userId]
  );
}

export type AuthMethod = "password" | "otp" | "recovery";
type AmrEntry = { method: AuthMethod; timestamp: number };

function parseAmr(value: unknown): AmrEntry[] | null {
  if (!Array.isArray(value)) return null;
  const out: AmrEntry[] = [];
  for (const v of value) {
    const method = v?.method;
    const timestamp = Number(v?.timestamp);
    if ((method === "password" || method === "otp" || method === "recovery") && Number.isFinite(timestamp)) {
      out.push({ method, timestamp });
    }
  }
  return out.length ? out : null;
}

// bcrypt work runs off the event loop (async), so a burst of sign-ins does
// not stall every other request this single Node process is serving.
function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

let dummyHash: Promise<string> | null = null;
/** Spend the same bcrypt time when there is no account, so timing does not reveal one. */
async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= bcrypt.hash("not-a-real-password", BCRYPT_ROUNDS);
  await bcrypt.compare(password, await dummyHash).catch(() => false);
}

async function userRowById(userId: string): Promise<Record<string, any> | null> {
  const { rows } = await query(
    `SELECT ${await userColumns()} FROM auth.users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

async function userRowByEmail(email: string): Promise<Record<string, any> | null> {
  const { rows } = await query(
    `SELECT ${await userColumns()} FROM auth.users WHERE lower(email) = $1 AND deleted_at IS NULL LIMIT 1`,
    [email.trim().toLowerCase()]
  );
  return rows[0] ?? null;
}

function rowToUser(row: Record<string, any>, appRole?: string | null): AuthUser {
  const meta =
    typeof row.raw_user_meta_data === "string"
      ? JSON.parse(row.raw_user_meta_data || "{}")
      : row.raw_user_meta_data || {};
  const appMeta =
    typeof row.raw_app_meta_data === "string"
      ? JSON.parse(row.raw_app_meta_data || "{}")
      : row.raw_app_meta_data || {};
  if (appRole) {
    appMeta.role = appRole;
  }
  return {
    id: row.id,
    aud: "authenticated",
    role: "authenticated",
    email: row.email || "",
    phone: row.phone || "",
    email_confirmed_at: row.email_confirmed_at || null,
    phone_confirmed_at: row.phone_confirmed_at || null,
    confirmed_at: row.email_confirmed_at || row.phone_confirmed_at || null,
    last_sign_in_at: row.last_sign_in_at || null,
    app_metadata: appMeta,
    user_metadata: meta,
    identities: [],
    created_at: row.created_at,
    updated_at: row.updated_at || row.created_at,
  };
}

async function loadAppRole(userId: string): Promise<string | null> {
  try {
    const { rows } = await query<{ role: string }>(
      `SELECT role FROM profiles WHERE id = $1 LIMIT 1`,
      [userId]
    );
    return rows[0]?.role ?? null;
  } catch {
    return null;
  }
}

async function mintSession(
  userRow: Record<string, any>,
  auth: { method: AuthMethod; amr?: AmrEntry[] | null; sessionId?: string }
): Promise<SessionTokens> {
  const appRole = await loadAppRole(userRow.id);
  const user = rowToUser(userRow, appRole);
  const now = Math.floor(Date.now() / 1000);
  const sessionId = auth.sessionId || randomUUID();
  const sv = rowVersion(userRow);
  // GoTrue-style authentication methods. A refresh keeps the original sign-in
  // time, so "signed in recently" cannot be renewed by refreshing.
  const amr: AmrEntry[] = auth.amr?.length ? auth.amr : [{ method: auth.method, timestamp: now }];

  const access_token = await new SignJWT({
    aud: "authenticated",
    role: "authenticated",
    email: user.email,
    phone: user.phone,
    app_metadata: user.app_metadata,
    user_metadata: user.user_metadata,
    session_id: sessionId,
    aal: "aal1",
    amr,
    sv,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TTL_SEC)
    .sign(secretKey());

  const refresh_token = await new SignJWT({
    typ: "refresh",
    session_id: sessionId,
    amr,
    sv,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuedAt(now)
    .setExpirationTime(now + REFRESH_TTL_SEC)
    .sign(secretKey());

  return {
    access_token,
    refresh_token,
    expires_in: ACCESS_TTL_SEC,
    expires_at: now + ACCESS_TTL_SEC,
    token_type: "bearer",
    user,
  };
}

export async function verifyAccessToken(
  token: string
): Promise<{ userId: string; payload: Record<string, any> } | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (payload.typ === "refresh") return null;
    // Only session tokens minted by signInWithPassword/refresh: never the
    // anon or service_role keys, and never a token without an expiry.
    if (payload.role !== "authenticated" || typeof payload.exp !== "number") return null;
    const userId = typeof payload.sub === "string" ? payload.sub : null;
    if (!userId) return null;
    return { userId, payload: payload as Record<string, any> };
  } catch {
    return null;
  }
}


/** The account behind an id, banned or not. */
export async function getUserById(userId: string): Promise<AuthUser | null> {
  const row = await userRowById(userId);
  if (!row) return null;
  return rowToUser(row, await loadAppRole(userId));
}

/**
 * The signed-in user for an access token: invalid, deleted, banned or revoked
 * (signed out everywhere, password changed) → null.
 */
export async function getUserForToken(token: string): Promise<AuthUser | null> {
  const verified = await verifyAccessToken(token);
  if (!verified) return null;
  const row = await userRowById(verified.userId);
  if (!row || isBanned(row)) return null;
  if (tokenVersion(verified.payload) < rowVersion(row)) return null;
  return rowToUser(row, await loadAppRole(row.id));
}

/** Sign out everywhere (supabase-js `signOut()`, default scope "global"). */
export async function signOutEverywhere(token: string): Promise<void> {
  const verified = await verifyAccessToken(token);
  if (!verified) return;
  const row = await userRowById(verified.userId);
  if (!row || tokenVersion(verified.payload) < rowVersion(row)) return;
  await bumpSessionVersion(row.id);
}

/**
 * GSG Goods has no mail provider, so accounts are confirmed on sign-up
 * (Supabase "Confirm email" off / mailer_autoconfirm) and an account that
 * was never confirmed on Supabase can still sign in: there is no way left
 * to confirm it.
 */
export const MAILER_AUTOCONFIRM = true;

export async function signInWithPassword(
  email: string,
  password: string
): Promise<{ session: SessionTokens | null; error: AuthFailure | null }> {
  const row = await userRowByEmail(email);
  if (!row?.encrypted_password) {
    await burnPasswordCheck(password);
    return { session: null, error: fail("Invalid login credentials", "invalid_credentials") };
  }
  if (!(await bcrypt.compare(password, row.encrypted_password).catch(() => false))) {
    return { session: null, error: fail("Invalid login credentials", "invalid_credentials") };
  }
  if (isBanned(row)) {
    return { session: null, error: fail("User is banned", "user_banned") };
  }
  if (!row.email_confirmed_at && !MAILER_AUTOCONFIRM) {
    return { session: null, error: fail("Email not confirmed", "email_not_confirmed") };
  }

  await query(
    `UPDATE auth.users SET last_sign_in_at = now(), updated_at = now() WHERE id = $1`,
    [row.id]
  ).catch(() => {});

  return { session: await mintSession(row, { method: "password" }), error: null };
}

/**
 * GoTrue sign-up with "Confirm email" off: the account is created confirmed
 * and signed in at once (the sign-up page then goes straight to /account).
 * An address that already has an account gets GoTrue's 422
 * `user_already_exists`, and the existing password is never touched. Both
 * branches spend one bcrypt hash, so response time does not differ.
 */
export async function signUpWithPassword(opts: {
  email: string;
  password: string;
  data?: Record<string, unknown>;
}): Promise<{ user: AuthUser | null; session: SessionTokens | null; error: AuthFailure | null }> {
  const email = opts.email.trim().toLowerCase();
  if (!email || !opts.password) {
    return { user: null, session: null, error: fail("Email and password are required", "validation_failed") };
  }
  if (!email.includes("@")) {
    return {
      user: null,
      session: null,
      error: fail("Unable to validate email address: invalid format", "validation_failed"),
    };
  }
  if (opts.password.length < 6) {
    return {
      user: null,
      session: null,
      error: fail("Password should be at least 6 characters.", "weak_password", 422),
    };
  }

  const prior = await userRowByEmail(email);
  if (prior) {
    await hashPassword(opts.password);
    return { user: null, session: null, error: fail("User already registered", "user_already_exists", 422) };
  }

  // handle_new_user (AFTER INSERT trigger) creates the matching profiles row.
  let inserted: Record<string, any>;
  try {
    const { rows } = await query(
      `INSERT INTO auth.users (
         id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
         confirmation_token, raw_app_meta_data, raw_user_meta_data,
         created_at, updated_at, last_sign_in_at, recovery_token, email_change_token_new, email_change
       ) VALUES (
         $1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         $2, $3, now(), '', '{"provider":"email","providers":["email"]}'::jsonb, $4::jsonb,
         now(), now(), now(), '', '', ''
       ) RETURNING ${await userColumns()}`,
      [randomUUID(), email, await hashPassword(opts.password), JSON.stringify(opts.data || {})]
    );
    inserted = rows[0];
  } catch (e: any) {
    // Two sign-ups for one address at once: the loser sees the unique index.
    if (e?.code === "23505") {
      return { user: null, session: null, error: fail("User already registered", "user_already_exists", 422) };
    }
    throw e;
  }
  await query(
    `INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
     VALUES (gen_random_uuid(), $1::text, $1, jsonb_build_object('sub', $1::text, 'email', $2::text,
             'email_verified', false, 'phone_verified', false), 'email', now(), now(), now())`,
    [inserted.id, email]
  ).catch((e) => console.error("[auth] identity insert failed:", e.message));

  const session = await mintSession(inserted, { method: "password" });
  return { user: session.user, session, error: null };
}

export async function refreshSession(
  refreshToken: string
): Promise<{ session: SessionTokens | null; error: AuthFailure | null }> {
  const invalid = { session: null, error: fail("Invalid Refresh Token", "refresh_token_not_found") };
  try {
    const { payload } = await jwtVerify(refreshToken, secretKey(), { algorithms: ["HS256"] });
    if (payload.typ !== "refresh" || typeof payload.sub !== "string") return invalid;
    if (typeof payload.exp !== "number") return invalid;
    const row = await userRowById(payload.sub);
    if (!row) return invalid;
    if (isBanned(row)) return { session: null, error: fail("User is banned", "user_banned") };
    // Signed out everywhere since: revoked.
    if (tokenVersion(payload as Record<string, any>) < rowVersion(row)) return invalid;
    return {
      session: await mintSession(row, {
        method: "password",
        amr: parseAmr(payload.amr) ?? [{ method: "password", timestamp: 0 }],
        sessionId: typeof payload.session_id === "string" ? payload.session_id : undefined,
      }),
      error: null,
    };
  } catch {
    return invalid;
  }
}

/**
 * Set a new password (supabase-js `updateUser({ password })` from a signed-in
 * session), as Supabase does with "Secure password change" off: no recent
 * sign-in is required and the caller's session keeps working.
 */
export async function updateUserPassword(
  userId: string,
  password: string
): Promise<{ user: AuthUser | null; error: AuthFailure | null }> {
  if (!password || password.length < 6) {
    return { user: null, error: fail("Password should be at least 6 characters.", "weak_password", 422) };
  }
  await query(
    `UPDATE auth.users SET encrypted_password = $1, updated_at = now() WHERE id = $2`,
    [await hashPassword(password), userId]
  );
  return { user: await getUserById(userId), error: null };
}

export async function updateUserMetadata(
  userId: string,
  data: Record<string, unknown>
): Promise<{ user: AuthUser | null; error: AuthFailure | null }> {
  await query(
    `UPDATE auth.users
     SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || $1::jsonb,
         updated_at = now()
     WHERE id = $2`,
    [JSON.stringify(data), userId]
  );
  return { user: await getUserById(userId), error: null };
}

/**
 * Ban or unban an account (GoTrue `ban_duration` semantics: a Go duration
 * such as "876000h", or "none" to lift). A ban ends every live session at once.
 */
export async function setUserBan(userId: string, duration: string): Promise<{ error: AuthFailure | null }> {
  if (duration === "none") {
    await query(`UPDATE auth.users SET banned_until = NULL, updated_at = now() WHERE id = $1`, [userId]);
    return { error: null };
  }
  const m = /^(\d+(?:\.\d+)?)(h|m|s)$/.exec(duration.trim());
  if (!m) return { error: fail(`invalid format for ban duration: ${duration}`, "validation_failed") };
  const unit = m[2] === "h" ? "hours" : m[2] === "m" ? "minutes" : "seconds";
  await query(
    `UPDATE auth.users SET banned_until = now() + $1::interval, updated_at = now() WHERE id = $2`,
    [`${m[1]} ${unit}`, userId]
  );
  await bumpSessionVersion(userId);
  return { error: null };
}
