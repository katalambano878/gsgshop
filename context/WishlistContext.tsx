'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { isPurchasable, sellableStock, stockCount } from '@/context/stock';

export type WishlistItem = {
    id: string;
    name: string;
    price: number;
    originalPrice?: number;
    image: string;
    rating?: number;
    reviewCount?: number;
    badge?: string;
    inStock: boolean;
    slug: string;
    /** Filled by refreshWishlist(): current sellable stock and minimum order. */
    maxStock?: number;
    moq?: number;
    hasVariants?: boolean;
};

type WishlistContextType = {
    wishlist: WishlistItem[];
    addToWishlist: (item: WishlistItem) => void;
    removeFromWishlist: (itemId: string) => void;
    isInWishlist: (itemId: string) => boolean;
    clearWishlist: () => void;
    wishlistCount: number;
    /** True once the saved list (this browser, or the account) has loaded. */
    ready: boolean;
    /** Signed in: the list is saved to the account. */
    synced: boolean;
    /**
     * Re-read current price and stock for every saved product. Products that
     * are no longer sold are dropped. Resolves to false when the catalogue
     * could not be reached.
     */
    refreshWishlist: () => Promise<boolean>;
};

const WishlistContext = createContext<WishlistContextType | undefined>(undefined);

const STORAGE_KEY = 'wishlist';
const PRODUCT_COLUMNS =
    'id, name, slug, price, compare_at_price, status, quantity, track_quantity, continue_selling, moq, rating_avg, review_count, product_images(url, position), product_variants(id, price, quantity)';

/** Turn a products row (with images and variants) into a wishlist line. */
function toItem(p: any): WishlistItem {
    const variants: any[] = p.product_variants || [];
    const hasVariants = variants.length > 0;
    const images = [...(p.product_images || [])].sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
    const minVariantPrice = hasVariants
        ? Math.min(...variants.map((v: any) => Number(v.price ?? p.price) || 0))
        : null;
    const price = Number(minVariantPrice ?? p.price) || 0;
    const compare = Number(p.compare_at_price) || 0;
    return {
        id: p.id,
        slug: p.slug || p.id,
        name: p.name,
        price,
        originalPrice: compare > price ? compare : undefined,
        image: images[0]?.url || '',
        rating: Number(p.rating_avg) || 0,
        reviewCount: Number(p.review_count) || 0,
        inStock: isPurchasable(p, variants),
        maxStock: hasVariants ? 0 : sellableStock(stockCount(p, variants), p),
        moq: Math.max(1, Number(p.moq) || 1),
        hasVariants,
    };
}

function readLocal(): WishlistItem[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((i) => i && typeof i.id === 'string') : [];
    } catch {
        return [];
    }
}

function writeLocal(items: WishlistItem[]) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
        /* storage full or blocked */
    }
}

