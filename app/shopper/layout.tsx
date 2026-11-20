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
    'Personal shopper service in Accra. Send us your shopping list, pay the estimate, and we buy your items at the market price and deliver them to your door. Pay by Mobile Money or card.',
  keywords: [
    'personal shopper Ghana',
    'personal shopper Accra',
    'shopping service Ghana',
    'grocery delivery Accra',
    'market shopping service',
    'imported goods Ghana',
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
      'Send us your list and pay the estimate. We buy at the market price and deliver in Accra, with updates on WhatsApp.',
    siteName: 'My Personal Shopper by GSG',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'My Personal Shopper by GSG | List Them, We Shop For You',
    description:
      'Personal shopper service in Accra. Send your list, pay the estimate, and we shop and deliver. Updates on WhatsApp.',
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
    'Personal shopper service in Accra. Send your shopping list and we buy convenience goods, specialty items and urgent essentials at the market price and deliver them.',
  url: shopperUrl,
  image: `${shopperUrl}/opengraph-image`,
  areaServed: {
    '@type': 'City',
    name: 'Accra',
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
    sameAs: ['https://wa.me/233246033792'],
  },
  offers: {
    '@type': 'Offer',
    description:
      'Market price of the items, plus a markup on the item subtotal shown before you pay, plus a delivery fee based on distance. Paid up front by Mobile Money or card.',
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
    'Personal shopper service in Accra. List them — we shop for you.',
  publisher: { '@id': `${shopperUrl}/#organization` },
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
          __html: JSON.stringify([SHOPPER_JSON_LD, WEBSITE_JSON_LD]).replace(/</g, '\\u003c'),
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
