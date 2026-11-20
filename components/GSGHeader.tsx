'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import MiniCart from './MiniCart';
import { useCart } from '@/context/CartContext';
import { supabase } from '@/lib/supabase';
import { shopperUrl } from '@/lib/site-urls';
import { SHOPPER_REDIRECT_CATEGORIES, shopperCategoryHref } from '@/lib/shopper-categories';

const MAIN_NAV = [
  { label: 'Home', href: '/' },
  { label: 'Shop All', href: '/shop' },
  { label: 'Categories', href: '/categories' },
  { label: 'Track Order', href: '/order-tracking' },
  { label: 'Contact', href: '/contact' },
];

const FALLBACK_CATEGORIES = [
  { label: 'Convenience Goods & More', href: '/shop', children: [] },
  { label: 'Groceries & Pantry', href: '/shop?category=grocery', children: [] },
  { label: 'Household Essentials', href: '/shop?category=household-essentials', children: [] },
  { label: 'Personal Care', href: '/shop?category=personal-care', children: [] },
  { label: 'Stationery & Office', href: '/shop?category=stationery', children: [] },
];

const FEATURED_NAV_ITEMS = [
  { label: 'Groceries', href: '/shop?category=grocery' },
  { label: 'Household Essentials', href: '/shop?category=household-essentials' },
  { label: 'Stationery & Office', href: '/shop?category=stationery' },
  { label: 'Free Delivery', href: '/shipping#free-delivery' },
];

interface CategoryItem {
  label: string;
  href: string;
  children: CategoryItem[];
  /** When true the entry links out to the Personal Shopper subdomain. */
  external?: boolean;
}

// Personal Shopper-only categories, hard-coded to redirect to the shopper
// subdomain. Appended after the DB-driven goods categories.
const SHOPPER_NAV_CATEGORIES: CategoryItem[] = SHOPPER_REDIRECT_CATEGORIES.map((c) => ({
  label: c.name,
  href: shopperCategoryHref(),
  children: [],
  external: true,
}));

