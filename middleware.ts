import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify, errors as joseErrors } from 'jose';
import { authJwtSecret, sessionClaimsValid } from '@/lib/db/mode';

// ============================================================
// Admin session check (edge-safe)
// ============================================================
// The middleware runs on the edge and cannot reach the database: it checks
// the session token's signature itself, then asks the app (same container,
// over loopback) for the live role, so a demoted, banned or signed-out
// staff member loses the dashboard at once. The browser mirrors its session
// into the `sb-access-token` cookie (app/admin/login and lib/supabase.ts).

const SESSION_COOKIE = 'sb-access-token';

/** The container serves on 0.0.0.0:3000; override with INTERNAL_APP_ORIGIN. */
function internalOrigin(request: NextRequest): string {
    if (process.env.INTERNAL_APP_ORIGIN) return process.env.INTERNAL_APP_ORIGIN.replace(/\/+$/, '');
    if (process.env.NODE_ENV !== 'production') return request.nextUrl.origin;
    return 'http://127.0.0.1:3000';
}

const ROLE_CACHE_TTL_MS = 30 * 1000;
const roleCache = new Map<string, { userId: string; role: string; fetchedAt: number }>();

type TokenCheck =
    | { status: 'ok'; userId: string; role: string }
    /** No usable session: expired. */
    | { status: 'expired' }
    /** Bad signature, wrong kind of token, revoked, or no profile. */
    | { status: 'invalid' }
    /** Signature is valid but the role lookup could not run (app unreachable). */
    | { status: 'unverified'; userId: string };

/** The same signing secret lib/db/auth.ts uses (AUTH_JWT_SECRET, JWT_SECRET or SUPABASE_JWT_SECRET). */
function jwtSecret(): string | null {
    try {
        return authJwtSecret();
    } catch {
        return null;
    }
}

async function checkToken(request: NextRequest, token: string): Promise<TokenCheck> {
    const secret = jwtSecret();
    if (!secret) return { status: 'invalid' };
    let userId: string;
    try {
        const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] });
        // A session access token for this app: not a refresh token, not the
        // anon/service key, has an expiry, a subject and this app's audience.
        if (!sessionClaimsValid(payload as Record<string, unknown>)) return { status: 'invalid' };
        userId = payload.sub as string;
    } catch (e) {
        return { status: e instanceof joseErrors.JWTExpired ? 'expired' : 'invalid' };
    }

    const now = Date.now();
    const cached = roleCache.get(token);
    if (cached && now - cached.fetchedAt < ROLE_CACHE_TTL_MS) {
        return { status: 'ok', userId: cached.userId, role: cached.role };
    }
    try {
        const res = await fetch(`${internalOrigin(request)}/api/auth/session-role`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
        });
        if (res.status === 401) return { status: 'invalid' };
        if (!res.ok) return { status: 'unverified', userId };
        const body = (await res.json()) as { userId?: string; role?: string };
        if (!body.userId || !body.role) return { status: 'invalid' };
        if (roleCache.size > 500) roleCache.clear();
        roleCache.set(token, { userId: body.userId, role: body.role, fetchedAt: now });
        return { status: 'ok', userId: body.userId, role: body.role };
    } catch {
        return { status: 'unverified', userId };
    }
}

