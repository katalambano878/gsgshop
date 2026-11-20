import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

// In-process anon client (no auth needed for public data; visitor RLS applies)
const supabase = createServerSupabase('anon');

export const dynamic = 'force-dynamic';

/**
 * Public product list (active products only).
 * GET ?featured=true&limit=1..100&category=<category slug>
 * 200 [{ id, name, slug, price, compare_at_price, quantity, track_quantity,
 *        continue_selling, moq, description, metadata, categories, product_images,
 *        product_variants: [{ id, name, option1, option2, price, quantity }] }]
 * No cost prices and no draft or archived products.
 */

// Simple in-memory cache
let cache: { data: Record<string, any>; timestamp: number } | null = null;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes — products don't change frequently

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,120}$/i;
/** Metadata keys that are staff-only and never leave the server. */
const PRIVATE_META = /cost|supplier|margin|wholesale|internal|note|purchase/i;

function clampLimit(raw: string | null): number {
    const n = Number.parseInt(raw || '50', 10);
    if (!Number.isFinite(n)) return 50;
    return Math.min(100, Math.max(1, n));
}

function publicMetadata(meta: unknown): Record<string, unknown> {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
        if (!PRIVATE_META.test(k)) out[k] = v;
    }
    return out;
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const featured = searchParams.get('featured') === 'true';
    const limit = clampLimit(searchParams.get('limit'));
    const rawCategory = (searchParams.get('category') || '').trim();
    const category = SLUG_RE.test(rawCategory) ? rawCategory.toLowerCase() : '';

    const cacheKey = `${featured}-${limit}-${category || 'all'}`;

    // Cache only featured/home requests — the general shop is more dynamic.
    if (featured && cache && cache.data[cacheKey] && Date.now() - cache.timestamp < CACHE_TTL) {
        return NextResponse.json(cache.data[cacheKey], {
            headers: {
                'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800',
                'X-Cache': 'HIT',
            },
        });
    }

    try {
        let categoryId: string | null = null;
        if (category) {
            const { data: cat, error: catError } = await supabase
                .from('categories')
                .select('id')
                .eq('slug', category)
                .eq('status', 'active')
                .maybeSingle();
            if (catError) throw new Error(catError.message);
            if (!cat) return NextResponse.json([]);
            categoryId = cat.id;
        }

        let q = supabase
            .from('products')
            .select(`
                id, name, slug, price, compare_at_price, quantity, track_quantity, continue_selling, moq,
                description, metadata,
                categories(id, name, slug),
                product_images(url, position),
                product_variants(id, name, option1, option2, price, quantity)
            `)
            .eq('status', 'active')
            .order('created_at', { ascending: false });

        if (featured) q = q.eq('featured', true);
        if (categoryId) q = q.eq('category_id', categoryId);
        q = q.limit(limit);

        const { data, error } = await q;
        if (error) throw new Error(error.message);

        const rows = (data || []).map((p: any) => ({ ...p, metadata: publicMetadata(p.metadata) }));

        if (featured) {
            if (!cache || Date.now() - cache.timestamp >= CACHE_TTL) cache = { data: {}, timestamp: Date.now() };
            cache.data[cacheKey] = rows;
        }

        return NextResponse.json(rows, {
            headers: {
                'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800',
                'X-Cache': 'MISS',
            },
        });
    } catch (err: any) {
        console.error('[storefront/products] failed:', err?.message);
        return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 });
    }
}
