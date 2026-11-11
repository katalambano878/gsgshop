'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { trackPixelOnce } from '@/lib/meta-pixel';

type RequestSummary = {
  id: string;
  request_number: string;
  status: string;
  payment_status: string;
  total_final: number | null;
  contact_name: string | null;
};

function ShopperPaymentCompleteContent() {
  const searchParams = useSearchParams();
  const ref = searchParams.get('ref');
  const paymentSuccess = searchParams.get('payment_success');
  const gatewayReference = searchParams.get('reference') || searchParams.get('trxref');
  const providerHint = (searchParams.get('provider') || '').toLowerCase();

  const [request, setRequest] = useState<RequestSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  useEffect(() => {
    if (!ref) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/shopper/requests/${encodeURIComponent(ref)}/pay-info`);
        const data = await res.json();
        if (cancelled) return;
        if (res.ok) {
          setRequest({
            id: data.id,
            request_number: data.request_number,
            status: data.status,
            payment_status: data.payment_status,
            total_final: data.total_final,
            contact_name: data.contact_name,
          });

          if (paymentSuccess === 'true' && data.payment_status !== 'paid') {
            await verifyPayment(data.request_number);
          }
        } else if (paymentSuccess === 'true' && ref.startsWith('SR-')) {
          // Pay-info couldn't load (transient DB error, stale CDN, etc.) but
          // the gateway clearly told us the user just paid. Don't strand the
          // payment — fire verification directly with the SR- ref we have.
          await verifyPayment(ref);
          // Try one more pay-info read so we can render real numbers if
          // verification succeeded.
          try {
            const finalRes = await fetch(`/api/shopper/requests/${encodeURIComponent(ref)}/pay-info`);
            if (finalRes.ok) {
              const finalData = await finalRes.json();
              if (!cancelled) {
                setRequest({
                  id: finalData.id,
                  request_number: finalData.request_number,
                  status: finalData.status,
                  payment_status: finalData.payment_status,
                  total_final: finalData.total_final,
                  contact_name: finalData.contact_name,
                });
              }
            }
          } catch {
            /* ignore */
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);

  // Meta Pixel Purchase for a paid Personal Shopper request, once per request.
  useEffect(() => {
    if (!request?.request_number || request.payment_status !== 'paid') return;
    trackPixelOnce(
      request.request_number,
      'Purchase',
      {
        value: Number(request.total_final) || 0,
        currency: 'GHS',
        content_name: 'Personal Shopper request',
        content_category: 'personal_shopper',
      },
      request.request_number
    );
  }, [request?.request_number, request?.payment_status, request?.total_final]);

  async function verifyPayment(requestNumber: string) {
    setVerifying(true);
    setVerifyError(null);

    // Give the gateway webhook a head start — most of the time it fires
    // first and we can short-circuit by just re-reading the request.
    await new Promise((r) => setTimeout(r, 3000));

    try {
      const refreshedRes = await fetch(`/api/shopper/requests/${encodeURIComponent(requestNumber)}/pay-info`);
      const refreshed = await refreshedRes.json();
      if (refreshedRes.ok && refreshed.payment_status === 'paid') {
        setRequest({
          id: refreshed.id,
          request_number: refreshed.request_number,
          status: refreshed.status,
          payment_status: refreshed.payment_status,
          total_final: refreshed.total_final,
          contact_name: refreshed.contact_name,
        });
        setVerifying(false);
        return;
      }
    } catch {
      // Fall through to direct gateway verify
    }

    // Webhook hasn't landed yet — ask our backend to confirm with the gateway.
    const provider = providerHint === 'paystack' ? 'paystack' : 'moolre';
    const endpoint =
      provider === 'paystack' ? '/api/payment/paystack/verify' : '/api/payment/moolre/verify';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderNumber: requestNumber,
          reference: gatewayReference || undefined,
        }),
      });
      const result = await res.json();
      if (result.success && result.payment_status === 'paid') {
        // Pull fresh state for display.
        try {
          const finalRes = await fetch(`/api/shopper/requests/${encodeURIComponent(requestNumber)}/pay-info`);
          const finalData = await finalRes.json();
          if (finalRes.ok) {
            setRequest((prev) =>
              prev
                ? {
                    ...prev,
                    payment_status: 'paid',
                    status: finalData.status || prev.status,
                  }
                : prev,
            );
          }
        } catch {
          /* swallow */
        }
      } else {
        setVerifyError(result.message || 'We could not confirm your payment yet. It may take a moment to appear.');
      }
    } catch (err: any) {
      setVerifyError(err?.message || 'Verification request failed');
    } finally {
      setVerifying(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-gray-50 min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-gsg-purple border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!ref || !request) {
    return (
      <div className="bg-gray-50 min-h-screen py-16 px-4">
        <div className="max-w-xl mx-auto bg-white p-8 rounded-2xl shadow-sm border border-gray-100 text-center">
          <i className="ri-error-warning-line text-4xl text-red-500 mb-3 block" />
          <h1 className="text-2xl font-bold text-gsg-black mb-2">We couldn't find that request</h1>
          <p className="text-gray-600 mb-6">If you just paid, give it a moment and check the tracking page.</p>
          <Link href="/track" className="inline-block bg-gsg-purple text-white px-6 py-3 rounded-xl font-bold">
            Track Request
          </Link>
        </div>
      </div>
    );
  }

  const paid = request.payment_status === 'paid';
  const total = request.total_final ?? 0;

  return (
    <div className="bg-gray-50 min-h-screen py-12 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-100 p-8 md:p-10 text-center">
        {paid ? (
          <>
            <div className="w-20 h-20 mx-auto bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-4">
              <i className="ri-check-line text-4xl" />
            </div>
            <h1 className="text-3xl font-bold text-gsg-black mb-2">Payment received!</h1>
            <p className="text-gray-600 mb-6">
              Thanks{request.contact_name ? `, ${request.contact_name}` : ''}. Your personal shopper has been notified and will get started right away.
            </p>
          </>
        ) : verifying ? (
          <>
            <div className="w-20 h-20 mx-auto border-4 border-gsg-purple border-t-transparent rounded-full animate-spin mb-4" />
            <h1 className="text-3xl font-bold text-gsg-black mb-2">Confirming your payment…</h1>
            <p className="text-gray-600 mb-6">This usually takes a few seconds.</p>
          </>
        ) : (
          <>
            <div className="w-20 h-20 mx-auto bg-yellow-100 text-yellow-600 rounded-full flex items-center justify-center mb-4">
              <i className="ri-time-line text-4xl" />
            </div>
            <h1 className="text-3xl font-bold text-gsg-black mb-2">Payment pending</h1>
            <p className="text-gray-600 mb-2">
              We haven't received confirmation from the payment provider yet.
            </p>
            {verifyError && <p className="text-sm text-red-600 mb-4">{verifyError}</p>}
            <p className="text-gray-600 mb-6 text-sm">
              If your money has been deducted, give it a few minutes — it'll update automatically. You can also reload this page or check the tracking page.
            </p>
          </>
        )}

        <div className="bg-gray-50 rounded-xl p-5 mb-6 text-left text-sm">
          <div className="flex justify-between mb-1">
            <span className="text-gray-500">Request</span>
            <span className="font-mono font-medium">{request.request_number}</span>
          </div>
          <div className="flex justify-between mb-1">
            <span className="text-gray-500">Status</span>
            <span className="font-medium">{request.status.replace(/_/g, ' ')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Amount</span>
            <span className="font-bold text-gsg-purple">GH₵{total.toFixed(2)}</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href={`/track?id=${request.id}`}
            className="bg-gsg-black hover:bg-gsg-purple text-white px-6 py-3 rounded-xl font-bold transition-colors"
          >
            Track My Request
          </Link>
          {!paid && (
            <Link
              href={`/pay/${request.id}`}
              className="border-2 border-gray-200 hover:border-gray-300 text-gray-600 hover:text-gsg-black px-6 py-3 rounded-xl font-bold transition-colors"
            >
              Try Payment Again
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
