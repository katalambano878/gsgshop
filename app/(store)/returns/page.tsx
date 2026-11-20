'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  PHONE_PRIMARY_DISPLAY,
  PHONE_PRIMARY_TEL,
  RETURN_WINDOW_HOURS,
  whatsappLink,
} from '@/components/legal/business-facts';
import { RETURN_REASONS } from '@/app/api/storefront/_lib/return-reasons';

const REASONS = RETURN_REASONS;

type FoundOrder = {
  orderNumber: string;
  createdAt: string;
  items: { name: string; variant?: string | null; quantity: number }[];
};

/** Accepts the route's order shape in either snake_case or camelCase. */
function readOrder(raw: any): FoundOrder | null {
  if (!raw || typeof raw !== 'object') return null;
  const items = Array.isArray(raw.items) ? raw.items : [];
  return {
    orderNumber: String(raw.order_number ?? raw.orderNumber ?? ''),
    createdAt: String(raw.created_at ?? raw.createdAt ?? ''),
    items: items.map((i: any) => ({
      name: String(i.product_name ?? i.name ?? 'Item'),
      variant: i.variant_name ?? i.variant ?? null,
      quantity: Number(i.quantity) || 1,
    })),
  };
}

const inputCls =
  'w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-gsg-purple/20 focus:border-gsg-purple outline-none';

