import { createServerSupabase } from '@/lib/supabase-server';
import { META_COLUMNS, META_PRODUCT_SELECT, toMetaItem, type MetaSourceProduct } from '@/lib/meta-catalog';

// Meta (Facebook / Instagram / WhatsApp) catalogue feed.
// Public, no login. It reads the live products table on every fetch, so price,
// stock, photo and new-product changes in admin flow through on Meta's next
// scheduled pull (Admin → Meta & WhatsApp sets that up hourly, and also pushes
// admin edits straight away). Columns and rules: lib/meta-catalog.ts.

export const dynamic = 'force-dynamic';


function csvCell(value: string): string {
  const clean = value.replace(/\r?\n|\r/g, ' ').trim();
  return /[",]/.test(clean) ? `"${clean.replace(/"/g, '""')}"` : clean;
}

export async function GET() {
  const supabase = createServerSupabase('anon');
  const { data, error } = await supabase
    .from('products')
    .select(META_PRODUCT_SELECT)
    .eq('status', 'active')
    .order('name');

  if (error) {
    console.error('[meta-feed] query failed:', error.message);
    return new Response('Feed temporarily unavailable', { status: 503 });
  }

  const rows = ((data || []) as unknown as MetaSourceProduct[])
    .map(toMetaItem)
    .filter((item) => item !== null)
    .map((item) => META_COLUMNS.map((col) => csvCell(item[col])).join(','));

  const body = [META_COLUMNS.join(','), ...rows].join('\n') + '\n';

  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'inline; filename="meta.csv"',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
