import { NextResponse } from 'next/server';
import { POST as resolveDistance } from '@/app/api/delivery/distance/route';
import { getDeliverySettings } from '@/lib/delivery-settings';
import { calculateDeliveryFee } from '@/lib/delivery-pricing';

/**
 * POST /api/brain/delivery-quote — public, read-only.
 * Body: { location: string; subtotal?: number }
 *
 * Lets the WhatsApp assistant quote the same delivery fees checkout will
 * charge: it resolves the place with the checkout's own distance lookup, then
 * prices every method with the live Admin → Delivery Pricing settings.
 */

export const dynamic = 'force-dynamic';

const METHODS = [
  { id: 'sole-express', name: 'Sole Express' },
  { id: 'joint-express', name: 'Joint Express' },
  { id: 'free-delivery', name: 'Free Delivery (Tue/Fri)' },
  { id: 'pickup', name: 'Pickup' },
] as const;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const location = typeof body.location === 'string' ? body.location.trim() : '';
  const subtotal = Math.max(0, Number(body.subtotal) || 0);

  if (!location) {
    return NextResponse.json({ success: false, message: 'location is required' }, { status: 400 });
  }

  const distanceRes = await resolveDistance(
    new Request(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify({ query: location }),
    })
  );
  const distance = await distanceRes.json();
  if (!distance?.success) {
    return NextResponse.json(
      { success: false, message: distance?.message || 'Could not find that location' },
      { status: distanceRes.status }
    );
  }

  const { pricing } = await getDeliverySettings();
  const quotes = METHODS.map((m) => {
    const fee = calculateDeliveryFee({
      method: m.id,
      km: distance.km,
      purchaseTotal: subtotal,
      config: pricing,
    });
    return { method: m.id, name: m.name, fee: fee.fee };
  });

  // Free Delivery shrinks by a share of the order total; tell the assistant
  // the order size at which it reaches GH₵0 so it can say so plainly.
  const freeBase = calculateDeliveryFee({
    method: 'free-delivery',
    km: distance.km,
    purchaseTotal: 0,
    config: pricing,
  }).fee;
  const freeDeliveryFromSubtotal =
    pricing.freePurchasePct > 0 ? Math.ceil(freeBase / pricing.freePurchasePct) : null;

  return NextResponse.json({
    success: true,
    location: distance.shortLabel || distance.label,
    km: Math.round(distance.km * 10) / 10,
    distanceMethod: distance.method,
    hub: distance.hub,
    subtotal,
    quotes,
    freeDeliveryFromSubtotal,
    note: 'Fees match checkout for this location and order subtotal. Final fee shows at checkout before payment.',
  });
}
