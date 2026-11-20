import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/pool";
import { resolveActor, withRls, RlsAuthError, type RlsActor } from "@/lib/db/rls";

// Mirrors the storage.objects policies on Supabase: these buckets accept
// writes from staff (or the service role); every other bucket is read-only.
const STAFF_WRITABLE_BUCKETS = new Set(["products"]);

async function canWrite(actor: RlsActor, bucket: string): Promise<boolean> {
  if (!STAFF_WRITABLE_BUCKETS.has(bucket)) return false;
  if (actor.kind === "service") return true;
  if (actor.kind !== "authenticated") return false;
  const { rows } = await withRls(actor, () =>
    query<{ ok: boolean }>("SELECT public.is_admin_or_staff() AS ok")
  );
  return rows[0]?.ok === true;
}

export async function authorizeStorageWrite(
  req: NextRequest,
  bucket: string
): Promise<NextResponse | null> {
  let actor: RlsActor;
  try {
    actor = await resolveActor(req.headers);
  } catch (e) {
    if (e instanceof RlsAuthError) {
      return NextResponse.json({ statusCode: "401", error: "Unauthorized", message: e.message }, { status: 401 });
    }
    throw e;
  }
  if (!(await canWrite(actor, bucket))) {
    return NextResponse.json(
      { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" },
      { status: 403 }
    );
  }
  return null;
}
