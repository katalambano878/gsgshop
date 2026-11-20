'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { trackPixel } from '@/lib/meta-pixel';
import { sellableStock } from '@/context/stock';

export { UNLIMITED_STOCK, sellableStock, isPurchasable, stockCount } from '@/context/stock';

export type CartItem = {
    id: string;
    /** Product SKU — the Meta catalogue id. Looked up when a caller doesn't pass it. */
    sku?: string;
    name: string;
    price: number;
    image: string;
    quantity: number;
    variant?: string;
    /** product_variants.id when a variant was chosen; the server prices the line from it. */
    variantId?: string;
    slug: string;
    maxStock: number;
    moq?: number; // Minimum Order Quantity
};

/** One thing that changed when the cart was checked against the live catalogue. */
export type CartChange = {
    id: string;
    variantId?: string;
    kind: 'removed' | 'price' | 'quantity';
    message: string;
};

type CartContextType = {
    cart: CartItem[];
    addToCart: (item: CartItem) => void;
    removeFromCart: (itemId: string, variant?: string, variantId?: string) => void;
    updateQuantity: (itemId: string, quantity: number, variant?: string, variantId?: string) => void;
    clearCart: () => void;
    cartCount: number;
    subtotal: number;
    isCartOpen: boolean;
    setIsCartOpen: (isOpen: boolean) => void;
    /** True once the saved cart has been read from this browser. */
    ready: boolean;
    /**
     * Re-read current prices and stock for everything in the cart and update
     * it. Resolves to the list of changes, or null when the catalogue could not
     * be reached (the cart is then left as it was).
     */
    refreshCart: () => Promise<CartChange[] | null>;
};

const sameCartLine = (item: { id: string; variant?: string; variantId?: string }, other: { id: string; variant?: string; variantId?: string }) => {
    if (item.id !== other.id) return false;
    if (item.variantId || other.variantId) return item.variantId === other.variantId;
    return (item.variant || '') === (other.variant || '');
};

const lineMatches = (item: CartItem, itemId: string, variant?: string, variantId?: string) =>
    item.id === itemId && (variantId ? item.variantId === variantId : (item.variant || '') === (variant || ''));

const CartContext = createContext<CartContextType | undefined>(undefined);

// Meta Pixel AddToCart. content_ids must be the SKU (the id in /feed/meta.csv);
// product cards only know the product id, so look the SKU up once and cache it.
const skuCache = new Map<string, string>();
async function trackAddToCart(item: CartItem) {
    let sku = item.sku || skuCache.get(item.id);
    if (!sku) {
        try {
            const { data } = await supabase.from('products').select('sku').eq('id', item.id).maybeSingle();
            sku = (data?.sku as string | undefined) || undefined;
        } catch {
            /* fall back to the product id */
        }
    }
    if (sku) skuCache.set(item.id, sku);
    trackPixel('AddToCart', {
        content_ids: [sku || item.id],
        content_type: 'product',
        content_name: item.name,
        value: Math.round(item.price * item.quantity * 100) / 100,
        currency: 'GHS',
        contents: [{ id: sku || item.id, quantity: item.quantity, item_price: item.price }],
    });
}

