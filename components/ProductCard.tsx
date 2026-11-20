'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import LazyImage from './LazyImage';
import { useCart } from '@/context/CartContext';

// Map common color names to hex values for swatches
const COLOR_MAP: Record<string, string> = {
  black: '#000000', white: '#FFFFFF', red: '#EF4444', blue: '#3B82F6',
  navy: '#1E3A5F', green: '#22C55E', yellow: '#EAB308', orange: '#F97316',
  pink: '#EC4899', purple: '#A855F7', brown: '#92400E', beige: '#D4C5A9',
  grey: '#6B7280', gray: '#6B7280', cream: '#FFFDD0', teal: '#14B8A6',
  maroon: '#800000', coral: '#FF7F50', burgundy: '#800020', olive: '#808000',
  tan: '#D2B48C', khaki: '#C3B091', charcoal: '#36454F', ivory: '#FFFFF0',
  gold: '#FFD700', silver: '#C0C0C0', rose: '#FF007F', lavender: '#E6E6FA',
  mint: '#98FB98', peach: '#FFDAB9', wine: '#722F37', denim: '#1560BD',
  nude: '#E3BC9A', camel: '#C19A6B', sage: '#BCB88A', rust: '#B7410E',
  mustard: '#FFDB58', plum: '#8E4585', lilac: '#C8A2C8', stone: '#928E85',
  sand: '#C2B280', taupe: '#483C32', mauve: '#E0B0FF', sky: '#87CEEB',
  forest: '#228B22', cobalt: '#0047AB', emerald: '#50C878', scarlet: '#FF2400',
  aqua: '#00FFFF', turquoise: '#40E0D0', indigo: '#4B0082', crimson: '#DC143C',
  magenta: '#FF00FF', cyan: '#00FFFF', chocolate: '#7B3F00', coffee: '#6F4E37',
};

export function getColorHex(colorName: string): string | null {
  const lower = colorName.toLowerCase().trim();
  if (COLOR_MAP[lower]) return COLOR_MAP[lower];
  // Try partial match (e.g. "Light Blue" -> "blue")
  for (const [key, val] of Object.entries(COLOR_MAP)) {
    if (lower.includes(key)) return val;
  }
  return null;
}

export interface ColorVariant {
  name: string;
  hex: string;
}

interface ProductCardProps {
  id: string;
  slug: string;
  name: string;
  price: number;
  originalPrice?: number;
  image: string;
  rating?: number;
  reviewCount?: number;
  badge?: string;
  inStock?: boolean;
  maxStock?: number;
  moq?: number;
  hasVariants?: boolean;
  minVariantPrice?: number;
  colorVariants?: ColorVariant[];
  size?: string;
}

