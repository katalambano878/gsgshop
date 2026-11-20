import type { Metadata } from 'next';
import { CONTACT_EMAIL, PHONE_PRIMARY_TEL, TELEGRAM_URL, WHATSAPP_URL } from '@/components/legal/business-facts';

export const metadata: Metadata = {
  title: 'Down for maintenance',
  robots: { index: false, follow: false },
};

export default function MaintenancePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-amber-50 flex items-center justify-center px-4">
      <div className="max-w-2xl mx-auto text-center">
        <div className="mb-8">
          <div className="w-32 h-32 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <i className="ri-tools-line text-6xl text-blue-700"></i>
          </div>
          <h1 className="text-5xl font-bold text-gray-900 mb-6">
            We'll Be Right Back
          </h1>
          <p className="text-xl text-gray-600 mb-8 leading-relaxed">
            We're doing some maintenance on the shop and will be back online as soon as we can.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="ri-rocket-line text-2xl text-blue-700"></i>
            </div>
            <h3 className="font-bold text-gray-900 mb-2">Performance</h3>
            <p className="text-gray-600 text-sm">Faster loading times and smoother navigation</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="ri-shield-check-line text-2xl text-blue-700"></i>
            </div>
            <h3 className="font-bold text-gray-900 mb-2">Security</h3>
            <p className="text-gray-600 text-sm">Enhanced protection for your data and transactions</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="ri-sparkle-line text-2xl text-amber-700"></i>
            </div>
            <h3 className="font-bold text-gray-900 mb-2">Features</h3>
            <p className="text-gray-600 text-sm">New functionality to enhance your experience</p>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-8 mb-8">
          <h3 className="text-xl font-bold text-gray-900 mb-4">Need Immediate Assistance?</h3>
          <p className="text-gray-600 mb-6">
            Our team is still available during opening hours. WhatsApp is the quickest way to reach us.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="inline-flex items-center gap-2 bg-white text-gray-900 px-6 py-3 rounded-full font-medium hover:bg-gray-50 transition-colors border border-gray-200 whitespace-nowrap"
            >
              <i className="ri-mail-line"></i>
              Email Us
            </a>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-blue-700 text-white px-6 py-3 rounded-full font-medium hover:bg-blue-800 transition-colors whitespace-nowrap"
            >
              <i className="ri-whatsapp-line"></i>
              WhatsApp
            </a>
            <a
              href={`tel:${PHONE_PRIMARY_TEL}`}
              className="inline-flex items-center gap-2 bg-white text-gray-900 px-6 py-3 rounded-full font-medium hover:bg-gray-50 transition-colors border border-gray-200 whitespace-nowrap"
            >
              <i className="ri-phone-line"></i>
              Call Us
            </a>
          </div>
        </div>

        <div className="text-gray-500 text-sm">
          <p className="mb-2">Thank you for your patience.</p>
          <p>
            For updates, message us on{' '}
            <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" className="text-gsg-purple font-semibold hover:underline">Telegram</a>
            {' '}or <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="text-gsg-purple font-semibold hover:underline">WhatsApp</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