/** This app's own Supabase-compatible API: never host-rewritten. */
function isDataApiPath(pathname: string): boolean {
    return (
        pathname === '/rest/v1' || pathname.startsWith('/rest/v1/') ||
        pathname === '/auth/v1' || pathname.startsWith('/auth/v1/') ||
        pathname === '/storage/v1' || pathname.startsWith('/storage/v1/')
    );
}

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;
    const hostname = request.headers.get('host') || '';
    const response = NextResponse.next();

    // ============================================================
    // Host-based routing for Shopper Subdomain
    // ============================================================
    // We have two sites in one Next.js app:
    //   - goods.gsgbrands.com.gh   -> the storefront (route root)
    //   - shopper.gsgbrands.com.gh -> the personal-shopper site
    //                                  (lives in the /shopper route group)
    //
    // Three rules are applied below in order so users always end up at clean
    // canonical URLs without us having to touch every <Link href="/shopper/...">
    // (which would break path-based access in local dev):
    //
    //   1. If the request hits the goods host with a /shopper/* path, and the
    //      shopper subdomain is configured, redirect cross-host so the user
    //      lands on the canonical subdomain URL.
    //   2. If the request hits the shopper host with a /shopper/* path,
    //      redirect to the bare path on the same host (drop the /shopper
    //      prefix from the URL bar).
    //   3. If the request hits the shopper host with a non-/shopper path
    //      (e.g. /how-it-works), silently rewrite to /shopper/<path> so the
    //      route group resolves. URL bar stays clean.
    //
    // Localhost / Vercel preview hosts hit none of these and continue to work
    // through path-based access at /shopper/*.
    // /rest/v1, /auth/v1 and /storage/v1 are API routes too: the browser's
    // supabase-js calls them on whichever host served the page.
    const isApiRoute = pathname.startsWith('/api/') || isDataApiPath(pathname);
    const isAdminRoute = pathname.startsWith('/admin');
    const isStaticFile = pathname.startsWith('/_next') || pathname.includes('.');

    const shopperHostFromEnv = (process.env.NEXT_PUBLIC_SITE_SHOPPER_URL || '')
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '')
        .toLowerCase();
    const goodsHostFromEnv = (process.env.NEXT_PUBLIC_SITE_GOODS_URL || '')
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '')
        .toLowerCase();
    const hostnameLower = hostname.toLowerCase();
    const isShopperHost = hostnameLower.startsWith('shopper.') ||
        (shopperHostFromEnv ? hostnameLower === shopperHostFromEnv : false);
    const isGoodsHost = goodsHostFromEnv ? hostnameLower === goodsHostFromEnv : false;

    if (!isApiRoute && !isAdminRoute && !isStaticFile) {
        // Rule 1: goods.../shopper/X  ->  shopper.../X (cross-host canonical)
        if (isGoodsHost && pathname.startsWith('/shopper') && shopperHostFromEnv) {
            const cleanPath = pathname.slice('/shopper'.length) || '/';
            const target = new URL(`https://${shopperHostFromEnv}${cleanPath}`);
            target.search = request.nextUrl.search;
            return NextResponse.redirect(target, 308);
        }

        // Rule 2: shopper.../shopper/X  ->  shopper.../X  (drop ugly prefix)
        if (isShopperHost && pathname.startsWith('/shopper')) {
            const cleanPath = pathname.slice('/shopper'.length) || '/';
            const target = new URL(cleanPath, request.url);
            target.search = request.nextUrl.search;
            return NextResponse.redirect(target, 308);
        }

        // Rule 3: shopper.../X  ->  rewrite to /shopper/X (transparent)
        if (isShopperHost && !pathname.startsWith('/shopper')) {
            const newUrl = new URL(
                `/shopper${pathname === '/' ? '' : pathname}`,
                request.url,
            );
            newUrl.search = request.nextUrl.search;
            return NextResponse.rewrite(newUrl);
        }
    }

    // ============================================================
    // Security headers for ALL routes
    // ============================================================
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

    // ============================================================
    // Admin route protection
    // ============================================================
    if (pathname.startsWith('/admin')) {
        // Security headers for admin
        response.headers.set('X-Robots-Tag', 'noindex, nofollow');
        response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');

        // Allow login page without auth
        if (pathname === '/admin/login') {
            return response;
        }

        // Server-side auth check: the session token the browser mirrors into
        // the sb-access-token cookie (see lib/supabase.ts).
        const token = request.cookies.get(SESSION_COOKIE)?.value;

        if (!token) {
            // No auth token found — redirect to login
            const loginUrl = new URL('/admin/login', request.url);
            loginUrl.searchParams.set('redirect', pathname);
            return NextResponse.redirect(loginUrl);
        }

        // Verify the token is valid and user has admin/staff role
        const check = await checkToken(request, token);
        if (check.status === 'expired' || check.status === 'invalid') {
            const loginUrl = new URL('/admin/login', request.url);
            loginUrl.searchParams.set('redirect', pathname);
            loginUrl.searchParams.set('error', 'session_expired');
            return NextResponse.redirect(loginUrl);
        }
        if (check.status === 'unverified') {
            // The role lookup could not run (app restarting, database blip,
            // loopback blocked). Fail closed only on a bad token or a wrong
            // role; here the signature is valid, so staff are not locked out
            // by a restart. The admin layout still checks the role, and
            // row-level security and the server routes' own role checks
            // still guard every read and write. Logged for monitoring.
            console.error(`[Middleware] role lookup unavailable; letting a validly signed session through (user ${check.userId}, ${pathname})`);
            response.headers.set('x-user-id', check.userId);
        } else {
            if (check.role !== 'admin' && check.role !== 'staff') {
                const loginUrl = new URL('/admin/login', request.url);
                loginUrl.searchParams.set('error', 'unauthorized');
                return NextResponse.redirect(loginUrl);
            }

            // Auth passed — set user info in headers for downstream use
            response.headers.set('x-user-id', check.userId);
            response.headers.set('x-user-role', check.role);
        }
    }

    // ============================================================
    // API route security headers
    // ============================================================
    if (pathname.startsWith('/api/')) {
        response.headers.set('X-Content-Type-Options', 'nosniff');
        response.headers.set('Cache-Control', 'no-store');
    }

    return response;
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - public files
         */
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
};
