import type { Metadata } from 'next';
import { getGoodsBaseUrl, getShopperBaseUrl } from '@/lib/site-urls';

export const SITE_NAME = 'GSG Convenience Goods & More';
export const SITE_TAGLINE = 'Premium Convenience Shopping in Ghana';

export const SHOPPER_SITE_NAME = 'My Personal Shopper by GSG';

export const DEFAULT_DESCRIPTION =
  'Shop groceries, household essentials, personal care, stationery, electronics and more online in Ghana. Fast delivery across Accra and nationwide from GSG Convenience Goods & More.';

export const DEFAULT_KEYWORDS = [
  'GSG Convenience Goods & More',
  'GSG shop Ghana',
  'goods.gsgbrands.com.gh',
  'online shopping Ghana',
  'buy groceries online Accra',
  'household essentials Ghana',
  'convenience store Ghana',
  'ecommerce Ghana',
  'delivery Accra',
  'stationery shop Ghana',
  'personal care products Ghana',
  'phones and electronics Ghana',
];

/** Canonical public origin for the goods storefront (Search Console property). */
export function getSiteUrl(): string {
  return getGoodsBaseUrl();
}

export function absoluteUrl(path: string = '/'): string {
  const base = getSiteUrl();
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalized === '/' ? '' : normalized}`;
}

type PageMetadataInput = {
  title: string;
  description?: string;
  path?: string;
  keywords?: string[];
  noindex?: boolean;
  ogImage?: string;
};

/** Build consistent page metadata with canonical URLs for Google. */
export function createPageMetadata({
  title,
  description = DEFAULT_DESCRIPTION,
  path = '/',
  keywords = [],
  noindex = false,
  ogImage = '/og-image.png',
}: PageMetadataInput): Metadata {
  const url = absoluteUrl(path);
  const fullTitle = title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`;

  return {
    title,
    description,
    keywords: [...new Set([...keywords, ...DEFAULT_KEYWORDS])],
    alternates: {
      canonical: url,
    },
    openGraph: {
      type: 'website',
      locale: 'en_GH',
      url,
      title: fullTitle,
      description,
      siteName: SITE_NAME,
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: SITE_NAME,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [ogImage],
      creator: '@gsgbrandsgh',
    },
    robots: noindex
      ? { index: false, follow: false }
      : {
          index: true,
          follow: true,
          googleBot: {
            index: true,
            follow: true,
            'max-image-preview': 'large',
            'max-snippet': -1,
          },
        },
  };
}

/**
 * Search description for a product. Most catalogue items have no description
 * yet, so we fall back to a factual sentence built from the name, category
 * and price rather than the same generic line on every page.
 */