export default function GSGHeader() {
  const [searchQuery, setSearchQuery] = useState('');
  const [user, setUser] = useState<any>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { cartCount, isCartOpen, setIsCartOpen } = useCart();
  const [isScrolled, setIsScrolled] = useState(false);
  const [categories, setCategories] = useState<CategoryItem[]>([...FALLBACK_CATEGORIES, ...SHOPPER_NAV_CATEGORIES]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [megaMenuOpen, setMegaMenuOpen] = useState(false);

  const toggleCategory = useCallback((label: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMegaMenuOpen(false);
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);

    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
      if (window.scrollY > 50) setMegaMenuOpen(false);
    };
    window.addEventListener('scroll', handleScroll);

    // Fetch categories from DB
    const fetchCategories = async () => {
      try {
        const { data, error } = await supabase
          .from('categories')
          .select('id, name, slug, parent_id, status, position, image_url')
          .eq('status', 'active')
          .order('position', { ascending: true });

        if (error || !data || data.length === 0) return;

        const parentCategories = data.filter(c => !c.parent_id);
        const tree: CategoryItem[] = parentCategories.map(parent => ({
          label: parent.name,
          href: `/shop?category=${parent.slug}`,
          children: data
            .filter(c => c.parent_id === parent.id)
            .map(child => ({
              label: child.name,
              href: `/shop?category=${child.slug}`,
              children: [],
            })),
        }));

        if (tree.length > 0) {
          setCategories([...tree, ...SHOPPER_NAV_CATEGORIES]);
        }
      } catch (err) {
        // Keep fallback categories on error
      }
    };

    fetchCategories();

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('keydown', handleKey);
    };
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      window.location.href = `/shop?search=${encodeURIComponent(searchQuery.trim())}`;
    }
  };

  return (
    <>
      {/* Top Utility Bar */}
      <div className="bg-gsg-purple-dark text-white text-xs py-2 hidden md:block print:hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <div className="flex gap-4">
            <span>Groceries and everyday goods in Accra</span>
            <span className="text-white/40" aria-hidden="true">|</span>
            <a href="tel:+233246033792" className="hover:text-gsg-accent transition-colors">Call or WhatsApp: +233 24 603 3792</a>
          </div>
          <div className="flex gap-4">
            <Link href="/help" className="hover:text-gsg-accent transition-colors">Help Center</Link>
            <span className="text-white/40">|</span>
            <Link href="/shipping" className="hover:text-gsg-accent transition-colors">Delivery</Link>
            <span className="text-white/40" aria-hidden="true">|</span>
            <Link href="/returns" className="hover:text-gsg-accent transition-colors">Returns</Link>
          </div>
        </div>
      </div>

      {/* Main Header */}
      <header className={`bg-white sticky top-0 z-50 transition-shadow duration-300 print:hidden ${isScrolled ? 'shadow-md' : 'border-b border-gray-100'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-4 flex items-center justify-between gap-4 md:gap-8">
            {/* Logo */}
            <div className="flex items-center gap-4">
              <button 
                type="button" 
                className="lg:hidden text-gsg-black p-1"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label="Open menu"
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-menu"
              >
                <i className="ri-menu-line text-2xl" aria-hidden="true" />
              </button>
              <Link href="/" className="flex items-center group" aria-label="GSG Convenience Goods & More, home">
                <div className="flex flex-col">
                  <div className="relative w-[68px] h-[24px] md:w-[90px] md:h-[30px]">
                    <Image src="/fgfg.png" alt="GSG Wordmark" fill className="object-contain object-left" />
                  </div>
                  <span className="text-[0.6rem] md:text-xs font-medium text-gray-500 uppercase tracking-wider leading-none">Convenience Goods & More</span>
                </div>
              </Link>
            </div>

            {/* Search Bar - Desktop */}
            <div className="hidden md:flex flex-1 max-w-2xl">
              <form onSubmit={handleSearch} className="w-full relative group">
                <label htmlFor="header-search" className="sr-only">Search products</label>
                <input
                  id="header-search"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search for products, brands and more..."
                  className="w-full pl-5 pr-12 py-3 rounded-full bg-gray-100 text-gsg-black placeholder:text-gray-400 text-sm border-2 border-transparent focus:bg-white focus:border-gsg-purple focus:ring-0 transition-all"
                />
                <button 
                  type="submit"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-gsg-purple text-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-gsg-purple-dark transition-colors shadow-sm"
                  aria-label="Search"
                >
                  <i className="ri-search-line text-sm" aria-hidden="true" />
                </button>
              </form>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 md:gap-6">
              <button 
                type="button"
                className="md:hidden p-2 text-gsg-black"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label="Search products"
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-menu"
              >
                <i className="ri-search-line text-xl" aria-hidden="true" />
              </button>

              <Link href={user ? '/account' : '/auth/login'} className="hidden md:flex flex-col items-center group">
                <div className="relative p-1">
                  <i className="ri-user-line text-2xl text-gray-600 group-hover:text-gsg-purple transition-colors" />
                </div>
                <span className="text-xs font-medium text-gray-500 group-hover:text-gsg-purple transition-colors">{user ? 'Account' : 'Login'}</span>
              </Link>

              <Link href="/wishlist" className="hidden md:flex flex-col items-center group">
                <div className="relative p-1">
                  <i className="ri-heart-line text-2xl text-gray-600 group-hover:text-gsg-purple transition-colors" />
                </div>
                <span className="text-xs font-medium text-gray-500 group-hover:text-gsg-purple transition-colors">Wishlist</span>
              </Link>

              <button 
                type="button"
                className="flex flex-col items-center group relative"
                onClick={() => setIsCartOpen(!isCartOpen)}
                aria-label={cartCount > 0 ? `Open cart, ${cartCount} item${cartCount === 1 ? '' : 's'}` : 'Open cart'}
                aria-expanded={isCartOpen}
              >
                <div className="relative p-1">
                  <i className="ri-shopping-bag-line text-2xl text-gray-600 group-hover:text-gsg-purple transition-colors" />
                  {cartCount > 0 && (
                    <span className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center rounded-full bg-gsg-purple text-white text-xs font-bold border-2 border-white">
                      {cartCount}
                    </span>
                  )}
                </div>
                <span className="hidden md:block text-xs font-medium text-gray-500 group-hover:text-gsg-purple transition-colors">Cart</span>
              </button>
            </div>
          </div>

        {/* Navigation Bar - Desktop */}
        <div className="hidden lg:flex items-center justify-between border-t border-gray-100">
          <nav className="flex items-center h-full">
            <div className="relative h-full flex items-center">
              <div className="w-[260px] flex items-center justify-between bg-gsg-purple text-white font-bold hover:bg-gsg-purple-dark transition-colors rounded-t-sm">
                <button
                  type="button"
                  onClick={() => setMegaMenuOpen(!megaMenuOpen)}
                  aria-expanded={megaMenuOpen}
                  aria-controls="categories-menu"
                  className="flex-1 flex items-center gap-2 text-sm px-4 py-3.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                >
                  <i className={`${megaMenuOpen ? 'ri-close-line' : 'ri-layout-grid-fill'} text-lg`} aria-hidden="true" />
                  <span>Categories</span>
                </button>
                <Link
                  href="/categories"
                  className="text-xs font-semibold text-white/80 hover:text-white transition-colors px-4 py-3.5"
                >
                  See all
                </Link>
              </div>
            </div>
            <div className="flex items-center gap-8 pl-8">
              {FEATURED_NAV_ITEMS.map((item) => (
                <div key={item.label} className="relative group/nav">
                  <Link 
                    href={item.href}
                    className="text-sm font-medium text-gray-600 hover:text-gsg-purple transition-colors py-3.5 block relative"
                  >
                    {item.label}
                    <span className="absolute inset-x-0 bottom-0 h-0.5 bg-gsg-purple scale-x-0 group-hover/nav:scale-x-100 transition-transform origin-left" />
                  </Link>
                </div>
              ))}
            </div>
          </nav>

            <div className="flex items-center gap-6">
              <Link href="/shipping#sole-express" className="flex items-center gap-2 text-sm font-medium text-gsg-purple hover:text-gsg-purple-dark">
                <i className="ri-flashlight-fill" />
                Sole Express
              </Link>
              <a
                href={shopperUrl('/')}
                className="flex items-center gap-2 text-sm font-medium text-orange-500 hover:text-orange-600"
              >
                <i className="ri-vip-crown-fill" />
                Personal Shopper
              </a>
            </div>
          </div>
        </div>

        {/* Mega Menu Dropdown - Full Width */}
        {megaMenuOpen && (
          <>
            <div className="fixed inset-0 bg-black/30 z-40 top-[125px]" onClick={() => setMegaMenuOpen(false)} aria-hidden="true" />
            <div id="categories-menu" className="hidden lg:block absolute left-0 right-0 bg-white border-t border-gray-100 shadow-2xl z-50 animate-fade-in-up">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <div className="grid grid-cols-5 gap-8">
                  {categories.map((cat) => (
                    <div key={cat.label}>
                      {cat.external ? (
                        <a
                          href={cat.href}
                          onClick={() => setMegaMenuOpen(false)}
                          className="flex items-center gap-2 font-bold text-gsg-black hover:text-gsg-purple transition-colors mb-4 pb-3 border-b-2 border-gsg-purple/20"
                        >
                          <span>{cat.label}</span>
                          <i className="ri-arrow-right-up-line text-xs text-gsg-purple opacity-0 group-hover:opacity-100" />
                        </a>
                      ) : (
                        <>
                          <Link
                            href={cat.href}
                            onClick={() => setMegaMenuOpen(false)}
                            className="flex items-center gap-2 font-bold text-gsg-black hover:text-gsg-purple transition-colors mb-4 pb-3 border-b-2 border-gsg-purple/20"
                          >
                            <span>{cat.label}</span>
                            <i className="ri-arrow-right-up-line text-xs text-gsg-purple opacity-0 group-hover:opacity-100" />
                          </Link>
                          {cat.children.length > 0 && (
                            <ul className="space-y-2">
                              {cat.children.map((sub) => (
                                <li key={sub.label}>
                                  <Link
                                    href={sub.href}
                                    onClick={() => setMegaMenuOpen(false)}
                                    className="text-sm text-gray-600 hover:text-gsg-purple hover:pl-1 transition-all flex items-center gap-2 group/sub"
                                  >
                                    <span className="w-1 h-1 rounded-full bg-gray-300 group-hover/sub:bg-gsg-purple transition-colors" />
                                    {sub.label}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          )}
                          <Link
                            href={cat.href}
                            onClick={() => setMegaMenuOpen(false)}
                            className="inline-flex items-center gap-1 text-xs font-bold text-gsg-purple hover:text-gsg-purple-dark mt-4 transition-colors"
                          >
                            View All <i className="ri-arrow-right-line" />
                          </Link>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                <div className="mt-8 pt-6 border-t border-gray-100 flex items-center justify-between">
                  <Link
                    href="/categories"
                    onClick={() => setMegaMenuOpen(false)}
                    className="inline-flex items-center gap-2 text-sm font-bold text-gsg-purple hover:text-gsg-purple-dark transition-colors"
                  >
                    <i className="ri-apps-2-line" />
                    Browse All Categories
                    <i className="ri-arrow-right-line" />
                  </Link>
                  <Link
                    href="/shop"
                    onClick={() => setMegaMenuOpen(false)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-gsg-purple text-white text-sm font-bold rounded-full hover:bg-gsg-purple-dark transition-colors shadow-md hover:shadow-lg"
                  >
                    <i className="ri-shopping-bag-line" />
                    Shop All Products
                  </Link>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Mobile Menu Overlay */}
        {mobileMenuOpen && (
          <div id="mobile-menu" className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} aria-hidden="true" />
            <div className="absolute top-0 left-0 bottom-0 w-[80%] max-w-sm bg-white shadow-xl flex flex-col">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gsg-purple text-white">
                <span className="font-bold text-lg">Menu</span>
                <button type="button" onClick={() => setMobileMenuOpen(false)} className="p-2 hover:bg-white/10 rounded-full" aria-label="Close menu">
                  <i className="ri-close-line text-2xl" aria-hidden="true" />
                </button>
              </div>
              
              <div className="p-4 border-b border-gray-100">
                <form onSubmit={(e) => { handleSearch(e); setMobileMenuOpen(false); }}>
                  <div className="relative">
                    <label htmlFor="mobile-search" className="sr-only">Search products</label>
                    <input
                      id="mobile-search"
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search..."
                      className="w-full pl-10 pr-4 py-2 rounded-lg bg-gray-100 border-none focus:ring-2 focus:ring-gsg-purple"
                    />
                    <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  </div>
                </form>
              </div>

              <div className="flex-1 overflow-y-auto py-4">
                <nav className="flex flex-col">
                  {MAIN_NAV.map((item) => (
                    <Link
                      key={item.label}
                      href={item.href}
                      className="px-6 py-3 text-gray-700 hover:bg-gray-50 hover:text-gsg-purple font-medium flex items-center justify-between"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      {item.label}
                      <i className="ri-arrow-right-s-line text-gray-400" />
                    </Link>
                  ))}
                  <div className="my-2 border-t border-gray-100" />
                  <div className="px-6 py-2 text-xs font-bold text-gray-400 uppercase tracking-wider">Categories</div>
                  {categories.map((cat) => (
                    <div key={cat.label}>
                      {cat.external ? (
                        <div className="flex items-center">
                          <a
                            href={cat.href}
                            className="flex-1 px-6 py-3 text-gray-700 hover:bg-gray-50 hover:text-gsg-purple font-medium"
                            onClick={() => setMobileMenuOpen(false)}
                          >
                            {cat.label}
                          </a>
                          <span className="px-4 py-3">
                            <i className="ri-arrow-right-s-line text-gray-400" />
                          </span>
                        </div>
                      ) : (
                      <>
                      <div className="flex items-center">
                        <Link
                          href={cat.href}
                          className="flex-1 px-6 py-3 text-gray-700 hover:bg-gray-50 hover:text-gsg-purple font-medium"
                          onClick={() => setMobileMenuOpen(false)}
                        >
                          {cat.label}
                        </Link>
                        {cat.children.length > 0 && (
                          <button
                            type="button"
                            onClick={() => toggleCategory(cat.label)}
                            aria-expanded={expandedCategories.has(cat.label)}
                            aria-label={`${expandedCategories.has(cat.label) ? 'Hide' : 'Show'} ${cat.label} subcategories`}
                            className="px-4 py-3 text-gray-400 hover:text-gsg-purple transition-colors"
                          >
                            <i className={`ri-arrow-${expandedCategories.has(cat.label) ? 'down' : 'right'}-s-line text-lg transition-transform`} />
                          </button>
                        )}
                        {cat.children.length === 0 && (
                          <span className="px-4 py-3">
                            <i className="ri-arrow-right-s-line text-gray-400" />
                          </span>
                        )}
                      </div>
                      {cat.children.length > 0 && expandedCategories.has(cat.label) && (
                        <div className="bg-gray-50 border-y border-gray-100">
                          {cat.children.map((sub) => (
                            <Link
                              key={sub.label}
                              href={sub.href}
                              className="flex items-center gap-2 pl-10 pr-6 py-2.5 text-sm text-gray-600 hover:text-gsg-purple hover:bg-gray-100 transition-colors"
                              onClick={() => setMobileMenuOpen(false)}
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-gsg-purple/30" />
                              {sub.label}
                            </Link>
                          ))}
                        </div>
                      )}
                      </>
                      )}
                    </div>
                  ))}
                </nav>
              </div>

              <div className="p-4 border-t border-gray-100 bg-gray-50">
                {!user ? (
                  <div className="grid grid-cols-2 gap-4">
                    <Link 
                      href="/auth/login" 
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center justify-center px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                    >
                      Log in
                    </Link>
                    <Link 
                      href="/auth/signup" 
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center justify-center px-4 py-2 border border-transparent rounded-lg text-sm font-medium text-white bg-gsg-purple hover:bg-gsg-purple-dark"
                    >
                      Sign up
                    </Link>
                  </div>
                ) : (
                  <Link 
                    href="/account"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center justify-center gap-2 w-full px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    <i className="ri-user-line" />
                    My Account
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}

        <MiniCart isOpen={isCartOpen} onClose={() => setIsCartOpen(false)} />
      </header>
    </>
  );
}
