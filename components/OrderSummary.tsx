interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image: string;
  variant?: string;
  variantId?: string;
}

interface OrderSummaryProps {
  items: OrderItem[];
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  /** Optional short note under the shipping line (e.g. formula). */
  shippingNote?: string | null;
  shippingLabel?: string;
  /** Coupon discount already validated by the server (0 when none). */
  discount?: number;
  discountLabel?: string | null;
  /** When false the delivery amount is not known yet and is shown as a dash. */
  shippingKnown?: boolean;
}

const money = (n: number) => `GH₵ ${n.toFixed(2)}`;

export default function OrderSummary({
  items,
  subtotal,
  shipping,
  tax,
  total,
  shippingNote,
  shippingLabel = 'Delivery',
  discount = 0,
  discountLabel,
  shippingKnown = true,
}: OrderSummaryProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-6 sticky top-4">
      <h2 className="text-xl font-bold text-gray-900 mb-6">Order Summary</h2>

      <div className="space-y-4 mb-6">
        {items.map((item) => (
          <div key={`${item.id}-${item.variantId || item.variant || 'novar'}`} className="flex space-x-4">
            <div className="relative w-20 h-20 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
              {item.image ? (
                <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
              ) : null}
              <div
                className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center bg-blue-700 text-white text-xs font-bold rounded-full"
                aria-hidden="true"
              >
                {item.quantity}
              </div>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 text-sm line-clamp-2">{item.name}</h3>
              {item.variant && <p className="text-xs text-gray-500 mt-0.5">{item.variant}</p>}
              <p className="text-xs text-gray-500 mt-1">
                {money(item.price)} × {item.quantity}
              </p>
              <p className="text-blue-700 font-bold">{money(Math.round(item.price * item.quantity * 100) / 100)}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-200 pt-4 space-y-3">
        <div className="flex justify-between text-gray-700">
          <span>Subtotal</span>
          <span className="font-semibold">{money(subtotal)}</span>
        </div>
        {discount > 0 && (
          <div className="flex justify-between text-green-700">
            <span>{discountLabel ? `Coupon (${discountLabel})` : 'Coupon'}</span>
            <span className="font-semibold">-{money(discount)}</span>
          </div>
        )}
        <div>
          <div className="flex justify-between text-gray-700">
            <span>{shippingLabel}</span>
            <span className="font-semibold">{shippingKnown ? money(shipping) : '—'}</span>
          </div>
          {shippingNote && (
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">{shippingNote}</p>
          )}
        </div>
        {tax > 0 && (
          <div className="flex justify-between text-gray-700">
            <span>Tax</span>
            <span className="font-semibold">{money(tax)}</span>
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 mt-4 pt-4">
        <div className="flex justify-between items-center">
          <span className="text-lg font-bold text-gray-900">Total</span>
          <span className="text-2xl font-bold text-blue-700">{money(total)}</span>
        </div>
      </div>

      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-center space-x-2 text-blue-800">
          <i className="ri-shield-check-line text-xl" aria-hidden="true"></i>
          <p className="text-sm font-semibold">Payment on Moolre (Mobile Money) or Paystack (card)</p>
        </div>
      </div>
    </div>
  );
}
