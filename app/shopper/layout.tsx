import ShopperHeader from '@/components/ShopperHeader';
import GSGFooter from '@/components/GSGFooter';
import WhatsAppWidget from '@/components/WhatsAppWidget';
import { Metadata, Viewport } from 'next';
import { getShopperBaseUrl, getGoodsBaseUrl } from '@/lib/site-urls';

const shopperUrl = getShopperBaseUrl();
const goodsUrl = getGoodsBaseUrl();

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#6B21A8',
};

export const metadata: Metadata = {
  metadataBase: new URL(shopperUrl),
  title: {
    template: '%s | My Personal Shopper by GSG',
    default: 'My Personal Shopper by GSG | List Them, We Shop For You in Ghana',
  },
  description:
    'Ghana\'s premium personal shopper service. Send us your shopping list — we source quality, fresh, and hard-to-find items at the exact source price. 15% or less Markup. Same-day delivery in Accra.',
  keywords: [
    'personal shopper Ghana',
    'personal shopper Accra',
    'shopping service Ghana',
    'grocery delivery Accra',
    'market shopping service',
    'imported goods Ghana',
    'building materials delivery Accra',
    'pharmacy delivery Ghana',
    'GSG personal shopper',
    'shopper.gsgbrands.com.gh',
    'My Personal Shopper by GSG',
    'shop for me Ghana',
    'errand service Accra',
    'Ghana sourcing service',
  ],
  authors: [{ name: 'My Personal Shopper by GSG' }],
  creator: 'GSG Convenience Goods & More',
  publisher: 'GSG Convenience Goods & More',
  applicationName: 'My Personal Shopper by GSG',
  category: 'shopping',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'My Personal Shopper',
  },
  formatDetection: {
    telephone: true,
  },
  openGraph: {
    type: 'website',
    locale: 'en_GH',
    url: shopperUrl,
    title: 'My Personal Shopper by GSG | List Them, We Shop For You',
    description:
      'Send us your list — we source at the exact market price. 15% or less Markup. Same-day delivery in Accra. Quality, fresh, and hard-to-find goods, all delivered to your door.',
    siteName: 'My Personal Shopper by GSG',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'My Personal Shopper by GSG | List Them, We Shop For You',
    description:
      'Ghana\'s premium personal shopper service. Source price guaranteed. 15% or less Markup. WhatsApp updates, 24/7.',
    creator: '@gsgbrandsgh',
  },
  alternates: {
    canonical: shopperUrl,
  },
  other: {
    'msapplication-TileColor': '#6B21A8',
  },
};

const SHOPPER_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  '@id': `${shopperUrl}/#service`,
  name: 'My Personal Shopper by GSG',
  serviceType: 'Personal Shopping & Delivery',
  description:
    'Premium personal shopper service in Ghana. Send your shopping list — we source convenience goods, specialty items, urgent essentials, and building materials at the exact market price.',
  url: shopperUrl,
  image: `${shopperUrl}/opengraph-image`,
  areaServed: {
    '@type': 'Country',
    name: 'Ghana',
  },
  provider: {
    '@type': 'Organization',
    '@id': `${shopperUrl}/#organization`,
    name: 'GSG Convenience Goods & More',
    url: goodsUrl,
    logo: `${goodsUrl}/fgfg.png`,
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer service',
      telephone: '+233-24-603-3792',
      availableLanguage: ['English'],
      areaServed: 'GH',
    },
    sameAs: [
      'https://www.instagram.com/gsgbrandsgh',
      'https://wa.me/233246033792',
    ],
  },
  offers: {
    '@type': 'Offer',
    description:
      'Source price + 15% or less Markup on items + delivery based on distance.',
    priceCurrency: 'GHS',
    availability: 'https://schema.org/InStock',
  },
  hasOfferCatalog: {
    '@type': 'OfferCatalog',
    name: 'Categories We Source',
    itemListElement: [
      {
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Service',
          name: 'Convenience Goods',
          description: 'Everyday essentials from trusted shops and markets.',
        },
      },
      {
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Service',
          name: 'Specialty Goods',
          description: 'Unique, imported, and brand-specific items.',
        },
      },
      {
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Service',
          name: 'Urgent Runs',
          description: 'Pharmacy items and urgent essentials.',
        },
      },
      {
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Service',
          name: 'Building Materials',
          description: 'Construction supplies delivered to site.',
        },
      },
    ],
  },
};

const WEBSITE_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${shopperUrl}/#website`,
  url: shopperUrl,
  name: 'My Personal Shopper by GSG',
  description:
    'Ghana\'s premium personal shopper service. List them — we shop for you.',
  publisher: { '@id': `${shopperUrl}/#organization` },
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: `${shopperUrl}/track?id={search_term_string}`,
    },
    'query-input': 'required name=search_term_string',
  },
  inLanguage: 'en-GH',
};

export default function ShopperLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([SHOPPER_JSON_LD, WEBSITE_JSON_LD]),
        }}
      />
      <ShopperHeader />
      <main className="flex-grow">{children}</main>
      <GSGFooter />
      <WhatsAppWidget
        agentName="GSG Personal Shopper"
        greeting={"Hi there! 👋\n\nWelcome to My Personal Shopper by GSG. Send us your list and we'll shop for you — how can we help?"}
        prefilledMessage={"Hi GSG Personal Shopper! I'd like some help with my shopping list."}
      />
    </div>
  );
}