export function CartProvider({ children }: { children: ReactNode }) {
    const [cart, setCart] = useState<CartItem[]>([]);
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);

    // Load cart from localStorage on mount, with migration for legacy items
    useEffect(() => {
        const savedCart = localStorage.getItem('cart');
        if (savedCart) {
            try {
                const parsed: CartItem[] = JSON.parse(savedCart);
                // Migrate legacy cart items: if `id` is not a UUID, it's likely a slug
                const isValidUUID = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
                const migratedCart = parsed.filter(item => {
                    if (!item.id || !item.name || !item.price) return false; // Remove corrupted items
                    if (!(Number(item.quantity) >= 1)) return false; // A line can never hold 0
                    if (!isValidUUID(item.id)) {
                        // Legacy item with slug as id - ensure slug is set, then clear
                        // These items will be resolved at checkout via the slug fallback
                        // But best to remove them so users re-add with correct UUIDs
                        console.warn(`Removing legacy cart item with non-UUID id: ${item.id}`);
                        return false;
                    }
                    // Ensure slug field exists
                    if (!item.slug) {
                        item.slug = item.id;
                    }
                    return true;
                });
                setCart(migratedCart);
                // If items were removed, update localStorage immediately
                if (migratedCart.length !== parsed.length) {
                    localStorage.setItem('cart', JSON.stringify(migratedCart));
                }
            } catch (e) {
                console.error('Failed to parse cart:', e);
                localStorage.removeItem('cart');
            }
        }
        setIsInitialized(true);
    }, []);

    // Save cart to localStorage whenever it changes
    useEffect(() => {
        if (isInitialized) {
            localStorage.setItem('cart', JSON.stringify(cart));
            window.dispatchEvent(new Event('cartUpdated')); // Keep compatibility with legacy listeners if any
        }
    }, [cart, isInitialized]);

    const addToCart = (rawItem: CartItem) => {
        const moq = Math.max(1, Math.floor(Number(rawItem.moq) || 1));
        const maxStock = Math.max(0, Math.floor(Number(rawItem.maxStock) || 0));
        // Nothing to add when there is not even the minimum available.
        if (maxStock < moq) return;
        const newItem: CartItem = {
            ...rawItem,
            moq,
            maxStock,
            quantity: Math.min(Math.max(Math.floor(Number(rawItem.quantity) || moq), moq), maxStock),
        };
        void trackAddToCart(newItem);
        setCart((prevCart) => {
            const existingItemIndex = prevCart.findIndex((item) => sameCartLine(item, newItem));

            if (existingItemIndex > -1) {
                const newCart = [...prevCart];
                const existingItem = newCart[existingItemIndex];
                // Never exceed what can be sold
                const newQuantity = Math.min(existingItem.quantity + newItem.quantity, newItem.maxStock);
                newCart[existingItemIndex] = {
                    ...existingItem,
                    price: newItem.price,
                    maxStock: newItem.maxStock,
                    moq: newItem.moq,
                    quantity: Math.max(newQuantity, newItem.moq || 1),
                };
                return newCart;
            } else {
                return [...prevCart, newItem];
            }
        });

        setIsCartOpen(true); // Open cart when item is added
    };

    const removeFromCart = (itemId: string, variant?: string, variantId?: string) => {
        setCart((prevCart) => prevCart.filter((item) => !lineMatches(item, itemId, variant, variantId)));
    };

    const updateQuantity = (itemId: string, quantity: number, variant?: string, variantId?: string) => {
        setCart((prevCart) => {
            const item = prevCart.find((i) => lineMatches(i, itemId, variant, variantId));
            if (!item) return prevCart;

            const minQty = item.moq || 1;

            // If trying to reduce below MOQ, remove the item
            if (quantity < minQty) {
                return prevCart.filter((i) => !lineMatches(i, itemId, variant, variantId));
            }

            // Clamp quantity between MOQ and maxStock
            const clampedQty = Math.min(Math.max(quantity, minQty), item.maxStock);

            return prevCart.map((i) =>
                lineMatches(i, itemId, variant, variantId) ? { ...i, quantity: clampedQty } : i
            );
        });
    };

    const clearCart = () => {
        setCart([]);
    };

    const cartRef = useRef<CartItem[]>(cart);
    cartRef.current = cart;

    const refreshCart = useCallback(async (): Promise<CartChange[] | null> => {
        const current = cartRef.current;
        if (current.length === 0) return [];
        const ids = Array.from(new Set(current.map((i) => i.id)));
        let rows: any[] | null = null;
        try {
            const { data, error } = await supabase
                .from('products')
                .select('id, name, price, quantity, status, track_quantity, continue_selling, moq, product_variants(id, name, price, quantity, option1, option2, option3)')
                .eq('status', 'active')
                .in('id', ids);
            if (error) return null;
            rows = data || [];
        } catch {
            return null;
        }

        const byId = new Map<string, any>((rows || []).map((p: any) => [p.id, p]));
        const changes: CartChange[] = [];
        const fmt = (n: number) => `GH₵${n.toFixed(2)}`;
        // For each line as it was when the check started: its fresh version, or null to remove it.
        const updates = new Map<CartItem, CartItem | null>();

        for (const item of current) {
            const label = item.variant ? `${item.name} (${item.variant})` : item.name;
            const product = byId.get(item.id);
            const productVariants: any[] = product?.product_variants || [];
            let variant: any = null;
            if (item.variantId) {
                variant = productVariants.find((v: any) => v.id === item.variantId) || null;
            } else if (item.variant && productVariants.length > 0) {
                // Older carts saved only the option label; match it to a variant.
                const wanted = item.variant.trim().toLowerCase();
                variant = productVariants.find((v: any) => {
                    const opts = [v.option1, v.option2, v.option3].filter(Boolean).join(' / ').toLowerCase();
                    return (v.name || '').trim().toLowerCase() === wanted || (opts && opts === wanted);
                }) || null;
            }
            if (!product || (item.variantId && !variant)) {
                changes.push({ id: item.id, variantId: item.variantId, kind: 'removed', message: `${label} is no longer available and was removed from your cart.` });
                updates.set(item, null);
                continue;
            }
            if (!variant && productVariants.length > 0) {
                changes.push({ id: item.id, variantId: item.variantId, kind: 'removed', message: `Please choose the option for ${item.name} again; it was removed from your cart.` });
                updates.set(item, null);
                continue;
            }
            const stock = sellableStock(variant ? variant.quantity : product.quantity, product);
            const moq = Math.max(1, Number(product.moq) || 1);
            const price = Number(variant ? (variant.price ?? product.price) : product.price);

            if (stock < moq) {
                changes.push({ id: item.id, variantId: item.variantId, kind: 'removed', message: `${label} is out of stock and was removed from your cart.` });
                updates.set(item, null);
                continue;
            }
            let quantity = Math.max(item.quantity, moq);
            if (quantity > stock) {
                quantity = stock;
                changes.push({ id: item.id, variantId: item.variantId, kind: 'quantity', message: `Only ${stock} of ${label} left, so we changed the quantity to ${stock}.` });
            } else if (quantity !== item.quantity) {
                changes.push({ id: item.id, variantId: item.variantId, kind: 'quantity', message: `${label} has a minimum order of ${moq}, so we changed the quantity to ${moq}.` });
            }
            if (Number.isFinite(price) && Math.abs(price - item.price) > 0.001) {
                changes.push({ id: item.id, variantId: item.variantId, kind: 'price', message: `The price of ${label} changed from ${fmt(item.price)} to ${fmt(price)}.` });
            }
            const fresh: CartItem = {
                ...item,
                name: product.name || item.name,
                variantId: variant?.id ?? item.variantId,
                price: Number.isFinite(price) ? price : item.price,
                quantity,
                maxStock: stock,
                moq,
            };
            const same =
                fresh.price === item.price && fresh.quantity === item.quantity && fresh.maxStock === item.maxStock &&
                fresh.moq === item.moq && fresh.variantId === item.variantId && fresh.name === item.name;
            if (!same) updates.set(item, fresh);
        }

        if (updates.size > 0) {
            // Apply against the latest cart so lines added or changed meanwhile are kept.
            setCart((prev) =>
                prev
                    .map((line) => {
                        const original = current.find((o) => o === line) || current.find((o) => sameCartLine(o, line));
                        if (!original || !updates.has(original)) return line;
                        const fresh = updates.get(original);
                        if (!fresh) return null;
                        return {
                            ...line,
                            name: fresh.name,
                            variantId: fresh.variantId,
                            price: fresh.price,
                            quantity: Math.min(Math.max(line.quantity, fresh.moq || 1), fresh.maxStock),
                            maxStock: fresh.maxStock,
                            moq: fresh.moq,
                        };
                    })
                    .filter((l): l is CartItem => l !== null)
            );
        }
        return changes;
    }, []);

    const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const subtotal = round2(cart.reduce((sum, item) => sum + round2(item.price) * item.quantity, 0));

    return (
        <CartContext.Provider value={{
            cart,
            addToCart,
            removeFromCart,
            updateQuantity,
            clearCart,
            cartCount,
            subtotal,
            isCartOpen,
            setIsCartOpen,
            ready: isInitialized,
            refreshCart,
        }}>
            {children}
        </CartContext.Provider>
    );
}

export function useCart() {
    const context = useContext(CartContext);
    if (context === undefined) {
        throw new Error('useCart must be used within a CartProvider');
    }
    return context;
}
