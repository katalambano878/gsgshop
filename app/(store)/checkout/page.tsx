'use client';

import Link from 'next/link';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import CheckoutSteps from '@/components/CheckoutSteps';
import OrderSummary from '@/components/OrderSummary';
import { useCart } from '@/context/CartContext';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRecaptcha } from '@/hooks/useRecaptcha';
import { shopperUrl } from '@/lib/site-urls';
import {
  calculateDeliveryFee,
  methodNeedsDistance,
} from '@/lib/delivery-pricing';
import { useDeliveryPricing } from '@/hooks/useDeliveryPricing';
import DeliveryLocationPicker from '@/components/DeliveryLocationPicker';

export default function CheckoutPage() {
  usePageTitle('Checkout');
  const router = useRouter();
  const { cart, subtotal: cartSubtotal, clearCart } = useCart();

  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [checkoutType, setCheckoutType] = useState<'guest' | 'account'>('guest');
  const [saveAddress, setSaveAddress] = useState(false);
  const [user, setUser] = useState<any>(null);
  const { getToken } = useRecaptcha();

  const [shippingData, setShippingData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    region: ''
  });

  // Ghana Regions for dropdown
  const ghanaRegions = [
    'Greater Accra', 'Ashanti', 'Western', 'Central', 'Eastern', 'Northern', 'Volta',
    'Upper East', 'Upper West', 'Brong-Ahafo', 'Ahafo', 'Bono', 'Bono East',
    'North East', 'Savannah', 'Oti', 'Western North'
  ];

  const [deliveryMethod, setDeliveryMethod] = useState('pickup');
  const [deliveryKm, setDeliveryKm] = useState('');
  const [deliveryPin, setDeliveryPin] = useState<{ lat: number; lng: number; label?: string } | null>(null);
  const pricingConfig = useDeliveryPricing();
  const [jointExpressNeighbor, setJointExpressNeighbor] = useState({ name: '', phone: '' });
  // 'moolre' = Mobile Money via Moolre. 'paystack' = Card payments via Paystack.
  const [paymentMethod, setPaymentMethod] = useState<'moolre' | 'paystack'>('moolre');
  const [errors, setErrors] = useState<any>({});

  const paymentOptions: Array<{
    value: 'moolre' | 'paystack';
    label: string;
    desc: string;
    icon: string;
    badges: string[];
  }> = [
    {
      value: 'moolre',
      label: 'Mobile Money',
      desc: 'Pay with MTN MoMo, AirtelTigo Money, or Vodafone Cash.',
      icon: 'ri-smartphone-line',
      badges: ['MTN', 'AirtelTigo', 'Vodafone'],
    },
    {
      value: 'paystack',
      label: 'Card Payments',
      desc: 'Pay securely with your debit or credit card via Paystack.',
      icon: 'ri-bank-card-line',
      badges: ['Visa', 'Mastercard', 'Verve'],
    },
  ];

  const deliveryOptionsList = [
    {
      value: 'personal-shopper',
      label: 'Add To My Personal Shopper',
      desc: 'Send your list to your personal shopper. Delivery priced separately there.',
      href: '/shopper/shopping-list',
    },
    {
      value: 'free-delivery',
      label: 'Free Delivery (Tue/Fri)',
      desc: 'Tue/Fri only. Confirm before noon the preceding day. Total shown after your address.',
      href: null,
    },
    {
      value: 'sole-express',
      label: 'Sole Express Delivery (Daily)',
      desc: 'Required for fresh/perishable. 2hr–48hr slots after confirmation.',
      href: null,
    },
    {
      value: 'joint-express',
      label: 'Joint Express – Myself & Neighbor (Daily)',
      desc: 'Share delivery with a neighbour; items stay private. 2hr–48hr slots.',
      href: null,
    },
    {
      value: 'pickup',
      label: 'Pickup (Within 72 Hrs.)',
      desc: 'No delivery fee. Collect within 72hrs (excl. Sunday) at the hub in your confirmation.',
      href: null,
    },
  ];

  // Check auth — runs once. Keeping cart/router/isLoading out of the deps so
  // the auth listener isn't torn down and resubscribed mid-checkout (which
  // can cancel in-flight supabase requests with AbortError).
  useEffect(() => {
    async function checkUser() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        setCheckoutType('account');
        setShippingData(prev => ({ ...prev, email: session.user.email || '' }));
      }
    }
    checkUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      if (!nextUser) {
        setCheckoutType('guest');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Scroll to top when step changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentStep]);

  // Calculate Totals — delivery fee from published formulas
  const subtotal = cartSubtotal;
  const kmValue = Math.max(0, parseFloat(deliveryKm) || 0);
  const deliveryBreakdown = useMemo(
    () =>
      calculateDeliveryFee({
        method: deliveryMethod,
        km: kmValue,
        purchaseTotal: subtotal,
        config: pricingConfig,
      }),
    [deliveryMethod, kmValue, subtotal, pricingConfig]
  );
  const shippingCost = deliveryBreakdown.fee;
  const tax = 0;
  const total = subtotal + shippingCost + tax;
  const needsKm = methodNeedsDistance(deliveryMethod);

  const validateShipping = () => {
    const newErrors: any = {};
    if (!shippingData.firstName) newErrors.firstName = 'First name is required';
    if (!shippingData.lastName) newErrors.lastName = 'Last name is required';
    if (!shippingData.email) newErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(shippingData.email)) newErrors.email = 'Invalid email';
    if (!shippingData.phone) newErrors.phone = 'Phone is required';
    if (!shippingData.address) newErrors.address = 'Address is required';
    if (!shippingData.city) newErrors.city = 'City is required';
    if (!shippingData.region) newErrors.region = 'Region is required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleContinueToDelivery = () => {
    if (!validateShipping()) return;
    // Distance is part of the address step so the fee total can show on delivery.
    if (!(kmValue > 0)) {
      setErrors((prev: any) => ({
        ...prev,
        deliveryKm: 'Type your delivery area so we can set the distance.',
      }));
      return;
    }
    setErrors((prev: any) => {
      const next = { ...prev };
      delete next.deliveryKm;
      return next;
    });
    setCurrentStep(2);
  };

  const handleContinueToPayment = async () => {
    if (needsKm && !(kmValue > 0)) {
      setErrors((prev: any) => ({
        ...prev,
        deliveryKm: 'Type your delivery area so we can set the distance.',
      }));
      return;
    }
    setErrors((prev: any) => {
      const next = { ...prev };
      delete next.deliveryKm;
      return next;
    });
    await handlePlaceOrder();
  };

  const handlePlaceOrder = async () => {
    if (cart.length === 0) {
      alert('Your cart is empty');
      return;
    }

    if (needsKm && !(kmValue > 0)) {
      alert('Please type your delivery area so we can calculate the distance.');
      return;
    }

    setIsLoading(true);

    // reCAPTCHA verification
    const isHuman = await getToken('checkout');
    if (!isHuman) {
      alert('Security verification failed. Please try again.');
      setIsLoading(false);
      return;
    }

    try {
      // 1. Create the order via the server-side route. This is required —
      // direct supabase-js inserts can't get past the RLS combination
      // (orders.RETURNING enforces SELECT policy + order_items WITH CHECK
      // joins through orders), and we don't want to trust client-supplied
      // prices for an endpoint that drives real card payments.
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
            variant: it.variant,
          })),
          shipping: {
            firstName: shippingData.firstName,
            lastName: shippingData.lastName,
            email: shippingData.email,
            phone: shippingData.phone,
            address: shippingData.address,
            city: shippingData.city,
            region: shippingData.region,
          },
          deliveryMethod,
          deliveryKm: needsKm ? kmValue : 0,
          deliveryPin: needsKm ? deliveryPin : null,
          paymentMethod,
          jointExpressNeighbor:
            deliveryMethod === 'joint-express' && (jointExpressNeighbor.name || jointExpressNeighbor.phone)
              ? jointExpressNeighbor
              : null,
        }),
      });

      const checkoutResult = await checkoutRes.json();
      if (!checkoutRes.ok || !checkoutResult.success) {
        throw new Error(checkoutResult.message || 'Failed to create order');
      }

      const orderNumber: string = checkoutResult.orderNumber;
      const orderTotal: number = checkoutResult.total;

      // 2. Initiate payment.
      if (paymentMethod === 'moolre' || paymentMethod === 'paystack') {
        try {
          const initEndpoint =
            paymentMethod === 'paystack' ? '/api/payment/paystack' : '/api/payment/moolre';

          const paymentRes = await fetch(initEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderId: orderNumber,
              amount: orderTotal,
              customerEmail: shippingData.email,
            }),
          });

          const paymentResult = await paymentRes.json();

          if (!paymentResult.success) {
            throw new Error(paymentResult.message || 'Payment initialization failed');
          }

          clearCart();
          window.location.href = paymentResult.url;
          return;
        } catch (paymentErr: any) {
          console.error('Payment Error:', paymentErr);
          alert('Failed to initialize payment: ' + paymentErr.message);
          setIsLoading(false);
          return;
        }
      }

      // 3. No payment provider — fire notifications and head to success page.
      fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'order_created',
          payload: { order_number: orderNumber, total: orderTotal, email: shippingData.email },
        }),
      }).catch(err => console.error('Notification trigger error:', err));

      clearCart();
      router.push(`/order-success?order=${orderNumber}`);

    } catch (err: any) {
      console.error('Checkout error:', err);
      alert('Failed to place order: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (cart.length === 0 && !isLoading) {
    return (
      <main className="min-h-screen bg-gray-50 py-20">
        <div className="max-w-md mx-auto text-center px-4">
          <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm border border-gray-100">
            <i className="ri-shopping-cart-line text-4xl text-gray-300"></i>
          </div>
          <h1 className="text-2xl font-bold text-gsg-black mb-2">Your cart is empty</h1>
          <p className="text-gray-500 mb-8">Add some items to start the checkout process.</p>
          <Link href="/shop" className="inline-block bg-gsg-purple text-white px-8 py-3 rounded-full font-bold hover:bg-gsg-purple-dark transition-colors shadow-lg">
            Return to Shop
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <Link href="/cart" className="text-gray-500 hover:text-gsg-purple font-medium inline-flex items-center whitespace-nowrap transition-colors">
            <i className="ri-arrow-left-line mr-2"></i>
            Back to Cart
          </Link>
        </div>

        <h1 className="text-3xl font-extrabold text-gsg-black mb-8">Checkout</h1>

        {currentStep === 1 && (
          <div className="mb-8 bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-xl font-bold text-gsg-black mb-6">Checkout As</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <button
                onClick={() => !user && setCheckoutType('guest')}
                className={`p-6 rounded-xl border-2 transition-all text-left cursor-pointer relative overflow-hidden ${checkoutType === 'guest'
                  ? 'border-gsg-purple bg-purple-50'
                  : 'border-gray-200 hover:border-gray-300'
                  } ${user ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={!!user}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shadow-sm">
                    <i className="ri-user-line text-2xl text-gsg-purple"></i>
                  </div>
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${checkoutType === 'guest' ? 'border-gsg-purple bg-gsg-purple' : 'border-gray-300'
                    }`}>
                    {checkoutType === 'guest' && <i className="ri-check-line text-white text-sm"></i>}
                  </div>
                </div>
                <h3 className="text-lg font-bold text-gsg-black mb-1">Guest Checkout</h3>
                <p className="text-sm text-gray-500">Quick checkout without creating an account</p>
                {user && <p className="text-xs text-gsg-purple mt-2 font-medium">You are logged in</p>}
              </button>

              <button
                onClick={() => setCheckoutType('account')}
                className={`p-6 rounded-xl border-2 transition-all text-left cursor-pointer ${checkoutType === 'account'
                  ? 'border-gsg-purple bg-purple-50'
                  : 'border-gray-200 hover:border-gray-300'
                  }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shadow-sm">
                    <i className="ri-account-circle-line text-2xl text-gsg-purple"></i>
                  </div>
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${checkoutType === 'account' ? 'border-gsg-purple bg-gsg-purple' : 'border-gray-300'
                    }`}>
                    {checkoutType === 'account' && <i className="ri-check-line text-white text-sm"></i>}
                  </div>
                </div>
                <h3 className="text-lg font-bold text-gsg-black mb-1">{user ? 'My Account' : 'Create Account'}</h3>
                <p className="text-sm text-gray-500">
                  {user ? `Logged in as ${user.email}` : 'Save info, track orders & earn loyalty points'}
                </p>
              </button>
            </div>
          </div>
        )}

        <CheckoutSteps currentStep={currentStep} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
          <div className="lg:col-span-2">
            {currentStep === 1 && (
              <>
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
                  <h2 className="text-xl font-bold text-gsg-black mb-6 flex items-center gap-2">
                    <i className="ri-map-pin-line text-gsg-purple"></i>
                    Shipping Information
                  </h2>

                  <div className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">
                          First Name <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={shippingData.firstName}
                          onChange={(e) => setShippingData({ ...shippingData, firstName: e.target.value })}
                          className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple transition-all outline-none ${errors.firstName ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50 focus:bg-white'
                            }`}
                          placeholder="John"
                        />
                        {errors.firstName && <p className="text-xs text-red-500 mt-1 font-medium">{errors.firstName}</p>}
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">
                          Last Name <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={shippingData.lastName}
                          onChange={(e) => setShippingData({ ...shippingData, lastName: e.target.value })}
                          className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple transition-all outline-none ${errors.lastName ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50 focus:bg-white'
                            }`}
                          placeholder="Doe"
                        />
                        {errors.lastName && <p className="text-xs text-red-500 mt-1 font-medium">{errors.lastName}</p>}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">
                        Email Address <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="email"
                        value={shippingData.email}
                        readOnly={!!user}
                        onChange={(e) => setShippingData({ ...shippingData, email: e.target.value })}
                        className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple transition-all outline-none ${errors.email ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50 focus:bg-white'
                          } ${user ? 'bg-gray-100 cursor-not-allowed text-gray-500' : ''}`}
                        placeholder="you@example.com"
                      />
                      {errors.email && <p className="text-xs text-red-500 mt-1 font-medium">{errors.email}</p>}
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">
                        Phone Number <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="tel"
                        value={shippingData.phone}
                        onChange={(e) => setShippingData({ ...shippingData, phone: e.target.value })}
                        className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple transition-all outline-none ${errors.phone ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50 focus:bg-white'
                          }`}
                        placeholder="+233 XX XXX XXXX"
                      />
                      {errors.phone && <p className="text-xs text-red-500 mt-1 font-medium">{errors.phone}</p>}
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">
                        Street Address <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={shippingData.address}
                        onChange={(e) => setShippingData({ ...shippingData, address: e.target.value })}
                        className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple transition-all outline-none ${errors.address ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50 focus:bg-white'
                          }`}
                        placeholder="House number and street name"
                      />
                      {errors.address && <p className="text-xs text-red-500 mt-1 font-medium">{errors.address}</p>}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">
                          City <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={shippingData.city}
                          onChange={(e) => setShippingData({ ...shippingData, city: e.target.value })}
                          className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple transition-all outline-none ${errors.city ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50 focus:bg-white'
                            }`}
                          placeholder="Accra"
                        />
                        {errors.city && <p className="text-xs text-red-500 mt-1 font-medium">{errors.city}</p>}
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">
                          Region <span className="text-red-500">*</span>
                        </label>
                        <div className="relative">
                          <select
                            value={shippingData.region}
                            onChange={(e) => setShippingData({ ...shippingData, region: e.target.value })}
                            className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple transition-all outline-none appearance-none ${errors.region ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50 focus:bg-white'
                              }`}
                          >
                            <option value="">Select Region</option>
                            {ghanaRegions.map((region) => (
                              <option key={region} value={region}>{region}</option>
                            ))}
                          </select>
                          <i className="ri-arrow-down-s-line absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none"></i>
                        </div>
                        {errors.region && <p className="text-xs text-red-500 mt-1 font-medium">{errors.region}</p>}
                      </div>
                    </div>

                    <DeliveryLocationPicker
                      valueKm={deliveryKm}
                      error={errors.deliveryKm}
                      onDistanceChange={(km, meta) => {
                        setDeliveryKm(km);
                        if (Number.isFinite(meta?.lat) && Number.isFinite(meta?.lng)) {
                          setDeliveryPin({ lat: meta!.lat!, lng: meta!.lng!, label: meta?.label });
                        } else if (!km) {
                          setDeliveryPin(null);
                        }
                        if (errors.deliveryKm) {
                          setErrors((prev: any) => {
                            const next = { ...prev };
                            delete next.deliveryKm;
                            return next;
                          });
                        }
                      }}
                      onPlaceFill={({ city, region, addressHint }) => {
                        setShippingData((prev) => ({
                          ...prev,
                          ...(city ? { city } : {}),
                          ...(region ? { region } : {}),
                          ...(addressHint && !prev.address ? { address: addressHint } : {}),
                        }));
                      }}
                    />

                    {checkoutType === 'account' && (
                      <label className="flex items-center space-x-3 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={saveAddress}
                          onChange={(e) => setSaveAddress(e.target.checked)}
                          className="w-5 h-5 text-gsg-purple rounded border-gray-300 focus:ring-gsg-purple"
                        />
                        <span className="text-sm text-gray-600 group-hover:text-gsg-purple transition-colors">Save this address for future orders</span>
                      </label>
                    )}
                  </div>

                  <button
                    onClick={handleContinueToDelivery}
                    className="w-full mt-8 bg-gsg-black hover:bg-gsg-purple text-white py-4 rounded-xl font-bold transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 whitespace-nowrap cursor-pointer"
                  >
                    Continue to Delivery
                  </button>
                </div>
              </>
            )}

            {currentStep === 2 && (
              <>
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
                  <h2 className="text-xl font-bold text-gsg-black mb-6 flex items-center gap-2">
                    <i className="ri-truck-line text-gsg-purple"></i>
                    Delivery Method
                  </h2>
                  <div className="space-y-3">
                    {deliveryOptionsList.map((opt) => {
                      const preview = calculateDeliveryFee({
                        method: opt.value,
                        km: kmValue || 0,
                        purchaseTotal: subtotal,
                        config: pricingConfig,
                      });
                      const showFee =
                        opt.value === 'pickup' ||
                        opt.value === 'personal-shopper' ||
                        kmValue > 0;
                      return (
                        <label
                          key={opt.value}
                          className={`flex items-start justify-between gap-3 p-4 border-2 rounded-xl cursor-pointer transition-all ${deliveryMethod === opt.value ? 'border-gsg-purple bg-purple-50' : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'}`}
                        >
                          <div className="flex items-start space-x-4 min-w-0">
                            <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${deliveryMethod === opt.value ? 'border-gsg-purple' : 'border-gray-300'}`}>
                              {deliveryMethod === opt.value && <div className="w-2.5 h-2.5 rounded-full bg-gsg-purple"></div>}
                            </div>
                            <input
                              type="radio"
                              name="delivery"
                              value={opt.value}
                              checked={deliveryMethod === opt.value}
                              onChange={(e) => setDeliveryMethod(e.target.value)}
                              className="hidden"
                            />
                            <div className="min-w-0">
                              <p className={`font-bold ${deliveryMethod === opt.value ? 'text-gsg-purple' : 'text-gsg-black'}`}>{opt.label}</p>
                              <p className="text-sm text-gray-500 mt-1 leading-relaxed">{opt.desc}</p>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={`text-sm font-bold ${deliveryMethod === opt.value ? 'text-gsg-purple' : 'text-gsg-black'}`}>
                              {!showFee
                                ? '—'
                                : preview.fee === 0
                                  ? 'GH₵0.00'
                                  : `GH₵${preview.fee.toFixed(2)}`}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  {deliveryMethod === 'joint-express' && (
                    <div className="mt-6 p-5 rounded-xl bg-gray-50 border border-gray-200">
                      <p className="font-bold text-gsg-black mb-3">Neighbor / Colleague details (optional)</p>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <input
                          type="text"
                          placeholder="Name"
                          value={jointExpressNeighbor.name}
                          onChange={(e) => setJointExpressNeighbor((p) => ({ ...p, name: e.target.value }))}
                          className="px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple outline-none"
                        />
                        <input
                          type="tel"
                          placeholder="Phone"
                          value={jointExpressNeighbor.phone}
                          onChange={(e) => setJointExpressNeighbor((p) => ({ ...p, phone: e.target.value }))}
                          className="px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple outline-none"
                        />
                      </div>
                    </div>
                  )}
                  {deliveryMethod === 'personal-shopper' && (
                    <p className="mt-4 text-sm text-gray-600 bg-blue-50 p-4 rounded-xl border border-blue-100">
                      <i className="ri-information-fill text-blue-500 mr-1"></i>
                      <a href={shopperUrl('/shopping-list')} className="text-blue-700 font-bold hover:underline">Go to My Personal Shopper</a> to add items to your list.
                    </p>
                  )}
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
                  <h2 className="text-xl font-bold text-gsg-black mb-2 flex items-center gap-2">
                    <i className="ri-secure-payment-line text-gsg-purple"></i>
                    Payment Method
                  </h2>
                  <p className="text-sm text-gray-500 mb-6">
                    Choose how you'd like to pay. You'll be redirected to a secure page to complete payment.
                  </p>
                  <div className="space-y-3">
                    {paymentOptions.map((opt) => {
                      const selected = paymentMethod === opt.value;
                      return (
                        <label
                          key={opt.value}
                          className={`flex items-start justify-between gap-4 p-4 border-2 rounded-xl cursor-pointer transition-all ${
                            selected
                              ? 'border-gsg-purple bg-purple-50'
                              : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-start space-x-4 flex-1">
                            <div
                              className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                                selected ? 'border-gsg-purple' : 'border-gray-300'
                              }`}
                            >
                              {selected && <div className="w-2.5 h-2.5 rounded-full bg-gsg-purple"></div>}
                            </div>
                            <input
                              type="radio"
                              name="payment-method"
                              value={opt.value}
                              checked={selected}
                              onChange={() => setPaymentMethod(opt.value)}
                              className="hidden"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <i className={`${opt.icon} text-lg ${selected ? 'text-gsg-purple' : 'text-gray-500'}`}></i>
                                <p className={`font-bold ${selected ? 'text-gsg-purple' : 'text-gsg-black'}`}>
                                  {opt.label}
                                </p>
                              </div>
                              <p className="text-sm text-gray-500 mt-1 leading-relaxed">{opt.desc}</p>
                              <div className="flex flex-wrap gap-1.5 mt-2">
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

                  <div className="flex flex-col-reverse md:flex-row gap-4 mt-8">
                    <button
                      onClick={() => setCurrentStep(1)}
                      disabled={isLoading}
                      className="flex-1 border-2 border-gray-200 hover:border-gray-300 text-gray-600 hover:text-gsg-black py-4 rounded-xl font-bold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
                    >
                      Back
                    </button>
                    <button
                      onClick={handleContinueToPayment}
                      disabled={isLoading}
                      className="flex-1 bg-gsg-black hover:bg-gsg-purple text-white py-4 rounded-xl font-bold transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 whitespace-nowrap cursor-pointer disabled:opacity-70 flex items-center justify-center gap-2"
                    >
                      {isLoading ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                          Processing...
                        </>
                      ) : (
                        <>
                          <span>
                            {paymentMethod === 'paystack'
                              ? 'Pay with Card'
                              : 'Pay with Mobile Money'}
                          </span>
                          <i className="ri-secure-payment-line"></i>
                        </>
                      )}
                    </button>
                  </div>
                </div>
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
              shippingLabel="Delivery"
              shippingNote={
                !(kmValue > 0)
                  ? 'Type your delivery area to see the delivery total.'
                  : null
              }
            />
          </div>
        </div>
      </div>
    </main>
  );
}
