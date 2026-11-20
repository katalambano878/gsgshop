import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/db/supabase-compat";
import { isPlainPostgres } from "@/lib/db/mode";
import { withTransaction } from "@/lib/db/pool";
import { resolveActor, withRls, rlsDeniedStatus, isServiceActor, RlsAuthError } from "@/lib/db/rls";
import { isRpcAllowed, publicError } from "@/lib/db/rest-policy";
import { absolutizeStorageUrls } from "@/lib/media-url";
import { becamePaid, lockOrderPaymentStatus, notifyWaPaymentConfirmed } from "@/lib/wa-payment-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PG_IDENT = /^[a-z_][a-z0-9_]*$/i;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, prefer, x-client-info",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ fn: string }> }
) {
  if (!isPlainPostgres()) {
    return NextResponse.json({ message: "DATABASE_URL not set" }, { status: 503, headers: CORS });
  }
  const { fn } = await ctx.params;
  if (!PG_IDENT.test(fn)) {
    return NextResponse.json({ message: "Invalid function name" }, { status: 400, headers: CORS });
  }

  let actor;
  try {
    actor = await resolveActor(req.headers);
  } catch (e) {
    if (e instanceof RlsAuthError) {
      return NextResponse.json({ message: e.message, code: "PGRST301" }, { status: 401, headers: CORS });
    }
    throw e;
  }

  // Browsers may call only the functions the pages call; the service key
  // (GSG AI agent) may call any function in schema public. Calls are always
  // schema-qualified as public.<fn>, so pg_catalog functions are never
  // reachable.
  if (!isRpcAllowed(fn, actor)) {
    return NextResponse.json(
      { message: "Function not allowed", code: "42501", details: null, hint: null },
      { status: 403, headers: CORS }
    );
  }

  const body = await req.json().catch(() => ({}));
  const args = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, any>;
  const client = createClient();

  // mark_order_paid (POS cash/card sales, or the agent): send the WhatsApp
  // "payment confirmed" webhook the database trigger used to send.
  const paidRef = fn === "mark_order_paid" && typeof args.order_ref === "string" ? args.order_ref : null;

  const { data, error, before } = await withRls(actor, () =>
    withTransaction(async () => {
      const before = paidRef ? await lockOrderPaymentStatus(paidRef) : undefined;
      const res = await client.rpc(fn, args);
      return { ...res, before };
    })
  );
  if (error) {
    return NextResponse.json(publicError({ ...error, code: error.code ?? "PGRST202" }, actor), {
      status: rlsDeniedStatus(actor, error.message) ?? 400,
      headers: CORS,
    });
  }
  if (paidRef && becamePaid(before, data)) notifyWaPaymentConfirmed(data);

  return NextResponse.json(isServiceActor(actor) ? absolutizeStorageUrls(data) : data, { headers: CORS });
}
