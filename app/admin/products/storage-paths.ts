import { supabase } from '@/lib/supabase';

const PUBLIC_PREFIX = '/storage/v1/object/public/products/';

/**
 * Object path inside the `products` bucket for a stored image URL, or null when
 * the URL is not one of our uploads (an external link is never deleted).
 * Uploads are stored host-relative (`/storage/v1/object/public/products/<path>`),
 * older rows may be absolute.
 */
export function productImageObjectPath(url: string | null | undefined): string | null {
    if (!url) return null;
    const at = url.indexOf(PUBLIC_PREFIX);
    if (at === -1) return null;
    const raw = url.slice(at + PUBLIC_PREFIX.length).split(/[?#]/)[0];
    if (!raw) return null;
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

/**
 * Delete uploaded image files from storage. Returns how many could not be
 * deleted (the database rows are already gone; a leftover file only wastes space).
 */
export async function removeProductImageFiles(urls: (string | null | undefined)[]): Promise<number> {
    const candidates = Array.from(new Set(urls.filter((u): u is string => !!u && !!productImageObjectPath(u))));
    if (candidates.length === 0) return 0;
    // Never delete a file another product image (for example a duplicated product) still shows.
    const stillUsed = new Set<string>();
    for (const url of candidates) {
        const { count, error } = await supabase
            .from('product_images')
            .select('id', { count: 'exact', head: true })
            .eq('url', url);
        if (error || (count ?? 0) > 0) stillUsed.add(url);
    }
    const paths = Array.from(new Set(
        candidates.filter((u) => !stillUsed.has(u)).map(productImageObjectPath).filter((p): p is string => !!p)
    ));
    if (paths.length === 0) return 0;
    const { error } = await supabase.storage.from('products').remove(paths);
    if (error) {
        console.error('Could not delete image files:', error);
        return paths.length;
    }
    return 0;
}
