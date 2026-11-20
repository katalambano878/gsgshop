import { NextRequest, NextResponse } from "next/server";
import {
  createClient,
  applyPostgrestParams,
  describeSelect,
  type SelectTree,
} from "@/lib/db/supabase-compat";
import { isPlainPostgres } from "@/lib/db/mode";
import {
  resolveActor,
  withRls,
  rlsDeniedStatus,
  isPrivilegedActor,
  isServiceActor,
  RlsAuthError,
  type RlsActor,
} from "@/lib/db/rls";
import { withTransaction } from "@/lib/db/pool";
import { absolutizeStorageUrls } from "@/lib/media-url";
import { notifyWaPaymentConfirmed, type PaidOrder } from "@/lib/wa-payment-webhook";
import {
  PolicyError,
  assertNoCostFilters,
  findDisallowedTable,
  isAllowedTableName,
  publicError,
  stripCostColumns,
  treeHasCostTable,
} from "@/lib/db/rest-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** PostgREST's `max-rows` on hosted Supabase: no read returns more rows than this. */
const MAX_ROWS = 1000;

const ANON: RlsActor = { kind: "anon", claims: { role: "anon" } };

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, prefer, x-client-info, accept-profile, content-profile",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  };
}

function preferSingle(req: NextRequest): boolean {
  const accept = req.headers.get("accept") || "";
  return accept.includes("application/vnd.pgrst.object+json");
}

function preferReturn(req: NextRequest): boolean {
  const prefer = req.headers.get("prefer") || "";
  return prefer.includes("return=representation") || prefer.includes("resolution=");
}

function preferCount(req: NextRequest): boolean {
  const prefer = req.headers.get("prefer") || "";
  return prefer.includes("count=exact");
}

/** PostgREST-shaped error; the message is generic for non-staff unless safe to show. */
function jsonError(
  err: { message?: string | null; code?: string | null; details?: string | null; hint?: string | null },
  status: number,
  actor: RlsActor = ANON
) {
  return NextResponse.json(publicError(err, actor), { status, headers: corsHeaders() });
}

async function actorOrError(req: NextRequest): Promise<RlsActor | NextResponse> {
  try {
    return await resolveActor(req.headers);
  } catch (e) {
    if (e instanceof RlsAuthError) return jsonError({ message: e.message, code: "PGRST301" }, 401);
    throw e;
  }
}

function failure(actor: RlsActor, error: { message?: string; code?: string | null; details?: string | null; hint?: string | null }, fallback: string) {
  const code = error.code ?? null;
  const body = { ...error, message: error.message || fallback, code };
  // PostgREST answers single() with no or several rows as 406 / PGRST116.
  if (code === "PGRST116") return jsonError(body, 406, actor);
  const denied = rlsDeniedStatus(actor, error.message) ?? (code === "42501" ? (actor.kind === "anon" ? 401 : 403) : null);
  return jsonError(body, denied ?? 400, actor);
}

/** What a request reads, and whether cost prices must be hidden from it. */
interface Scope {
  table: string;
  actor: RlsActor;
  tree: SelectTree;
  hideCost: boolean;
}

/**
 * Shared guard for every method: plain-Postgres mode, an allowed public table
 * (top-level and embedded), the caller's identity, and the cost-price rule.
 */
async function guard(
  req: NextRequest,
  ctx: { params: Promise<{ table: string }> }
): Promise<Scope | NextResponse> {
  if (!isPlainPostgres()) {
    return jsonError({ message: "Plain Postgres mode is not enabled (DATABASE_URL missing)" }, 503);
  }
  const { table } = await ctx.params;
  if (!isAllowedTableName(table)) {
    return jsonError({ message: `relation "public.${table.slice(0, 63)}" does not exist`, code: "42P01" }, 404);
  }
  let tree: SelectTree;
  try {
    tree = describeSelect(table, req.nextUrl.searchParams.get("select") || "*");
  } catch {
    return jsonError({ message: "Invalid select", code: "PGRST100" }, 400);
  }
  if (findDisallowedTable(tree) !== null) {
    return jsonError(
      { message: "Could not find a relationship in the schema cache", code: "PGRST200" },
      400
    );
  }
  const actor = await actorOrError(req);
  if (actor instanceof NextResponse) return actor;

  // Staff and the service key (GSG AI agent) see everything RLS allows;
  // everyone else gets cost columns hidden and cannot filter on them.
  const staff = isPrivilegedActor(actor);
  if (!staff) {
    try {
      assertNoCostFilters(req.nextUrl.searchParams);
    } catch (e) {
      if (e instanceof PolicyError) {
        return jsonError({ message: e.message, code: e.code }, actor.kind === "anon" ? 401 : 403, actor);
      }
      throw e;
    }
  }
  return { table, actor, tree, hideCost: !staff && treeHasCostTable(tree) };
}

