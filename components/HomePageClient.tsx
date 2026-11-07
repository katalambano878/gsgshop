'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import ProductCard, { type ColorVariant, getColorHex } from '@/components/ProductCard';
import ProductCardSkeleton from '@/components/skeletons/ProductCardSkeleton';
import AnimatedSection, { AnimatedGrid } from '@/components/AnimatedSection';
import { usePageTitle } from '@/hooks/usePageTitle';
import HomeHeroCategoryNav, { type HomeCategoryNode } from '@/components/HomeHeroCategoryNav';
import { shopperUrl } from '@/lib/site-urls';
import { SHOPPER_REDIRECT_CATEGORIES, shopperCategoryHref } from '@/lib/shopper-categories';

const MAIN_GOODS_SLUGS = [
  'grocery', 'household-essentials', 'personal-care', 'stationery',
  'phones-electronics', 'fashion-clothing',
];
const FALLBACK_HOME_CATEGORY_ROWS = [
  { id: 'fallback-grocery', name: 'Groceries & Pantry', slug: 'grocery', image_url: null, parent_id: null },
  { id: 'fallback-household', name: 'Household Essentials', slug: 'household-essentials', image_url: null, parent_id: null },
  { id: 'fallback-personal-care', name: 'Personal Care', slug: 'personal-care', image_url: null, parent_id: null },
  { id: 'fallback-stationery', name: 'Stationery & Office', slug: 'stationery', image_url: null, parent_id: null },
  { id: 'fallback-electronics', name: 'Phones & Electronics', slug: 'phones-electronics', image_url: null, parent_id: null },
  { id: 'fallback-fashion', name: 'Fashion & Clothing', slug: 'fashion-clothing', image_url: null, parent_id: null },
];
const DELIVERY_OPTIONS = [
  { id: 'pickup', title: 'Pickup', desc: 'No delivery fee. Daily after confirmation.', href: '/shipping#pickup', icon: 'ri-store-2-line' },
  { id: 'free', title: 'Free Delivery', desc: 'Daily. The more you buy, the further you get it FREE.', href: '/shipping#free-delivery', icon: 'ri-truck-line' },
  { id: 'sole', title: 'Sole Express', desc: 'Daily. Fresh/perishable must use Express. 2hr–48hr slots.', href: '/shipping#sole-express', icon: 'ri-time-line' },
  { id: 'joint', title: 'Joint Express', desc: 'Share fee with neighbor. Same perishable rule. 2hr–48hr.', href: '/shipping#joint-express', icon: 'ri-group-line' },
];

