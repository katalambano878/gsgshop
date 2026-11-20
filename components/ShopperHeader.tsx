'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { goodsUrl } from '@/lib/site-urls';

const NAV_LINKS = [
  { href: '/shopper', label: 'Home' },
  { href: '/shopper/how-it-works', label: 'How it Works' },
  { href: '/shopper/track', label: 'Track Request' },
  { href: '/shopper/faqs', label: 'FAQs' },
  { href: '/shopper/customer-experience', label: 'Support' },
];

export default function ShopperHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  // Close the menu after navigating.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Close on Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const shopGoodsHref = goodsUrl('/');

  return (
    <>
      {/* Top Utility Bar */}
      <div className="bg-gsg-purple-dark text-white text-xs py-2 hidden md:block">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <div className="flex gap-4">
            <span>Welcome to My Personal Shopper by GSG</span>
            <span className="text-white/40" aria-hidden="true">|</span>
            <a href="tel:+233246033792" className="hover:text-gsg-accent transition-colors">Call: +233 (0) 246 033 792</a>
          </div>
          <div className="flex gap-4">
            <Link href="/shopper/faqs" className="hover:text-gsg-accent transition-colors">FAQs</Link>
            <span className="text-white/40" aria-hidden="true">|</span>
            <Link href="/shopper/customer-experience" className="hover:text-gsg-accent transition-colors">Support</Link>
          </div>
        </div>
      </div>

      {/* Main Header */}
      <header className="bg-white sticky top-0 z-50 shadow-sm border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-4 flex items-center justify-between gap-4 md:gap-8">
            {/* Logo */}
            <Link href="/shopper" className="flex items-center group" aria-label="My Personal Shopper by GSG, home">
              <div className="flex flex-col">
                <div className="relative w-[68px] h-[24px] md:w-[90px] md:h-[30px]">
                  <Image src="/fgfg.png" alt="GSG" fill className="object-contain object-left" />
                </div>
                <span className="text-[0.6rem] md:text-xs font-medium text-gray-500 uppercase tracking-wider leading-none">Personal Shopper</span>
              </div>
            </Link>

            {/* Navigation Bar - Desktop */}
            <nav className="hidden md:flex items-center gap-8" aria-label="Personal Shopper">
              <Link href="/shopper" className="text-sm font-medium text-gray-600 hover:text-gsg-purple transition-colors">Home</Link>
              <Link href="/shopper/how-it-works" className="text-sm font-medium text-gray-600 hover:text-gsg-purple transition-colors">How it Works</Link>
              <Link href="/shopper/track" className="text-sm font-medium text-gray-600 hover:text-gsg-purple transition-colors">Track Request</Link>
              <a href={shopGoodsHref} className="text-sm font-medium text-orange-500 hover:text-orange-600 flex items-center gap-1">
                <i className="ri-shopping-bag-line" aria-hidden="true"></i> Shop Convenience Goods & More
              </a>
            </nav>

            {/* Actions */}
            <div className="flex items-center gap-2 sm:gap-4">
              <Link
                href="/shopper/shopping-list"
                className="bg-gsg-purple text-white px-5 py-2.5 rounded-full text-sm font-bold hover:bg-gsg-purple-dark transition-colors shadow-md"
              >
                Create List
              </Link>
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
                aria-controls="shopper-mobile-menu"
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                className="md:hidden inline-flex h-11 w-11 items-center justify-center rounded-full text-gsg-black hover:bg-gray-100 transition-colors"
              >
                <i className={`${menuOpen ? 'ri-close-line' : 'ri-menu-line'} text-2xl`} aria-hidden="true"></i>
              </button>
            </div>
          </div>
        </div>

        {/* Navigation - Mobile */}
        {menuOpen && (
          <nav
            id="shopper-mobile-menu"
            aria-label="Personal Shopper"
            className="md:hidden border-t border-gray-100 bg-white"
          >
            <ul className="max-w-7xl mx-auto px-4 py-2">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    className="block py-3 text-base font-medium text-gray-700 hover:text-gsg-purple border-b border-gray-50"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
              <li>
                <a
                  href={shopGoodsHref}
                  className="flex items-center gap-2 py-3 text-base font-medium text-orange-500 hover:text-orange-600 border-b border-gray-50"
                >
                  <i className="ri-shopping-bag-line" aria-hidden="true"></i> Shop Convenience Goods & More
                </a>
              </li>
              <li>
                <a href="tel:+233246033792" className="flex items-center gap-2 py-3 text-base font-medium text-gray-700 hover:text-gsg-purple">
                  <i className="ri-phone-line" aria-hidden="true"></i> Call +233 24 603 3792
                </a>
              </li>
            </ul>
          </nav>
        )}
      </header>
    </>
  );
}
