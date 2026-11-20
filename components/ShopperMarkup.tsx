'use client';

import { useShopperSettings } from '@/app/shopper/_lib/shopper-client';

/**
 * The live Personal Shopper markup from the delivery settings, for use inside
 * server-rendered copy. Renders `fallback` until the setting has loaded (or if
 * it cannot be loaded), so the page never shows a guessed percentage.
 */
export default function ShopperMarkup({
  fallback = 'a small',
  suffix = '',
}: {
  fallback?: string;
  suffix?: string;
}) {
  const { markupPct } = useShopperSettings();
  if (markupPct === null) return <>{fallback}</>;
  return (
    <>
      {markupPct}%{suffix}
    </>
  );
}