/**
 * Response rows with cost prices removed for non-staff callers. The service
 * key caller (the WhatsApp agent) gets storage URLs made absolute, since it
 * sends them off-site.
 */
function visibleRows(data: any, scope: Scope): any {
  if (scope.hideCost && data != null) stripCostColumns(data, scope.tree);
  if (isServiceActor(scope.actor) && data != null) return absolutizeStorageUrls(data);
  return data;
}

/**
 * PATCH/DELETE without any row filter would touch every row the policy
 * allows. Like Supabase's safeupdate guard, refuse it for everyone but staff.
 */
function requireFilter(scope: Scope, hasFilters: boolean, verb: "UPDATE" | "DELETE"): NextResponse | null {
  if (hasFilters || isPrivilegedActor(scope.actor)) return null;
  return jsonError({ message: `${verb} requires a WHERE clause`, code: "21000" }, 400, scope.actor);
}

/** Mutations carry `select`/`on_conflict`/`columns` as options, not filters. */
function withoutOptions(params: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(params);
  out.delete("select");
  out.delete("on_conflict");
  out.delete("columns");
  return out;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ table: string }> }
) {
  const scope = await guard(req, ctx);
  if (scope instanceof NextResponse) return scope;
  const { table, actor } = scope;

  const client = createClient();
  const qb = client.from(table);
  const select = req.nextUrl.searchParams.get("select") || "*";
  if (preferCount(req)) {
    qb.select(select, {
      count: "exact",
      head: req.headers.get("prefer")?.includes("head=true"),
    });
  } else {
    qb.select(select);
  }
  // Apply filters/order/limit without re-applying select
  const params = new URLSearchParams(req.nextUrl.searchParams);
  params.delete("select");
  try {
    applyPostgrestParams(qb as any, params, {
      preferSingle: preferSingle(req),
    });
  } catch (e: any) {
    return jsonError({ message: e?.message, code: "PGRST100" }, 400, actor);
  }
  // Hosted PostgREST never returned more than 1000 rows per request; pages
  // that need more ask for them with .range().
  qb.capRows(MAX_ROWS);

  const result = await withRls(actor, async () => await qb);
  if (result.error) return failure(actor, result.error, "Query failed");
  const data = visibleRows(result.data, scope);

  const headers = new Headers(corsHeaders());
  headers.set("Content-Type", "application/json");
  if (result.count != null) {
    const rows = Array.isArray(result.data)
      ? result.data
      : result.data
        ? [result.data]
        : [];
    const len = rows.length;
    const offset = Math.max(0, Number(params.get("offset") || 0) || 0);
    // PostgREST: empty/head counts use */N (fixes shop "12 of 0")
    if (len === 0) {
      headers.set("Content-Range", `*/${result.count}`);
    } else {
      headers.set(
        "Content-Range",
        `${offset}-${offset + len - 1}/${result.count}`
      );
    }
  }

  if (preferSingle(req)) {
    return NextResponse.json(data, { status: 200, headers });
  }
  return NextResponse.json(data ?? [], { status: 200, headers });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ table: string }> }
) {
  const scope = await guard(req, ctx);
  if (scope instanceof NextResponse) return scope;
  const { table, actor } = scope;

  const body = await req.json().catch(() => null);
  if (body == null || typeof body !== "object") return jsonError({ message: "Invalid JSON body", code: "PGRST102" }, 400, actor);

  const client = createClient();
  // supabase-js .upsert() posts with Prefer: resolution=merge-duplicates and
  // ?on_conflict=cols; plain .insert() sends neither.
  const prefer = req.headers.get("prefer") || "";
  const onConflict = req.nextUrl.searchParams.get("on_conflict") || undefined;
  let qb = prefer.includes("resolution=merge-duplicates")
    ? client.from(table).upsert(body, { onConflict })
    : client.from(table).insert(body);
  if (preferReturn(req) || preferSingle(req)) {
    qb = qb.select(req.nextUrl.searchParams.get("select") || "*") as typeof qb;
  }
  if (preferSingle(req)) qb = qb.single() as typeof qb;

  const result = await withRls(actor, async () => await qb);
  if (result.error) return failure(actor, result.error, "Insert failed");

  return NextResponse.json(visibleRows(result.data, scope), {
    status: 201,
    headers: corsHeaders(),
  });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ table: string }> }
) {
  const scope = await guard(req, ctx);
  if (scope instanceof NextResponse) return scope;
  const { table, actor } = scope;

  const body = await req.json().catch(() => null);
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return jsonError({ message: "Invalid JSON body", code: "PGRST102" }, 400, actor);
  }

  const client = createClient();
  let qb = client.from(table).update(body);
  const filters = withoutOptions(req.nextUrl.searchParams);
  try {
    applyPostgrestParams(qb as any, filters);
  } catch (e: any) {
    return jsonError({ message: e?.message, code: "PGRST100" }, 400, actor);
  }
  const unfiltered = requireFilter(scope, qb.hasFilters, "UPDATE");
  if (unfiltered) return unfiltered;

  // An order turned paid here (the WhatsApp agent or an admin page) gets the
  // "payment confirmed" webhook the database trigger used to send.
  const watchPaid = table === "orders" && (body as Record<string, unknown>).payment_status === "paid";
  const wantRows = preferReturn(req) || preferSingle(req);
  if (wantRows || watchPaid) {
    qb = qb.select("*") as typeof qb;
  }
  if (preferSingle(req)) qb = qb.single() as typeof qb;

  const result = await withRls(actor, () =>
    withTransaction(async () => {
      let unpaidBefore: Set<string> | null = null;
      if (watchPaid) {
        // Lock the rows this update matches and note which were not paid yet.
        const pre = client.from("orders").select("id, payment_status");
        applyPostgrestParams(pre as any, filters);
        const before = await pre.forUpdate();
        if (before.error) return before;
        unpaidBefore = new Set(
          ((before.data as Array<{ id: string; payment_status: string | null }>) || [])
            .filter((r) => r.payment_status !== "paid")
            .map((r) => String(r.id))
        );
      }
      const res = await qb;
      return { ...res, unpaidBefore };
    })
  );
  if (result.error) return failure(actor, result.error, "Update failed");

  if (watchPaid && "unpaidBefore" in result && result.unpaidBefore) {
    const rows = (Array.isArray(result.data) ? result.data : result.data ? [result.data] : []) as PaidOrder[];
    for (const row of rows) {
      if (result.unpaidBefore.has(String(row.id))) notifyWaPaymentConfirmed(row);
    }
  }

  const data = wantRows ? visibleRows(result.data, scope) : [];
  return NextResponse.json(data, { status: 200, headers: corsHeaders() });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ table: string }> }
) {
  const scope = await guard(req, ctx);
  if (scope instanceof NextResponse) return scope;
  const { table, actor } = scope;

  const client = createClient();
  let qb = client.from(table).delete();
  try {
    applyPostgrestParams(qb as any, withoutOptions(req.nextUrl.searchParams));
  } catch (e: any) {
    return jsonError({ message: e?.message, code: "PGRST100" }, 400, actor);
  }
  const unfiltered = requireFilter(scope, qb.hasFilters, "DELETE");
  if (unfiltered) return unfiltered;
  if (preferReturn(req)) {
    qb = qb.select("*") as typeof qb;
  }

  const result = await withRls(actor, async () => await qb);
  if (result.error) return failure(actor, result.error, "Delete failed");

  return NextResponse.json(visibleRows(result.data, scope) ?? null, { status: 200, headers: corsHeaders() });
}
