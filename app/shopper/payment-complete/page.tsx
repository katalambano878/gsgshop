'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { trackPixelOnce } from '@/lib/meta-pixel';
import {
  FINAL_AMOUNT_NOTE,
  authHeaders,
  getAccessToken,
  ghs,
  readJson,
  recallShopperPhone,
  statusLabel,
  toNumber,
} from '../_lib/shopper-client';

type Outcome = 'checking' | 'paid' | 'pending' | 'failed' | 'error';

type Summary = {
  id: string | null;
  request_number: string;
  status: string | null;
  total_final: number | null;
  contact_name: string | null;
};

type VerifyResult = { paid: boolean; payment_status: string | null; status: string | null; reachable: boolean };

const SR_RE = /^SR-[A-Z0-9-]{3,40}$/;

async function verifyWith(provider: 'moolre' | 'paystack', requestNumber: string): Promise<VerifyResult> {
  try {
    const res = await fetch(`/api/payment/${provider}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestNumber }),
      cache: 'no-store',
    });
    const data = await readJson(res);
    const paymentStatus = typeof data?.payment_status === 'string' ? data.payment_status : null;
    return {
      paid: data?.success === true && (paymentStatus || '').toLowerCase() === 'paid',
      payment_status: paymentStatus,
      status: typeof data?.status === 'string' ? data.status : null,
      reachable: res.status < 500,
    };
  } catch {
    return { paid: false, payment_status: null, status: null, reachable: false };
  }
}

function ShopperPaymentCompleteContent() {
  const searchParams = useSearchParams();
  const ref = (searchParams.get('ref') || searchParams.get('request') || searchParams.get('order') || '')
    .trim()
    .toUpperCase();
  const providerHint = (searchParams.get('provider') || '').toLowerCase();

  const [outcome, setOutcome] = useState<Outcome>('checking');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!ref || !SR_RE.test(ref)) {
      setOutcome('error');
      return;
    }

    let cancelled = false;
    setOutcome('checking');

    (async () => {
      // Details for display, when this browser can prove the request is theirs.
      const token = await getAccessToken();
      const phone = recallShopperPhone(ref);
      if (token || phone) {
        try {
          const qs = phone ? `?phone=${encodeURIComponent(phone)}` : '';
          const res = await fetch(`/api/shopper/requests/${encodeURIComponent(ref)}/pay-info${qs}`, {
            headers: authHeaders(token),
            cache: 'no-store',
          });
          if (res.ok) {
            const data = await readJson(res);
            if (!cancelled) {
              setSummary({
                id: typeof data?.id === 'string' ? data.id : null,
                request_number: String(data?.request_number || ref),
                status: typeof data?.status === 'string' ? data.status : null,
                total_final: toNumber(data?.total_final),
                contact_name: typeof data?.contact_name === 'string' ? data.contact_name : null,
              });
            }
          }
        } catch {
          /* details are optional */
        }
      }

      // The real payment status, from our server asking the gateway about
      // this request's own last payment. The return URL proves nothing.
      const providers: Array<'moolre' | 'paystack'> =
        providerHint === 'paystack'
          ? ['paystack']
          : providerHint === 'moolre'
            ? ['moolre']
            : ['moolre', 'paystack'];

      const delays = [0, 3000, 6000];
      let last: VerifyResult | null = null;
      for (const delay of delays) {
        if (delay) await new Promise((r) => setTimeout(r, delay));
        if (cancelled) return;
        for (const p of providers) {
          const result = await verifyWith(p, ref);
          if (result.reachable || !last) last = result;
          if (result.paid) {
            last = result;
            break;
          }
        }
        if (last?.paid) break;
        const ps = (last?.payment_status || '').toLowerCase();
        if (providers.length === 1 && (ps === 'failed' || ps === 'cancelled')) break;
      }
      if (cancelled) return;

      if (last?.status) {
        setSummary((prev) => (prev ? { ...prev, status: last!.status } : prev));
      }
      if (last?.paid) setOutcome('paid');
      else if (!last?.reachable) setOutcome('error');
      else {
        const ps = (last.payment_status || '').toLowerCase();
        const definite = providers.length === 1 && (ps === 'failed' || ps === 'cancelled');
        setOutcome(definite ? 'failed' : 'pending');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ref, providerHint, attempt]);

  // Meta Pixel Purchase for a paid Personal Shopper request, once per request.
  useEffect(() => {
    if (outcome !== 'paid' || !ref) return;
    trackPixelOnce(
      ref,
      'Purchase',
      {
        value: summary?.total_final ?? 0,
        currency: 'GHS',
        content_name: 'Personal Shopper request',
        content_category: 'personal_shopper',
      },
      ref,
    );
  }, [outcome, ref, summary?.total_final]);

  if (!ref || !SR_RE.test(ref)) {
    return (
      <div className="bg-gray-50 min-h-screen py-16 px-4">
        <div className="max-w-xl mx-auto bg-white p-8 rounded-2xl shadow-sm border border-gray-100 text-center">
          <i className="ri-error-warning-line text-4xl text-red-500 mb-3 block" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-gsg-black mb-2">We couldn't find that request</h1>
          <p className="text-gray-600 mb-6">If you just paid, check the tracking page with your request number and phone.</p>
          <Link href="/shopper/track" className="inline-block bg-gsg-purple text-white px-6 py-3 rounded-xl font-bold">
            Track Request
          </Link>
        </div>
      </div>
    );
  }

  const trackHref = `/shopper/track?ref=${encodeURIComponent(ref)}`;
  const payHref = `/shopper/pay/${encodeURIComponent(summary?.id || ref)}`;

  return (
    <div className="bg-gray-50 min-h-screen py-12 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-100 p-8 md:p-10 text-center" aria-live="polite">
        {outcome === 'paid' ? (
          <>
            <div className="w-20 h-20 mx-auto bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-4" aria-hidden="true">
              <i className="ri-check-line text-4xl" />
            </div>
            <h1 className="text-3xl font-bold text-gsg-black mb-2">Payment received</h1>
            <p className="text-gray-600 mb-2">
              Thanks{summary?.contact_name ? `, ${summary.contact_name}` : ''}. Your request is with our shopping team, and updates come by SMS and WhatsApp.
            </p>
            <p className="text-xs text-gray-500 mb-6">{FINAL_AMOUNT_NOTE}</p>
          </>
        ) : outcome === 'checking' ? (
          <>
            <div className="w-20 h-20 mx-auto border-4 border-gsg-purple border-t-transparent rounded-full animate-spin mb-4" aria-hidden="true" />
            <h1 className="text-3xl font-bold text-gsg-black mb-2">Confirming your payment…</h1>
            <p className="text-gray-600 mb-6">This usually takes a few seconds.</p>
          </>
        ) : outcome === 'failed' ? (
          <>
            <div className="w-20 h-20 mx-auto bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4" aria-hidden="true">
              <i className="ri-close-line text-4xl" />
            </div>
            <h1 className="text-3xl font-bold text-gsg-black mb-2">Payment not completed</h1>
            <p className="text-gray-600 mb-6">
              The payment provider did not confirm this payment. You can try again with Mobile Money or card.
            </p>
          </>
        ) : (
          <>
            <div className="w-20 h-20 mx-auto bg-yellow-100 text-yellow-600 rounded-full flex items-center justify-center mb-4" aria-hidden="true">
              <i className="ri-time-line text-4xl" />
            </div>
            <h1 className="text-3xl font-bold text-gsg-black mb-2">Payment not confirmed yet</h1>
            <p className="text-gray-600 mb-2">
              {outcome === 'error'
                ? 'We could not reach the payment check just now.'
                : "We haven't received confirmation from the payment provider yet."}
            </p>
            <p className="text-gray-600 mb-6 text-sm">
              If money has left your account, wait a few minutes and check again. Do not pay twice: message us on WhatsApp if it still shows as unpaid.
            </p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="mb-6 inline-flex items-center gap-2 border-2 border-gray-200 hover:border-gsg-purple text-gsg-black px-5 py-2.5 rounded-xl font-bold"
            >
              <i className="ri-refresh-line" aria-hidden="true" /> Check again
            </button>
          </>
        )}

        <div className="bg-gray-50 rounded-xl p-5 mb-6 text-left text-sm">
          <div className="flex justify-between mb-1">
            <span className="text-gray-500">Request</span>
            <span className="font-mono font-medium">{summary?.request_number || ref}</span>
          </div>
          {summary?.status && (
            <div className="flex justify-between mb-1">
              <span className="text-gray-500">Status</span>
              <span className="font-medium">{statusLabel(summary.status)}</span>
            </div>
          )}
          {summary?.total_final !== null && summary?.total_final !== undefined && (
            <div className="flex justify-between">
              <span className="text-gray-500">Amount</span>
              <span className="font-bold text-gsg-purple">{ghs(summary.total_final)}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href={trackHref}
            className="bg-gsg-black hover:bg-gsg-purple text-white px-6 py-3 rounded-xl font-bold transition-colors"
          >
            Track My Request
          </Link>
          {(outcome === 'failed' || outcome === 'pending' || outcome === 'error') && (
            <Link
              href={payHref}
              className="border-2 border-gray-200 hover:border-gray-300 text-gray-600 hover:text-gsg-black px-6 py-3 rounded-xl font-bold transition-colors"
            >
              {outcome === 'failed' ? 'Try Payment Again' : 'Go to payment page'}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ShopperPaymentCompletePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-12 h-12 border-4 border-gsg-purple border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <ShopperPaymentCompleteContent />
    </Suspense>
  );
}
