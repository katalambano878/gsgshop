'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PHONE_PRIMARY_DISPLAY, PHONE_PRIMARY_TEL, whatsappLink } from '@/components/legal/business-facts';

const REF_RE = /^RET-[A-Z0-9]{4,32}$/;

function ConfirmationContent() {
  const searchParams = useSearchParams();
  const rawRef = (searchParams?.get('ref') || '').toUpperCase();
  const reference = REF_RE.test(rawRef) ? rawRef : '';
  const existing = searchParams?.get('existing') === '1';

  if (!reference) {
    return (
      <div className="bg-white rounded-xl shadow-lg p-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">No return request to show</h1>
        <p className="text-gray-600 mb-6">Start from the returns page to get a reference.</p>
        <Link
          href="/returns"
          className="inline-block bg-gsg-purple hover:bg-gsg-purple-dark text-white px-6 py-3 rounded-lg font-semibold transition-colors"
        >
          Report a problem
        </Link>
      </div>
    );
  }

  const waHref = whatsappLink(`Hi GSG, here are photos for return request ${reference}.`);

  return (
    <div className="bg-white rounded-xl shadow-lg p-8 text-center">
      <div className="w-20 h-20 flex items-center justify-center bg-purple-50 rounded-full mx-auto mb-6">
        <i className="ri-check-line text-4xl text-gsg-purple" aria-hidden="true"></i>
      </div>

      <h1 className="text-3xl font-bold text-gray-900 mb-4">
        {existing ? 'We already have your request' : 'Request received'}
      </h1>
      <p className="text-gray-600 mb-2">
        {existing
          ? 'There is already an open request for this order, so we did not create another one.'
          : 'We have your request. Our team will contact you to agree the next step.'}
      </p>
      <p className="text-sm text-gray-500 mb-8">
        Your reference: <span className="font-semibold text-gray-900">{reference}</span>
      </p>

      <div className="mb-8 p-6 bg-purple-50 border border-purple-100 rounded-xl text-left">
        <h2 className="font-bold text-gray-900 mb-3">What happens next</h2>
        <ul className="text-sm text-gray-700 space-y-2 list-disc pl-5">
          <li>
            <a href={waHref} target="_blank" rel="noopener noreferrer" className="font-semibold text-gsg-purple underline">Send us photos on WhatsApp</a>{' '}
            of the item and its packaging, quoting {reference}.
          </li>
          <li>Our team reviews your request and contacts you by phone, SMS or WhatsApp.</li>
          <li>Please keep the item and its packaging until we have spoken. There are no return labels to print.</li>
          <li>
            Questions? Call or WhatsApp <a href={`tel:${PHONE_PRIMARY_TEL}`} className="font-semibold text-gsg-purple underline">{PHONE_PRIMARY_DISPLAY}</a>.
          </li>
        </ul>
      </div>

      <div className="space-y-3">
        <Link
          href="/shop"
          className="block w-full bg-gsg-purple hover:bg-gsg-purple-dark text-white py-4 rounded-lg font-semibold transition-colors"
        >
          Continue shopping
        </Link>
        <Link
          href="/contact"
          className="block text-gsg-purple hover:text-gsg-purple-dark font-semibold"
        >
          Need help? Contact us
        </Link>
      </div>
    </div>
  );
}

export default function ReturnConfirmationPage() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center py-12">
      <div className="max-w-2xl w-full mx-auto px-4">
        <Suspense fallback={<div className="py-16 text-center text-gray-500">Loading…</div>}>
          <ConfirmationContent />
        </Suspense>
      </div>
    </main>
  );
}