export default function ReturnsPortalPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [orderNumber, setOrderNumber] = useState('');
  const [contactType, setContactType] = useState<'phone' | 'email'>('phone');
  const [contact, setContact] = useState('');
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [foundOrder, setFoundOrder] = useState<FoundOrder | null>(null);

  const requestBody = (extra: Record<string, unknown>) => ({
    orderNumber: orderNumber.trim(),
    ...(contactType === 'email' ? { email: contact.trim() } : { phone: contact.trim() }),
    ...extra,
  });

  const handleFindOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const res = await fetch('/api/storefront/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody({ lookupOnly: true })),
      });
      const data = await res.json().catch(() => ({}));
      const order = res.ok ? readOrder(data.order) : null;
      if (!order) {
        setError(data.error || data.message || 'We could not find that order. Check the order number and the phone or email used on it.');
        return;
      }
      setFoundOrder(order);
      setStep(2);
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const res = await fetch('/api/storefront/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody({ reason, description: description.trim() })),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.reference) {
        setError(data.error || data.message || 'We could not send your request. Please try again, or WhatsApp us.');
        return;
      }
      router.push(`/returns/confirmation?ref=${encodeURIComponent(data.reference)}${data.duplicate ? '&existing=1' : ''}`);
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const steps = ['Find order', 'Tell us why', 'Done'];
  const waHref = whatsappLink(
    foundOrder ? `Hi GSG, I have a problem with order ${foundOrder.orderNumber}. Photos attached.` : 'Hi GSG, I have a problem with my order. Photos attached.'
  );

  return (
    <main className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-gsg-black mb-2">Returns and order problems</h1>
        <p className="text-gray-600 mb-8">
          Something wrong with your order? Tell us within {RETURN_WINDOW_HOURS} hours of delivery and we will sort it out with you.
        </p>

        <ol className="mb-8 flex items-center" aria-label="Progress">
          {steps.map((label, idx) => {
            const i = idx + 1;
            return (
              <li key={label} className="flex items-center flex-1 last:flex-none" aria-current={i === step ? 'step' : undefined}>
                <div className="flex flex-col items-center gap-1">
                  <div className={`w-10 h-10 flex items-center justify-center rounded-full font-bold ${i <= step ? 'bg-gsg-purple text-white' : 'bg-gray-200 text-gray-500'}`}>
                    {i < step ? <i className="ri-check-line" aria-hidden="true"></i> : i}
                  </div>
                  <span className="text-xs sm:text-sm font-semibold text-gray-900 whitespace-nowrap">{label}</span>
                </div>
                {i < steps.length && (
                  <div className={`flex-1 h-1 mx-2 sm:mx-4 mb-6 ${i < step ? 'bg-gsg-purple' : 'bg-gray-200'}`}></div>
                )}
              </li>
            );
          })}
        </ol>

        {error && (
          <div role="alert" className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-start gap-2">
            <i className="ri-error-warning-line mt-0.5" aria-hidden="true"></i>
            <span>{error}</span>
          </div>
        )}

        {step === 1 && (
          <div className="bg-white rounded-xl shadow-sm p-6 sm:p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Find your order</h2>
            <form onSubmit={handleFindOrder} className="space-y-6">
              <div>
                <label htmlFor="return-order" className="block text-sm font-semibold text-gray-900 mb-2">
                  Order number *
                </label>
                <input
                  id="return-order"
                  type="text"
                  value={orderNumber}
                  onChange={(e) => setOrderNumber(e.target.value)}
                  className={inputCls}
                  placeholder="As shown in your order SMS or receipt"
                  autoComplete="off"
                  required
                />
              </div>

              <fieldset>
                <legend className="block text-sm font-semibold text-gray-900 mb-2">Phone or email used on the order *</legend>
                <div className="flex gap-2 mb-3">
                  {(['phone', 'email'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      aria-pressed={contactType === type}
                      onClick={() => { setContactType(type); setContact(''); }}
                      className={`px-4 py-2 rounded-lg border-2 text-sm font-semibold transition-colors ${contactType === type ? 'border-gsg-purple bg-purple-50 text-gsg-purple' : 'border-gray-300 text-gray-700 hover:border-gray-400'}`}
                    >
                      {type === 'email' ? 'Email' : 'Phone'}
                    </button>
                  ))}
                </div>
                <label htmlFor="return-contact" className="sr-only">
                  {contactType === 'email' ? 'Email address' : 'Phone number'}
                </label>
                <input
                  id="return-contact"
                  type={contactType === 'email' ? 'email' : 'tel'}
                  inputMode={contactType === 'email' ? 'email' : 'tel'}
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  className={inputCls}
                  placeholder={contactType === 'email' ? 'you@example.com' : '024 XXX XXXX'}
                  autoComplete={contactType === 'email' ? 'email' : 'tel'}
                  required
                />
              </fieldset>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-gsg-purple hover:bg-gsg-purple-dark text-white py-4 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Checking your order…' : 'Find order'}
              </button>
            </form>

            <div className="mt-8 p-4 bg-purple-50 border border-purple-100 rounded-lg">
              <div className="flex items-start space-x-3">
                <i className="ri-information-line text-xl text-gsg-purple mt-0.5" aria-hidden="true"></i>
                <div className="text-sm text-gray-800">
                  <p className="font-semibold mb-1">How it works</p>
                  <ul className="space-y-1 list-disc pl-4">
                    <li>Report a problem within {RETURN_WINDOW_HOURS} hours of delivery, with this form or on WhatsApp.</li>
                    <li>Send us clear photos of the item and its packaging on WhatsApp, quoting your order number.</li>
                    <li>Keep the item and its packaging. Do not send anything back until we have agreed the next step with you.</li>
                    <li>We contact you by phone, SMS or WhatsApp. There are no return labels.</li>
                    <li>
                      Full terms: <Link href="/terms#cancellations-returns" className="font-semibold underline">Terms &amp; Conditions</Link>. Questions? Call or WhatsApp{' '}
                      <a href={`tel:${PHONE_PRIMARY_TEL}`} className="font-semibold underline">{PHONE_PRIMARY_DISPLAY}</a>.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 2 && foundOrder && (
          <form onSubmit={handleSubmitReturn} className="bg-white rounded-xl shadow-sm p-6 sm:p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Tell us what went wrong</h2>

            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600 mb-2">
                Order {foundOrder.orderNumber}
                {foundOrder.createdAt && !Number.isNaN(new Date(foundOrder.createdAt).getTime()) && (
                  <> · placed {new Date(foundOrder.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</>
                )}
              </p>
              <ul className="text-sm text-gray-900 space-y-1">
                {foundOrder.items.map((item, i) => (
                  <li key={i}>{item.name}{item.variant ? ` (${item.variant})` : ''} × {item.quantity}</li>
                ))}
              </ul>
            </div>

            <div className="mb-6">
              <label htmlFor="return-reason" className="block text-sm font-semibold text-gray-900 mb-2">
                Reason *
              </label>
              <select
                id="return-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={`${inputCls} pr-8 bg-white`}
                required
              >
                <option value="">Choose a reason</option>
                {REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div className="mb-6">
              <label htmlFor="return-description" className="block text-sm font-semibold text-gray-900 mb-2">
                Which item, and what happened? *
              </label>
              <textarea
                id="return-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                maxLength={2000}
                minLength={5}
                className={inputCls}
                placeholder="For example: one of the egg trays arrived cracked."
                required
              />
            </div>

            <p className="mb-8 text-sm text-gray-600">
              Photos help us decide quickly. After sending this form,{' '}
              <a href={waHref} target="_blank" rel="noopener noreferrer" className="font-semibold text-gsg-purple underline">
                send photos on WhatsApp
              </a>{' '}
              with your order number.
            </p>

            <div className="flex flex-col-reverse sm:flex-row gap-3 sm:gap-4">
              <button
                type="button"
                onClick={() => { setStep(1); setError(''); }}
                className="flex-1 py-4 border-2 border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={isLoading || !reason || description.trim().length < 5}
                className="flex-1 py-4 bg-gsg-purple hover:bg-gsg-purple-dark text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Sending…' : 'Send request'}
              </button>
            </div>
          </form>
        )}

        <p className="mt-8 text-sm text-gray-600 text-center">
          Want to check where an order is instead? <Link href="/order-tracking" className="text-gsg-purple font-semibold hover:underline">Track your order</Link>
        </p>
      </div>
    </main>
  );
}