export function WishlistProvider({ children }: { children: ReactNode }) {
    const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
    const [isInitialized, setIsInitialized] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    const userIdRef = useRef<string | null>(null);
    userIdRef.current = userId;
    const wishlistRef = useRef<WishlistItem[]>(wishlist);
    wishlistRef.current = wishlist;

    // Guests: this browser's list.
    useEffect(() => {
        setWishlist(readLocal());
        setIsInitialized(true);
    }, []);

    // Keep this browser's copy current (also used as the guest list).
    useEffect(() => {
        if (isInitialized) writeLocal(wishlist);
    }, [wishlist, isInitialized]);

    // Signed in: load the account's list and merge in what was saved as a guest.
    const loadAccountList = useCallback(async (uid: string) => {
        const { data, error } = await supabase
            .from('wishlist_items')
            .select(`product_id, created_at, products(${PRODUCT_COLUMNS})`)
            .eq('user_id', uid)
            .order('created_at', { ascending: false });
        if (error) {
            console.error('Wishlist load failed:', error.message);
            return;
        }
        const serverItems: WishlistItem[] = (data || [])
            .map((row: any) => (Array.isArray(row.products) ? row.products[0] : row.products))
            .filter((p: any) => p && p.status === 'active')
            .map(toItem);
        const serverIds = new Set(serverItems.map((i) => i.id));
        const guestOnly = readLocal().filter((i) => !serverIds.has(i.id));
        if (guestOnly.length > 0) {
            const { error: insertError } = await supabase
                .from('wishlist_items')
                .upsert(
                    guestOnly.map((i) => ({ user_id: uid, product_id: i.id })),
                    { onConflict: 'user_id,product_id' }
                );
            if (insertError) console.error('Wishlist merge failed:', insertError.message);
        }
        if (userIdRef.current === uid) setWishlist([...serverItems, ...guestOnly]);
    }, []);

    useEffect(() => {
        let active = true;
        const apply = (uid: string | null) => {
            const prev = userIdRef.current;
            userIdRef.current = uid;
            setUserId(uid);
            // Signing out leaves this browser's copy as the guest list.
            if (uid && uid !== prev) void loadAccountList(uid);
        };
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (active) apply(session?.user?.id ?? null);
        });
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            if (active) apply(session?.user?.id ?? null);
        });
        return () => {
            active = false;
            subscription.unsubscribe();
        };
    }, [loadAccountList]);

    const addToWishlist = (item: WishlistItem) => {
        if (wishlistRef.current.some((i) => i.id === item.id)) return;
        setWishlist((prev) => (prev.some((i) => i.id === item.id) ? prev : [...prev, item]));
        const uid = userIdRef.current;
        if (uid) {
            supabase
                .from('wishlist_items')
                .upsert([{ user_id: uid, product_id: item.id }], { onConflict: 'user_id,product_id' })
                .then(({ error }) => {
                    if (error) console.error('Wishlist save failed:', error.message);
                });
        }
    };

    const removeFromWishlist = (itemId: string) => {
        setWishlist((prev) => prev.filter((item) => item.id !== itemId));
        const uid = userIdRef.current;
        if (uid) {
            supabase
                .from('wishlist_items')
                .delete()
                .eq('user_id', uid)
                .eq('product_id', itemId)
                .then(({ error }) => {
                    if (error) console.error('Wishlist remove failed:', error.message);
                });
        }
    };

    const isInWishlist = (itemId: string) => wishlist.some((item) => item.id === itemId);

    const clearWishlist = () => {
        setWishlist([]);
        const uid = userIdRef.current;
        if (uid) {
            supabase
                .from('wishlist_items')
                .delete()
                .eq('user_id', uid)
                .then(({ error }) => {
                    if (error) console.error('Wishlist clear failed:', error.message);
                });
        }
    };

    const refreshWishlist = useCallback(async (): Promise<boolean> => {
        const ids = wishlistRef.current.map((i) => i.id);
        if (ids.length === 0) return true;
        try {
            const { data, error } = await supabase
                .from('products')
                .select(PRODUCT_COLUMNS)
                .eq('status', 'active')
                .in('id', ids);
            if (error) return false;
            const fresh = new Map<string, WishlistItem>((data || []).map((p: any) => [p.id, toItem(p)]));
            setWishlist((prev) => prev.filter((i) => fresh.has(i.id)).map((i) => fresh.get(i.id)!));
            const uid = userIdRef.current;
            const gone = ids.filter((id) => !fresh.has(id));
            if (uid && gone.length > 0) {
                await supabase.from('wishlist_items').delete().eq('user_id', uid).in('product_id', gone);
            }
            return true;
        } catch {
            return false;
        }
    }, []);

    return (
        <WishlistContext.Provider value={{
            wishlist,
            addToWishlist,
            removeFromWishlist,
            isInWishlist,
            clearWishlist,
            wishlistCount: wishlist.length,
            ready: isInitialized,
            synced: Boolean(userId),
            refreshWishlist,
        }}>
            {children}
        </WishlistContext.Provider>
    );
}

export function useWishlist() {
    const context = useContext(WishlistContext);
    if (context === undefined) {
        throw new Error('useWishlist must be used within a WishlistProvider');
    }
    return context;
}
