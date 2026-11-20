import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { fetchProductsForBrain, verifyBrainBearer } from '../_lib';

export async function GET(request: Request) {
  const authError = verifyBrainBearer(request);
  if (authError) return authError;

  try {
    // Primary source: categories table
    const { data: categoryRows, error } = await supabaseAdmin
      .from('categories')
      .select('name, status')
      .eq('status', 'active')
      .order('name', { ascending: true });

    if (!error && categoryRows) {
      const categories = Array.from(
        new Set(
          categoryRows
            .map((c: any) => c?.name)
            .filter((name: any) => typeof name === 'string' && name.trim().length > 0)
        )
      );
      return NextResponse.json({ categories });
    }

    // Fallback: derive from products relation
    const products = await fetchProductsForBrain({});
    const categories = Array.from(
      new Set(
        products
          .map((p: any) => p?.categories?.name ?? p?.categories?.[0]?.name)
          .filter((name: any) => typeof name === 'string' && name.trim().length > 0)
      )
    ).sort();

    return NextResponse.json({ categories });
  } catch (error: any) {
    return (console.error('[brain] Failed to load categories:', error?.code || error?.name || 'error'), NextResponse.json({ error: 'Failed to load categories' }, { status: 500 }));
  }
}
