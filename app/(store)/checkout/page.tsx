'use client';

import Link from 'next/link';
import { useState, useEffect, useMemo, useRef } from 'react';
import CheckoutSteps from '@/components/CheckoutSteps';
import OrderSummary from '@/components/OrderSummary';
import { useCart } from '@/context/CartContext';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRecaptcha } from '@/hooks/useRecaptcha';
import { calculateDeliveryFee, methodNeedsDistance } from '@/lib/delivery-pricing';
import { useDeliverySettings } from '@/hooks/useDeliveryPricing';
import { saveOrderUuid } from '@/hooks/useOrderUuid';
import DeliveryLocationPicker from '@/components/DeliveryLocationPicker';
import { isGhanaPhone, normalizeGhanaPhone } from '@/lib/phone';
import { shopperUrl } from '@/lib/site-urls';

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `GH₵${n.toFixed(2)}`;

// Ghana's sixteen regions (Brong-Ahafo was split into Bono, Bono East and Ahafo in 2019).
const GHANA_REGIONS = [
  'Greater Accra', 'Ashanti', 'Western', 'Western North', 'Central', 'Eastern', 'Volta', 'Oti',
  'Northern', 'Savannah', 'North East', 'Upper East', 'Upper West', 'Bono', 'Bono East', 'Ahafo',
];

type PaymentMethod = 'moolre' | 'paystack';

type AppliedCoupon = { code: string; type: string; discount: number; message: string };

/** What the server returned for an order it created from this checkout. */
type PlacedOrder = {
  orderId: string;
  orderNumber: string;
  total: number;
  subtotal: number;
  shippingTotal: number;
  discountTotal: number;
  items: Array<{ name: string; variant?: string | null; quantity: number; unitPrice: number; lineTotal: number }>;
  /** True until the customer confirms a total that differs from what they saw. */
  needsConfirm: boolean;
};

const PAYMENT_OPTIONS: Array<{
  value: PaymentMethod;
  label: string;
  desc: string;
  icon: string;
  badges: string[];
}> = [
  {
    value: 'moolre',
    label: 'Mobile Money',
    desc: 'Pay with MTN MoMo, Telecel Cash or AirtelTigo Money, through Moolre.',
    icon: 'ri-smartphone-line',
    badges: ['MTN', 'Telecel', 'AirtelTigo'],
  },
  {
    value: 'paystack',
    label: 'Card Payments',
    desc: 'Pay with your debit or credit card through Paystack.',
    icon: 'ri-bank-card-line',
    badges: ['Visa', 'Mastercard', 'Verve'],
  },
];

const inputClass = (hasError: boolean) =>
  `w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple transition-all outline-none ${
    hasError ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50 focus:bg-white'
  }`;

