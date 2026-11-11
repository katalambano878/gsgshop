'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { trackPixel } from '@/lib/meta-pixel';

export type CartItem = {
    id: string;
    /** Product SKU — the Meta catalogue id. Looked up when a caller doesn't pass it. */
    sku?: string;
    name: string;
    price: number;
    image: string;
    quantity: number;
    variant?: string;
    slug: string;
    maxStock: number;
    moq?: number; // Minimum Order Quantity
};

type CartContextType = {
    cart: CartItem[];
    addToCart: (item: CartItem) => void;
    removeFromCart: (itemId: string, variant?: string) => void;
    updateQuantity: (itemId: string, quantity: number, variant?: string) => void;
    clearCart: () => void;
    cartCount: number;
    subtotal: number;
    isCartOpen: boolean;
    setIsCartOpen: (isOpen: boolean) => void;
};

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

    const addToCart = (newItem: CartItem) => {
        void trackAddToCart(newItem);
        setCart((prevCart) => {
            const existingItemIndex = prevCart.findIndex(
                (item) => item.id === newItem.id && item.variant === newItem.variant
            );

            if (existingItemIndex > -1) {
                const newCart = [...prevCart];
                const existingItem = newCart[existingItemIndex];
                // Ensure we don't exceed max stock
                const newQuantity = Math.min(
                    existingItem.quantity + newItem.quantity,
                    existingItem.maxStock
                );
                newCart[existingItemIndex] = { ...existingItem, quantity: newQuantity };
                return newCart;
            } else {
                return [...prevCart, newItem];
            }
        });

        setIsCartOpen(true); // Open cart when item is added
    };

    const removeFromCart = (itemId: string, variant?: string) => {
        setCart((prevCart) =>
            prevCart.filter((item) => !(item.id === itemId && item.variant === variant))
        );
    };

    const updateQuantity = (itemId: string, quantity: number, variant?: string) => {
        setCart((prevCart) => {
            const item = prevCart.find(i => i.id === itemId && i.variant === variant);
            if (!item) return prevCart;

            const minQty = item.moq || 1;
            
            // If trying to reduce below MOQ, remove the item
            if (quantity < minQty) {
                return prevCart.filter(i => !(i.id === itemId && i.variant === variant));
            }

            // Clamp quantity between MOQ and maxStock
            const clampedQty = Math.min(Math.max(quantity, minQty), item.maxStock);

            return prevCart.map((i) =>
                i.id === itemId && i.variant === variant
                    ? { ...i, quantity: clampedQty }
                    : i
            );
        });
    };

    const clearCart = () => {
        setCart([]);
    };

    const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

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
            setIsCartOpen
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
