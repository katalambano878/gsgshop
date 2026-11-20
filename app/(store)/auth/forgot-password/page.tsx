import Link from 'next/link';
import type { Metadata } from 'next';
import {
  PHONE_PRIMARY_DISPLAY,
  PHONE_PRIMARY_TEL,
  PHONE_SECONDARY_DISPLAY,
  PHONE_SECONDARY_TEL,
  HOURS_SUMMARY,
  whatsappLink,
} from '@/components/legal/business-facts';

export const metadata: Metadata = {
  title: 'Forgot your password?',
  robots: { index: false, follow: true },
};

/**
 * The shop cannot send email, so there is no reset link. A member of staff
 * resets the password after checking who the customer is.
 */
export default function ForgotPasswordPage() {
  const waHref = whatsappLink("Hi GSG, I've forgotten my account password. My account email is: ");

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gsg-black mb-2">Forgot your password?</h1>
          <p className="text-gray-500">We reset passwords by WhatsApp or phone.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <ol className="space-y-4 text-gray-700 mb-8 list-decimal pl-5">
            <li>Message us on WhatsApp or call us, and tell us the email address you use to sign in.</li>
            <li>We check that the account is yours, for example with the phone number or a recent order on it.</li>
            <li>Our team helps you back into your account. Once you are signed in, you can choose a new password under My Account.</li>
          </ol>

          <div className="space-y-3">
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#1ebe5b] text-white py-4 rounded-xl font-bold transition-colors"
            >
              <i className="ri-whatsapp-line text-xl" aria-hidden="true"></i>
              WhatsApp us
            </a>
            <a
              href={`tel:${PHONE_PRIMARY_TEL}`}
              className="w-full flex items-center justify-center gap-2 border-2 border-gray-200 hover:border-gsg-purple text-gsg-black py-4 rounded-xl font-bold transition-colors"
            >
              <i className="ri-phone-line text-xl" aria-hidden="true"></i>
              Call {PHONE_PRIMARY_DISPLAY}
            </a>
            <p className="text-sm text-gray-500 text-center">
              Or call <a href={`tel:${PHONE_SECONDARY_TEL}`} className="font-semibold text-gsg-purple hover:underline">{PHONE_SECONDARY_DISPLAY}</a>. {HOURS_SUMMARY}.
            </p>
          </div>

          <p className="mt-8 text-sm text-gray-500 text-center">
            We will never ask for your current password, or for a Mobile Money PIN or card details.
          </p>

          <p className="mt-6 text-center text-gray-600 text-sm">
            Remembered it?{' '}
            <Link href="/auth/login" className="text-gsg-purple hover:text-gsg-purple-dark font-bold hover:underline">
              Sign in
            </Link>
          </p>
        </div>

        <div className="mt-8 text-center">
          <Link href="/" className="text-gray-500 hover:text-gsg-black font-medium inline-flex items-center transition-colors">
            <i className="ri-arrow-left-line mr-2" aria-hidden="true"></i>
            Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}