export default function HomePageClient() {
  usePageTitle('');
  const [featuredProducts, setFeaturedProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [allCategories, setAllCategories] = useState<any[]>(FALLBACK_HOME_CATEGORY_ROWS);
  const [loading, setLoading] = useState(true);

  const [currentHeroImage, setCurrentHeroImage] = useState(0);
  const HERO_IMAGES = ['/hero-1.png', '/hero-2.png', '/slider-1.png', '/slider-2.png', '/slider-3.png'];

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentHeroImage((prev) => (prev + 1) % HERO_IMAGES.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    async function fetchData() {
      try {
        const [productsRes, categoriesRes, allCatRes] = await Promise.all([
          supabase.from('products').select('*, product_variants(*), product_images(*)').eq('status', 'active').eq('featured', true).order('created_at', { ascending: false }).limit(12),
          supabase.from('categories').select('id, name, slug, image_url, metadata').eq('status', 'active').order('position').order('name'),
          supabase.from('categories').select('id, name, slug, image_url, parent_id').eq('status', 'active').order('position').order('name'),
        ]);
        if (!productsRes.error) setFeaturedProducts(productsRes.data || []);
        const featured = (categoriesRes.data || []).filter((c: any) => c.metadata?.featured === true);
        setCategories(featured.length > 0 ? featured : (categoriesRes.data || []).slice(0, 8));
        if (!allCatRes.error && (allCatRes.data || []).length > 0) {
          setAllCategories(allCatRes.data || []);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const mainGoods = allCategories.filter((c) => MAIN_GOODS_SLUGS.some((s) => (c.slug || '').toLowerCase().includes(s))).slice(0, 11);
  const showMainGoods = mainGoods.length > 0 ? mainGoods : allCategories.slice(0, 10);

  const categoryTree: HomeCategoryNode[] = useMemo(() => {
    const parents = allCategories.filter((c: any) => !c.parent_id);
    const dbNodes = parents
      .map((p: any) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        image_url: p.image_url,
        children: allCategories
          .filter((c: any) => c.parent_id === p.id)
          .map((c: any) => ({ id: c.id, name: c.name, slug: c.slug })),
      }))
      .slice(0, 12);

    // Personal Shopper-only categories: hard-coded, link out to the shopper
    // subdomain (these are intentionally not stored in the categories table).
    const shopperNodes: HomeCategoryNode[] = SHOPPER_REDIRECT_CATEGORIES.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      image_url: null,
      externalHref: shopperCategoryHref(),
      children: [],
    }));

    return [...dbNodes, ...shopperNodes];
  }, [allCategories]);

  const featuredRailRef = useRef<HTMLDivElement>(null);
  const scrollFeatured = (dir: number) => {
    featuredRailRef.current?.scrollBy({ left: dir * 280, behavior: 'smooth' });
  };

  return (
    <main className="min-h-screen bg-white">
      {/* Modern Hero Section */}
      <section className="relative bg-gray-50 overflow-hidden">
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-6 md:pb-10 lg:pb-12 pt-0 lg:pt-6 z-10">
          <div className="flex flex-col lg:flex-row gap-6 lg:items-stretch">
            {/* Sidebar */}
            {categoryTree.length > 0 && (
              <div className="hidden lg:block shrink-0 relative z-[60]">
                <HomeHeroCategoryNav categories={categoryTree} />
              </div>
            )}
            
            {/* Center Banner Slider */}
            <div className="w-full lg:flex-1 min-w-0 relative rounded-2xl overflow-hidden shadow-sm bg-gsg-black h-[320px] sm:h-[380px] lg:h-[430px] group">
              {HERO_IMAGES.map((img, index) => (
                <div
                  key={img}
                  className={`absolute inset-0 transition-opacity duration-1000 ${index === currentHeroImage ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}
                >
                  <Image
                    src={img}
                    alt="Promo Banner"
                    fill
                    className="object-cover opacity-80"
                    priority={index === 0}
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-gsg-black/90 via-gsg-black/50 to-transparent"></div>
                </div>
              ))}

              <div className="absolute inset-0 z-20 flex flex-col justify-center px-8 md:px-12 lg:px-16">
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gsg-purple text-white text-xs font-bold mb-6 w-fit shadow-lg">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                  </span>
                  Now delivering to all regions
                </span>
                
                <h1 className="text-3xl md:text-4xl lg:text-5xl font-extrabold text-white mb-3 leading-[1.08] tracking-tight max-w-lg">
                  Premium Convenience,
                  <span className="text-gsg-accent"> Delivered.</span>
                </h1>
                
                <p className="text-base text-gray-200/90 mb-7 leading-relaxed max-w-md hidden sm:block">
                  Trusted everyday essentials with fast, reliable delivery across Ghana.
                </p>
                
                <div className="flex flex-wrap gap-4">
                  <Link
                    href="/shop"
                    className="inline-flex items-center justify-center bg-gsg-purple text-white px-8 py-3.5 rounded-full font-bold text-sm hover:bg-gsg-purple-dark hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300"
                  >
                    Start Shopping
                    <i className="ri-arrow-right-line ml-2" />
                  </Link>
                </div>
              </div>

              {/* Slider Controls */}
              <div className="absolute bottom-6 left-0 right-0 z-20 flex justify-center gap-2">
                {HERO_IMAGES.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => setCurrentHeroImage(index)}
                    className={`h-2 rounded-full transition-all duration-300 ${index === currentHeroImage ? 'w-8 bg-gsg-purple' : 'w-2 bg-white/50 hover:bg-white/80'}`}
                    aria-label={`Go to slide ${index + 1}`}
                  />
                ))}
              </div>
            </div>

            {/* Right Column: Quick Promos */}
            <div className="hidden xl:flex flex-col w-[260px] shrink-0 gap-6 lg:h-[430px]">
              <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl p-6 border border-amber-100 flex-1 flex flex-col justify-center relative overflow-hidden group hover:shadow-md transition-shadow">
                 <div className="absolute top-0 right-0 w-24 h-24 bg-amber-200 rounded-full blur-2xl opacity-50 -mr-10 -mt-10 group-hover:scale-150 transition-transform duration-700"></div>
                 <span className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-2">Featured Deal</span>
                 <h3 className="text-xl font-bold text-gsg-black mb-2 leading-tight">Fresh Groceries Bundle</h3>
                 <div className="flex items-end gap-2 mb-5">
                   <span className="text-2xl font-extrabold text-gsg-purple">GHS 150</span>
                 </div>
                 <Link href="/shop" className="text-sm font-bold text-white bg-gsg-black px-4 py-2.5 rounded-xl text-center hover:bg-gray-800 transition-colors z-10">
                   Shop Now
                 </Link>
              </div>
              <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-2xl p-6 border border-purple-100 flex-1 flex flex-col justify-center relative overflow-hidden group hover:shadow-md transition-shadow">
                 <div className="absolute bottom-0 left-0 w-24 h-24 bg-purple-200 rounded-full blur-2xl opacity-50 -ml-10 -mb-10 group-hover:scale-150 transition-transform duration-700"></div>
                 <span className="text-xs font-bold text-gsg-purple uppercase tracking-wider mb-2">Personal Shopper</span>
                 <h3 className="text-xl font-bold text-gsg-black mb-2 leading-tight">We shop for you!</h3>
                 <p className="text-sm text-gray-600 mb-5 line-clamp-2">Get exactly what you need at market price.</p>
                 <a href={shopperUrl('/')} className="text-sm font-bold text-white bg-gsg-purple px-4 py-2.5 rounded-xl text-center hover:bg-gsg-purple-dark transition-colors z-10">
                   Create List
                 </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Category showcase – horizontal featured rail (Anjaro-style) */}
      <section className="pt-8 pb-16 bg-gray-50/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8 gap-4">
            <h2 className="text-2xl md:text-3xl font-bold text-gsg-black">Featured categories</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => scrollFeatured(-1)}
                className="hidden sm:flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 hover:bg-gsg-purple hover:text-white hover:border-gsg-purple transition-colors shadow-sm"
                aria-label="Scroll categories left"
              >
                <i className="ri-arrow-left-s-line text-xl" />
              </button>
              <button
                type="button"
                onClick={() => scrollFeatured(1)}
                className="hidden sm:flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 hover:bg-gsg-purple hover:text-white hover:border-gsg-purple transition-colors shadow-sm"
                aria-label="Scroll categories right"
              >
                <i className="ri-arrow-right-s-line text-xl" />
              </button>
              <Link href="/categories" className="text-gsg-purple font-medium hover:text-gsg-purple-dark flex items-center gap-1 text-sm sm:text-base whitespace-nowrap">
                View all <i className="ri-arrow-right-line" />
              </Link>
            </div>
          </div>

          <div
            ref={featuredRailRef}
            className="flex flex-nowrap gap-4 overflow-x-auto pb-4 scrollbar-hide snap-x snap-mandatory scroll-smooth -mx-1 px-1"
          >
            <Link href="/shop" className="group relative flex-none w-[140px] sm:w-[160px] aspect-[4/5] snap-start rounded-2xl overflow-hidden bg-violet-50 shadow-sm border border-violet-100/80 hover:shadow-md transition-all">
              <div className="absolute inset-0 bg-gray-100 group-hover:scale-105 transition-transform duration-500">
                <Image 
                  src="https://images.unsplash.com/photo-1542838132-92c53300491e?q=80&w=800&auto=format&fit=crop" 
                  alt="Grocery" 
                  fill 
                  className="object-cover"
                  sizes="(max-width: 768px) 50vw, 16vw"
                />
                <div className="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition-colors" />
              </div>
              <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
                <p className="font-bold text-white text-center text-sm">Grocery</p>
              </div>
            </Link>

            <a href={shopperUrl('/')} className="group relative flex-none w-[140px] sm:w-[160px] aspect-[4/5] snap-start rounded-2xl overflow-hidden bg-amber-50 shadow-sm border border-amber-100/80 hover:shadow-md transition-all block">
              <div className="absolute inset-0 bg-orange-50 group-hover:scale-105 transition-transform duration-500">
                <Image 
                  src="https://images.unsplash.com/photo-1483985988355-763728e1935b?q=80&w=800&auto=format&fit=crop" 
                  alt="Personal Shopper" 
                  fill 
                  className="object-cover"
                  sizes="(max-width: 768px) 50vw, 16vw"
                />
                <div className="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition-colors" />
              </div>
              <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
                <p className="font-bold text-white text-center text-sm">Personal Shopper</p>
              </div>
            </a>

            {showMainGoods.slice(0, 12).map((cat) => (
              <Link
                key={cat.id}
                href={`/shop?category=${cat.slug}`}
                className="group relative flex-none w-[140px] sm:w-[160px] aspect-[4/5] snap-start rounded-2xl overflow-hidden bg-white shadow-sm border border-gray-100 hover:shadow-md transition-all"
              >
                <div className="absolute inset-0 bg-gray-100 group-hover:scale-105 transition-transform duration-500">
                  {cat.image_url ? (
                    <Image src={cat.image_url} alt={cat.name} fill className="object-cover" sizes="(max-width: 768px) 50vw, 16vw" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <i className="ri-archive-line text-4xl text-gray-300" />
                    </div>
                  )}
                </div>
                <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/70 to-transparent">
                  <p className="font-bold text-white text-center text-xs sm:text-sm leading-tight line-clamp-2">{cat.name}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Products */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gsg-black mb-4">Trending Now</h2>
            <p className="text-gray-500 max-w-2xl mx-auto">Discover our most popular products, handpicked for quality and value.</p>
          </div>
          
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {[...Array(4)].map((_, i) => <ProductCardSkeleton key={i} />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8">
              {featuredProducts.slice(0, 8).map((product) => {
                const variants = product.product_variants || [];
                const hasVariants = variants.length > 0;
                const minVariantPrice = hasVariants ? Math.min(...variants.map((v: any) => v.price || product.price)) : undefined;
                const totalVariantStock = hasVariants ? variants.reduce((s: number, v: any) => s + (v.quantity || 0), 0) : 0;
                const effectiveStock = hasVariants ? totalVariantStock : product.quantity;
                const colorVariants: ColorVariant[] = [];
                const seen = new Set<string>();
                for (const v of variants) {
                  const name = (v as any).option2;
                  if (name && !seen.has(name.toLowerCase().trim())) {
                    const hex = getColorHex(name);
                    if (hex) {
                      seen.add(name.toLowerCase().trim());
                      colorVariants.push({ name: name.trim(), hex });
                    }
                  }
                }
                return (
                  <div key={product.id} className="w-full">
                    <ProductCard
                      id={product.id}
                      slug={product.slug}
                      name={product.name}
                      price={product.price}
                      originalPrice={product.compare_at_price}
                      image={product.product_images?.[0]?.url || 'https://via.placeholder.com/400x500'}
                      rating={product.rating_avg || 5}
                      reviewCount={product.review_count || 0}
                      badge={product.featured ? 'Featured' : undefined}
                      inStock={effectiveStock > 0}
                      maxStock={effectiveStock || 50}
                      moq={product.moq || 1}
                      hasVariants={hasVariants}
                      minVariantPrice={minVariantPrice}
                      colorVariants={colorVariants}
                    />
                  </div>
                );
              })}
            </div>
          )}
          <div className="text-center mt-12">
            <Link href="/shop" className="inline-flex items-center justify-center bg-white text-gsg-black border-2 border-gsg-black px-8 py-3 rounded-full font-bold hover:bg-gsg-black hover:text-white transition-all duration-300">
              View All Products
            </Link>
          </div>
        </div>
      </section>

      {/* Promo + Track order */}
      <section className="py-16 bg-gsg-purple text-white overflow-hidden relative">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(white 1px, transparent 1px)', backgroundSize: '32px 32px' }}></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
           <div className="bg-white/10 backdrop-blur-md rounded-3xl p-8 md:p-12 flex flex-col md:flex-row items-center justify-between gap-8 border border-white/20">
              <div className="text-center md:text-left">
                <h3 className="text-2xl md:text-3xl font-bold mb-2">🎁 Free gift for every purchase</h3>
                <p className="text-white/80">Shop now and get a special surprise in your delivery box.</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link href="/shop" className="inline-flex items-center justify-center bg-white text-gsg-purple px-8 py-3 rounded-full font-bold hover:bg-gsg-accent hover:text-gsg-black transition-colors shadow-lg">
                  Shop Now
                </Link>
                <Link href="/order-tracking" className="inline-flex items-center justify-center bg-transparent border-2 border-white text-white px-8 py-3 rounded-full font-bold hover:bg-white/10 transition-colors">
                  Track Order
                </Link>
              </div>
           </div>
        </div>
      </section>

      {/* Delivery options strip */}
      <section className="py-12 bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {DELIVERY_OPTIONS.map((opt) => (
              <Link
                key={opt.id}
                href={opt.href}
                className="group p-6 rounded-2xl bg-gray-50 hover:bg-white hover:shadow-xl hover:shadow-gsg-purple/5 border border-transparent hover:border-gsg-purple/10 transition-all duration-300"
              >
                <div className="w-12 h-12 rounded-xl bg-white text-gsg-purple shadow-sm flex items-center justify-center mb-4 group-hover:scale-110 group-hover:bg-gsg-purple group-hover:text-white transition-all duration-300">
                  <i className={`${opt.icon} text-2xl`} />
                </div>
                <h3 className="font-bold text-gsg-black mb-2 group-hover:text-gsg-purple transition-colors">{opt.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{opt.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="py-12 bg-gsg-black text-white text-center border-t border-white/10">
        <p className="text-lg font-medium mb-2">Need help? WhatsApp & Telegram Active 24/7</p>
        <p className="text-white/80 text-sm">+233 (0) 246 033 792 · +233 (0) 579 033 792 · <a href="https://t.me/gsgbrandsgh" target="_blank" rel="noopener noreferrer" className="text-gsg-accent hover:underline">t.me/gsgbrandsgh</a></p>
      </section>
    </main>
  );
}
