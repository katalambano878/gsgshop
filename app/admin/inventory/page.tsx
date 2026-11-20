'use client';

import { useState, useEffect, Fragment } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { downloadCsv, csvMoney } from '@/lib/csv';
import { adminFetch, errorText } from '@/components/admin/adminFetch';

type Variant = { id: string; name: string; sku: string | null; quantity: number };

type InventoryProduct = {
  id: string;
  name: string;
  slug: string;
  sku: string;
  category: string;
  currentStock: number;
  threshold: number;
  price: number;
  tracked: boolean;
  productStatus: string;
  status: 'good' | 'low' | 'out' | 'untracked';
  variants: Variant[];
};

/** One stock change through the server route (atomic, audit-logged). */
async function adjustStock(body: { productId: string; variantId?: string; delta?: number; setTo?: number; reason?: string }) {
  const res = await adminFetch<{ success: boolean; quantity: number }>('/api/admin/inventory/adjust', { body });
  if (!res.ok || !res.data.success) throw new Error(errorText(res.data, 'Stock not changed'));
  return res.data.quantity;
}

type AdjustTarget = { productId: string; variantId?: string; label: string; current: number };

type ImportRow = {
  line: number;
  key: string;
  quantity: number | null;
  productId?: string;
  variantId?: string;
  label?: string;
  current?: number;
  next?: number;
  error?: string;
};

const DEFAULT_THRESHOLD = 5;
const PAGE_SIZE = 1000;

/** Page through every product: the API caps a single response. */
async function fetchAllProducts(): Promise<any[]> {
  const all: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('products')
      .select(`
        id,
        name,
        slug,
        sku,
        price,
        quantity,
        status,
        track_quantity,
        metadata,
        categories(name),
        product_variants(id, name, sku, quantity)
      `)
      .order('name')
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

/**
 * The shop's low-stock rule: stock is tracked, the product is active, and
 * quantity <= metadata.low_stock_threshold (default 5).
 */
function stockStatus(stock: number, threshold: number, tracked: boolean, active: boolean): InventoryProduct['status'] {
  if (!tracked || !active) return 'untracked';
  if (stock <= 0) return 'out';
  if (stock <= threshold) return 'low';
  return 'good';
}

/** Minimal CSV parser: quoted cells, doubled quotes, commas or semicolons. */
function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] || '';
  const sep = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === sep) {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some(c => c.trim() !== '')) rows.push(row);
  return rows;
}

