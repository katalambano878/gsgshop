'use client';

import Link from 'next/link';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { notifyMetaCatalog } from '@/lib/meta-admin-client';
import { removeProductImageFiles } from './storage-paths';

const PAGE_SIZE = 1000;

/** Low-stock threshold: metadata.low_stock_threshold, default 5 (same rule as the dashboard). */
function lowStockThreshold(product: any): number {
  const raw = product?.metadata?.low_stock_threshold;
  const n = Number(raw);
  return raw !== null && raw !== undefined && raw !== '' && Number.isFinite(n) && n >= 0 ? n : 5;
}

/** Active, stock-tracked product at or below its threshold (includes out of stock). */
function isLowStock(product: any): boolean {
  return product.status === 'active'
    && product.track_quantity === true
    && Number(product.quantity ?? 0) <= lowStockThreshold(product);
}

function isOutOfStock(product: any): boolean {
  return product.status === 'active'
    && product.track_quantity === true
    && Number(product.quantity ?? 0) <= 0;
}

type BulkAction = 'archived' | 'draft' | 'active' | 'delete';

export default function ProductsPage() {
  return (
    <Suspense fallback={
      <div className="p-12 text-center text-gray-500">
        <i className="ri-loader-4-line animate-spin text-3xl mb-2 inline-block"></i>
        <p>Loading products...</p>
      </div>
    }>
      <ProductsPageInner />
    </Suspense>
  );
}

