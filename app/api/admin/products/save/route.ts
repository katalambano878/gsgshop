import { NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/db/pool';
import { checkRateLimit } from '@/lib/rate-limit';
import { HttpError, UUID_RE, errorResponse, gate, readJson, toPesewas, fromPesewas } from '@/app/api/admin/_lib/shared';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Create or update a product with its images and variants (admin or staff).
 *
 * POST {
 *   id?: uuid,                       // omit to create
 *   product: { name, slug, description, price, compare_at_price, category_id, status,
 *              sku, track_quantity, continue_selling, moq,
 *              metadataPatch?: object,  // merged into stored metadata; a key set to null is removed
 *              quantity?: number },     // send ONLY when the stock field was edited
 *   images?: [{ id?, url, position, alt? }],       // full desired list; omit to leave images alone
 *   variants?: [{ id?, name, option1, option2, sku, price,
 *                 quantity?: number,                // only when edited
 *                 metadataPatch?: object }]          // full desired list; omit to leave variants alone
 * }
 * 200 { success: true, id, slug, keptVariants: [{ id, name, reason }] }
 * 400 { error, field? }   (field: 'name' | 'price' | 'slug' | 'sku' | 'category_id' | 'status' | 'moq' | 'images' | 'variants' | ...)
 * 404 { error } unknown product id.
 *
 * Everything runs in ONE transaction. On update only the product fields that
 * are present in `product` are written. Existing variants are matched by id
 * and updated in place (only the fields sent; other columns such as cost,
 * barcode, image and metadata keys are kept); new ones are inserted; a
 * variant left out of the list is deleted only when no order or cart refers
 * to it, otherwise it is kept and listed in keptVariants. When the product has
 * variants, its quantity is re-summed from the variants' current stock.
 */

const LIMIT = { maxRequests: 60, windowSeconds: 60 };
const STATUSES = ['active', 'draft', 'archived'];
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_IMAGES = 30;
const MAX_VARIANTS = 200;
const MAX_QTY = 1_000_000;

function has(obj: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function bad(message: string, field?: string): never {
  throw new HttpError(400, message, field ? { field } : {});
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '');
}

function text(value: unknown, max: number, field: string, required = false): string | null {
  if (value === null || value === undefined) {
    if (required) bad(`${field} is required`, field);
    return null;
  }
  if (typeof value !== 'string') bad(`${field} must be text`, field);
  const v = (value as string).trim();
  if (required && !v) bad(`${field} is required`, field);
  if (v.length > max) bad(`${field} is too long (at most ${max} characters)`, field);
  return v || null;
}

const MONEY_LABEL: Record<string, string> = {
  price: 'The price',
  compare_at_price: 'The compare-at price',
  variants: 'A variant price',
};

function money(value: unknown, field: string, opts: { required?: boolean; positive?: boolean } = {}): number | null {
  const label = MONEY_LABEL[field] || 'The amount';
  if (value === null || value === undefined || value === '') {
    if (opts.required) bad(`${label} is required`, field);
    return null;
  }
  const p = toPesewas(value);
  if (!Number.isFinite(p) || p < 0 || p > 100_000_000) bad(`${label} is not a valid amount`, field);
  if (opts.positive && p <= 0) bad(`${label} must be more than GH₵0`, field);
  return fromPesewas(p);
}

function stock(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_QTY) bad(`${field} must be a whole number of 0 or more`, field);
  return n;
}

/** Splits a metadata patch into keys to set and keys to remove. */
function patchParts(patch: unknown, field: string): { set: Record<string, unknown>; remove: string[] } | null {
  if (patch === undefined || patch === null) return null;
  if (typeof patch !== 'object' || Array.isArray(patch)) bad(`${field} must be an object`, field);
  const set: Record<string, unknown> = {};
  const remove: string[] = [];
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (k.length > 100) bad(`${field} has a key that is too long`, field);
    if (v === null) remove.push(k);
    else set[k] = v;
  }
  if (JSON.stringify(set).length > 20_000) bad(`${field} is too large`, field);
  return { set, remove };
}

