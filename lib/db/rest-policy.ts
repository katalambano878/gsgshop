// Browser-facing rules for the /rest/v1 shim, on top of the database's own
// row-level security (which still decides which rows a caller sees):
// - only real public tables, top-level or embedded;
// - only the RPCs the browser actually calls;
// - cost prices hidden from everyone but staff;
// - raw database errors only for staff.

import { PUBLIC_TABLES } from "./fk-map";
import type { SelectTree } from "./supabase-compat";
import { isPrivilegedActor, type RlsActor } from "./rls";

export class PolicyError extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status = 403, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---- tables the browser may name ------------------------------------------

/** A public table or view the data API may touch (never a system catalog). */
export function isAllowedTableName(table: string): boolean {
  return PUBLIC_TABLES.has(table);
}

/** The first embedded table in a select tree that is not allowed, or null. */
export function findDisallowedTable(tree: SelectTree): string | null {
  for (const e of tree.embeds) {
    if (!isAllowedTableName(e.node.table)) return e.node.table;
    const nested = findDisallowedTable(e.node);
    if (nested !== null) return nested;
  }
  return null;
}

// ---- cost prices -----------------------------------------------------------

/** Tables whose rows carry cost prices (products.cost_per_item, product_variants.cost_per_item). */
export function isCostTable(table: string): boolean {
  return table === "products" || table === "product_variants";
}

/** A cost column name (cost_per_item, or any future cost_* column). */
export function isCostColumn(col: string): boolean {
  return /^cost(_|$)/i.test(col);
}

/** The column a filter key or order term names: `alias.col->>key` → `col`. */
function baseColumn(ref: string): string {
  const noPath = ref.split("->")[0];
  const parts = noPath.split(".");
  return (parts[parts.length - 1] || "").trim();
}

const OPTION_KEYS = new Set(["select", "limit", "offset", "on_conflict", "columns"]);

/**
 * Throws when request parameters filter or sort on a cost column, so cost
 * prices cannot be worked out by probing (`cost_per_item=lt.50`,
 * `order=cost_per_item`, `products.cost_per_item=gt.10` from another table).
 * Applied to every non-staff request: only products/product_variants have
 * cost columns, so no other filter is affected.
 */
export function assertNoCostFilters(params: URLSearchParams): void {
  const reject = () => {
    throw new PolicyError("permission denied for column cost_per_item", 403, "42501");
  };
  for (const [key, raw] of params.entries()) {
    const last = key.split(".").pop() || key;
    if (OPTION_KEYS.has(last)) continue;
    if (last === "order") {
      for (const part of raw.split(",")) if (isCostColumn(baseColumn(part.trim().split(".")[0] || ""))) reject();
      continue;
    }
    if (last === "or" || last === "and") {
      // Column names open each term: `(`/`,` then `col.op.value`. Values
      // (e.g. a search for "cost") come after an operator and are not matched.
      if (/(?:^|[,(])\s*cost(?:_[a-z0-9_]*)?(?:->>?[a-z0-9_]+)*\./i.test(raw)) reject();
      continue;
    }
    if (isCostColumn(baseColumn(key))) reject();
  }
}

/** Remove cost columns from every row of a cost table in `data`, embedded rows included. */
export function stripCostColumns(data: unknown, tree: SelectTree): void {
  const visit = (value: unknown, node: SelectTree) => {
    if (value == null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const v of value) visit(v, node);
      return;
    }
    const row = value as Record<string, unknown>;
    if (isCostTable(node.table)) {
      for (const k of Object.keys(row)) if (isCostColumn(k)) delete row[k];
    }
    for (const e of node.embeds) visit(row[e.alias], e.node);
  };
  visit(data, tree);
}

/** True when any table in the select tree carries cost prices. */
export function treeHasCostTable(tree: SelectTree): boolean {
  return isCostTable(tree.table) || tree.embeds.some((e) => treeHasCostTable(e.node));
}

// ---- error messages --------------------------------------------------------

/**
 * Postgres error codes whose message pages show to shoppers: permission and
 * row-level-security denials, constraint violations, and messages raised on
 * purpose by the store's own functions and triggers (RAISE EXCEPTION).
 */
const PUBLIC_ERROR_CODES = new Set(["42501", "23505", "23503", "23502", "23514", "23P01", "P0001", "21000"]);

export interface PostgrestErrorBody {
  message: string;
  code: string | null;
  details: string | null;
  hint: string | null;
}

/**
 * PostgREST-shaped error body for the browser. Staff get the database's own
 * message; everyone else gets it only for the codes above (and for this
 * layer's own PGRST* / code-less validation messages). Anything else (syntax,
 * type, missing column, internal errors) becomes a generic message, so table
 * internals do not leak. `code` is always kept.
 */
export function publicError(
  err: { message?: string | null; code?: string | null; details?: string | null; hint?: string | null },
  actor: RlsActor
): PostgrestErrorBody {
  const code = err.code ?? null;
  const message = err.message || "Request failed";
  if (isPrivilegedActor(actor)) return { message, code, details: err.details ?? null, hint: err.hint ?? null };
  if (!code || code.startsWith("PGRST")) return { message, code, details: null, hint: null };
  if (PUBLIC_ERROR_CODES.has(code)) {
    // Keep RAISE details (written for users); drop key values from
    // constraint details ("Key (email)=(...) already exists").
    return { message, code, details: code === "P0001" ? err.details ?? null : null, hint: null };
  }
  return { message: "The request could not be completed.", code, details: null, hint: null };
}

// ---- RPCs ------------------------------------------------------------------

/**
 * RPCs the browser may call: the functions this app's pages call through
 * supabase.rpc() (grep `.rpc(` outside app/api and lib/):
 * - upsert_customer_from_order: POS (app/admin/pos/page.tsx);
 * - mark_order_paid: POS cash/card sales (the function is SECURITY DEFINER;
 *   EXECUTE is granted to the authenticated role only);
 * - is_admin_or_staff: role checks.
 * Everything else (update_customer_stats, mark_shopper_request_paid,
 * get_all_customer_emails/phones, the WhatsApp agent's lookups, trigger
 * functions) is server-only: it runs in-process as the service role, or over
 * HTTP for a caller holding the service key (see resolveActor).
 */
const BROWSER_RPCS = new Set(["upsert_customer_from_order", "mark_order_paid", "is_admin_or_staff"]);

/** Whether `actor` may call public.<fn> over /rest/v1/rpc. The service role may call any. */
export function isRpcAllowed(fn: string, actor?: RlsActor): boolean {
  if (actor && actor.kind === "service") return true;
  return BROWSER_RPCS.has(fn);
}