export default function CheckoutPage() {
  usePageTitle('Checkout');
  const { cart, subtotal: cartSubtotal, ready: cartReady, refreshCart } = useCart();

  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const { getToken } = useRecaptcha();

  const [shippingData, setShippingData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    region: '',
  });

  const [deliveryMethod, setDeliveryMethod] = useState('pickup');
  const [deliveryKm, setDeliveryKm] = useState('');
  const [deliveryPin, setDeliveryPin] = useState<{ lat: number; lng: number; label?: string } | null>(null);
  const { settings: deliverySettings, loaded: settingsLoaded, failed: settingsFailed, retry: retrySettings } =
    useDeliverySettings();
  const [jointExpressNeighbor, setJointExpressNeighbor] = useState({ name: '', phone: '' });
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('moolre');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Cart check against the live catalogue
  const [cartChanges, setCartChanges] = useState<string[]>([]);
  const [cartChecked, setCartChecked] = useState(false);
  const [cartCheckFailed, setCartCheckFailed] = useState(false);

  // Coupon
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null);
  const [couponError, setCouponError] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);

  // Order placement
  const [orderError, setOrderError] = useState('');
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [placedOrder, setPlacedOrder] = useState<PlacedOrder | null>(null);
  const [paymentFailed, setPaymentFailed] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  // Check auth once.
  useEffect(() => {
    async function checkUser() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        setShippingData((prev) => ({ ...prev, email: prev.email || session.user.email || '' }));
      }
    }
    checkUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Re-price and re-check every cart line once the saved cart has loaded.
  useEffect(() => {
    if (!cartReady) return;
    let active = true;
    refreshCart().then((changes) => {
      if (!active) return;
      if (changes === null) setCartCheckFailed(true);
      else if (changes.length > 0) setCartChanges(changes.map((c) => c.message));
      setCartChecked(true);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartReady]);

  // Scroll to top when step changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentStep]);

  // Anything the order depends on changed: the order created earlier no
  // longer matches, so the next Pay creates a fresh one.
  const cartKey = cart.map((i) => `${i.id}:${i.variantId || i.variant || ''}:${i.quantity}:${i.price}`).join('|');
  useEffect(() => {
    setPlacedOrder(null);
    setPaymentFailed(false);
  }, [cartKey, deliveryMethod, deliveryPin?.lat, deliveryPin?.lng, coupon?.code, shippingData]);

  // Totals: the delivery fee uses the live settings only (Pay stays disabled
  // until they load); the server recomputes everything and we compare.
  const subtotal = cartSubtotal;
  const needsKm = methodNeedsDistance(deliveryMethod);
  const kmValue = needsKm && deliveryPin ? Math.max(0, parseFloat(deliveryKm) || 0) : 0;
  const pricingConfig = deliverySettings?.pricing;
  const deliveryBreakdown = useMemo(
    () =>
      pricingConfig
        ? calculateDeliveryFee({ method: deliveryMethod, km: kmValue, purchaseTotal: subtotal, config: pricingConfig })
        : null,
    [deliveryMethod, kmValue, subtotal, pricingConfig]
  );
  const feeKnown = Boolean(deliveryBreakdown) && (!needsKm || kmValue > 0);
  const deliveryFee = feeKnown && deliveryBreakdown ? round2(deliveryBreakdown.fee) : 0;
  // A free-shipping coupon removes the delivery fee instead of taking money off the items.
  const freeShipping = coupon?.type === 'free_shipping';
  const shippingCost = freeShipping ? 0 : deliveryFee;
  const discount = coupon && !freeShipping ? round2(Math.min(coupon.discount, subtotal)) : 0;
  const tax = 0;
  const total = round2(Math.max(0, subtotal - discount) + shippingCost + tax);
  const hubLabel = deliverySettings?.hub?.label || null;

  const deliveryOptionsList = [
    {
      value: 'personal-shopper',
      label: 'Add To Personal Shopper',
      subtitle: 'Free delivery',
      desc: 'Pay for this cart now, then continue shopping on Personal Shopper. Everything comes together.',
    },
    {
      value: 'free-delivery',
      label: 'Free Delivery (Daily)',
      subtitle: null as string | null,
      desc: 'Daily after confirmation. The more you buy, the further you get it FREE — beyond your free km you only pay the extra distance.',
    },
    {
      value: 'sole-express',
      label: 'Sole Express Delivery (Daily)',
      subtitle: null as string | null,
      desc: 'Required for fresh/perishable. 2hr–48hr slots after confirmation.',
    },
    {
      value: 'joint-express',
      label: 'Joint Express – Myself & Neighbour (Daily)',
      subtitle: null as string | null,
      desc: 'Share delivery with a neighbour; items stay private. 2hr–48hr slots.',
    },
    {
      value: 'pickup',
      label: 'Pickup (Daily)',
      subtitle: null as string | null,
      desc: hubLabel
        ? `No delivery fee. Collect from ${hubLabel} after we confirm your order is ready.`
        : 'No delivery fee. Collect from our Accra pickup point after we confirm your order is ready.',
    },
  ];

  const clearError = (key: string) => {
    if (!errors[key]) return;
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const applyCoupon = async (code: string, quiet = false) => {
    const trimmed = code.trim();
    if (!trimmed) {
      setCouponError('Enter a coupon code.');
      return;
    }
    setCouponLoading(true);
    setCouponError('');
    try {
      const res = await fetch('/api/storefront/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: trimmed,
          subtotal,
          shippingTotal: deliveryFee,
          ...(isGhanaPhone(shippingData.phone) ? { phone: normalizeGhanaPhone(shippingData.phone) } : {}),
        }),
      });
      const result = await res.json().catch(() => null);
      if (result?.valid) {
        setCoupon({
          code: result.code || trimmed.toUpperCase(),
          type: String(result.type || ''),
          discount: Number(result.discount) || 0,
          message: result.message || '',
        });
        setCouponInput('');
      } else {
        setCoupon(null);
        setCouponError(
          result?.message || (quiet ? 'Your coupon no longer applies to this order.' : 'This coupon code is not valid.')
        );
      }
    } catch {
      setCouponError('Could not check this coupon right now. Please try again.');
    } finally {
      setCouponLoading(false);
    }
  };

  const removeCoupon = () => {
    setCoupon(null);
    setCouponError('');
  };

  // Re-check the coupon when the cart total changes (minimum spend, % off).
  useEffect(() => {
    if (!coupon) return;
    const t = setTimeout(() => applyCoupon(coupon.code, true), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotal, deliveryFee]);

  const validateShipping = () => {
    const newErrors: Record<string, string> = {};
    if (!shippingData.firstName.trim()) newErrors.firstName = 'First name is required';
    if (!shippingData.lastName.trim()) newErrors.lastName = 'Last name is required';
    if (shippingData.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shippingData.email.trim())) {
      newErrors.email = 'Enter a valid email address, or leave it blank';
    }
    if (!shippingData.phone.trim()) newErrors.phone = 'Phone is required';
    else if (!isGhanaPhone(shippingData.phone)) {
      newErrors.phone = 'Enter a Ghana mobile number, for example 024 123 4567 or +233 24 123 4567';
    }
    if (!shippingData.address.trim()) newErrors.address = 'Address is required';
    if (!shippingData.city.trim()) newErrors.city = 'City is required';
    if (!shippingData.region) newErrors.region = 'Region is required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleContinueToDelivery = () => {
    if (!validateShipping()) return;
    setCurrentStep(2);
  };

  const showOrderError = (message: string) => {
    setOrderError(message);
    // Bring the message into view for keyboard and screen-reader users.
    setTimeout(() => errorRef.current?.focus(), 0);
  };

  /** Start payment for an order that already exists. Safe to call again. */
  const startPayment = async (order: PlacedOrder) => {
    setIsLoading(true);
    setOrderError('');
    setPaymentFailed(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      const endpoint = paymentMethod === 'paystack' ? '/api/payment/paystack' : '/api/payment/moolre';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          orderId: order.orderNumber,
          orderUuid: order.orderId,
          customerEmail: shippingData.email.trim() || undefined,
          phone: normalizeGhanaPhone(shippingData.phone) || shippingData.phone.trim(),
        }),
      });
      const result = await res.json().catch(() => null);
      if (!res.ok || !result?.success || !result?.url) {
        throw new Error(result?.message || 'We could not start the payment.');
      }
      // The cart is kept until the order is paid; the success page clears it.
      window.location.href = result.url;
    } catch (err: any) {
      console.error('Payment start error:', err);
      setPaymentFailed(true);
      showOrderError(
        `${err?.message || 'We could not start the payment.'} Your order ${order.orderNumber} is saved: try again, choose the other payment method, or pay later from the payment page.`
      );
      setIsLoading(false);
    }
  };

  const handlePlaceOrder = async () => {
    if (cart.length === 0) return;
    setOrderError('');
    setUnavailable([]);

    // An order already exists for exactly this checkout: pay it, never create another.
    if (placedOrder) {
      if (placedOrder.needsConfirm) {
        setPlacedOrder({ ...placedOrder, needsConfirm: false });
      }
      await startPayment({ ...placedOrder, needsConfirm: false });
      return;
    }

    if (!settingsLoaded) {
      showOrderError('Delivery prices are still loading. Please wait a moment.');
      return;
    }
    if (needsKm && !(deliveryPin && kmValue > 0)) {
      setErrors((prev) => ({
        ...prev,
        deliveryKm: 'Find your delivery location so we can work out the distance.',
      }));
      return;
    }
    if (!validateShipping()) {
      setCurrentStep(1);
      return;
    }

    setIsLoading(true);

    const isHuman = await getToken('checkout');
    if (!isHuman) {
      showOrderError('Security check failed. Please try again.');
      setIsLoading(false);
      return;
    }

    try {
      // The server prices every line, works out the delivery distance from
      // the pin, checks the coupon and creates the order.
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;

      const checkoutRes = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          items: cart.map((it) => ({
            id: it.id,
            quantity: it.quantity,
            ...(it.variantId ? { variantId: it.variantId } : {}),
            ...(it.variant ? { variant: it.variant } : {}),
          })),
          shipping: {
            firstName: shippingData.firstName.trim(),
            lastName: shippingData.lastName.trim(),
            ...(shippingData.email.trim() ? { email: shippingData.email.trim() } : {}),
            phone: normalizeGhanaPhone(shippingData.phone) || shippingData.phone.trim(),
            address: shippingData.address.trim(),
            city: shippingData.city.trim(),
            region: shippingData.region,
          },
          deliveryMethod,
          ...(needsKm && deliveryPin ? { deliveryPin: { lat: deliveryPin.lat, lng: deliveryPin.lng } } : {}),
          ...(coupon ? { couponCode: coupon.code } : {}),
          paymentMethod,
          clientTotal: total,
          jointExpressNeighbor:
            deliveryMethod === 'joint-express' && (jointExpressNeighbor.name || jointExpressNeighbor.phone)
              ? jointExpressNeighbor
              : null,
        }),
      });

      const result = await checkoutRes.json().catch(() => null);
      if (!checkoutRes.ok || !result?.success) {
        const code = result?.code as string | undefined;
        const list: string[] = Array.isArray(result?.unavailable) ? result.unavailable : [];
        if (code === 'invalid_phone') {
          setErrors((prev) => ({ ...prev, phone: result?.message || 'Enter a valid Ghana mobile number' }));
          setCurrentStep(1);
        } else if (code === 'distance_required') {
          setErrors((prev) => ({
            ...prev,
            deliveryKm: result?.message || 'Find your delivery location so we can work out the distance.',
          }));
        } else if (code === 'coupon_invalid') {
          setCoupon(null);
          setCouponError(result?.message || 'This coupon no longer applies.');
        } else if (code === 'unavailable' || code === 'out_of_stock' || code === 'invalid_items') {
          setUnavailable(list);
          // Bring the cart in line with the catalogue so the customer sees what changed.
          refreshCart().then((changes) => {
            if (changes && changes.length > 0) setCartChanges(changes.map((c) => c.message));
          });
        }
        throw new Error(result?.message || 'We could not place your order. Please try again.');
      }

      const order: PlacedOrder = {
        orderId: String(result.orderId),
        orderNumber: String(result.orderNumber),
        total: Number(result.total) || 0,
        subtotal: Number(result.subtotal) || 0,
        shippingTotal: Number(result.shippingTotal) || 0,
        discountTotal: Number(result.discountTotal) || 0,
        items: Array.isArray(result.items) ? result.items : [],
        needsConfirm: Boolean(result.priceChanged),
      };
      saveOrderUuid(order.orderNumber, order.orderId);
      setPlacedOrder(order);

      // The server's total differs from what was shown: stop, show its
      // breakdown and wait for one confirming click.
      if (order.needsConfirm) {
        setIsLoading(false);
        return;
      }

      await startPayment(order);
    } catch (err: any) {
      console.error('Checkout error:', err);
      showOrderError(err?.message || 'We could not place your order. Please try again.');
      setIsLoading(false);
    }
  };

  if (!cartReady) {
    return (
      <main className="min-h-screen bg-gray-50 flex justify-center py-24" role="status" aria-live="polite">
        <i className="ri-loader-4-line animate-spin text-4xl text-gray-400" aria-hidden="true"></i>
        <span className="sr-only">Loading your cart…</span>
      </main>
    );
  }

  if (cart.length === 0 && !isLoading) {
    return (
      <main className="min-h-screen bg-gray-50 py-20">
        <div className="max-w-md mx-auto text-center px-4">
          <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm border border-gray-100">
            <i className="ri-shopping-cart-line text-4xl text-gray-300" aria-hidden="true"></i>
          </div>
          <h1 className="text-2xl font-bold text-gsg-black mb-2">Your cart is empty</h1>
          {cartChanges.length > 0 ? (
            <ul className="text-gray-500 mb-8 space-y-1">
              {cartChanges.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500 mb-8">Add some items to start the checkout process.</p>
          )}
          <Link href="/shop" className="inline-block bg-gsg-purple text-white px-8 py-3 rounded-full font-bold hover:bg-gsg-purple-dark transition-colors shadow-lg">
            Return to Shop
          </Link>
        </div>
      </main>
    );
  }

  const payDisabled = isLoading || !settingsLoaded || !cartChecked || couponLoading;
  const payLabel = placedOrder?.needsConfirm
    ? `Confirm and pay ${money(placedOrder.total)}`
    : paymentFailed && placedOrder
      ? 'Try payment again'
      : paymentMethod === 'paystack'
        ? 'Pay with Card'
        : 'Pay with Mobile Money';

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <Link href="/cart" className="text-gray-500 hover:text-gsg-purple font-medium inline-flex items-center whitespace-nowrap transition-colors">
            <i className="ri-arrow-left-line mr-2" aria-hidden="true"></i>
            Back to Cart
          </Link>
        </div>

        <h1 className="text-3xl font-extrabold text-gsg-black mb-8">Checkout</h1>

        {cartChanges.length > 0 && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
            <p className="font-semibold">Your cart was updated</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {cartChanges.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          </div>
        )}
        {cartCheckFailed && (
          <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700" role="status">
            We could not check the latest prices just now. We will confirm the final total with you before payment.
          </div>
        )}

        {currentStep === 1 && (
          <div className="mb-8 bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            {user ? (
              <p className="text-sm text-gray-600">
                <i className="ri-account-circle-line text-gsg-purple mr-1" aria-hidden="true"></i>
                Signed in as <span className="font-semibold text-gsg-black">{user.email}</span>. This order will appear in your account.
              </p>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <p className="text-sm text-gray-600">
                  Checking out as a guest. You can track your order with its number and your phone.
                </p>
                <div className="flex gap-3 text-sm font-semibold">
                  <Link href="/auth/login?redirect=/checkout" className="text-gsg-purple hover:underline">
                    Sign in
                  </Link>
                  <Link href="/auth/signup?redirect=/checkout" className="text-gsg-purple hover:underline">
                    Create an account
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}

        <CheckoutSteps currentStep={currentStep} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
          <div className="lg:col-span-2">
            {currentStep === 1 && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
                <h2 className="text-xl font-bold text-gsg-black mb-6 flex items-center gap-2">
                  <i className="ri-map-pin-line text-gsg-purple" aria-hidden="true"></i>
                  Your Details
                </h2>

                <div className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                      <label htmlFor="co-first-name" className="block text-sm font-bold text-gray-700 mb-2">
                        First Name <span className="text-red-500" aria-hidden="true">*</span>
                      </label>
                      <input
                        id="co-first-name"
                        type="text"
                        autoComplete="given-name"
                        required
                        value={shippingData.firstName}
                        onChange={(e) => { setShippingData({ ...shippingData, firstName: e.target.value }); clearError('firstName'); }}
                        aria-invalid={Boolean(errors.firstName)}
                        aria-describedby={errors.firstName ? 'co-first-name-error' : undefined}
                        className={inputClass(Boolean(errors.firstName))}
                        placeholder="Ama"
                      />
                      {errors.firstName && <p id="co-first-name-error" className="text-xs text-red-500 mt-1 font-medium">{errors.firstName}</p>}
                    </div>
                    <div>
                      <label htmlFor="co-last-name" className="block text-sm font-bold text-gray-700 mb-2">
                        Last Name <span className="text-red-500" aria-hidden="true">*</span>
                      </label>
                      <input
                        id="co-last-name"
                        type="text"
                        autoComplete="family-name"
                        required
                        value={shippingData.lastName}
                        onChange={(e) => { setShippingData({ ...shippingData, lastName: e.target.value }); clearError('lastName'); }}
                        aria-invalid={Boolean(errors.lastName)}
                        aria-describedby={errors.lastName ? 'co-last-name-error' : undefined}
                        className={inputClass(Boolean(errors.lastName))}
                        placeholder="Mensah"
                      />
                      {errors.lastName && <p id="co-last-name-error" className="text-xs text-red-500 mt-1 font-medium">{errors.lastName}</p>}
                    </div>
                  </div>

                  <div>
                    <label htmlFor="co-phone" className="block text-sm font-bold text-gray-700 mb-2">
                      Phone Number <span className="text-red-500" aria-hidden="true">*</span>
                    </label>
                    <input
                      id="co-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      required
                      value={shippingData.phone}
                      onChange={(e) => { setShippingData({ ...shippingData, phone: e.target.value }); clearError('phone'); }}
                      aria-invalid={Boolean(errors.phone)}
                      aria-describedby={errors.phone ? 'co-phone-error' : 'co-phone-hint'}
                      className={inputClass(Boolean(errors.phone))}
                      placeholder="024 123 4567"
                    />
                    {errors.phone ? (
                      <p id="co-phone-error" className="text-xs text-red-500 mt-1 font-medium">{errors.phone}</p>
                    ) : (
                      <p id="co-phone-hint" className="text-xs text-gray-500 mt-1">
                        Your order confirmation and delivery updates come by SMS and WhatsApp to this number.
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="co-email" className="block text-sm font-bold text-gray-700 mb-2">
                      Email Address <span className="font-normal text-gray-500">(optional)</span>
                    </label>
                    <input
                      id="co-email"
                      type="email"
                      autoComplete="email"
                      value={shippingData.email}
                      readOnly={!!user}
                      onChange={(e) => { setShippingData({ ...shippingData, email: e.target.value }); clearError('email'); }}
                      aria-invalid={Boolean(errors.email)}
                      aria-describedby={errors.email ? 'co-email-error' : undefined}
                      className={`${inputClass(Boolean(errors.email))} ${user ? 'bg-gray-100 cursor-not-allowed text-gray-500' : ''}`}
                      placeholder="you@example.com"
                    />
                    {errors.email && <p id="co-email-error" className="text-xs text-red-500 mt-1 font-medium">{errors.email}</p>}
                  </div>

                  <div>
                    <label htmlFor="co-address" className="block text-sm font-bold text-gray-700 mb-2">
                      Street Address or Directions <span className="text-red-500" aria-hidden="true">*</span>
                    </label>
                    <input
                      id="co-address"
                      type="text"
                      autoComplete="street-address"
                      required
                      value={shippingData.address}
                      onChange={(e) => { setShippingData({ ...shippingData, address: e.target.value }); clearError('address'); }}
                      aria-invalid={Boolean(errors.address)}
                      aria-describedby={errors.address ? 'co-address-error' : undefined}
                      className={inputClass(Boolean(errors.address))}
                      placeholder="House number, street, nearest landmark"
                    />
                    {errors.address && <p id="co-address-error" className="text-xs text-red-500 mt-1 font-medium">{errors.address}</p>}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                      <label htmlFor="co-city" className="block text-sm font-bold text-gray-700 mb-2">
                        City or Town <span className="text-red-500" aria-hidden="true">*</span>
                      </label>
                      <input
                        id="co-city"
                        type="text"
                        autoComplete="address-level2"
                        required
                        value={shippingData.city}
                        onChange={(e) => { setShippingData({ ...shippingData, city: e.target.value }); clearError('city'); }}
                        aria-invalid={Boolean(errors.city)}
                        aria-describedby={errors.city ? 'co-city-error' : undefined}
                        className={inputClass(Boolean(errors.city))}
                        placeholder="Accra"
                      />
                      {errors.city && <p id="co-city-error" className="text-xs text-red-500 mt-1 font-medium">{errors.city}</p>}
                    </div>
                    <div>
                      <label htmlFor="co-region" className="block text-sm font-bold text-gray-700 mb-2">
                        Region <span className="text-red-500" aria-hidden="true">*</span>
                      </label>
                      <div className="relative">
                        <select
                          id="co-region"
                          autoComplete="address-level1"
                          required
                          value={shippingData.region}
                          onChange={(e) => { setShippingData({ ...shippingData, region: e.target.value }); clearError('region'); }}
                          aria-invalid={Boolean(errors.region)}
                          aria-describedby={errors.region ? 'co-region-error' : undefined}
                          className={`${inputClass(Boolean(errors.region))} appearance-none`}
                        >
                          <option value="">Select Region</option>
                          {GHANA_REGIONS.map((region) => (
                            <option key={region} value={region}>{region}</option>
                          ))}
                        </select>
                        <i className="ri-arrow-down-s-line absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" aria-hidden="true"></i>
                      </div>
                      {errors.region && <p id="co-region-error" className="text-xs text-red-500 mt-1 font-medium">{errors.region}</p>}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleContinueToDelivery}
                  className="w-full mt-8 bg-gsg-black hover:bg-gsg-purple text-white py-4 rounded-xl font-bold transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 whitespace-nowrap cursor-pointer"
                >
                  Continue to Delivery
                </button>
              </div>
            )}

            {currentStep === 2 && (
              <>
                <fieldset className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
                  <legend className="sr-only">Delivery Method</legend>
                  <h2 className="text-xl font-bold text-gsg-black mb-6 flex items-center gap-2" aria-hidden="true">
                    <i className="ri-truck-line text-gsg-purple"></i>
                    Delivery Method
                  </h2>
                  {settingsFailed && !settingsLoaded && (
                    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
                      We could not load delivery prices.{' '}
                      <button type="button" onClick={retrySettings} className="font-semibold underline">
                        Try again
                      </button>
                    </div>
                  )}
                  <div className="space-y-3">
                    {deliveryOptionsList.map((opt) => {
                      const selected = deliveryMethod === opt.value;
                      const optNeedsKm = methodNeedsDistance(opt.value);
                      const preview = pricingConfig
                        ? calculateDeliveryFee({
                            method: opt.value,
                            km: deliveryPin ? Math.max(0, parseFloat(deliveryKm) || 0) : 0,
                            purchaseTotal: subtotal,
                            config: pricingConfig,
                          })
                        : null;
                      const showFee = Boolean(preview) && (!optNeedsKm || (deliveryPin && parseFloat(deliveryKm) > 0));
                      return (
                        <label
                          key={opt.value}
                          className={`flex items-start justify-between gap-3 p-4 border-2 rounded-xl cursor-pointer transition-all has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gsg-purple has-[:focus-visible]:ring-offset-2 ${selected ? 'border-gsg-purple bg-purple-50' : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'}`}
                        >
                          <div className="flex items-start space-x-4 min-w-0">
                            <input
                              type="radio"
                              name="delivery"
                              value={opt.value}
                              checked={selected}
                              onChange={(e) => { setDeliveryMethod(e.target.value); clearError('deliveryKm'); }}
                              className="sr-only"
                            />
                            <div aria-hidden="true" className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${selected ? 'border-gsg-purple' : 'border-gray-300'}`}>
                              {selected && <div className="w-2.5 h-2.5 rounded-full bg-gsg-purple"></div>}
                            </div>
                            <div className="min-w-0">
                              <p className={`font-bold ${selected ? 'text-gsg-purple' : 'text-gsg-black'}`}>{opt.label}</p>
                              {opt.subtitle && (
                                <p className={`text-sm font-semibold mt-0.5 ${selected ? 'text-gsg-purple' : 'text-emerald-700'}`}>
                                  {opt.subtitle}
                                </p>
                              )}
                              <p className="text-sm text-gray-500 mt-1 leading-relaxed">{opt.desc}</p>
                              {opt.value === 'personal-shopper' && (
                                <a
                                  href={shopperUrl('/')}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sm font-semibold text-gsg-purple underline underline-offset-2 mt-1 inline-block"
                                >
                                  Open Personal Shopper
                                </a>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={`text-sm font-bold ${selected ? 'text-gsg-purple' : 'text-gsg-black'}`}>
                              {showFee && preview ? money(preview.fee) : optNeedsKm ? 'Set location' : '—'}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  {needsKm && (
                    <div className="mt-6">
                      <DeliveryLocationPicker
                        valueKm={deliveryPin ? deliveryKm : ''}
                        error={errors.deliveryKm}
                        onDistanceChange={(km, meta) => {
                          if (meta && Number.isFinite(meta.lat) && Number.isFinite(meta.lng)) {
                            setDeliveryKm(km);
                            setDeliveryPin({ lat: meta.lat!, lng: meta.lng!, label: meta.label });
                          } else {
                            // No pin means no distance: a km without a place is never used.
                            setDeliveryKm('');
                            setDeliveryPin(null);
                          }
                          clearError('deliveryKm');
                        }}
                        onPlaceFill={({ city, region }) => {
                          setShippingData((prev) => ({
                            ...prev,
                            ...(city && !prev.city ? { city } : {}),
                            ...(region && GHANA_REGIONS.includes(region) && !prev.region ? { region } : {}),
                          }));
                        }}
                      />
                    </div>
                  )}

                  {deliveryMethod === 'joint-express' && (
                    <div className="mt-6 p-5 rounded-xl bg-gray-50 border border-gray-200">
                      <p className="font-bold text-gsg-black mb-3">Neighbour / Colleague details (optional)</p>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                          <label htmlFor="co-neighbour-name" className="sr-only">Neighbour&apos;s name</label>
                          <input
                            id="co-neighbour-name"
                            type="text"
                            placeholder="Name"
                            value={jointExpressNeighbor.name}
                            onChange={(e) => setJointExpressNeighbor((p) => ({ ...p, name: e.target.value }))}
                            className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple outline-none"
                          />
                        </div>
                        <div>
                          <label htmlFor="co-neighbour-phone" className="sr-only">Neighbour&apos;s phone</label>
                          <input
                            id="co-neighbour-phone"
                            type="tel"
                            placeholder="Phone"
                            value={jointExpressNeighbor.phone}
                            onChange={(e) => setJointExpressNeighbor((p) => ({ ...p, phone: e.target.value }))}
                            className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </fieldset>

                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
                  {coupon ? (
                    <div className="flex items-start justify-between gap-3 rounded-xl border border-green-200 bg-green-50 p-4">
                      <div>
                        <p className="text-sm font-semibold text-green-900">
                          Coupon <span className="font-mono">{coupon.code}</span> applied
                        </p>
                        <p className="text-sm text-green-800">
                          {coupon.message || (freeShipping ? 'Free delivery on this order' : `You save ${money(discount)}`)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={removeCoupon}
                        className="text-sm font-semibold text-green-900 underline"
                        aria-label={`Remove coupon ${coupon.code}`}
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        applyCoupon(couponInput);
                      }}
                    >
                      <label htmlFor="checkout-coupon" className="mb-2 block text-sm font-bold text-gray-700">
                        Coupon code <span className="font-normal text-gray-500">(optional)</span>
                      </label>
                      <div className="flex gap-2">
                        <input
                          id="checkout-coupon"
                          type="text"
                          value={couponInput}
                          onChange={(e) => {
                            setCouponInput(e.target.value);
                            if (couponError) setCouponError('');
                          }}
                          autoComplete="off"
                          aria-invalid={!!couponError}
                          aria-describedby={couponError ? 'checkout-coupon-error' : undefined}
                          className={`min-w-0 flex-1 px-4 py-3 border rounded-xl uppercase outline-none focus:ring-2 focus:ring-gsg-purple ${couponError ? 'border-red-500' : 'border-gray-200'}`}
                        />
                        <button
                          type="submit"
                          disabled={couponLoading || !couponInput.trim()}
                          className="px-5 py-3 rounded-xl bg-gsg-black text-white font-bold disabled:opacity-50"
                        >
                          {couponLoading ? 'Checking…' : 'Apply'}
                        </button>
                      </div>
                      {couponError && (
                        <p id="checkout-coupon-error" className="mt-2 text-sm text-red-600" role="alert">{couponError}</p>
                      )}
                    </form>
                  )}
                  {coupon && couponError && (
                    <p className="mt-2 text-sm text-red-600" role="alert">{couponError}</p>
                  )}
                </div>

                <fieldset className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
                  <legend className="sr-only">Payment Method</legend>
                  <h2 className="text-xl font-bold text-gsg-black mb-2 flex items-center gap-2" aria-hidden="true">
                    <i className="ri-secure-payment-line text-gsg-purple"></i>
                    Payment Method
                  </h2>
                  <p className="text-sm text-gray-500 mb-6">
                    Choose how you&apos;d like to pay. You&apos;ll be taken to a secure page to complete payment.
                  </p>
                  <div className="space-y-3">
                    {PAYMENT_OPTIONS.map((opt) => {
                      const selected = paymentMethod === opt.value;
                      return (
                        <label
                          key={opt.value}
                          className={`flex items-start justify-between gap-4 p-4 border-2 rounded-xl cursor-pointer transition-all has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gsg-purple has-[:focus-visible]:ring-offset-2 ${
                            selected ? 'border-gsg-purple bg-purple-50' : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-start space-x-4 flex-1">
                            <input
                              type="radio"
                              name="payment-method"
                              value={opt.value}
                              checked={selected}
                              onChange={() => setPaymentMethod(opt.value)}
                              className="sr-only"
                            />
                            <div
                              aria-hidden="true"
                              className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${selected ? 'border-gsg-purple' : 'border-gray-300'}`}
                            >
                              {selected && <div className="w-2.5 h-2.5 rounded-full bg-gsg-purple"></div>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <i className={`${opt.icon} text-lg ${selected ? 'text-gsg-purple' : 'text-gray-500'}`} aria-hidden="true"></i>
                                <p className={`font-bold ${selected ? 'text-gsg-purple' : 'text-gsg-black'}`}>{opt.label}</p>
                              </div>
                              <p className="text-sm text-gray-500 mt-1 leading-relaxed">{opt.desc}</p>
                              <div className="flex flex-wrap gap-1.5 mt-2" aria-hidden="true">
                                {opt.badges.map((b) => (
                                  <span
                                    key={b}
                                    className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-white text-gray-600 border border-gray-200"
                                  >
                                    {b}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  {placedOrder?.needsConfirm && (
                    <div className="mt-6 rounded-xl border-2 border-amber-300 bg-amber-50 p-5" role="alert">
                      <p className="font-bold text-amber-900">The total has changed</p>
                      <p className="text-sm text-amber-900 mt-1">
                        You saw {money(total)}, but with today&apos;s prices and delivery the order comes to{' '}
                        <strong>{money(placedOrder.total)}</strong>. Please check it before you pay.
                      </p>
                      <dl className="mt-3 space-y-1 text-sm text-amber-950">
                        {placedOrder.items.map((it, i) => (
                          <div key={`${it.name}-${i}`} className="flex justify-between gap-3">
                            <dt>
                              {it.name}
                              {it.variant ? ` (${it.variant})` : ''} — {money(Number(it.unitPrice) || 0)} × {it.quantity}
                            </dt>
                            <dd className="font-semibold">{money(Number(it.lineTotal) || 0)}</dd>
                          </div>
                        ))}
                        <div className="flex justify-between gap-3 border-t border-amber-200 pt-1">
                          <dt>Subtotal</dt>
                          <dd>{money(placedOrder.subtotal)}</dd>
                        </div>
                        {placedOrder.discountTotal > 0 && (
                          <div className="flex justify-between gap-3">
                            <dt>Coupon</dt>
                            <dd>-{money(placedOrder.discountTotal)}</dd>
                          </div>
                        )}
                        <div className="flex justify-between gap-3">
                          <dt>Delivery</dt>
                          <dd>{money(placedOrder.shippingTotal)}</dd>
                        </div>
                        <div className="flex justify-between gap-3 font-bold">
                          <dt>Total</dt>
                          <dd>{money(placedOrder.total)}</dd>
                        </div>
                      </dl>
                    </div>
                  )}

                  {(orderError || unavailable.length > 0) && (
                    <div
                      ref={errorRef}
                      tabIndex={-1}
                      className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 outline-none"
                      role="alert"
                    >
                      {orderError && <p>{orderError}</p>}
                      {unavailable.length > 0 && (
                        <ul className="mt-1 list-disc pl-5">
                          {unavailable.map((name) => (
                            <li key={name}>{name}</li>
                          ))}
                        </ul>
                      )}
                      {paymentFailed && placedOrder && (
                        <Link
                          href={`/pay/${encodeURIComponent(placedOrder.orderNumber)}`}
                          className="mt-2 inline-block font-semibold underline"
                        >
                          Go to the payment page for order {placedOrder.orderNumber}
                        </Link>
                      )}
                    </div>
                  )}

                  {!settingsLoaded && !settingsFailed && (
                    <p className="mt-6 text-sm text-gray-500" role="status">Loading delivery prices…</p>
                  )}

                  <div className="flex flex-col-reverse md:flex-row gap-4 mt-8">
                    <button
                      type="button"
                      onClick={() => setCurrentStep(1)}
                      disabled={isLoading}
                      className="flex-1 border-2 border-gray-200 hover:border-gray-300 text-gray-600 hover:text-gsg-black py-4 rounded-xl font-bold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handlePlaceOrder}
                      disabled={payDisabled}
                      className="flex-1 bg-gsg-black hover:bg-gsg-purple text-white py-4 rounded-xl font-bold transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 whitespace-nowrap cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 flex items-center justify-center gap-2"
                    >
                      {isLoading ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true"></div>
                          Processing...
                        </>
                      ) : (
                        <>
                          <span>{payLabel}</span>
                          <i className="ri-secure-payment-line" aria-hidden="true"></i>
                        </>
                      )}
                    </button>
                  </div>
                </fieldset>
              </>
            )}
          </div>

          <div className="lg:col-span-1">
            <OrderSummary
              items={cart}
              subtotal={subtotal}
              shipping={shippingCost}
              tax={tax}
              total={total}
              discount={discount}
              discountLabel={coupon?.code}
              shippingKnown={feeKnown}
              shippingLabel="Delivery"
              shippingNote={
                freeShipping && feeKnown
                  ? 'Free delivery with your coupon.'
                  : !settingsLoaded
                  ? 'Loading delivery prices…'
                  : needsKm && !(kmValue > 0)
                    ? 'Find your delivery location to see the delivery total.'
                    : null
              }
            />
          </div>
        </div>
      </div>
    </main>
  );
}