export function productSeoDescription(product: {
  name: string;
  description?: string | null;
  seo_description?: string | null;
  price?: number | null;
  categoryName?: string | null;
}): string {
  const own = (product.seo_description || product.description || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (own.length >= 40) return own.slice(0, 160);

  const price = product.price && product.price > 0 ? ` for GH₵${product.price.toFixed(2)}` : '';
  const category =
    product.categoryName && product.categoryName !== 'Shop'
      ? ` from our ${product.categoryName.trim()} range`
      : '';
  return `Buy ${product.name}${price}${category} at GSG Convenience Goods & More. Order online in Ghana with pickup in Accra or delivery nationwide.`.slice(0, 160);
}

/** Indexable static storefront routes for sitemap.xml */
export const STORE_STATIC_ROUTES: {
  path: string;
  changeFrequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  priority: number;
}[] = [
  { path: '/', changeFrequency: 'daily', priority: 1 },
  { path: '/shop', changeFrequency: 'daily', priority: 0.95 },
  { path: '/categories', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/about', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/contact', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/faqs', changeFrequency: 'monthly', priority: 0.75 },
  { path: '/shipping', changeFrequency: 'monthly', priority: 0.75 },
  { path: '/returns', changeFrequency: 'monthly', priority: 0.65 },
  { path: '/blog', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/gift-card', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/help', changeFrequency: 'monthly', priority: 0.55 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/cookies', changeFrequency: 'yearly', priority: 0.3 },
];

export function generateOrganizationSchema() {
  const siteUrl = getSiteUrl();
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: siteUrl,
    logo: absoluteUrl('/fgfg.png'),
    description: DEFAULT_DESCRIPTION,
    address: {
      '@type': 'PostalAddress',
      addressCountry: 'GH',
      addressLocality: 'Accra',
    },
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer service',
      telephone: '+233-246-033-792',
      areaServed: 'GH',
      availableLanguage: ['English'],
    },
    sameAs: [
      'https://facebook.com/gsgbrandsgh',
      'https://instagram.com/gsgbrandsgh',
      'https://twitter.com/gsgbrandsgh',
    ],
  };
}

export function generateWebSiteSchema() {
  const siteUrl = getSiteUrl();
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: siteUrl,
    description: DEFAULT_DESCRIPTION,
    inLanguage: 'en-GH',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${siteUrl}/shop?search={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function generateOnlineStoreSchema() {
  const siteUrl = getSiteUrl();
  return {
    '@context': 'https://schema.org',
    '@type': 'OnlineStore',
    name: SITE_NAME,
    url: siteUrl,
    image: absoluteUrl('/og-image.png'),
    description: DEFAULT_DESCRIPTION,
    priceRange: 'GHS',
    currenciesAccepted: 'GHS',
    paymentAccepted: 'Mobile Money, Card',
    areaServed: {
      '@type': 'Country',
      name: 'Ghana',
    },
  };
}

export function generateProductSchema(product: {
  name: string;
  description: string;
  image: string | string[];
  price: number;
  currency?: string;
  sku: string;
  slug: string;
  rating?: number;
  reviewCount?: number;
  availability?: string;
  brand?: string;
  category?: string;
}) {
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    image: product.image,
    sku: product.sku,
    url: absoluteUrl(`/product/${product.slug}`),
  };

  // Only claim a real manufacturer brand. Labelling every product (Coca-Cola,
  // Voltic, ...) with the store's own name is wrong data for Google.
  if (product.brand) {
    schema.brand = { '@type': 'Brand', name: product.brand };
  }

  // Google rejects offers priced at 0 and stops treating the page as a
  // product listing, so an unpriced product publishes no offer at all.
  if (product.price > 0) {
    schema.offers = {
      '@type': 'Offer',
      price: product.price.toFixed(2),
      priceCurrency: product.currency || 'GHS',
      itemCondition: 'https://schema.org/NewCondition',
      availability:
        product.availability === 'in_stock'
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
      url: absoluteUrl(`/product/${product.slug}`),
      priceValidUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0],
      seller: {
        '@type': 'Organization',
        name: SITE_NAME,
      },
    };
  }

  if (product.rating && product.reviewCount) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: product.rating,
      reviewCount: product.reviewCount,
      bestRating: 5,
      worstRating: 1,
    };
  }

  if (product.category) {
    schema.category = product.category;
  }

  return schema;
}

export function generateBreadcrumbSchema(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/** Canonical public origin for the personal-shopper subdomain. */
export function getShopperSiteUrl(): string {
  return getShopperBaseUrl();
}

export function shopperAbsoluteUrl(path: string = '/'): string {
  const base = getShopperSiteUrl();
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalized === '/' ? '' : normalized}`;
}

/** Build consistent metadata with canonical URLs for shopper subdomain pages. */
export function createShopperPageMetadata({
  title,
  description,
  path = '/',
  keywords = [],
  noindex = false,
  ogImage,
}: {
  title: string;
  description: string;
  path?: string;
  keywords?: string[];
  noindex?: boolean;
  ogImage?: string;
}): Metadata {
  const url = shopperAbsoluteUrl(path);
  const fullTitle = title.includes(SHOPPER_SITE_NAME)
    ? title
    : `${title} | ${SHOPPER_SITE_NAME}`;
  const image = ogImage || shopperAbsoluteUrl('/opengraph-image');

  return {
    title,
    description,
    keywords: keywords.length ? keywords : undefined,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      locale: 'en_GH',
      url,
      title: fullTitle,
      description,
      siteName: SHOPPER_SITE_NAME,
      images: [{ url: image, width: 1200, height: 630, alt: SHOPPER_SITE_NAME }],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [image],
      creator: '@gsgbrandsgh',
    },
    robots: noindex
      ? { index: false, follow: false }
      : {
          index: true,
          follow: true,
          googleBot: {
            index: true,
            follow: true,
            'max-image-preview': 'large',
            'max-snippet': -1,
          },
        },
  };
}

export function generateFaqSchema(faqs: { question: string; answer: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };
}