export default function InventoryManagementPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [stockFilter, setStockFilter] = useState('all');
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // Bulk restock
  const [restockAmount, setRestockAmount] = useState('');
  const [restocking, setRestocking] = useState(false);

  // CSV import
  const [showImportModal, setShowImportModal] = useState(false);
  const [importMode, setImportMode] = useState<'set' | 'add'>('set');
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importReason, setImportReason] = useState('');

  // Single stock change (product or variant)
  const [adjustTarget, setAdjustTarget] = useState<AdjustTarget | null>(null);
  const [adjustMode, setAdjustMode] = useState<'add' | 'subtract' | 'set'>('add');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustError, setAdjustError] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [restockReason, setRestockReason] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);

  useEffect(() => {
    fetchInventory();
  }, []);

  const fetchInventory = async () => {
    try {
      setLoading(true);
      setLoadError('');
      const data = await fetchAllProducts();

      const mapped: InventoryProduct[] = (data || []).map((p: any) => {
        const stock = p.quantity || 0;
        const t = parseInt(p.metadata?.low_stock_threshold, 10);
        const threshold = Number.isFinite(t) ? t : DEFAULT_THRESHOLD;
        const tracked = p.track_quantity !== false;
        // `categories` is a single embedded object (many-to-one), not an array.
        const cat = Array.isArray(p.categories) ? p.categories[0] : p.categories;
        return {
          id: p.id,
          name: p.name,
          slug: p.slug || '',
          sku: p.sku || '',
          category: cat?.name || 'Uncategorized',
          currentStock: stock,
          threshold,
          price: Number(p.price) || 0,
          tracked,
          productStatus: p.status || 'active',
          status: stockStatus(stock, threshold, tracked, (p.status || 'active') === 'active'),
          variants: (p.product_variants || []).map((v: any) => ({
            id: v.id,
            name: v.name,
            sku: v.sku,
            quantity: v.quantity || 0,
          })),
        };
      });
      setProducts(mapped);
    } catch (error: any) {
      console.error('Error fetching inventory:', error);
      setLoadError(`Could not load inventory: ${error?.message || 'unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = products.filter(product => {
    const q = searchTerm.toLowerCase();
    const matchesSearch = product.name.toLowerCase().includes(q) ||
      product.sku.toLowerCase().includes(q) ||
      product.variants.some(v => (v.sku || '').toLowerCase().includes(q));
    const matchesFilter = stockFilter === 'all' || product.status === stockFilter;
    return matchesSearch && matchesFilter;
  });

  const lowStockCount = products.filter(p => p.status === 'low').length;
  const untrackedCount = products.filter(p => p.status === 'untracked').length;
  const outOfStockCount = products.filter(p => p.status === 'out').length;
  const totalValue = products.reduce((sum, p) => sum + (Math.max(p.currentStock, 0) * p.price), 0);

  const toggleProductSelection = (id: string) => {
    setSelectedProducts(prev =>
      prev.includes(id) ? prev.filter(pid => pid !== id) : [...prev, id]
    );
  };

  const toggleAllProducts = () => {
    if (selectedProducts.length === filteredProducts.length) {
      setSelectedProducts([]);
    } else {
      setSelectedProducts(filteredProducts.map(p => p.id));
    }
  };

  const handleBulkRestock = async () => {
    const n = parseInt(restockAmount, 10);
    if (!Number.isFinite(n) || n <= 0 || String(n) !== restockAmount.trim()) {
      setNotice({ kind: 'error', text: 'Enter how many units to add (a whole number above 0).' });
      return;
    }
    const chosen = products.filter(p => selectedProducts.includes(p.id) && filteredProducts.some(f => f.id === p.id));
    const simple = chosen.filter(p => p.variants.length === 0);
    const withVariants = chosen.filter(p => p.variants.length > 0);
    if (simple.length === 0) {
      setNotice({ kind: 'error', text: 'All selected products have variants. Restock those per variant (open the product row) or with Import CSV.' });
      return;
    }
    if (!window.confirm(`Add ${n} to the stock of ${simple.length} product${simple.length > 1 ? 's' : ''}?`)) return;

    setRestocking(true);
    setNotice(null);
    const failed: string[] = [];
    for (const p of simple) {
      try {
        // A delta, applied on the server, so a sale since the page loaded is kept.
        await adjustStock({ productId: p.id, delta: n, reason: restockReason.trim() || 'Bulk restock' });
      } catch (err: any) {
        failed.push(`${p.name}: ${err?.message || 'failed'}`);
      }
    }
    setRestocking(false);
    const done = simple.length - failed.length;
    const skipped = withVariants.length
      ? ` Skipped ${withVariants.length} with variants (restock those per variant).`
      : '';
    setNotice(failed.length
      ? { kind: 'error', text: `Restocked ${done}, ${failed.length} failed: ${failed.join('; ')}.${skipped}` }
      : { kind: 'ok', text: `Added ${n} to ${done} product${done > 1 ? 's' : ''}.${skipped}` });
    setSelectedProducts([]);
    setRestockAmount('');
    setRestockReason('');
    fetchInventory();
  };

  const openAdjust = (target: AdjustTarget) => {
    setAdjustTarget(target);
    setAdjustMode('add');
    setAdjustAmount('');
    setAdjustReason('');
    setAdjustError('');
  };

  const applyAdjust = async () => {
    if (!adjustTarget) return;
    const raw = adjustAmount.trim();
    const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
    if (!Number.isFinite(n) || (adjustMode !== 'set' && n === 0)) {
      setAdjustError(adjustMode === 'set' ? 'Enter the new stock count (a whole number, 0 or more).' : 'Enter a whole number above 0.');
      return;
    }
    if (adjustMode === 'subtract' && n > adjustTarget.current) {
      setAdjustError(`Only ${adjustTarget.current} in stock; you cannot take away ${n}.`);
      return;
    }
    if (!adjustReason.trim()) {
      setAdjustError('Give a reason (for example: delivery from supplier, damaged, stock count).');
      return;
    }
    setAdjusting(true);
    setAdjustError('');
    try {
      const qty = await adjustStock({
        productId: adjustTarget.productId,
        variantId: adjustTarget.variantId,
        ...(adjustMode === 'set' ? { setTo: n } : { delta: adjustMode === 'add' ? n : -n }),
        reason: adjustReason.trim(),
      });
      setNotice({ kind: 'ok', text: `${adjustTarget.label}: stock is now ${qty}.` });
      setAdjustTarget(null);
      fetchInventory();
    } catch (err: any) {
      setAdjustError(err?.message || 'Stock not changed.');
    } finally {
      setAdjusting(false);
    }
  };

  const handleExportCSV = () => {
    const rows: unknown[][] = [];
    for (const p of products) {
      const statusText = p.status === 'untracked' ? (p.tracked ? `not active (${p.productStatus})` : 'not tracked') : p.status === 'good' ? 'in stock' : p.status === 'low' ? 'low stock' : 'out of stock';
      rows.push([p.sku, p.name, '', p.category, p.currentStock, p.threshold, csvMoney(p.price), statusText]);
      for (const v of p.variants) {
        rows.push([v.sku || '', p.name, v.name, p.category, v.quantity, '', '', '']);
      }
    }
    downloadCsv(
      `inventory-${new Date().toISOString().split('T')[0]}.csv`,
      ['SKU', 'Product', 'Variant', 'Category', 'Stock', 'Low stock at', 'Price (GHS)', 'Status'],
      rows
    );
  };

  // ---------- CSV import ----------

  const buildPreview = (text: string, mode: 'set' | 'add'): ImportRow[] | string => {
    const rows = parseCsv(text);
    if (rows.length === 0) return 'The file is empty.';
    const header = rows[0].map(h => h.trim().toLowerCase());
    let keyCol = header.findIndex(h => h === 'sku');
    let nameCol = header.findIndex(h => ['name', 'product', 'product name'].includes(h));
    let qtyCol = header.findIndex(h => ['quantity', 'qty', 'stock'].includes(h));
    let body = rows.slice(1);
    if (qtyCol === -1 && keyCol === -1 && nameCol === -1) {
      // No header row: assume "identifier, quantity".
      keyCol = 0; nameCol = -1; qtyCol = 1; body = rows;
    }
    if (qtyCol === -1) return 'Could not find a quantity column. Use the headings: SKU (or Name), Quantity.';
    if (keyCol === -1 && nameCol === -1) return 'Could not find a SKU or Name column.';

    const variantBySku = new Map<string, { product: InventoryProduct; variant: Variant }[]>();
    const productBySku = new Map<string, InventoryProduct[]>();
    const productByName = new Map<string, InventoryProduct[]>();
    const push = <T,>(m: Map<string, T[]>, k: string, v: T) => {
      if (!k) return;
      m.set(k, [...(m.get(k) || []), v]);
    };
    for (const p of products) {
      push(productBySku, p.sku.trim().toLowerCase(), p);
      push(productByName, p.name.trim().toLowerCase(), p);
      for (const v of p.variants) push(variantBySku, (v.sku || '').trim().toLowerCase(), { product: p, variant: v });
    }

    const seen = new Set<string>();
    return body.map((cells, i): ImportRow => {
      const line = i + (body === rows ? 1 : 2);
      const sku = keyCol >= 0 ? (cells[keyCol] || '').trim() : '';
      const name = nameCol >= 0 ? (cells[nameCol] || '').trim() : '';
      const key = sku || name;
      const rawQty = (cells[qtyCol] || '').trim();
      const qty = /^-?\d+$/.test(rawQty) ? parseInt(rawQty, 10) : null;
      const row: ImportRow = { line, key, quantity: qty };
      if (!key) return { ...row, error: 'No SKU or name' };
      if (qty === null) return { ...row, error: `Quantity "${rawQty}" is not a whole number` };
      if (mode === 'set' && qty < 0) return { ...row, error: 'Quantity cannot be negative' };

      const k = key.toLowerCase();
      const vMatches = sku ? variantBySku.get(sku.toLowerCase()) || [] : [];
      if (vMatches.length > 1) return { ...row, error: 'This SKU is on more than one variant' };
      if (vMatches.length === 1) {
        const { product, variant } = vMatches[0];
        if (seen.has(variant.id)) return { ...row, error: 'Listed twice in this file' };
        seen.add(variant.id);
        const next = mode === 'set' ? qty : variant.quantity + qty;
        if (next < 0) return { ...row, error: 'Stock would go below 0' };
        return { ...row, productId: product.id, variantId: variant.id, label: `${product.name} / ${variant.name}`, current: variant.quantity, next };
      }
      const pMatches = sku ? productBySku.get(k) || [] : productByName.get(k) || [];
      if (pMatches.length === 0 && sku && name) {
        // SKU did not match; fall back to the name column if present.
        const byName = productByName.get(name.toLowerCase()) || [];
        pMatches.push(...byName);
      }
      if (pMatches.length === 0) return { ...row, error: 'No product with this SKU or name' };
      if (pMatches.length > 1) return { ...row, error: `Matches ${pMatches.length} products; use the SKU` };
      const p = pMatches[0];
      if (p.variants.length > 0) return { ...row, label: p.name, error: 'This product has variants; use the variant SKU' };
      if (seen.has(p.id)) return { ...row, error: 'Listed twice in this file' };
      seen.add(p.id);
      const next = mode === 'set' ? qty : p.currentStock + qty;
      if (next < 0) return { ...row, error: 'Stock would go below 0' };
      return { ...row, productId: p.id, label: p.name, current: p.currentStock, next };
    });
  };

  const [importText, setImportText] = useState('');

  const handleImportFile = async (file: File) => {
    setImportError('');
    setImportFileName(file.name);
    const text = await file.text();
    setImportText(text);
    const result = buildPreview(text, importMode);
    if (typeof result === 'string') {
      setImportRows(null);
      setImportError(result);
    } else {
      setImportRows(result);
    }
  };

  const changeImportMode = (mode: 'set' | 'add') => {
    setImportMode(mode);
    if (importText) {
      const result = buildPreview(importText, mode);
      if (typeof result === 'string') { setImportRows(null); setImportError(result); }
      else { setImportRows(result); setImportError(''); }
    }
  };

  const closeImport = () => {
    setShowImportModal(false);
    setImportRows(null);
    setImportText('');
    setImportFileName('');
    setImportError('');
    setImportReason('');
  };

  const applyImport = async () => {
    if (!importRows) return;
    const ok = importRows.filter(r => !r.error && r.next !== r.current);
    if (ok.length === 0) return;
    setImporting(true);
    setImportError('');
    const failed: string[] = [];
    const reason = importReason.trim() || `CSV import${importFileName ? ` (${importFileName})` : ''}`;
    for (const r of ok) {
      try {
        // "Add" mode sends a delta so sales since the file was read are kept;
        // "Set" mode sets the counted number.
        await adjustStock({
          productId: r.productId!,
          variantId: r.variantId,
          ...(importMode === 'set' ? { setTo: r.next! } : { delta: r.next! - r.current! }),
          reason,
        });
      } catch (err: any) {
        failed.push(`line ${r.line} (${r.key}): ${err?.message || 'failed'}`);
      }
    }
    setImporting(false);
    if (failed.length) {
      setImportError(`${ok.length - failed.length} updated, ${failed.length} failed: ${failed.join('; ')}`);
      fetchInventory();
      return;
    }
    closeImport();
    setNotice({ kind: 'ok', text: `Stock updated for ${ok.length} item${ok.length > 1 ? 's' : ''}.` });
    fetchInventory();
  };

  const importReady = importRows?.filter(r => !r.error && r.next !== r.current) || [];
  const importProblems = importRows?.filter(r => r.error) || [];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Inventory</h1>
            <p className="text-gray-600 mt-1 md:mt-2 text-sm md:text-base">Stock levels for every product. Low stock counts active products with tracked stock at or below their own threshold (default {DEFAULT_THRESHOLD}). Every change is recorded with a reason.</p>
          </div>
          <Link
            href="/admin"
            className="bg-gray-900 hover:bg-gray-800 text-white px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap text-center"
          >
            Back to Dashboard
          </Link>
        </div>

        {loadError && (
          <div className="mb-6 flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg" role="alert">
            <i className="ri-error-warning-line text-red-600 mt-0.5"></i>
            <span>{loadError}</span>
          </div>
        )}

        {notice && (
          <div className={`mb-6 flex items-start gap-2 px-4 py-3 rounded-lg border ${notice.kind === 'ok' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`} role="status">
            <i className={`${notice.kind === 'ok' ? 'ri-checkbox-circle-line text-green-600' : 'ri-error-warning-line text-red-600'} mt-0.5`}></i>
            <span className="flex-1">{notice.text}</span>
            <button onClick={() => setNotice(null)} aria-label="Dismiss" className="opacity-70 hover:opacity-100"><i className="ri-close-line"></i></button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Products</p>
                <p className="text-3xl font-bold text-gray-900">{products.length}</p>
              </div>
              <div className="w-12 h-12 flex items-center justify-center bg-blue-100 rounded-lg">
                <i className="ri-stack-line text-2xl text-blue-600"></i>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Low Stock Items</p>
                <p className="text-3xl font-bold text-amber-600">{lowStockCount}</p>
              </div>
              <div className="w-12 h-12 flex items-center justify-center bg-amber-100 rounded-lg">
                <i className="ri-alert-line text-2xl text-amber-600"></i>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Out of Stock</p>
                <p className="text-3xl font-bold text-red-600">{outOfStockCount}</p>
              </div>
              <div className="w-12 h-12 flex items-center justify-center bg-red-100 rounded-lg">
                <i className="ri-close-circle-line text-2xl text-red-600"></i>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Retail Value</p>
                <p className="text-3xl font-bold text-blue-600">GH₵{totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
              </div>
              <div className="w-12 h-12 flex items-center justify-center bg-blue-100 rounded-lg">
                <i className="ri-money-dollar-circle-line text-2xl text-blue-600"></i>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex-1 max-w-md">
              <div className="relative">
                <i className="ri-search-line absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl flex items-center justify-center"></i>
                <input
                  type="text"
                  placeholder="Search by product name or SKU..."
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); setSelectedProducts([]); }}
                  className="w-full pl-12 pr-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center space-x-2 bg-gray-100 rounded-lg p-1">
                {['all', 'low', 'out', 'good', 'untracked'].map((filter) => (
                  <button
                    key={filter}
                    onClick={() => { setStockFilter(filter); setSelectedProducts([]); }}
                    className={`px-4 py-2 rounded-md font-medium text-sm transition-colors whitespace-nowrap cursor-pointer ${stockFilter === filter
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                      }`}
                  >
                    {filter === 'all' && 'All'}
                    {filter === 'low' && `Low (${lowStockCount})`}
                    {filter === 'out' && `Out (${outOfStockCount})`}
                    {filter === 'good' && 'In Stock'}
                    {filter === 'untracked' && `Not tracked (${untrackedCount})`}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setShowImportModal(true)}
                disabled={loading}
                className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-3 rounded-lg font-semibold transition-colors flex items-center space-x-2 whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                <i className="ri-upload-line"></i>
                <span>Import CSV</span>
              </button>

              <button
                onClick={handleExportCSV}
                disabled={loading || products.length === 0}
                className="border-2 border-gray-300 hover:border-gray-400 text-gray-700 px-4 py-3 rounded-lg font-semibold transition-colors flex items-center space-x-2 whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                <i className="ri-download-line"></i>
                <span>Export</span>
              </button>
            </div>
          </div>

          {selectedProducts.length > 0 && (
            <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-gray-800 font-medium">
                {selectedProducts.length} product{selectedProducts.length > 1 ? 's' : ''} selected
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-900">
                  Add
                  <input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={restockAmount}
                    onChange={(e) => setRestockAmount(e.target.value)}
                    className="w-24 px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="0"
                  />
                  units to each
                </label>
                <input
                  type="text"
                  value={restockReason}
                  onChange={(e) => setRestockReason(e.target.value)}
                  placeholder="Reason (e.g. supplier delivery)"
                  aria-label="Reason for restock"
                  className="w-56 px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
                <button
                  onClick={handleBulkRestock}
                  disabled={restocking}
                  className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  {restocking ? 'Restocking...' : 'Restock'}
                </button>
                <button
                  onClick={() => setSelectedProducts([])}
                  className="text-gray-600 hover:text-gray-900 font-medium whitespace-nowrap cursor-pointer"
                >
                  Clear Selection
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-4 text-left">
                    <input
                      type="checkbox"
                      checked={selectedProducts.length === filteredProducts.length && filteredProducts.length > 0}
                      onChange={toggleAllProducts}
                      aria-label="Select all"
                      className="w-5 h-5 text-gray-900 rounded cursor-pointer"
                    />
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Product</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">SKU</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Category</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Stock</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Retail Value</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Status</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr><td colSpan={8} className="p-10 text-center text-gray-500">Loading inventory...</td></tr>
                ) : filteredProducts.length === 0 ? (
                  <tr><td colSpan={8} className="p-10 text-center text-gray-500">No products found.</td></tr>
                ) : (
                  filteredProducts.map((product) => (
                    <Fragment key={product.id}>
                    <tr className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <input
                          type="checkbox"
                          checked={selectedProducts.includes(product.id)}
                          onChange={() => toggleProductSelection(product.id)}
                          aria-label={`Select ${product.name}`}
                          className="w-5 h-5 text-gray-900 rounded cursor-pointer"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-semibold text-gray-900">{product.name}</p>
                        {product.variants.length > 0 && (
                          <button
                            onClick={() => setExpanded(prev => prev.includes(product.id) ? prev.filter(x => x !== product.id) : [...prev, product.id])}
                            aria-expanded={expanded.includes(product.id)}
                            className="text-sm text-blue-700 hover:underline cursor-pointer"
                          >
                            {expanded.includes(product.id) ? 'Hide' : 'Show'} {product.variants.length} variant{product.variants.length > 1 ? 's' : ''}
                          </button>
                        )}
                        {product.productStatus !== 'active' && (
                          <p className="text-xs text-gray-500 capitalize">{product.productStatus}</p>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-700">{product.sku || <span className="text-gray-400">None</span>}</td>
                      <td className="px-6 py-4 text-gray-700">{product.category}</td>
                      <td className="px-6 py-4">
                        <span className="font-semibold text-gray-900">{product.currentStock}</span>
                        {product.tracked && <span className="block text-xs text-gray-500">Low at {product.threshold}</span>}
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-semibold text-gray-900">
                          GH₵{(Math.max(product.currentStock, 0) * product.price).toFixed(2)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {product.status === 'good' && (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-700 whitespace-nowrap">
                            <i className="ri-checkbox-circle-fill mr-1"></i>
                            In Stock
                          </span>
                        )}
                        {product.status === 'low' && (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-amber-100 text-amber-700 whitespace-nowrap">
                            <i className="ri-alert-fill mr-1"></i>
                            Low Stock
                          </span>
                        )}
                        {product.status === 'out' && (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-700 whitespace-nowrap">
                            <i className="ri-close-circle-fill mr-1"></i>
                            Out of Stock
                          </span>
                        )}
                        {product.status === 'untracked' && (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-600 whitespace-nowrap">
                            {product.tracked ? 'Not on sale' : 'Stock not tracked'}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1">
                          {product.variants.length === 0 && (
                            <button
                              onClick={() => openAdjust({ productId: product.id, label: product.name, current: product.currentStock })}
                              className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                              title="Change stock"
                              aria-label={`Change stock of ${product.name}`}
                            >
                              <i className="ri-add-box-line text-lg"></i>
                            </button>
                          )}
                          <Link
                            href={`/admin/products/${product.id}`}
                            className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                            title="Edit product"
                            aria-label={`Edit ${product.name}`}
                          >
                            <i className="ri-edit-line text-lg"></i>
                          </Link>
                          {product.slug && (
                            <a
                              href={`/product/${product.slug}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                              title="View in store (new tab)"
                              aria-label={`View ${product.name} in the store`}
                            >
                              <i className="ri-eye-line text-lg"></i>
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded.includes(product.id) && product.variants.map(v => (
                      <tr key={v.id} className="bg-gray-50/60">
                        <td className="px-6 py-3"></td>
                        <td className="px-6 py-3 text-sm text-gray-700 pl-10"><i className="ri-corner-down-right-line text-gray-400 mr-2"></i>{v.name}</td>
                        <td className="px-6 py-3 text-sm text-gray-600">{v.sku || <span className="text-gray-400">None</span>}</td>
                        <td className="px-6 py-3"></td>
                        <td className="px-6 py-3 text-sm font-semibold text-gray-900">{v.quantity}</td>
                        <td className="px-6 py-3" colSpan={2}></td>
                        <td className="px-6 py-3">
                          <button
                            onClick={() => openAdjust({ productId: product.id, variantId: v.id, label: `${product.name} / ${v.name}`, current: v.quantity })}
                            className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                            title="Change stock"
                            aria-label={`Change stock of ${product.name} ${v.name}`}
                          >
                            <i className="ri-add-box-line text-lg"></i>
                          </button>
                        </td>
                      </tr>
                    ))}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">Import stock from CSV</h2>
              <button onClick={closeImport} aria-label="Close" className="text-gray-500 hover:text-gray-800"><i className="ri-close-line text-xl"></i></button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Columns: <strong>SKU</strong> (or <strong>Name</strong>) and <strong>Quantity</strong>. A variant SKU updates that variant and
              the product total is recalculated from its variants. Nothing changes until you press Apply.
            </p>
            <input
              type="text"
              value={importReason}
              onChange={(e) => setImportReason(e.target.value)}
              placeholder="Reason (e.g. monthly stock count)"
              aria-label="Reason for this import"
              className="w-full mb-4 px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
            />

            <div className="flex flex-wrap gap-4 mb-4 text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="import-mode" checked={importMode === 'set'} onChange={() => changeImportMode('set')} />
                Set stock to the quantity
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="import-mode" checked={importMode === 'add'} onChange={() => changeImportMode('add')} />
                Add the quantity to current stock
              </label>
            </div>

            <label className="block border-2 border-dashed border-gray-300 rounded-lg p-6 text-center mb-4 cursor-pointer hover:border-gray-500 hover:bg-gray-50">
              <i className="ri-upload-cloud-line text-3xl text-gray-400"></i>
              <p className="text-sm text-gray-600 mt-1">{importFileName || 'Choose a .csv file'}</p>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }}
              />
            </label>

            {importError && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm" role="alert">{importError}</div>
            )}

            {importRows && (
              <>
                <p className="text-sm text-gray-700 mb-2">
                  {importReady.length} change{importReady.length === 1 ? '' : 's'} ready
                  {importProblems.length > 0 && `, ${importProblems.length} row${importProblems.length === 1 ? '' : 's'} will be skipped`}.
                </p>
                <div className="border border-gray-200 rounded-lg overflow-x-auto max-h-80 mb-4">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">Line</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">In file</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">Matched</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">Stock</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {importRows.map(r => (
                        <tr key={r.line} className={r.error ? 'bg-red-50/50' : ''}>
                          <td className="px-3 py-2 text-gray-500">{r.line}</td>
                          <td className="px-3 py-2 text-gray-900">{r.key || <span className="text-gray-400">empty</span>}</td>
                          <td className="px-3 py-2 text-gray-700">
                            {r.label}
                            {r.error && <span className="block text-red-700">{r.error}</span>}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {!r.error && (r.next === r.current
                              ? <span className="text-gray-500">{r.current} (no change)</span>
                              : <span>{r.current} <i className="ri-arrow-right-line text-gray-400"></i> <strong>{r.next}</strong></span>)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="flex justify-end gap-3">
              <button onClick={closeImport} className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg font-semibold">Cancel</button>
              <button
                onClick={applyImport}
                disabled={importing || importReady.length === 0}
                className="px-5 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold disabled:opacity-50"
              >
                {importing ? 'Applying...' : `Apply ${importReady.length} change${importReady.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}
      {adjustTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !adjusting && setAdjustTarget(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md" role="dialog" aria-modal="true" aria-labelledby="adjust-title" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 id="adjust-title" className="text-xl font-bold text-gray-900">Change stock</h2>
                <p className="text-sm text-gray-600 mt-1">{adjustTarget.label}: {adjustTarget.current} in stock when the page loaded.</p>
              </div>
              <button onClick={() => setAdjustTarget(null)} disabled={adjusting} aria-label="Close" className="text-gray-500 hover:text-gray-800"><i className="ri-close-line text-xl"></i></button>
            </div>
            <div className="flex gap-2 mb-4">
              {([['add', 'Add'], ['subtract', 'Take away'], ['set', 'Set to']] as const).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => setAdjustMode(m)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border-2 cursor-pointer ${adjustMode === m ? 'border-blue-700 bg-blue-50 text-blue-800' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label htmlFor="adjust-amount" className="block text-sm font-semibold text-gray-700 mb-1">
              {adjustMode === 'set' ? 'New stock count' : 'Units'}
            </label>
            <input
              id="adjust-amount"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={adjustAmount}
              onChange={(e) => setAdjustAmount(e.target.value)}
              className="w-full mb-4 px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <label htmlFor="adjust-reason" className="block text-sm font-semibold text-gray-700 mb-1">Reason</label>
            <input
              id="adjust-reason"
              type="text"
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
              placeholder="e.g. supplier delivery, damaged, stock count"
              className="w-full mb-2 px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {adjustMode !== 'set' && (
              <p className="text-xs text-gray-500 mb-2">Added to or taken from the live stock, so sales made since this page loaded are kept.</p>
            )}
            {adjustError && (
              <div className="mb-3 bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg text-sm" role="alert">{adjustError}</div>
            )}
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setAdjustTarget(null)} disabled={adjusting} className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg font-semibold">Cancel</button>
              <button
                onClick={applyAdjust}
                disabled={adjusting}
                className="px-5 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold disabled:opacity-50"
              >
                {adjusting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
