'use client';

import Link from 'next/link';
import { useState } from 'react';
import PageHero from '@/components/PageHero';

export default function ShippingPage() {
  const [selectedZone, setSelectedZone] = useState('');

  const deliveryOptions = [
    {
      id: 'pickup',
      type: 'Pickup',
      time: 'Within 72hrs (excl. Sunday)',
      cost: 'No delivery fee',
      description: 'Available after order confirmation. Pickup location will be displayed at the confirmation stage. Collect your items at your convenience within the pickup window.',
      icon: 'ri-store-2-line',
      highlight: false,
    },
    {
      id: 'free-delivery',
      type: 'Free Delivery',
      time: 'Tuesday & Friday only',
      cost: 'Calculated at checkout',
      description: 'Your delivery total is shown at checkout after you enter your address. Confirm before noon of the preceding delivery day.',
      icon: 'ri-truck-line',
      highlight: true,
    },
    {
      id: 'sole-express',
      type: 'Sole Express',
      time: 'Daily',
      cost: 'Calculated at checkout',
      description: 'Fresh produce, bakery, meat, frozen food, seafood, fish, and poultry MUST use Sole Express or Joint Express. Delivery within 2hr, 6hr, 12hr, 24hr, or 48hr after confirmation. Fee shown at checkout after you enter your address.',
      icon: 'ri-flashlight-line',
      highlight: false,
    },
    {
      id: 'joint-express',
      type: 'Joint Express',
      time: 'Daily',
      cost: 'Shared fee at checkout',
      description: 'Share the delivery fee with a neighbor or colleague — items remain completely private. Same perishable product rule applies. Available in 2hr, 6hr, 12hr, 24hr, or 48hr windows after confirmation.',
      icon: 'ri-group-line',
      highlight: false,
    },
    {
      id: 'personal-shopper',
      type: 'Add To Personal Shopper',
      time: 'Continue shopping after checkout',
      cost: 'Free delivery',
      description:
        'Select this option if you wish to continue shopping at Personal Shopper. Pay for your current cart, then visit Personal Shopper for additional shopping.',
      icon: 'ri-shopping-bag-3-line',
      highlight: false,
    },
  ];

  const zones = [
    {
      zone: 'Zone 1 — Accra Metro',
      areas: 'East Legon, Osu, Labone, Airport Residential, Dzorwulu, Cantonments, Adabraka, Tema',
      freeDelivery: 'Tue & Fri',
      express: '2hr–48hr windows',
    },
    {
      zone: 'Zone 2 — Greater Accra',
      areas: 'Madina, Legon, Haatso, Achimota, Dansoman, Spintex, Teshie, Kasoa',
      freeDelivery: 'Tue & Fri',
      express: '6hr–48hr windows',
    },
    {
      zone: 'Zone 3 — Major Cities',
      areas: 'Kumasi, Takoradi, Cape Coast, Tamale, Sunyani, Ho, Koforidua',
      freeDelivery: 'Fri only',
      express: '24hr–48hr windows',
    },
    {
      zone: 'Zone 4 — Other Areas',
      areas: 'All other locations within Ghana',
      freeDelivery: 'Contact us',
      express: 'Contact us',
    },
  ];

  const pickupLocations = [
    { name: 'GSG Hub — Accra Central', address: 'Exact address provided at confirmation', hours: 'Mon–Sat, 8am–6pm' },
    { name: 'GSG Hub — East Legon', address: 'Exact address provided at confirmation', hours: 'Mon–Sat, 9am–5pm' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHero
        title="Shipping & Delivery"
        subtitle="Pickup, Free Delivery (Tue/Fri), Sole Express, Joint Express, and Add To Personal Shopper — across Ghana."
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Delivery Options */}
        <div className="mb-20">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gsg-black mb-3">Delivery Options</h2>
            <p className="text-gray-500 max-w-2xl mx-auto">Choose the delivery method that works best for you. Perishable items require Express delivery for freshness.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
            {deliveryOptions.map((option) => (
              <div
                key={option.id}
                id={option.id}
                className={`scroll-mt-24 bg-white border p-8 rounded-2xl hover:shadow-xl transition-all group relative overflow-hidden ${
                  option.highlight ? 'border-gsg-purple ring-2 ring-gsg-purple/10' : 'border-gray-100 hover:border-gsg-purple'
                }`}
              >
                {option.highlight && (
                  <div className="absolute top-4 right-4">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gsg-purple text-white text-xs font-bold">
                      <i className="ri-star-fill text-[10px]"></i> Popular
                    </span>
                  </div>
                )}
                <div className="w-14 h-14 bg-purple-50 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-gsg-purple group-hover:text-white transition-colors text-gsg-purple">
                  <i className={`${option.icon} text-2xl`}></i>
                </div>
                <h3 className="text-xl font-bold text-gsg-black mb-2">{option.type}</h3>
                <div className="text-gsg-purple font-bold mb-2">{option.cost}</div>
                <div className="text-gray-500 font-medium mb-4 text-sm bg-gray-50 inline-block px-3 py-1 rounded-full">{option.time}</div>
                <p className="text-gray-600 leading-relaxed text-sm">{option.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Delivery total notice */}
        <div id="delivery-rates" className="scroll-mt-24 mb-20">
          <div className="bg-white border border-gray-100 rounded-2xl p-8 md:p-10 shadow-sm text-center max-w-3xl mx-auto">
            <div className="w-14 h-14 bg-purple-50 rounded-2xl flex items-center justify-center mx-auto mb-5 text-gsg-purple">
              <i className="ri-map-pin-line text-2xl" />
            </div>
            <h2 className="text-2xl font-bold text-gsg-black mb-3">Delivery Total at Checkout</h2>
            <p className="text-gray-600 leading-relaxed mb-6">
              Search your area or landmark at checkout — we calculate the distance from our Accra hub
              and show your delivery total before you pay.
            </p>
            <Link
              href="/checkout"
              className="inline-flex items-center gap-2 bg-gsg-purple text-white px-6 py-3 rounded-xl font-bold hover:bg-gsg-purple-dark transition-colors"
            >
              Go to Checkout
              <i className="ri-arrow-right-line" />
            </Link>
          </div>
        </div>

        {/* Zone Delivery Dropdown */}
        <div className="mb-20">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gsg-black mb-3">Delivery Zones & Timeframes</h2>
            <p className="text-gray-500 max-w-2xl mx-auto">Select your zone to see available delivery options and timeframes.</p>
          </div>

          <div className="max-w-md mx-auto mb-8">
            <select
              value={selectedZone}
              onChange={(e) => setSelectedZone(e.target.value)}
              className="w-full px-5 py-4 rounded-xl border-2 border-gray-200 bg-white text-gsg-black font-medium focus:border-gsg-purple focus:ring-2 focus:ring-gsg-purple/20 transition-all cursor-pointer appearance-none"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236B21A8' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 16px center' }}
            >
              <option value="">Select your delivery zone...</option>
              {zones.map((z, i) => (
                <option key={i} value={z.zone}>{z.zone}</option>
              ))}
            </select>
          </div>

          {selectedZone ? (
            <div className="max-w-2xl mx-auto animate-fade-in-up">
              {zones.filter(z => z.zone === selectedZone).map((zone) => (
                <div key={zone.zone} className="bg-white rounded-2xl border border-gray-100 p-8 shadow-sm">
                  <h3 className="text-xl font-bold text-gsg-black mb-4">{zone.zone}</h3>
                  <p className="text-gray-600 mb-6"><strong>Areas:</strong> {zone.areas}</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-green-50 rounded-xl p-4 text-center">
                      <p className="text-sm font-medium text-gray-500 mb-1">Free Delivery</p>
                      <p className="text-lg font-bold text-green-700">{zone.freeDelivery}</p>
                    </div>
                    <div className="bg-purple-50 rounded-xl p-4 text-center">
                      <p className="text-sm font-medium text-gray-500 mb-1">Express</p>
                      <p className="text-lg font-bold text-gsg-purple">{zone.express}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-8 py-5 text-left text-sm font-bold text-gsg-black uppercase tracking-wider">Zone</th>
                      <th className="px-8 py-5 text-left text-sm font-bold text-gsg-black uppercase tracking-wider">Areas Covered</th>
                      <th className="px-8 py-5 text-left text-sm font-bold text-gsg-black uppercase tracking-wider">Free Delivery</th>
                      <th className="px-8 py-5 text-left text-sm font-bold text-gsg-black uppercase tracking-wider">Express</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {zones.map((zone, index) => (
                      <tr key={index} className="hover:bg-purple-50/30 transition-colors">
                        <td className="px-8 py-6 font-bold text-gsg-black whitespace-nowrap">{zone.zone}</td>
                        <td className="px-8 py-6 text-gray-600 text-sm leading-relaxed">{zone.areas}</td>
                        <td className="px-8 py-6 text-green-700 font-medium">{zone.freeDelivery}</td>
                        <td className="px-8 py-6 text-gsg-purple font-medium">{zone.express}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Pickup Locations */}
        <div className="mb-20">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
            <h2 className="text-3xl font-bold text-gsg-black">Pickup Locations</h2>
            <p className="text-gray-500">Collect from your preferred hub after confirmation.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {pickupLocations.map((loc, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-8 shadow-sm hover:shadow-xl transition-all group">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-gsg-purple group-hover:text-white transition-colors">
                    <i className="ri-map-pin-2-fill text-xl text-gsg-purple group-hover:text-white"></i>
                  </div>
                  <div>
                    <h3 className="font-bold text-gsg-black mb-1 text-lg">{loc.name}</h3>
                    <p className="text-gray-500 text-sm mb-3">{loc.address}</p>
                    <div className="inline-flex items-center gap-1.5 text-sm text-gsg-purple font-semibold bg-purple-50 px-3 py-1 rounded-full">
                      <i className="ri-time-line"></i> {loc.hours}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* How Shipping Works + Important Information */}
        <div className="grid lg:grid-cols-5 gap-8 mb-20">
          <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-100 p-8 md:p-10 shadow-sm">
            <h2 className="text-3xl font-bold text-gsg-black mb-8">How Shipping Works</h2>
            <div className="space-y-6">
              {[
                {
                  step: '01',
                  title: 'Order Processing',
                  text: 'Orders confirmed before noon are processed same day. We inspect and pack items for safe transit.',
                },
                {
                  step: '02',
                  title: 'Dispatch',
                  text: 'Your order is dispatched via your selected method and tracking details are shared by email/SMS.',
                },
                {
                  step: '03',
                  title: 'Track in Real Time',
                  text: 'Use your order number to monitor status from confirmation through delivery.',
                },
                {
                  step: '04',
                  title: 'Final Delivery',
                  text: 'Our partner calls before arrival. Confirm receipt and enjoy your order.',
                },
              ].map((s) => (
                <div key={s.step} className="flex gap-4 group">
                  <div className="w-11 h-11 shrink-0 rounded-xl bg-gsg-purple/10 text-gsg-purple font-bold flex items-center justify-center group-hover:bg-gsg-purple group-hover:text-white transition-colors">
                    {s.step}
                  </div>
                  <div>
                    <h3 className="font-bold text-gsg-black mb-1.5 text-lg">{s.title}</h3>
                    <p className="text-gray-600">{s.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-2 bg-gradient-to-br from-white to-purple-50 rounded-2xl border border-purple-100 p-8 shadow-sm">
            <h2 className="text-2xl font-bold text-gsg-black mb-6">Important Information</h2>
            <div className="space-y-5">
              {[
                {
                  icon: 'ri-time-line',
                  title: 'Cut-off Times',
                  text: 'Orders confirmed before noon dispatch same day. After noon dispatch next business day.',
                },
                {
                  icon: 'ri-calendar-line',
                  title: 'Business Days',
                  text: 'Delivery windows exclude Sundays and public holidays. Processing is Monday to Saturday.',
                },
                {
                  icon: 'ri-phone-line',
                  title: 'Delivery Contact',
                  text: 'Keep your phone reachable during the delivery window for call-ahead coordination.',
                },
                {
                  icon: 'ri-home-line',
                  title: 'Failed Delivery Policy',
                  text: 'Two attempts are made. Afterward, orders are held for 5 business days at pickup.',
                },
                {
                  icon: 'ri-shield-check-line',
                  title: 'Package Security',
                  text: 'Report damage or missing items within 48 hours so we can resolve quickly.',
                },
              ].map((item) => (
                <div key={item.title} className="flex gap-3">
                  <div className="w-9 h-9 rounded-lg bg-white border border-purple-200 text-gsg-purple flex items-center justify-center shrink-0">
                    <i className={`${item.icon} text-lg`}></i>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gsg-black">{item.title}</h3>
                    <p className="text-sm text-gray-600 leading-relaxed">{item.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Order Tracking */}
        <div className="mb-20">
          <div className="bg-white border border-gray-100 rounded-2xl p-8 md:p-10 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
              <div>
                <h2 className="text-3xl font-bold text-gsg-black mb-2">Order Tracking</h2>
                <p className="text-gray-600 max-w-2xl">
                  Follow your order status from confirmation to final delivery in one view.
                </p>
              </div>
              <Link
                href="/order-tracking"
                className="inline-flex items-center gap-2 bg-gsg-purple text-white px-6 py-3 rounded-xl font-bold hover:bg-gsg-purple-dark transition-colors shadow-md w-fit"
              >
                <i className="ri-map-pin-line"></i>
                Track Your Order
              </Link>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { icon: 'ri-checkbox-circle-line', label: 'Confirmed' },
                { icon: 'ri-package-line', label: 'Processing' },
                { icon: 'ri-truck-line', label: 'Out for Delivery' },
                { icon: 'ri-check-double-line', label: 'Delivered' },
              ].map((step) => (
                <div key={step.label} className="rounded-xl border border-gray-100 bg-gray-50 p-5 text-center hover:border-gsg-purple/30 hover:bg-purple-50/40 transition-colors">
                  <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3 text-gsg-purple border border-purple-100">
                    <i className={`${step.icon} text-2xl`}></i>
                  </div>
                  <p className="font-semibold text-gsg-black text-sm">{step.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="bg-gsg-black rounded-2xl p-10 md:p-12 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-32 -mt-32"></div>
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full -ml-24 -mb-24"></div>
          <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-bold mb-3">Need Help with Your Delivery?</h2>
              <p className="text-gray-300 leading-relaxed text-lg">
                Questions about shipping costs, delivery windows, or tracking? Our support team is ready to help.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/contact"
                className="inline-flex items-center justify-center gap-2 bg-white text-gsg-black px-7 py-3.5 rounded-xl font-bold hover:bg-gray-100 transition-colors whitespace-nowrap"
              >
                Contact Support
              </Link>
              <Link
                href="/faqs"
                className="inline-flex items-center justify-center gap-2 bg-white/10 text-white px-7 py-3.5 rounded-xl font-bold hover:bg-white/20 transition-colors backdrop-blur-sm whitespace-nowrap border border-white/15"
              >
                View FAQs
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