export default function ProductCard({
  id,
  slug,
  name,
  price,
  originalPrice,
  image,
  badge,
  inStock = true,
  maxStock = 0,
  moq = 1,
  hasVariants = false,
  minVariantPrice,
  colorVariants = [],
  size,
}: ProductCardProps) {
  const { addToCart } = useCart();
  const router = useRouter();
  const [activeColor, setActiveColor] = useState<string | null>(null);
  const [addQty, setAddQty] = useState(moq);
  const [showQtySelector, setShowQtySelector] = useState(false);
  const displayPrice = hasVariants && minVariantPrice ? minVariantPrice : price;
  const discount = originalPrice ? Math.round((1 - displayPrice / originalPrice) * 100) : 0;
  const MAX_SWATCHES = 5;

  const formatPrice = (val: number) => `GH\u20B5${val.toFixed(2)}`;

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (hasVariants) {
      router.push(`/product/${slug}`);
      return;
    }
    setAddQty(Math.max(moq, addQty));
    setShowQtySelector(true);
  };

  const confirmAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    addToCart({ id, name, price, image, quantity: addQty, slug, maxStock, moq });
    setShowQtySelector(false);
  };

  return (
    <div className="group relative bg-white rounded-card border border-gray-100 h-full flex flex-col shadow-sm hover:shadow-md transition-all">
      <div className="relative block aspect-[3/4] overflow-hidden rounded-t-card bg-gray-100">
        <Link href={`/product/${slug}`} className="absolute inset-0 z-0" aria-label={name} tabIndex={-1}>
          <LazyImage
            src={image}
            alt={name}
            className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-700"
          />
        </Link>
        <div className="absolute top-3 left-3 flex flex-col gap-2 z-20">
          {badge && (
            <span className="bg-white/90 backdrop-blur text-gray-900 border border-gray-100 text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 rounded-md shadow-sm">
              {badge}
            </span>
          )}
          {discount > 0 && (
            <span className="bg-red-50 text-red-700 border border-red-100 text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 rounded-md shadow-sm">
              -{discount}%
            </span>
          )}
        </div>

        {!inStock && (
          <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] flex items-center justify-center z-20 pointer-events-none">
            <span className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium">Out of Stock</span>
          </div>
        )}

        {inStock && (
          <>
            <div className="absolute bottom-3 left-3 z-20">
              <button
                type="button"
                onClick={handleAddToCart}
                aria-label={hasVariants ? `Choose options for ${name}` : `Add ${name} to cart`}
                className="bg-white text-gray-900 hover:bg-gsg-purple hover:text-white py-2 px-4 rounded-lg font-medium shadow-lg transition-colors flex items-center gap-1 text-sm"
              >
                <span>Add to Cart</span>
              </button>
            </div>
            {showQtySelector && (
              <div className="absolute bottom-14 left-3 z-30 flex items-center gap-2 bg-white rounded-lg shadow-xl border border-gray-200 p-2">
                <label htmlFor={`qty-${id}`} className="sr-only">Quantity of {name}</label>
                <input
                  id={`qty-${id}`}
                  type="number"
                  min={moq}
                  max={maxStock}
                  value={addQty}
                  onChange={(e) => setAddQty(Math.max(moq, Math.min(maxStock, parseInt(e.target.value, 10) || moq)))}
                  className="w-14 py-1 px-2 border border-gray-300 rounded text-center text-sm"
                />
                <button type="button" onClick={confirmAdd} className="bg-gsg-purple text-white py-1.5 px-3 rounded text-sm font-medium">
                  Add
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex flex-col flex-grow p-4">
        <div className="flex items-baseline gap-2 mb-1">
          {hasVariants && minVariantPrice ? (
            <span className="text-gray-900 font-semibold">From {formatPrice(minVariantPrice)}</span>
          ) : (
            <span className="text-gray-900 font-semibold">{formatPrice(price)}</span>
          )}
          {originalPrice && (
            <span className="text-sm text-gray-400 line-through">{formatPrice(originalPrice)}</span>
          )}
        </div>
        <Link href={`/product/${slug}`}>
          <h3 className="font-medium text-gray-900 mb-1 group-hover:text-gsg-purple transition-colors line-clamp-2">
            {name}{size ? ` · ${size}` : ''}
          </h3>
        </Link>
        <p className="text-xs text-gray-500">Min order: {moq} {moq === 1 ? 'piece' : 'pieces'}</p>

        {colorVariants.length > 0 && (
          <div className="flex items-center gap-1.5 mt-2">
            {colorVariants.slice(0, MAX_SWATCHES).map((color) => (
              <button
                type="button"
                key={color.name}
                title={color.name}
                aria-label={`Colour ${color.name}`}
                aria-pressed={activeColor === color.name}
                onClick={(e) => { e.preventDefault(); setActiveColor(activeColor === color.name ? null : color.name); }}
                className={`w-4 h-4 rounded-full border flex-shrink-0 ${activeColor === color.name ? 'ring-2 ring-offset-1 ring-gsg-purple scale-110' : ''} ${color.hex === '#FFFFFF' ? 'border-gray-300' : 'border-transparent'}`}
                style={{ backgroundColor: color.hex }}
              />
            ))}
          </div>
        )}

        <div className="mt-auto pt-3 lg:hidden">
          {hasVariants ? (
            <Link href={`/product/${slug}`} className="w-full border border-gray-200 text-gray-900 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center justify-center gap-1">
              <i className="ri-list-check" aria-hidden="true"></i>
              <span>Select Options</span>
            </Link>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); setAddQty(Math.max(moq, addQty)); setShowQtySelector(true); }}
              disabled={!inStock}
              aria-label={inStock ? `Buy ${name}` : `${name} is out of stock`}
              className="w-full border border-gray-200 text-gray-900 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              {inStock ? 'Buy' : 'Out of Stock'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
