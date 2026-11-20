'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { usePageTitle } from '@/hooks/usePageTitle';
import ProductCard, { type ColorVariant } from '@/components/ProductCard';
import ProductCardSkeleton from '@/components/skeletons/ProductCardSkeleton';
import { getColorHex } from '@/components/ProductCard';
import { supabase } from '@/lib/supabase';
import { cachedQuery } from '@/lib/query-cache';
import PageHero from '@/components/PageHero';
import { isPurchasable, sellableStock, stockCount } from '@/context/stock';

const NO_IMAGE =
  "data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 100 100%27%3E%3Crect width=%27100%27 height=%27100%27 fill=%27%23f3f4f6%27/%3E%3C/svg%3E";
const SORTS = ['new', 'price-low', 'price-high'] as const;

function ShopContent() {
  usePageTitle('Shop All Products');
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // State
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([{ id: 'all', name: 'All Products', count: 0 }]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [totalProducts, setTotalProducts] = useState(0);
  const requestRef = useRef(0);

  // Category, search and sort always come from the URL, so the header search,
  // category links and "Shop All" each show exactly what they say.
  const selectedCategory = searchParams.get('category') || 'all';
  const search = (searchParams.get('search') || '').trim();
  const rawSort = searchParams.get('sort') || 'new';
  const sortBy = (SORTS as readonly string[]).includes(rawSort) ? rawSort : 'new';

  const [priceRange, setPriceRange] = useState([0, 5000]);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const productsPerPage = 9;

  // A new category, search or sort starts again at page 1.
  useEffect(() => {
    setPage(1);
  }, [selectedCategory, search, sortBy]);

  const updateUrl = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '' || (key === 'category' && value === 'all')) next.delete(key);
      else next.set(key, value);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const setSelectedCategory = (slug: string) => updateUrl({ category: slug });
  const setSortBy = (value: string) => updateUrl({ sort: value === 'new' ? null : value });

  // Fetch Categories from cached API
  useEffect(() => {
    async function fetchCategories() {
      try {
        const res = await fetch('/api/storefront/categories');
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data) && data.length > 0) {
            setCategories([{ id: 'all', name: 'All Products', slug: 'all', parent_id: null }, ...data]);
          }
        }
      } catch (err) {
        console.error('Error fetching categories:', err);
      } finally {
        setCategoriesLoaded(true);
      }
    }
    fetchCategories();
  }, []);

  // Fetch Products
  useEffect(() => {
    // When a specific category is selected, wait until the category tree has
    // loaded so we can resolve its full set of descendant categories. Fetching
    // early would either miss the filter or cache an incorrect result.
    if (selectedCategory !== 'all' && !categoriesLoaded) return;

    const requestId = ++requestRef.current;
    async function fetchProducts() {
      setLoading(true);
      setLoadError(false);
      try {
        // Build cache key from all filter params
        const cacheKey = `shop:${selectedCategory}:${search}:${priceRange.join('-')}:${sortBy}:${page}`;

        const { data, count, error } = await cachedQuery<{ data: any; count: any; error: any }>(
          cacheKey,
          async () => {
            let query = supabase
              .from('products')
              .select(`
                id, name, slug, price, compare_at_price, quantity, track_quantity, continue_selling, status, moq,
                categories!inner(name, slug),
                product_images!product_id(url, position),
                product_variants(id, name, price, quantity, option1, option2, image_url)
              `, { count: 'exact' })
              .eq('status', 'active')
              .order('position', { foreignTable: 'product_images', ascending: true });

            // Search
            if (search) {
              query = query.ilike('name', `%${search}%`);
            }

            // Category Filter: include the selected category AND every
            // descendant (sub-categories at any depth), since products are
            // assigned to the deepest leaf categories.
            if (selectedCategory !== 'all') {
              const categoryObj = categories.find(c => c.slug === selectedCategory);

              if (categoryObj) {
                const ids = [categoryObj.id];
                let frontier = [categoryObj.id];
                while (frontier.length) {
                  const childIds = categories
                    .filter(c => c.parent_id && frontier.includes(c.parent_id))
                    .map(c => c.id)
                    .filter(id => !ids.includes(id));
                  if (childIds.length === 0) break;
                  ids.push(...childIds);
                  frontier = childIds;
                }
                query = query.in('category_id', ids);
              } else {
                // Unknown / inactive category slug — return no products rather
                // than silently showing the entire catalogue.
                query = query.eq('category_id', '00000000-0000-0000-0000-000000000000');
              }
            }

            // Price Filter
            if (priceRange[1] < 5000) {
              query = query.gte('price', priceRange[0]).lte('price', priceRange[1]);
            }

            // Sorting
            switch (sortBy) {
              case 'price-low':
                query = query.order('price', { ascending: true });
                break;
              case 'price-high':
                query = query.order('price', { ascending: false });
                break;
              case 'new':
              default:
                query = query.order('created_at', { ascending: false });
                break;
            }

            // Pagination
            const from = (page - 1) * productsPerPage;
            const to = from + productsPerPage - 1;
            query = query.range(from, to);

            return query as any;
          },
          2 * 60 * 1000 // Cache for 2 minutes
        );

        if (requestId !== requestRef.current) return;
        if (error) throw error;

        if (data) {
          const formattedProducts = data.map((p: any) => {
            const variants = p.product_variants || [];
            const hasVariants = variants.length > 0;
            const minVariantPrice = hasVariants ? Math.min(...variants.map((v: any) => v.price || p.price)) : undefined;
            // Extract unique colors from option2
            const colorVariants: ColorVariant[] = [];
            const seenColors = new Set<string>();
            for (const v of variants) {
              const colorName = v.option2;
              if (colorName && !seenColors.has(colorName.toLowerCase().trim())) {
                const hex = getColorHex(colorName);
                if (hex) {
                  seenColors.add(colorName.toLowerCase().trim());
                  colorVariants.push({ name: colorName.trim(), hex });
                }
              }
            }

            return {
              id: p.id,           // Product UUID for cart/orders
              slug: p.slug,       // Slug for navigation
              name: p.name,
              price: p.price,
              originalPrice: p.compare_at_price > p.price ? p.compare_at_price : undefined,
              image: p.product_images?.[0]?.url || NO_IMAGE,
              badge: p.compare_at_price > p.price ? 'Sale' : undefined,
              inStock: isPurchasable(p, variants),
              maxStock: sellableStock(stockCount(p, variants), p),
              moq: p.moq || 1,
              category: p.categories?.name,
              hasVariants,
              minVariantPrice,
              colorVariants
            };
          });
          setProducts(formattedProducts);
          setTotalProducts(count || 0);
        }
      } catch (err) {
        if (requestId !== requestRef.current) return;
        console.error('Error fetching products:', err);
        setLoadError(true);
        setProducts([]);
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    }

    fetchProducts();
  }, [selectedCategory, search, priceRange, sortBy, page, categoriesLoaded, categories, retryKey]);

  const totalPages = Math.ceil(totalProducts / productsPerPage);
  const firstShown = totalProducts === 0 ? 0 : (page - 1) * productsPerPage + 1;
  const lastShown = Math.min(totalProducts, (page - 1) * productsPerPage + products.length);

  return (
    <main className="min-h-screen bg-gray-50">
      <PageHero
        title="Shop All Products"
        subtitle="Browse our range of premium convenience goods"
      />

      {/* Mobile Filter Toggle */}
      <div className="lg:hidden bg-white border-b border-gray-200 py-4 px-4 sticky top-[72px] z-20 shadow-sm">
        <div className="flex justify-between items-center">
          <button
            type="button"
            onClick={() => setIsFilterOpen(!isFilterOpen)}
            aria-expanded={isFilterOpen}
            className="flex items-center space-x-2 text-gsg-black font-medium"
          >
            <i className="ri-filter-3-line text-xl text-gsg-purple" aria-hidden="true"></i>
            <span>Filters & Sort</span>
          </button>
          <span className="text-sm text-gray-500">{loadError ? '' : `${totalProducts} ${totalProducts === 1 ? 'product' : 'products'}`}</span>
        </div>
      </div>

      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col lg:flex-row gap-8">
            <aside className={`${isFilterOpen ? 'fixed inset-0 z-50 bg-white overflow-y-auto' : 'hidden'} lg:block lg:w-72 lg:flex-shrink-0`}>
              <div className="lg:sticky lg:top-24">
                <div className="bg-white lg:rounded-2xl lg:shadow-sm p-6 lg:border lg:border-gray-100">
                  <div className="flex items-center justify-between mb-6 lg:hidden">
                    <h2 className="text-xl font-bold text-gsg-black">Filters</h2>
                    <button
                      type="button"
                      onClick={() => setIsFilterOpen(false)}
                      aria-label="Close filters"
                      className="w-10 h-10 flex items-center justify-center text-gray-700 hover:bg-gray-100 rounded-full"
                    >
                      <i className="ri-close-line text-2xl" aria-hidden="true"></i>
                    </button>
                  </div>

                  <div className="space-y-8">
                    {/* Categories */}
                    <div>
                      <h3 className="font-bold text-gsg-black mb-4 flex items-center gap-2">
                        <i className="ri-layout-grid-line text-gsg-purple"></i>
                        Categories
                      </h3>
                      <div className="space-y-1">
                        <button
                          onClick={() => {
                            setSelectedCategory('all');
                            setIsFilterOpen(false);
                          }}
                          className={`w-full text-left px-4 py-2.5 rounded-lg transition-all ${selectedCategory === 'all'
                            ? 'bg-gsg-purple text-white font-medium shadow-md'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gsg-purple'
                            }`}
                        >
                          All Products
                        </button>

                        {/* Parent Categories */}
                        {categories.filter(c => !c.parent_id && c.id !== 'all').map(parent => {
                          const subcategories = categories.filter(c => c.parent_id === parent.id);
                          const isSelected = selectedCategory === parent.slug;
                          const isChildSelected = subcategories.some(sub => sub.slug === selectedCategory);
                          
                          return (
                            <div key={parent.id} className="space-y-1">
                              <button
                                onClick={() => {
                                  setSelectedCategory(parent.slug);
                                }}
                                className={`w-full text-left px-4 py-2.5 rounded-lg transition-all flex justify-between items-center ${isSelected
                                  ? 'bg-gsg-purple/10 text-gsg-purple font-bold'
                                  : 'text-gray-600 hover:bg-gray-50 hover:text-gsg-purple'
                                  }`}
                              >
                                <span>{parent.name}</span>
                              </button>

                              {/* Subcategories */}
                              {subcategories.length > 0 && (
                                <div className="ml-4 border-l-2 border-gray-100 pl-2 space-y-1">
                                  {subcategories.map(child => (
                                    <button
                                      key={child.id}
                                      onClick={() => {
                                        setSelectedCategory(child.slug);
                                        setIsFilterOpen(false);
                                      }}
                                      className={`w-full text-left px-4 py-2 rounded-lg text-sm transition-all ${selectedCategory === child.slug
                                        ? 'text-gsg-purple font-bold bg-gsg-purple/5'
                                        : 'text-gray-500 hover:text-gsg-purple hover:bg-gray-50'
                                        }`}
                                    >
                                      {child.name}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Price Range */}
                    <div className="border-t border-gray-100 pt-8">
                      <h3 className="font-bold text-gsg-black mb-4 flex items-center gap-2">
                        <i className="ri-money-dollar-circle-line text-gsg-purple"></i>
                        Price Range
                      </h3>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between text-sm font-medium text-gsg-purple">
                          <span>GH₵0</span>
                          <span>GH₵{priceRange[1]}</span>
                        </div>
                        <label htmlFor="shop-price-max" className="sr-only">Maximum price</label>
                        <input
                          id="shop-price-max"
                          type="range"
                          min="0"
                          max="5000"
                          step="50"
                          value={priceRange[1]}
                          onChange={(e) => {
                            setPriceRange([0, parseInt(e.target.value)]);
                            setPage(1);
                          }}
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-gsg-purple"
                        />
                      </div>
                    </div>

                    <button
                      onClick={() => setIsFilterOpen(false)}
                      className="w-full bg-gsg-black hover:bg-gsg-purple text-white py-3.5 rounded-xl font-bold transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 lg:hidden"
                    >
                      Show Results
                    </button>
                  </div>
                </div>
              </div>
            </aside>

            <div className="flex-1">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-8 flex flex-col sm:flex-row items-center justify-between gap-4">
                <p className="text-gray-600 font-medium" aria-live="polite">
                  {loading
                    ? 'Loading products…'
                    : loadError
                      ? 'Products could not be loaded'
                      : totalProducts === 0
                        ? 'No products found'
                        : <>Showing <span className="text-gsg-black font-bold">{firstShown}–{lastShown}</span> of <span className="text-gsg-black font-bold">{totalProducts}</span> {totalProducts === 1 ? 'product' : 'products'}{search ? <> for &ldquo;{search}&rdquo;</> : null}</>}
                </p>

                <div className="flex items-center space-x-3 w-full sm:w-auto">
                  <label htmlFor="shop-sort" className="text-sm text-gray-500 whitespace-nowrap hidden sm:block">Sort by:</label>
                  <div className="relative w-full sm:w-48">
                    <select
                      id="shop-sort"
                      value={sortBy}
                      onChange={(e) => {
                        setSortBy(e.target.value);
                      }}
                      className="w-full appearance-none px-4 py-2.5 pr-10 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple text-sm font-medium text-gsg-black cursor-pointer transition-all hover:bg-white"
                    >
                      <option value="new">Newest Arrivals</option>
                      <option value="price-low">Price: Low to High</option>
                      <option value="price-high">Price: High to Low</option>
                    </select>
                    <i className="ri-arrow-down-s-line absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none"></i>
                  </div>
                </div>
              </div>

              {loading ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-4 md:gap-6">
                  {[...Array(6)].map((_, i) => (
                    <ProductCardSkeleton key={i} />
                  ))}
                </div>
              ) : loadError ? (
                <div className="text-center py-24 bg-white rounded-3xl border border-dashed border-red-200" role="alert">
                  <h3 className="text-2xl font-bold text-gsg-black mb-3">We couldn&apos;t load products</h3>
                  <p className="text-gray-500 mb-8 max-w-md mx-auto">Check your connection and try again.</p>
                  <button
                    type="button"
                    onClick={() => setRetryKey((k) => k + 1)}
                    className="inline-flex items-center bg-gsg-purple hover:bg-gsg-purple-dark text-white px-8 py-3.5 rounded-full font-bold transition-all shadow-lg"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6" data-product-shop>
                    {products.map(product => (
                      <div key={product.id} className="h-full">
                        <ProductCard {...product} />
                      </div>
                    ))}
                  </div>

                  {products.length === 0 && (
                    <div className="text-center py-24 bg-white rounded-3xl border border-dashed border-gray-200">
                      <div className="w-24 h-24 flex items-center justify-center mx-auto mb-6 bg-gray-50 rounded-full">
                        <i className="ri-search-eye-line text-5xl text-gray-300"></i>
                      </div>
                      <h3 className="text-2xl font-bold text-gsg-black mb-3">No Products Found</h3>
                      <p className="text-gray-500 mb-8 max-w-md mx-auto">We couldn't find any products matching your criteria. Try adjusting your filters or search term.</p>
                      <button
                        type="button"
                        onClick={() => {
                          setPriceRange([0, 5000]);
                          setPage(1);
                          router.replace(pathname, { scroll: false });
                        }}
                        className="inline-flex items-center bg-gsg-purple hover:bg-gsg-purple-dark text-white px-8 py-3.5 rounded-full font-bold transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
                      >
                        Clear All Filters
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-16 flex justify-center">
                  <nav className="flex items-center bg-white rounded-full shadow-sm border border-gray-100 p-1" aria-label="Pagination">
                    <button
                      type="button"
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      aria-label="Previous page"
                      className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-gsg-black"
                    >
                      <i className="ri-arrow-left-s-line text-xl" aria-hidden="true"></i>
                    </button>

                    <span className="px-6 font-bold text-gsg-purple">
                      Page {page} <span className="text-gray-400 font-normal">of</span> {totalPages}
                    </span>

                    <button
                      type="button"
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      aria-label="Next page"
                      className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-gsg-black"
                    >
                      <i className="ri-arrow-right-s-line text-xl" aria-hidden="true"></i>
                    </button>
                  </nav>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function ShopPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="w-12 h-12 border-4 border-gsg-purple border-t-transparent rounded-full animate-spin"></div></div>}>
      <ShopContent />
    </Suspense>
  );
}
