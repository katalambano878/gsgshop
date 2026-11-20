import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { absoluteMediaUrl } from '@/lib/media-url';

export function verifyBrainBearer(request: Request): NextResponse | null {
  const expected = process.env.BRAIN_API_KEY;
  if (!expected) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const auth = request.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing Bearer token' }, { status: 401 });
  }

  const token = auth.slice('Bearer '.length).trim();
  const a = crypto.createHash('sha256').update(token).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  if (!token || !crypto.timingSafeEqual(a, b) || token.length !== expected.length) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 403 });
  }

  return null;
}

export type SafeProduct = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  category: string | null;
  in_stock: boolean;
  image_url: string | null;
};

export function toSafeProduct(product: any): SafeProduct {
  const images = Array.isArray(product?.product_images) ? product.product_images : [];
  const firstImage = images
    .slice()
    .sort((a: any, b: any) => (a?.position ?? 0) - (b?.position ?? 0))[0];

  const category =
    product?.categories?.name ??
    product?.categories?.[0]?.name ??
    null;

  return {
    id: product.id,
    name: product.name,
    description: product.description ?? null,
    price: Number(product.price ?? 0),
    category,
    // Sellable-stock rule: untracked or oversell-allowed products are always in stock.
    in_stock:
      product.track_quantity === false ||
      product.continue_selling === true ||
      Number(product.quantity ?? 0) > 0,
    image_url: absoluteMediaUrl(firstImage?.url ?? null),
  };
}

export async function fetchProductsForBrain({
  search,
  category,
  singleId,
}: {
  search?: string | null;
  category?: string | null;
  singleId?: string | null;
}) {
  let query = supabaseAdmin
    .from('products')
    .select(
      `
      id,
      name,
      slug,
      description,
      price,
      quantity,
      track_quantity,
      continue_selling,
      status,
      categories(name, slug),
      product_images(url, position)
    `
    )
    .eq('status', 'active')
    .order('name', { ascending: true });

  if (search) {
    const literal = search.slice(0, 100).replace(/[\\%_]/g, (m) => `\\${m}`);
    query = query.ilike('name', `%${literal}%`);
  }

  if (singleId) {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    query = UUID_RE.test(singleId) ? query.eq('id', singleId) : query.eq('slug', singleId.slice(0, 200));
  }

  const { data, error } = await query.limit(500);
  if (error) throw error;

  let rows = data ?? [];

  if (category) {
    const c = category.toLowerCase();
    rows = rows.filter((p: any) => {
      const n1 = (p?.categories?.name ?? '').toLowerCase();
      const s1 = (p?.categories?.slug ?? '').toLowerCase();
      const n2 = (p?.categories?.[0]?.name ?? '').toLowerCase();
      const s2 = (p?.categories?.[0]?.slug ?? '').toLowerCase();
      return n1 === c || s1 === c || n2 === c || s2 === c;
    });
  }

  return rows;
}
