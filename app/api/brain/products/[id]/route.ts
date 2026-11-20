import { NextResponse } from 'next/server';
import { fetchProductsForBrain, toSafeProduct, verifyBrainBearer } from '../../_lib';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const authError = verifyBrainBearer(request);
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const rows = await fetchProductsForBrain({ singleId: id });
    const product = rows[0];
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    return NextResponse.json({ product: toSafeProduct(product) });
  } catch (error: any) {
    return (console.error('[brain] Failed to load product:', error?.code || error?.name || 'error'), NextResponse.json({ error: 'Failed to load product' }, { status: 500 }));
  }
}
