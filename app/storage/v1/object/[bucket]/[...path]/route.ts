import { NextRequest, NextResponse } from "next/server";
import { acceptedUploadType, createStorageClient, MAX_VIDEO_BYTES, uploadLimitFor } from "@/lib/db/storage";
import { isPlainPostgres } from "@/lib/db/mode";
import { authorizeStorageWrite as authorize } from "@/lib/db/storage-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** supabase-js sends Blob/File uploads as multipart form data, buffers as raw bytes. */
async function readUpload(req: NextRequest): Promise<{ bytes: Buffer; contentType: string }> {
  const headerType = req.headers.get("content-type") || "application/octet-stream";
  if (headerType.includes("multipart/form-data")) {
    const form = await req.formData();
    for (const value of form.values()) {
      if (typeof value !== "string") {
        return {
          bytes: Buffer.from(await value.arrayBuffer()),
          contentType: value.type || "application/octet-stream",
        };
      }
    }
    throw new Error("No file in upload");
  }
  return { bytes: Buffer.from(await req.arrayBuffer()), contentType: headerType };
}

function tooLarge() {
  return NextResponse.json(
    {
      statusCode: "413",
      error: "Payload too large",
      message: "The file is too large. Images may be up to 15 MB and videos up to 60 MB.",
    },
    { status: 413 }
  );
}

async function store(req: NextRequest, ctx: { params: Promise<{ bucket: string; path: string[] }> }, upsert: boolean) {
  if (!isPlainPostgres()) {
    return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 503 });
  }
  const { bucket, path } = await ctx.params;
  const denied = await authorize(req, bucket);
  if (denied) return denied;

  const objectPath = path.map(decodeURIComponent).join("/");
  // Refuse oversized bodies before reading them (multipart adds a little framing).
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_VIDEO_BYTES + 1024 * 1024) return tooLarge();
  let upload;
  try {
    upload = await readUpload(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Invalid upload" }, { status: 400 });
  }

  // Only images, videos and PDFs: an uploaded HTML/script file served from
  // this origin would run as the store.
  const contentType = acceptedUploadType(objectPath, upload.contentType);
  if (!contentType) {
    return NextResponse.json(
      { statusCode: "415", error: "invalid_mime_type", message: "Only image, video or PDF files can be uploaded." },
      { status: 415 }
    );
  }
  if (upload.bytes.length > (uploadLimitFor(contentType) ?? 0)) return tooLarge();

  const storage = createStorageClient();
  const { data, error } = await storage.from(bucket).upload(objectPath, upload.bytes, {
    contentType,
    upsert: upsert || (req.headers.get("x-upsert") || "").toLowerCase() === "true",
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { data: pub } = storage.from(bucket).getPublicUrl(objectPath);
  return NextResponse.json({
    Key: `${bucket}/${objectPath}`,
    Id: data?.path,
    ...data,
    publicUrl: pub.publicUrl,
  });
}

/** Supabase Storage upload: POST /storage/v1/object/{bucket}/{path} */
export async function POST(req: NextRequest, ctx: { params: Promise<{ bucket: string; path: string[] }> }) {
  return store(req, ctx, false);
}

/** Supabase Storage update (overwrite): PUT /storage/v1/object/{bucket}/{path} */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ bucket: string; path: string[] }> }) {
  return store(req, ctx, true);
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ bucket: string; path: string[] }> }
) {
  if (!isPlainPostgres()) {
    return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 503 });
  }
  const { bucket, path } = await ctx.params;
  const denied = await authorize(req, bucket);
  if (denied) return denied;

  const objectPath = path.map(decodeURIComponent).join("/");
  const storage = createStorageClient();
  const { error } = await storage.from(bucket).remove([objectPath]);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({});
}
