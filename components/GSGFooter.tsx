'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { getShopperBaseUrl, goodsUrl, shopperUrl } from '@/lib/site-urls';
import {
  CONTACT_EMAIL,
  PHONE_PRIMARY_DISPLAY,
  PHONE_PRIMARY_TEL,
  PHONE_SECONDARY_DISPLAY,
  PHONE_SECONDARY_TEL,
  TELEGRAM_URL,
  WHATSAPP_URL,
} from '@/components/legal/business-facts';

const SUPPORT_PHONES = [
  { display: PHONE_PRIMARY_DISPLAY, tel: PHONE_PRIMARY_TEL },
  { display: PHONE_SECONDARY_DISPLAY, tel: PHONE_SECONDARY_TEL },
];

/** True when the page is served from the Personal Shopper host. */
function useOnShopperHost(): boolean {
  const [onShopper, setOnShopper] = useState(false);
  useEffect(() => {
    const host = window.location.hostname;
    let shopperHost = '';
    try {
      shopperHost = new URL(getShopperBaseUrl()).hostname;
    } catch {
      /* ignore */
    }
    setOnShopper(host === shopperHost || host.startsWith('shopper.'));
  }, []);
  return onShopper;
}

/**
 * A link to a goods-storefront page. On the shopper host those paths do not
 * exist, so the link goes to the goods host instead.
 */
function GoodsLink({ path, onShopper, className, children }: { path: string; onShopper: boolean; className?: string; children: React.ReactNode }) {
  if (onShopper) {
    return <a href={goodsUrl(path)} className={className}>{children}</a>;
  }
  return <Link href={path} className={className}>{children}</Link>;
}

function NewsletterForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!/\S+@\S+\.\S+/.test(value)) {
      setState('error');
      setMessage('Please enter a valid email address.');
      return;
    }
    setState('sending');
    setMessage('');
    try {
      const res = await fetch('/api/storefront/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value, source: 'footer' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState('error');
        setMessage(data.error || data.message || 'We could not add your email. Please try again.');
        return;
      }
      setState('done');
      setMessage('Thank you, your email has been added to our list.');
      setEmail('');
    } catch {
      setState('error');
      setMessage('Network error. Please try again.');
    }
  };

  return (
    <>
      <form className="flex gap-2" onSubmit={onSubmit} noValidate>
        <label htmlFor="footer-newsletter-email" className="sr-only">Email address</label>
        <input
          id="footer-newsletter-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your email"
          className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-gsg-purple focus:ring-1 focus:ring-gsg-purple transition-all"
        />
        <button
          type="submit"
          disabled={state === 'sending'}
          className="bg-gsg-purple text-white px-6 py-3 rounded-lg text-sm font-bold hover:bg-gsg-purple-dark transition-colors disabled:opacity-60"
        >
          {state === 'sending' ? 'Joining…' : 'Join'}
        </button>
      </form>
      {message && (
        <p role={state === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${state === 'error' ? 'text-red-300' : 'text-green-300'}`}>
          {message}
        </p>
      )}
    </>
  );
}

const BUSINESS_UNITS = [
  { name: 'Convenience Goods & More', icon: 'ri-shopping-cart-2-line' },
  { name: 'My Personal Shopper', icon: 'ri-vip-crown-line' },
  { name: 'Sell-Safe Buy-Safe', icon: 'ri-shield-check-line' },
  { name: 'StreetCuisine', icon: 'ri-restaurant-line' },
  { name: 'Courier', icon: 'ri-truck-line' },
  { name: 'Affiliates', icon: 'ri-links-line' },
];

export default function GSGFooter() {
  const currentYear = new Date().getFullYear();
  const onShopper = useOnShopperHost();

  return (
    <footer className="bg-gsg-black text-white pt-16 pb-8 border-t border-gray-800 print:hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Top Section */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 mb-16">
          {/* Brand */}
          <div className="lg:col-span-4">
            <GoodsLink path="/" onShopper={onShopper} className="inline-block mb-6">
              <div className="flex items-center">
                <div className="flex flex-col">
                  <div className="relative w-[82px] h-[28px]">
                    <Image src="/fgfg.png" alt="GSG Wordmark" fill className="object-contain object-left" />
                  </div>
                  <span className="text-xs font-medium text-gray-400 uppercase tracking-wider leading-none">Convenience Goods & More</span>
                </div>
              </div>
            </GoodsLink>
            <p className="text-gray-400 text-sm leading-relaxed mb-6 max-w-sm">
              Groceries, household goods and everyday essentials from Accra. Pickup or delivery in and around the city, paid online by Mobile Money or card.
            </p>
            <div className="flex gap-4 mb-6">
              <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-gsg-purple hover:scale-110 transition-all duration-300" aria-label="GSG on Telegram">
                <i className="ri-telegram-fill text-xl" aria-hidden="true" />
              </a>
              <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-gsg-purple hover:scale-110 transition-all duration-300" aria-label="GSG on WhatsApp">
                <i className="ri-whatsapp-line text-xl" aria-hidden="true" />
              </a>
            </div>
          </div>

          {/* Shop Links */}
          <div className="lg:col-span-2">
            <h3 className="font-bold text-lg text-white mb-6">Shop</h3>
            <ul className="space-y-4 text-sm text-gray-400">
              <li><GoodsLink path="/shop" onShopper={onShopper} className="hover:text-gsg-accent transition-colors">All Products</GoodsLink></li>
              <li><GoodsLink path="/categories" onShopper={onShopper} className="hover:text-gsg-accent transition-colors">Categories</GoodsLink></li>
              <li><GoodsLink path="/shipping#sole-express" onShopper={onShopper} className="hover:text-gsg-accent transition-colors">Sole Express</GoodsLink></li>
              <li><a href={shopperUrl('/')} className="hover:text-gsg-accent transition-colors">Personal Shopper</a></li>
            </ul>
          </div>

          {/* Support Links */}
          <div className="lg:col-span-2">
            <h3 className="font-bold text-lg text-white mb-6">Support</h3>
            <ul className="space-y-4 text-sm text-gray-400">
              <li><GoodsLink path="/order-tracking" onShopper={onShopper} className="hover:text-gsg-accent transition-colors">Track Order</GoodsLink></li>
              <li><GoodsLink path="/account" onShopper={onShopper} className="hover:text-gsg-accent transition-colors">My Account</GoodsLink></li>
              <li><GoodsLink path="/help" onShopper={onShopper} className="hover:text-gsg-accent transition-colors">Help Center</GoodsLink></li>
              <li><GoodsLink path="/shipping" onShopper={onShopper} className="hover:text-gsg-accent transition-colors">Shipping & Delivery</GoodsLink></li>
              <li><GoodsLink path="/returns" onShopper={onShopper} className="hover:text-gsg-accent transition-colors">Returns</GoodsLink></li>
              <li><GoodsLink path="/contact" onShopper={onShopper} className="hover:text-gsg-accent transition-colors">Contact Us</GoodsLink></li>
            </ul>
          </div>

          {/* Newsletter + Payment */}
          <div className="lg:col-span-4">
            <h3 className="font-bold text-lg text-white mb-6">Stay Updated</h3>
            <p className="text-gray-400 text-sm mb-4">Leave your email to hear about new products and offers.</p>
            <NewsletterForm />
            <div className="mt-6">
              <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wider">We Accept</p>
              <div className="flex gap-3 opacity-70 grayscale hover:grayscale-0 transition-all duration-500">
                <div className="h-8 w-12 bg-white rounded flex items-center justify-center" title="Visa"><i className="ri-visa-line text-2xl text-blue-900" aria-hidden="true" /><span className="sr-only">Visa</span></div>
                <div className="h-8 w-12 bg-white rounded flex items-center justify-center" title="Mastercard"><i className="ri-mastercard-fill text-2xl text-red-600" aria-hidden="true" /><span className="sr-only">Mastercard</span></div>
                <div className="h-8 w-12 bg-white rounded flex items-center justify-center font-bold text-xs text-black" title="Mobile Money">MOMO</div>
              </div>
            </div>
          </div>
        </div>

        {/* GSG Business Units */}
        <div className="border-t border-white/10 pt-8 mb-8">
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-5">GSG Brands Business Units</h4>
          <div className="flex flex-wrap gap-3">
            {BUSINESS_UNITS.map((unit) => (
              <span
                key={unit.name}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-sm text-gray-400 cursor-default"
              >
                <i className={`${unit.icon} text-base text-gray-500`}></i>
                {unit.name}
              </span>
            ))}
          </div>
        </div>

        {/* Contact Row */}
        <div className="border-t border-white/10 pt-8 mb-8">
          <div className="flex flex-wrap gap-6 text-sm text-gray-400">
            {SUPPORT_PHONES.map((phone) => (
              <a key={phone.tel} href={`tel:${phone.tel}`} className="inline-flex items-center gap-2 hover:text-white transition-colors">
                <i className="ri-phone-line text-gsg-purple" aria-hidden="true"></i> {phone.display}
              </a>
            ))}
            <a href={`mailto:${CONTACT_EMAIL}`} className="inline-flex items-center gap-2 hover:text-white transition-colors">
              <i className="ri-mail-line text-gsg-purple" aria-hidden="true"></i> {CONTACT_EMAIL}
            </a>
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 hover:text-white transition-colors">
              <i className="ri-whatsapp-line text-gsg-purple"></i> WhatsApp
            </a>
          </div>
        </div>

        {/* Bottom Section */}
        <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-gray-500 text-sm">
            &copy; {currentYear} GSG Convenience Goods & More. All rights reserved.
          </p>
          <div className="flex gap-6 text-sm text-gray-500">
            <GoodsLink path="/privacy" onShopper={onShopper} className="hover:text-white transition-colors">Privacy Policy</GoodsLink>
            <GoodsLink path="/terms" onShopper={onShopper} className="hover:text-white transition-colors">Terms of Service</GoodsLink>
            <GoodsLink path="/cookies" onShopper={onShopper} className="hover:text-white transition-colors">Cookie Policy</GoodsLink>
          </div>
        </div>
      </div>
    </footer>
  );
}