function variantLabel(v: { name?: unknown; option1?: unknown; option2?: unknown }): string {
  const name = typeof v.name === 'string' ? v.name.trim() : '';
  if (name) return name;
  return [v.option1, v.option2]
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
    .join(' / ');
}

/** Maps a unique violation to a clear 400. */
function uniqueViolation(err: any): HttpError | null {
  if (err?.code !== '23505') return null;
  const c = String(err?.constraint || err?.message || '');
  if (c.includes('products_slug')) return new HttpError(400, 'Another product already uses this web address (slug). Change the slug and save again.', { field: 'slug' });
  if (c.includes('products_sku')) return new HttpError(400, 'Another product already uses this SKU.', { field: 'sku' });
  if (c.includes('product_variants_sku')) return new HttpError(400, 'A variant SKU is already used by another product or variant.', { field: 'variants' });
  return new HttpError(400, 'Another record already uses one of these values.');
}

export async function POST(request: Request) {
  const g = await gate(request, ['admin', 'staff']);
  if (g.response) return g.response;
  const actor = g.actor;

  if (!checkRateLimit(`admin-product-save:${actor.id}`, LIMIT).success) {
    return NextResponse.json({ error: 'Too many saves in a minute. Wait a moment and try again.' }, { status: 429 });
  }

  const body = await readJson(request);
  if (!body || !body.product || typeof body.product !== 'object') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const id: string | null = body.id ? String(body.id) : null;
  if (id && !UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  const isCreate = !id;
  const p = body.product as Record<string, unknown>;

  try {
    // ---- validate product fields (only the ones sent, except on create) ----
    const fields: Record<string, unknown> = {};
    if (isCreate || has(p, 'name')) fields.name = text(p.name, 200, 'name', true);
    if (isCreate || has(p, 'price')) fields.price = money(p.price, 'price', { required: true, positive: true });
    if (has(p, 'compare_at_price')) fields.compare_at_price = money(p.compare_at_price, 'compare_at_price');
    if (has(p, 'description')) fields.description = text(p.description, 20_000, 'description');
    if (has(p, 'sku')) fields.sku = text(p.sku, 100, 'sku');
    if (has(p, 'category_id')) {
      const c = p.category_id === '' ? null : p.category_id;
      if (c !== null && c !== undefined && (typeof c !== 'string' || !UUID_RE.test(c))) bad('Choose a valid category', 'category_id');
      fields.category_id = c ?? null;
    }
    if (isCreate || has(p, 'status')) {
      const s = p.status === undefined ? 'draft' : String(p.status).toLowerCase();
      if (!STATUSES.includes(s)) bad('Status must be active, draft or archived', 'status');
      fields.status = s;
    }
    if (has(p, 'track_quantity')) fields.track_quantity = p.track_quantity !== false;
    if (has(p, 'continue_selling')) fields.continue_selling = p.continue_selling === true;
    if (has(p, 'moq')) {
      const m = p.moq === null || p.moq === '' ? 1 : Number(p.moq);
      if (!Number.isInteger(m) || m < 1 || m > 10_000) bad('Minimum order must be a whole number of at least 1', 'moq');
      fields.moq = m;
    }
    if (has(p, 'quantity') && p.quantity !== null && p.quantity !== undefined) fields.quantity = stock(p.quantity, 'quantity');
    if (isCreate || has(p, 'slug')) {
      const raw = typeof p.slug === 'string' ? p.slug.trim().toLowerCase() : '';
      const slug = raw ? raw : slugify(String(fields.name ?? ''));
      if (!slug || slug.length > 120 || !SLUG_RE.test(slug)) {
        bad('The web address (slug) may use only lower-case letters, numbers and single dashes', 'slug');
      }
      fields.slug = slug;
    }
    const metaPatch = patchParts(p.metadataPatch, 'metadataPatch');

    // ---- validate images ----------------------------------------------------
    let images: { id: string | null; url: string; position: number; alt: string | null }[] | null = null;
    if (body.images !== undefined && body.images !== null) {
      if (!Array.isArray(body.images)) bad('images must be a list', 'images');
      if (body.images.length > MAX_IMAGES) bad(`At most ${MAX_IMAGES} images`, 'images');
      images = body.images.map((img: any, i: number) => {
        const url = typeof img?.url === 'string' ? img.url.trim() : '';
        if (!url || url.length > 2000 || !(/^https?:\/\//i.test(url) || url.startsWith('/'))) bad('An image has an invalid address', 'images');
        const imgId = img?.id ? String(img.id) : null;
        if (imgId && !UUID_RE.test(imgId)) bad('An image has an invalid id', 'images');
        const pos = Number.isInteger(Number(img?.position)) ? Number(img.position) : i;
        const alt = typeof img?.alt === 'string' ? img.alt.trim().slice(0, 300) || null : null;
        return { id: imgId, url, position: pos, alt };
      });
    }

    // ---- validate variants --------------------------------------------------
    type VariantIn = {
      id: string | null;
      sent: Record<string, unknown>;
      quantity: number | null;
      meta: { set: Record<string, unknown>; remove: string[] } | null;
      label: string;
    };
    let variants: VariantIn[] | null = null;
    if (body.variants !== undefined && body.variants !== null) {
      if (!Array.isArray(body.variants)) bad('variants must be a list', 'variants');
      if (body.variants.length > MAX_VARIANTS) bad(`At most ${MAX_VARIANTS} variants`, 'variants');
      const skus = new Set<string>();
      const ids = new Set<string>();
      variants = body.variants.map((v: any) => {
        if (!v || typeof v !== 'object') bad('A variant is not valid', 'variants');
        const vid = v.id ? String(v.id) : null;
        if (vid && !UUID_RE.test(vid)) bad('A variant has an invalid id', 'variants');
        if (vid) {
          if (ids.has(vid)) bad('The same variant is listed twice', 'variants');
          ids.add(vid);
        }
        const sent: Record<string, unknown> = {};
        if (!vid || has(v, 'name') || has(v, 'option1') || has(v, 'option2')) {
          const label = variantLabel(v);
          if (!vid && !label) bad('Every variant needs a name, size or colour', 'variants');
          if (label.length > 200) bad('A variant name is too long', 'variants');
          if (label) sent.name = label;
        }
        if (has(v, 'option1')) sent.option1 = text(v.option1, 100, 'variants');
        if (has(v, 'option2')) sent.option2 = text(v.option2, 100, 'variants');
        if (has(v, 'sku')) {
          const sku = text(v.sku, 100, 'variants');
          if (sku) {
            if (skus.has(sku.toLowerCase())) bad(`The SKU "${sku}" is used by two variants`, 'variants');
            skus.add(sku.toLowerCase());
          }
          sent.sku = sku;
        }
        if (has(v, 'price') && v.price !== null && v.price !== '') sent.price = money(v.price, 'variants', { positive: true });
        const quantity = has(v, 'quantity') && v.quantity !== null && v.quantity !== undefined ? stock(v.quantity, 'variants') : null;
        return { id: vid, sent, quantity, meta: patchParts(v.metadataPatch, 'variants'), label: String(sent.name || '') };
      });
    }

    const result = await withTransaction(async () => {
      let productId = id;
      let currentPrice: number;

      if (fields.category_id) {
        const { rows } = await query(`SELECT 1 FROM categories WHERE id = $1`, [fields.category_id]);
        if (!rows[0]) bad('That category no longer exists. Choose another.', 'category_id');
      }
      if (fields.slug) {
        const { rows } = await query(`SELECT 1 FROM products WHERE slug = $1 AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1`, [fields.slug, productId]);
        if (rows[0]) bad('Another product already uses this web address (slug). Change the slug and save again.', 'slug');
      }
      if (fields.sku) {
        const { rows } = await query(`SELECT 1 FROM products WHERE sku = $1 AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1`, [fields.sku, productId]);
        if (rows[0]) bad('Another product already uses this SKU.', 'sku');
      }

      // ---- product row ------------------------------------------------------
      const cols = Object.keys(fields);
      if (isCreate) {
        const metaSet = metaPatch ? metaPatch.set : {};
        const params = [...cols.map((c) => fields[c]), JSON.stringify(metaSet)];
        const { rows } = await query<{ id: string; price: number }>(
          `INSERT INTO products (${cols.map((c) => `"${c}"`).join(', ')}, metadata)
           VALUES (${cols.map((c, i) => (c === 'status' ? `$${i + 1}::product_status` : `$${i + 1}`)).join(', ')}, $${cols.length + 1}::jsonb)
           RETURNING id, price`,
          params,
        );
        productId = rows[0].id;
        currentPrice = Number(rows[0].price);
      } else {
        const { rows: found } = await query<{ id: string; price: number }>(`SELECT id, price FROM products WHERE id = $1 FOR UPDATE`, [productId]);
        if (!found[0]) throw new HttpError(404, 'Product not found');
        const sets = cols.map((c, i) => `"${c}" = $${i + 2}${c === 'status' ? '::product_status' : ''}`);
        const params: unknown[] = [productId, ...cols.map((c) => fields[c])];
        if (metaPatch) {
          params.push(JSON.stringify(metaPatch.set), metaPatch.remove);
          sets.push(`metadata = (COALESCE(metadata, '{}'::jsonb) || $${params.length - 1}::jsonb) - $${params.length}::text[]`);
        }
        sets.push('updated_at = now()');
        const { rows } = await query<{ price: number }>(`UPDATE products SET ${sets.join(', ')} WHERE id = $1 RETURNING price`, params);
        currentPrice = Number(rows[0].price);
      }

      // ---- images -----------------------------------------------------------
      if (images) {
        const { rows: existing } = await query<{ id: string; url: string }>(`SELECT id, url FROM product_images WHERE product_id = $1`, [productId]);
        const byId = new Map(existing.map((r) => [r.id, r]));
        const byUrl = new Map(existing.map((r) => [r.url, r]));
        const keep = new Set<string>();
        for (const img of images) {
          const match = (img.id && byId.get(img.id)) || byUrl.get(img.url);
          if (img.id && !byId.get(img.id) && !byUrl.get(img.url)) bad('An image does not belong to this product. Reload the page.', 'images');
          if (match && !keep.has(match.id)) {
            keep.add(match.id);
            await query(`UPDATE product_images SET url = $2, position = $3, alt_text = $4 WHERE id = $1`, [match.id, img.url, img.position, img.alt]);
          } else {
            const { rows } = await query<{ id: string }>(
              `INSERT INTO product_images (product_id, url, position, alt_text) VALUES ($1, $2, $3, $4) RETURNING id`,
              [productId, img.url, img.position, img.alt],
            );
            keep.add(rows[0].id);
          }
        }
        await query(`DELETE FROM product_images WHERE product_id = $1 AND NOT (id = ANY($2::uuid[]))`, [productId, [...keep]]);
      }

      // ---- variants ---------------------------------------------------------
      const keptVariants: { id: string; name: string; reason: string }[] = [];
      if (variants) {
        const { rows: existing } = await query<{ id: string; name: string }>(
          `SELECT id, name FROM product_variants WHERE product_id = $1 FOR UPDATE`,
          [productId],
        );
        const existingIds = new Set(existing.map((r) => r.id));
        const listed = new Set<string>();

        for (const v of variants) {
          if (v.id) {
            if (!existingIds.has(v.id)) bad('A variant does not belong to this product. Reload the page.', 'variants');
            listed.add(v.id);
            const cols = Object.keys(v.sent);
            const sets = cols.map((c, i) => `"${c}" = $${i + 2}`);
            const params: unknown[] = [v.id, ...cols.map((c) => v.sent[c])];
            if (v.quantity !== null) {
              params.push(v.quantity);
              sets.push(`quantity = $${params.length}`);
            }
            if (v.meta) {
              params.push(JSON.stringify(v.meta.set), v.meta.remove);
              sets.push(`metadata = (COALESCE(metadata, '{}'::jsonb) || $${params.length - 1}::jsonb) - $${params.length}::text[]`);
            }
            if (sets.length === 0) continue;
            sets.push('updated_at = now()');
            await query(`UPDATE product_variants SET ${sets.join(', ')} WHERE id = $1`, params);
          } else {
            const { rows } = await query<{ id: string }>(
              `INSERT INTO product_variants (product_id, name, option1, option2, sku, price, quantity, metadata)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) RETURNING id`,
              [
                productId,
                v.sent.name,
                v.sent.option1 ?? null,
                v.sent.option2 ?? null,
                v.sent.sku ?? null,
                v.sent.price ?? currentPrice,
                v.quantity ?? 0,
                JSON.stringify(v.meta ? v.meta.set : {}),
              ],
            );
            listed.add(rows[0].id);
          }
        }

        const removed = existing.filter((r) => !listed.has(r.id));
        if (removed.length) {
          const { rows: refs } = await query<{ id: string; in_orders: boolean; in_carts: boolean }>(
            `SELECT v.id,
                    EXISTS (SELECT 1 FROM order_items oi WHERE oi.variant_id = v.id) AS in_orders,
                    EXISTS (SELECT 1 FROM cart_items ci WHERE ci.variant_id = v.id) AS in_carts
               FROM product_variants v WHERE v.id = ANY($1::uuid[])`,
            [removed.map((r) => r.id)],
          );
          const refById = new Map(refs.map((r) => [r.id, r]));
          const deletable: string[] = [];
          for (const r of removed) {
            const ref = refById.get(r.id);
            if (ref?.in_orders) keptVariants.push({ id: r.id, name: r.name, reason: 'It is on past orders, so it was kept. Set its stock to 0 to stop selling it.' });
            else if (ref?.in_carts) keptVariants.push({ id: r.id, name: r.name, reason: 'It is in a customer’s cart, so it was kept. Remove it again later.' });
            else deletable.push(r.id);
          }
          if (deletable.length) await query(`DELETE FROM product_variants WHERE id = ANY($1::uuid[])`, [deletable]);
        }
      }

      // Products with variants carry the sum of their variants' current stock.
      if (variants) {
        await query(
          `UPDATE products p
              SET quantity = s.total, updated_at = now()
             FROM (SELECT product_id, COALESCE(SUM(quantity), 0)::int AS total
                     FROM product_variants WHERE product_id = $1 GROUP BY product_id) s
            WHERE p.id = s.product_id`,
          [productId],
        );
      }

      await query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'product', $3, $4::jsonb)`,
        [
          actor.id,
          isCreate ? 'product.create' : 'product.update',
          productId,
          JSON.stringify({
            fields: cols,
            images: images ? images.length : undefined,
            variants: variants ? variants.length : undefined,
            stock_set: has(fields, 'quantity') || (variants || []).some((v) => v.quantity !== null),
            kept_variants: keptVariants.length || undefined,
          }),
        ],
      );

      const { rows: out } = await query<{ slug: string }>(`SELECT slug FROM products WHERE id = $1`, [productId]);
      return { id: productId as string, slug: out[0]?.slug, keptVariants };
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    const unique = uniqueViolation(err);
    if (unique) return errorResponse(unique, '', 'admin/products/save');
    return errorResponse(err, 'The product was not saved. Try again.', 'admin/products/save');
  }
}
