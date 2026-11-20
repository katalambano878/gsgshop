import { NextResponse } from 'next/server';
import { fetchProductsForBrain, toSafeProduct, verifyBrainBearer } from '../_lib';

export async function GET(request: Request) {
  const authError = verifyBrainBearer(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const search = searchParams.get('search');

    const products = await fetchProductsForBrain({ search, category });
    return NextResponse.json({ products: products.map(toSafeProduct) });
  } catch (error: any) {
    return (console.error('[brain] Failed to load products:', error?.code || error?.name || 'error'), NextResponse.json({ error: 'Failed to load products' }, { status: 500 }));
  }
}
