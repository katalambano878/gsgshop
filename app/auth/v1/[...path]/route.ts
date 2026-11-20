import { NextRequest, NextResponse } from "next/server";
import {
  signInWithPassword,
  signUpWithPassword,
  refreshSession,
  getUserForToken,
  signOutEverywhere,
  updateUserPassword,
  updateUserMetadata,
  MAILER_AUTOCONFIRM,
  type AuthFailure,
} from "@/lib/db/auth";
import { isPlainPostgres } from "@/lib/db/mode";
import {
  checkRateLimit,
  clearLoginFailures,
  getClientIdentifier,
  loginLockRemaining,
  RATE_LIMITS,
  recordLoginFailure,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Sign-ups per client IP per hour (Supabase's default is 30/hour per IP).
const SIGNUP_IP_LIMIT = { maxRequests: 30, windowSeconds: 3600 };

function cors(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  };
}

function gotrueError(message: string, status = 400, code = "invalid_request") {
  return NextResponse.json(
    { error: code, error_code: code, error_description: message, msg: message, message },
    { status, headers: cors() }
  );
}

function failure(err: AuthFailure) {
  return gotrueError(err.message, err.status, err.code);
}

/** Sign-in attempts per IP and per address (successes count too; failures also feed the lockout). */
function loginRateLimited(req: NextRequest, email: string): NextResponse | null {
  const ip = checkRateLimit(`auth-login-ip:${getClientIdentifier(req)}`, RATE_LIMITS.authLoginIp);
  const addr = email ? checkRateLimit(`auth-login-email:${email}`, RATE_LIMITS.authLoginEmail) : { success: true };
  if (ip.success && addr.success) return null;
  return gotrueError("Too many requests. Please wait a minute and try again.", 429, "over_request_rate_limit");
}

function bearer(req: NextRequest): string {
  return (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

function sessionResponse(session: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  token_type: string;
  user: unknown;
}) {
  return NextResponse.json(
    {
      access_token: session.access_token,
      token_type: session.token_type,
      expires_in: session.expires_in,
      expires_at: session.expires_at,
      refresh_token: session.refresh_token,
      user: session.user,
    },
    { status: 200, headers: cors() }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
) {
  if (!isPlainPostgres()) return gotrueError("DATABASE_URL not set", 503);

  const { path } = await ctx.params;
  const slug = path.join("/");

  if (slug === "user") {
    const token = bearer(req);
    if (!token) return gotrueError("This endpoint requires a Bearer token", 401, "no_authorization");
    // Invalid, expired, banned, deleted or revoked (signed out everywhere,
    // password changed) sessions all answer like GoTrue's bad_jwt.
    const user = await getUserForToken(token);
    if (!user) return gotrueError("invalid JWT: unable to parse or verify signature", 403, "bad_jwt");
    return NextResponse.json(user, { headers: cors() });
  }

  if (slug === "settings" || slug === "health") {
    return NextResponse.json(
      { external: { email: true }, disable_signup: false, mailer_autoconfirm: MAILER_AUTOCONFIRM },
      { headers: cors() }
    );
  }

  return gotrueError(`Unknown auth path: ${slug}`, 404);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
) {
  if (!isPlainPostgres()) return gotrueError("DATABASE_URL not set", 503);

  const { path } = await ctx.params;
  const slug = path.join("/");
  const url = req.nextUrl;
  const contentType = req.headers.get("content-type") || "";

  let body: Record<string, any> = {};
  if (contentType.includes("application/json")) {
    body = (await req.json().catch(() => ({}))) as Record<string, any>;
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    body = Object.fromEntries(new URLSearchParams(text));
  }

  // /auth/v1/token?grant_type=password|refresh_token
  if (slug === "token") {
    const grant =
      url.searchParams.get("grant_type") ||
      body.grant_type ||
      "password";

    if (grant === "password") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const limited = loginRateLimited(req, email);
      if (limited) return limited;
      // 10 wrong passwords for one address lock it for 15 minutes. Only
      // failures count, and a correct password clears the count.
      const lockedFor = loginLockRemaining(email);
      if (lockedFor > 0) {
        return gotrueError(
          `Too many failed sign-in attempts. Try again in ${Math.ceil(lockedFor / 60)} minutes, or reset your password.`,
          429,
          "over_request_rate_limit"
        );
      }
      const { session, error } = await signInWithPassword(email, password);
      if (error?.code === "invalid_credentials") recordLoginFailure(email);
      else if (!error || error.code === "email_not_confirmed") clearLoginFailures(email);
      if (error || !session) return failure(error ?? { message: "Invalid login credentials", code: "invalid_credentials", status: 400 });
      return sessionResponse(session);
    }

    if (grant === "refresh_token") {
      const refresh = String(body.refresh_token || "");
      const { session, error } = await refreshSession(refresh);
      if (error || !session) {
        return failure(error ?? { message: "Invalid Refresh Token", code: "refresh_token_not_found", status: 400 });
      }
      return sessionResponse(session);
    }

    return gotrueError(`Unsupported grant_type: ${grant}`);
  }

  if (slug === "signup") {
    const ip = checkRateLimit(`auth-signup-ip:${getClientIdentifier(req)}`, SIGNUP_IP_LIMIT);
    if (!ip.success) return gotrueError("Too many requests. Please try again later.", 429, "over_request_rate_limit");
    const email = String(body.email || "");
    const { session, error } = await signUpWithPassword({
      email,
      password: String(body.password || ""),
      data: body.data || body.user_metadata || {},
    });
    if (error || !session) {
      return failure(error ?? { message: "Signup failed", code: "validation_failed", status: 400 });
    }
    // Confirmation off: GoTrue answers with a full session, which supabase-js
    // stores, so the visitor is signed in straight away.
    clearLoginFailures(session.user.email);
    return sessionResponse(session);
  }

  // No mail provider is configured for this store, so confirmation and
  // password-reset emails cannot be sent. Answer like GoTrue does for an
  // unknown address (no error, nothing sent) rather than failing the page.
  if (slug === "resend" || slug === "recover") {
    console.warn(`[auth] /auth/v1/${slug} called, but this store sends no account emails`);
    return NextResponse.json({}, { status: 200, headers: cors() });
  }

  if (slug === "logout") {
    // supabase-js signOut() defaults to scope=global: end every session of
    // the account (all devices) by bumping its session version. "local" and
    // "others" only drop this browser's tokens. GoTrue answers 204 with no
    // body, and supabase-js keeps the session if this errors, so never fail.
    const scope = url.searchParams.get("scope") || "global";
    const token = bearer(req);
    if (scope === "global" && token) {
      await signOutEverywhere(token).catch((e) => console.error("[auth] global sign-out failed:", e.message));
    }
    // 204 must not include a body (NextResponse.json throws Invalid response status code 204)
    return new NextResponse(null, { status: 204, headers: cors() });
  }

  return gotrueError(`Unknown auth path: ${slug}`, 404);
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
) {
  if (!isPlainPostgres()) return gotrueError("DATABASE_URL not set", 503);

  const { path } = await ctx.params;
  const slug = path.join("/");

  if (slug !== "user") {
    return gotrueError(`Unknown auth path: ${slug}`, 404);
  }

  const token = bearer(req);
  if (!token) return gotrueError("This endpoint requires a Bearer token", 401, "no_authorization");
  const current = await getUserForToken(token);
  if (!current) return gotrueError("invalid JWT: unable to parse or verify signature", 403, "bad_jwt");

  const body = (await req.json().catch(() => ({}))) as Record<string, any>;
  let user = current;

  if (body.password !== undefined) {
    // Supabase with "Secure password change" off: any valid session may set
    // a new password, and that session stays signed in.
    const res = await updateUserPassword(current.id, String(body.password));
    if (res.error || !res.user) return failure(res.error ?? { message: "Update failed", code: "unexpected_failure", status: 500 });
    user = res.user;
  }

  if (body.data || body.user_metadata) {
    const res = await updateUserMetadata(current.id, body.data || body.user_metadata);
    if (res.error || !res.user) return failure(res.error ?? { message: "Update failed", code: "unexpected_failure", status: 500 });
    user = res.user;
  }

  return NextResponse.json(user, { headers: cors() });
}