function ProductsPageInner() {
  const searchParams = useSearchParams();
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [sortBy, setSortBy] = useState('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(searchParams?.get('filter') === 'low-stock');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>(
    searchParams?.get('filter') === 'low-stock' ? 'low' : 'all'
  );
  const [bulkAction, setBulkAction] = useState<BulkAction>('archived');
  const [bulkWorking, setBulkWorking] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [categories, setCategories] = useState<any[]>([]);

  const statusColors: any = {
    'active': 'bg-blue-100 text-blue-700',
    'draft': 'bg-gray-100 text-gray-700',
    'archived': 'bg-amber-100 text-amber-700',
  };

  // Follow ?filter=low-stock (dashboard link), also when it changes while on this page.
  const filterParam = searchParams?.get('filter');
  useEffect(() => {
    if (filterParam === 'low-stock') {
      setStockFilter('low');
      setShowFilters(true);
    }
  }, [filterParam]);

  useEffect(() => {
    fetchProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch when sortBy changes
  }, [sortBy]);

  useEffect(() => {
    fetchCategories();
  }, []);

  // Never keep hidden products selected: changing search or filters clears the selection.
  useEffect(() => {
    setSelectedProducts([]);
  }, [searchQuery, categoryFilter, statusFilter, stockFilter]);

  const fetchCategories = async () => {
    const { data } = await supabase.from('categories').select('id, name').order('name');
    if (data) setCategories(data);
  };

  const fetchProducts = async () => {
    try {
      setLoading(true);
      setLoadError('');
      const buildQuery = () => {
        let query = supabase
          .from('products')
          .select(`
            *,
            categories(name),
            product_variants(count),
            product_images(url, position)
          `);
        if (sortBy === 'newest') query = query.order('created_at', { ascending: false });
        if (sortBy === 'price_asc') query = query.order('price', { ascending: true });
        if (sortBy === 'price_desc') query = query.order('price', { ascending: false });
        if (sortBy === 'name') query = query.order('name', { ascending: true });
        if (sortBy === 'stock') query = query.order('quantity', { ascending: true });
        return query.order('id', { ascending: true });
      };

      // Page through the whole catalogue so no product is silently left out.
      const all: any[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        all.push(...(data || []));
        if (!data || data.length < PAGE_SIZE) break;
      }

      setProducts(all.map((p: any) => {
        const images = [...(p.product_images || [])].sort((a: any, b: any) => (Number(a.position) || 0) - (Number(b.position) || 0));
        return {
          ...p,
          price: Number(p.price) || 0,
          category: p.categories?.name || 'Uncategorized',
          image: images[0]?.url || 'https://via.placeholder.com/300?text=No+Image',
          variantsCount: p.product_variants?.[0]?.count || 0,
          stock: Number(p.quantity ?? 0),
          rating: p.rating_avg || 0
        };
      }));
    } catch (error: any) {
      console.error('Error fetching products:', error);
      setLoadError(error?.message || 'Could not load products.');
    } finally {
      setLoading(false);
    }
  };

  const stats = {
    total: products.length,
    active: products.filter(p => p.status === 'active').length,
    lowStock: products.filter(isLowStock).length,
    outOfStock: products.filter(isOutOfStock).length,
  };

  const filteredProducts = products.filter(product => {
    const term = searchQuery.toLowerCase();
    const matchesSearch = !term
      || product.name.toLowerCase().includes(term)
      || (product.sku && product.sku.toLowerCase().includes(term))
      || (product.category && product.category.toLowerCase().includes(term));
    const matchesCategory = !categoryFilter
      || (categoryFilter === '__none' ? !product.category_id : product.category_id === categoryFilter);
    const matchesStatus = !statusFilter || product.status === statusFilter;
    const matchesStock = stockFilter === 'all'
      || (stockFilter === 'low' && isLowStock(product))
      || (stockFilter === 'out' && isOutOfStock(product));
    return matchesSearch && matchesCategory && matchesStatus && matchesStock;
  });

  /** Selected products that are still visible under the current filters. */
  const visibleSelectedIds = () => {
    const visible = new Set(filteredProducts.map((p) => p.id));
    return selectedProducts.filter((id) => visible.has(id));
  };

  /** Select-all works on the rows currently shown (search + filters), never the whole catalogue. */
  const allVisibleSelected = filteredProducts.length > 0 && filteredProducts.every((p) => selectedProducts.includes(p.id));
  const handleSelectAll = () => {
    setSelectedProducts(allVisibleSelected ? [] : filteredProducts.map((p) => p.id));
  };

  const handleSelectProduct = (productId: string) => {
    if (selectedProducts.includes(productId)) {
      setSelectedProducts(selectedProducts.filter(id => id !== productId));
    } else {
      setSelectedProducts([...selectedProducts, productId]);
    }
  };

  const isLinkedError = (error: any) =>
    error?.code === '23503' || /foreign key|violates/i.test(error?.message || '');

  /** Products (of these ids) that appear on at least one order. */
  const productsWithOrders = async (ids: string[]): Promise<Set<string>> => {
    const linked = new Set<string>();
    for (const id of ids) {
      const { count, error } = await supabase
        .from('order_items')
        .select('id', { count: 'exact', head: true })
        .eq('product_id', id);
      if (error) throw error;
      if ((count ?? 0) > 0) linked.add(id);
    }
    return linked;
  };

  const archiveProducts = async (ids: string[]): Promise<number> => {
    const { data, error } = await supabase
      .from('products')
      .update({ status: 'archived' })
      .in('id', ids)
      .select('id');
    if (error) throw error;
    const updated = new Set((data || []).map((r: any) => r.id));
    setProducts(prev => prev.map(p => updated.has(p.id) ? { ...p, status: 'archived' } : p));
    if (updated.size) void notifyMetaCatalog({ action: 'product', productIds: Array.from(updated) });
    return updated.size;
  };

  /** Delete products that have no orders; their image files are removed from storage too. */
  const deleteProducts = async (ids: string[]): Promise<{ deleted: string[]; linked: string[] }> => {
    const targets = products.filter(p => ids.includes(p.id));
    const imageUrls = targets.flatMap(p => (p.product_images || []).map((img: any) => img.url));
    const { error } = await supabase.from('products').delete().in('id', ids);
    if (error) {
      if (isLinkedError(error)) return { deleted: [], linked: ids };
      throw error;
    }
    const skus = targets.map(p => p.sku).filter(Boolean);
    if (skus.length) void notifyMetaCatalog({ action: 'remove', skus });
    setProducts(prev => prev.filter(p => !ids.includes(p.id)));
    await removeProductImageFiles(imageUrls);
    return { deleted: ids, linked: [] };
  };

  const handleDeleteProduct = async (productId: string) => {
    const product = products.find(p => p.id === productId);
    const name = product?.name || 'this product';
    try {
      const linked = await productsWithOrders([productId]);
      if (linked.size > 0) {
        if (confirm(
          `"${name}" is on past orders, so it cannot be deleted (the orders need it).\n\n` +
          'Archive it instead? Archived products are hidden from the shop and the till, and can be made active again.'
        )) {
          await archiveProducts([productId]);
          alert('Product archived.');
        }
        return;
      }
      if (!confirm(
        `Delete "${name}" permanently?\n\n` +
        'Its images and variants are deleted too, and this cannot be undone. To just hide it from the shop, archive it instead.'
      )) return;
      const result = await deleteProducts([productId]);
      if (result.linked.length) {
        if (confirm(
          `"${name}" is still used by reviews, wishlists or carts, so it cannot be deleted.\n\nArchive it instead?`
        )) {
          await archiveProducts([productId]);
          alert('Product archived.');
        }
        return;
      }
      setSelectedProducts(prev => prev.filter(id => id !== productId));
      alert('Product deleted.');
    } catch (err: any) {
      console.error('Delete error:', err);
      alert('Could not delete the product: ' + (err?.message || 'unknown error'));
    }
  };

  const handleBulkApply = async () => {
    const ids = visibleSelectedIds();
    if (ids.length === 0 || bulkWorking) return;
    const count = `${ids.length} product${ids.length === 1 ? '' : 's'}`;

    setBulkWorking(true);
    try {
      if (bulkAction === 'delete') {
        const linked = await productsWithOrders(ids);
        const deletable = ids.filter(id => !linked.has(id));
        const msg =
          (deletable.length
            ? `Delete ${deletable.length} product${deletable.length === 1 ? '' : 's'} permanently? Their images and variants are deleted too. This cannot be undone.`
            : 'None of the selected products can be deleted.') +
          (linked.size
            ? `\n\n${linked.size} ${linked.size === 1 ? 'is' : 'are'} on past orders and will be archived instead (hidden from the shop and the till).`
            : '');
        if (!confirm(msg)) return;
        let archived = 0;
        if (linked.size) archived = await archiveProducts(Array.from(linked));
        let deleted = 0;
        const blocked: string[] = [];
        // One by one, so one product still used by a review or cart does not block the rest.
        for (const id of deletable) {
          const result = await deleteProducts([id]);
          deleted += result.deleted.length;
          blocked.push(...result.linked);
        }
        if (blocked.length) archived += await archiveProducts(blocked);
        setSelectedProducts([]);
        alert(
          `${deleted} deleted.` +
            (archived ? `\n${archived} archived instead, because orders, reviews, wishlists or carts use them.` : '')
        );
      } else {
        const verb = bulkAction === 'archived'
          ? 'Archive'
          : bulkAction === 'draft' ? 'Set to Draft' : 'Publish (set to Active)';
        const effect = bulkAction === 'active' ? 'They will show in the shop.' : 'They will be hidden from the shop.';
        if (!confirm(`${verb}: ${count}?\n\n${effect}`)) return;
        const { data, error } = await supabase
          .from('products')
          .update({ status: bulkAction })
          .in('id', ids)
          .select('id');
        if (error) throw error;
        const updated = new Set((data || []).map((r: any) => r.id));
        setProducts(prev => prev.map(p => updated.has(p.id) ? { ...p, status: bulkAction } : p));
        if (updated.size) void notifyMetaCatalog({ action: 'product', productIds: Array.from(updated) });
        setSelectedProducts([]);
        alert(updated.size < ids.length
          ? `Only ${updated.size} of ${ids.length} products were updated.`
          : `${count} updated.`);
      }
    } catch (err: any) {
      console.error('Bulk action error:', err);
      alert('Could not complete the action: ' + (err?.message || 'unknown error'));
    } finally {
      setBulkWorking(false);
    }
  };

  const filtersActive = !!(categoryFilter || statusFilter || stockFilter !== 'all');
  const clearFilters = () => {
    setCategoryFilter('');
    setStatusFilter('');
    setStockFilter('all');
  };
  const selectedVisibleCount = visibleSelectedIds().length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Products</h1>
          <p className="text-gray-600 mt-1">Manage your product catalog and inventory</p>
        </div>
        <Link
          href="/admin/products/new"
          className="px-6 py-3 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer flex items-center justify-center md:items-start"
        >
          <i className="ri-add-line mr-2"></i>
          Add Product
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={clearFilters}
          className="bg-white rounded-xl border-2 border-gray-200 p-4 text-left cursor-pointer hover:border-gray-400 transition-colors"
        >
          <p className="text-sm text-gray-600 mb-1">Total Products</p>
          <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
        </button>
        <button
          type="button"
          onClick={() => { setStatusFilter('active'); setStockFilter('all'); setShowFilters(true); }}
          className={`bg-white rounded-xl border-2 p-4 text-left cursor-pointer transition-colors ${statusFilter === 'active' && stockFilter === 'all' ? 'border-blue-600' : 'border-gray-200 hover:border-gray-400'}`}
        >
          <p className="text-sm text-gray-600 mb-1">Active</p>
          <p className="text-2xl font-bold text-blue-700">{stats.active}</p>
        </button>
        <button
          type="button"
          onClick={() => { setStockFilter('low'); setShowFilters(true); }}
          className={`bg-white rounded-xl border-2 p-4 text-left cursor-pointer transition-colors ${stockFilter === 'low' ? 'border-amber-400' : 'border-gray-200 hover:border-amber-300'}`}
        >
          <p className="text-sm text-gray-600 mb-1">Low Stock</p>
          <p className="text-2xl font-bold text-amber-700">{stats.lowStock}</p>
          <p className="text-xs text-gray-500 mt-1">Active, at or below threshold</p>
        </button>
        <button
          type="button"
          onClick={() => { setStockFilter('out'); setShowFilters(true); }}
          className={`bg-white rounded-xl border-2 p-4 text-left cursor-pointer transition-colors ${stockFilter === 'out' ? 'border-red-400' : 'border-gray-200 hover:border-red-300'}`}
        >
          <p className="text-sm text-gray-600 mb-1">Out of Stock</p>
          <p className="text-2xl font-bold text-red-700">{stats.outOfStock}</p>
          <p className="text-xs text-gray-500 mt-1">Active, tracked products</p>
        </button>
      </div>

      {loadError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center justify-between gap-4" role="alert">
          <span>Could not load products: {loadError}</span>
          <button onClick={fetchProducts} className="font-semibold underline cursor-pointer">Retry</button>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
            <div className="flex-1 max-w-md">
              <div className="relative">
                <i className="ri-search-line absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg w-5 h-5 flex items-center justify-center"></i>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search products by name, SKU, or category..."
                  aria-label="Search products"
                  className="w-full pl-12 pr-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="px-4 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:border-gray-400 transition-colors font-medium whitespace-nowrap cursor-pointer"
              >
                <i className="ri-filter-line mr-2"></i>
                Filters{filtersActive ? ' (on)' : ''}
              </button>
              <select
                aria-label="Sort products"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-4 py-3 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium cursor-pointer"
              >
                <option value="newest">Newest First</option>
                <option value="name">Sort by Name</option>
                <option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option>
                <option value="stock">Sort by Stock</option>
              </select>
              <div className="flex border-2 border-gray-300 rounded-lg overflow-hidden">
                <button
                  onClick={() => setViewMode('list')}
                  aria-label="List view"
                  aria-pressed={viewMode === 'list'}
                  className={`w-10 h-10 flex items-center justify-center transition-colors cursor-pointer ${viewMode === 'list' ? 'bg-blue-700 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                >
                  <i className="ri-list-check text-xl w-5 h-5 flex items-center justify-center"></i>
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  aria-label="Grid view"
                  aria-pressed={viewMode === 'grid'}
                  className={`w-10 h-10 flex items-center justify-center border-l-2 border-gray-300 transition-colors cursor-pointer ${viewMode === 'grid' ? 'bg-blue-700 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                >
                  <i className="ri-grid-line text-xl w-5 h-5 flex items-center justify-center"></i>
                </button>
              </div>
            </div>
          </div>

          {showFilters && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg grid md:grid-cols-4 gap-4">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                aria-label="Filter by category"
                className="px-3 py-2 pr-8 border-2 border-gray-300 rounded-lg text-sm cursor-pointer"
              >
                <option value="">All Categories</option>
                <option value="__none">Uncategorized</option>
                {categories.map((cat: any) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by status"
                className="px-3 py-2 pr-8 border-2 border-gray-300 rounded-lg text-sm cursor-pointer"
              >
                <option value="">All Status</option>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </select>
              <select
                value={stockFilter}
                onChange={(e) => setStockFilter(e.target.value as 'all' | 'low' | 'out')}
                aria-label="Filter by stock"
                className="px-3 py-2 pr-8 border-2 border-gray-300 rounded-lg text-sm cursor-pointer"
              >
                <option value="all">All Stock Levels</option>
                <option value="low">Low stock (at or below threshold)</option>
                <option value="out">Out of stock</option>
              </select>
              {filtersActive && (
                <button onClick={clearFilters} className="text-sm font-medium text-blue-700 hover:underline cursor-pointer text-left">
                  Clear filters
                </button>
              )}
            </div>
          )}
        </div>

        {selectedVisibleCount > 0 && (
          <div className="p-4 bg-blue-50 border-b border-blue-200 flex flex-wrap items-center justify-between gap-3">
            <p className="text-blue-800 font-semibold">
              {selectedVisibleCount} product{selectedVisibleCount > 1 ? 's' : ''} selected
            </p>
            <div className="flex items-center space-x-2">
              <select
                value={bulkAction}
                onChange={(e) => setBulkAction(e.target.value as BulkAction)}
                aria-label="Bulk action"
                className="px-3 py-2 pr-8 border-2 border-gray-300 rounded-lg text-sm cursor-pointer bg-white"
              >
                <option value="archived">Archive (hide from shop)</option>
                <option value="draft">Set to Draft</option>
                <option value="active">Set to Active</option>
                <option value="delete">Delete permanently</option>
              </select>
              <button
                onClick={handleBulkApply}
                disabled={bulkWorking}
                className={`px-4 py-2 ${bulkAction === 'delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-700 hover:bg-blue-800'} text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50`}
              >
                {bulkWorking ? 'Working...' : 'Apply'}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="p-12 text-center text-gray-500">
            <i className="ri-loader-4-line animate-spin text-3xl mb-2 inline-block"></i>
            <p>Loading products...</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <i className="ri-inbox-line text-4xl mb-4 text-gray-300 inline-block"></i>
            <p className="text-lg">No products found</p>
            <p className="text-sm text-gray-400 mt-1">Try adjusting your search or filters</p>
          </div>
        ) : viewMode === 'list' ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="py-4 px-6">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={handleSelectAll}
                      aria-label="Select all shown products"
                      className="w-4 h-4 text-blue-700 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                    />
                  </th>
                  <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Product</th>
                  <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">SKU</th>
                  <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Category</th>
                  <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Price</th>
                  <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Stock</th>
                  <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Status</th>
                  <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => (
                  <tr key={product.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-6">
                      <input
                        type="checkbox"
                        checked={selectedProducts.includes(product.id)}
                        onChange={() => handleSelectProduct(product.id)}
                        aria-label={`Select ${product.name}`}
                        className="w-4 h-4 text-blue-700 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                      />
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-16 h-16 bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                          <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">{product.name}</p>
                          <div className="flex items-center mt-1">
                            <span className="text-xs text-gray-400">ID: {product.id.substring(0, 8)}...</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-gray-700 text-sm font-mono">{product.sku || '-'}</td>
                    <td className="py-4 px-4 text-gray-700 text-sm">{product.category}</td>
                    <td className="py-4 px-4 font-semibold text-gray-900 whitespace-nowrap">GH₵ {product.price.toFixed(2)}</td>
                    <td className="py-4 px-4 text-gray-700">
                      {product.track_quantity === true ? product.stock : <span className="text-gray-400" title="Stock not tracked">Not tracked</span>}
                      {isLowStock(product) && !isOutOfStock(product) && (
                        <span className="ml-2 w-2 h-2 rounded-full bg-amber-500 inline-block" title="Low Stock"><span className="sr-only">Low stock</span></span>
                      )}
                      {isOutOfStock(product) && (
                        <span className="ml-2 w-2 h-2 rounded-full bg-red-500 inline-block" title="Out of Stock"><span className="sr-only">Out of stock</span></span>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap capitalize ${statusColors[product.status] || 'bg-gray-100 text-gray-600'}`}>
                        {product.status}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-2">
                        <Link
                          href={`/admin/products/${product.id}`}
                          title="Edit"
                          aria-label={`Edit ${product.name}`}
                          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <i className="ri-edit-line text-lg" aria-hidden="true"></i>
                        </Link>
                        <button
                          onClick={() => handleDeleteProduct(product.id)}
                          title="Delete"
                          aria-label={`Delete ${product.name}`}
                          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <i className="ri-delete-bin-line text-lg"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6 grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredProducts.map((product) => (
              <div key={product.id} className="border-2 border-gray-200 rounded-xl p-4 hover:shadow-lg transition-shadow">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={selectedProducts.includes(product.id)}
                    onChange={() => handleSelectProduct(product.id)}
                    aria-label={`Select ${product.name}`}
                    className="absolute top-2 left-2 w-5 h-5 text-blue-700 border-gray-300 rounded focus:ring-blue-500 cursor-pointer z-10"
                  />
                  <div className="aspect-square bg-gray-100 rounded-lg overflow-hidden mb-3 border border-gray-200">
                    <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
                  </div>
                </div>
                <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold mb-2 capitalize ${statusColors[product.status] || 'bg-gray-100 text-gray-600'}`}>
                  {product.status}
                </span>
                <h3 className="font-semibold text-gray-900 mb-1 line-clamp-2">{product.name}</h3>
                <p className="text-sm text-gray-600 mb-2">{product.category}</p>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-lg font-bold text-gray-900">GH₵ {product.price.toFixed(2)}</p>
                </div>
                <div className="flex items-center justify-between text-sm text-gray-600 mb-3 pb-3 border-b border-gray-200">
                  <span>Stock: {product.track_quantity === true ? product.stock : 'not tracked'}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Link
                    href={`/admin/products/${product.id}`}
                    className="flex-1 bg-blue-700 hover:bg-blue-800 text-white py-2 rounded-lg text-sm font-medium text-center transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Edit
                  </Link>
                  <button
                    onClick={() => handleDeleteProduct(product.id)}
                    title="Delete"
                    aria-label={`Delete ${product.name}`}
                    className="w-9 h-9 flex items-center justify-center border-2 border-gray-300 text-gray-700 hover:border-red-600 hover:text-red-600 rounded-lg transition-colors cursor-pointer"
                  >
                    <i className="ri-delete-bin-line"></i>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="p-6 border-t border-gray-200 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            {filteredProducts.length === 0 ? 'No products' : `Showing ${filteredProducts.length} of ${products.length} product${products.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>
    </div>
  );
}
