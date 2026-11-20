'use client';

import { useCMS } from '@/context/CMSContext';

export default function CustomerExperience() {
  const { getSetting } = useCMS();
  const primaryPhone = getSetting('live_calls_phone_primary') || '+233 (0) 246 033 792';
  const secondaryPhone = getSetting('live_calls_phone_secondary') || '+233 (0) 579 033 792';
  const extendedPhone = getSetting('live_calls_phone_extended') || '+233 (0) 571 303 716';
  const infoEmail = getSetting('contact_email') || 'info@gsgbrands.com.gh';
  const shopperEmail = getSetting('shopper_contact_email') || 'shopper@gsgbrands.com.gh';

  const websites = [
    getSetting('website_goods') || 'www.goods.gsgbrands.com.gh',
    getSetting('website_shopper') || 'www.shopper.gsgbrands.com.gh',
    getSetting('website_sellbuysafe') || 'www.sellbuysafe.gsgbrands.com.gh',
    getSetting('website_courier') || 'www.courier.gsgbrands.com.gh',
    getSetting('website_cuisine') || 'www.cuisine.gsgbrands.com.gh',
  ];
  return (
    <div className="bg-gray-50 min-h-screen py-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h1 className="text-3xl md:text-5xl font-bold text-gsg-black mb-4">Customer Experience</h1>
          <p className="text-xl text-gray-600">We're here to help you with your personal shopping needs.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 mb-12">
          {/* Contact Info */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
            <h2 className="text-2xl font-bold text-gsg-black mb-6">Get in Touch</h2>
            
            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-purple-50 flex items-center justify-center shrink-0">
                  <i className="ri-phone-line text-gsg-purple text-xl"></i>
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">Live Calls Support Hours</h3>
                  <p className="text-gray-600 mt-1">
                    <a href={`tel:${primaryPhone.replace(/[^\d+]/g, '')}`} className="hover:text-gsg-purple block">{primaryPhone}</a>
                    <a href={`tel:${secondaryPhone.replace(/[^\d+]/g, '')}`} className="hover:text-gsg-purple block">{secondaryPhone}</a>
                    <a href={`tel:${extendedPhone.replace(/[^\d+]/g, '')}`} className="hover:text-gsg-purple block mt-2 text-sm text-gray-500">{extendedPhone} (Extended Hours)</a>
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center shrink-0">
                  <i className="ri-whatsapp-line text-green-600 text-xl"></i>
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">WhatsApp</h3>
                  <p className="text-gray-600 mt-1">
                    <a href="https://wa.me/233246033792" target="_blank" rel="noopener noreferrer" className="hover:text-green-600 block">+233 246 033 792</a>
                    <a href="https://wa.me/233579033792" target="_blank" rel="noopener noreferrer" className="hover:text-green-600 block">+233 579 033 792</a>
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                  <i className="ri-telegram-line text-blue-500 text-xl"></i>
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">Telegram</h3>
                  <p className="text-gray-600 mt-1">
                    <a href="https://t.me/gsgbrandsgh" target="_blank" rel="noopener noreferrer" className="hover:text-blue-500">@gsgbrandsgh</a>
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                  <i className="ri-mail-line text-gray-600 text-xl"></i>
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">Email</h3>
                  <p className="text-gray-600 mt-1">
                    <a href={`mailto:${infoEmail}`} className="hover:text-gsg-purple block">{infoEmail}</a>
                    <a href={`mailto:${shopperEmail}`} className="hover:text-gsg-purple block">{shopperEmail}</a>
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
                  <i className="ri-global-line text-amber-600 text-xl"></i>
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">Websites</h3>
                  <ul className="text-gray-600 mt-1 space-y-1 text-sm">
                    {websites.map((site) => (
                      <li key={site}>{site}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* Support Hours */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
            <h2 className="text-2xl font-bold text-gsg-black mb-6">Live Calls Support Hours</h2>
            
            <div className="space-y-6">
              <div>
                <h3 className="font-bold text-gsg-purple mb-2">Regular Hours ({primaryPhone}, {secondaryPhone})</h3>
                <ul className="space-y-2 text-gray-600">
                  <li className="flex justify-between">
                    <span>Mon - Fri:</span>
                    <span className="font-medium text-gray-900">05:00 - 14:00</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Sat & Holidays:</span>
                    <span className="font-medium text-gray-900">05:00 - 09:00</span>
                  </li>
                </ul>
              </div>

              <div className="pt-4 border-t border-gray-100">
                <h3 className="font-bold text-gsg-purple mb-2">Extended Hours ({extendedPhone})</h3>
                <ul className="space-y-2 text-gray-600">
                  <li className="flex justify-between">
                    <span>Mon - Fri:</span>
                    <span className="font-medium text-gray-900">14:01 - 18:00</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Sat & Holidays:</span>
                    <span className="font-medium text-gray-900">09:01 - 14:00</span>
                  </li>
                </ul>
              </div>

              <div className="bg-gray-50 p-4 rounded-xl mt-6">
                <p className="text-sm text-gray-600 text-center">
                  <strong>Note:</strong> You can message us on WhatsApp or Telegram at any time. We reply during the hours above.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
