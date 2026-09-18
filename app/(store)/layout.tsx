'use client';

import { Suspense } from 'react';
import GSGHeader from '@/components/GSGHeader';
import GSGFooter from '@/components/GSGFooter';
import GSGPromoBanner from '@/components/GSGPromoBanner';
import MobileBottomNav from '@/components/MobileBottomNav';
import ScrollToTop from '@/components/ScrollToTop';
import WhatsAppWidget from '@/components/WhatsAppWidget';
import ErrorBoundary from '@/components/ErrorBoundary';
import NavigationProgress from '@/components/NavigationProgress';
import CookieConsent from '@/components/CookieConsent';
import { CMSProvider } from '@/context/CMSContext';

// Lazy-load non-critical components
import dynamic from 'next/dynamic';
const SessionTimeoutWarning = dynamic(() => import('@/components/SessionTimeoutWarning'), { ssr: false });
const PWAPrompt = dynamic(() => import('@/components/PWAPrompt'), { ssr: false });
const PWAInstaller = dynamic(() => import('@/components/PWAInstaller'), { ssr: false });
const PWASplash = dynamic(() => import('@/components/PWASplash'), { ssr: false });
const OfflineIndicator = dynamic(() => import('@/components/OfflineIndicator'), { ssr: false });
const NetworkStatusMonitor = dynamic(() => import('@/components/NetworkStatusMonitor'), { ssr: false });
const UpdatePrompt = dynamic(() => import('@/components/UpdatePrompt'), { ssr: false });
const LiveSalesNotification = dynamic(() => import('@/components/LiveSalesNotification'), { ssr: false });

export default function StoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CMSProvider>
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      <ScrollToTop />
      <div className="min-h-screen bg-gray-50">
        <PWASplash />
        <PWAInstaller />
        <GSGPromoBanner />
        <GSGHeader />
        <ErrorBoundary>
          <div className="pwa-page-enter">
            {children}
          </div>
        </ErrorBoundary>
        <GSGFooter />
        <MobileBottomNav />
        <SessionTimeoutWarning />
        <PWAPrompt />
        <OfflineIndicator />
        <NetworkStatusMonitor />
        <UpdatePrompt />
        <LiveSalesNotification />
        <CookieConsent />
        <WhatsAppWidget
          greeting={"Hi there! 👋\n\nWelcome to GSG Convenience Goods & More. How can we help you shop today?"}
          prefilledMessage={"Hi GSG! I'd like some help with my order."}
        />
      </div>
    </CMSProvider>
  );
}
