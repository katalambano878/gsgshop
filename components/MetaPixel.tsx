'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { META_PIXEL_ID } from '@/lib/meta-pixel';

/**
 * Meta Pixel base code. Rendered from the root layout, so it runs on every
 * storefront and Personal Shopper page; skipped on /admin. The Pixel ID comes
 * from Admin → Meta & WhatsApp (/api/meta/config), falling back to the
 * default. Fires PageView on the first load and on every client-side
 * navigation.
 */
export default function MetaPixel() {
    const pathname = usePathname() || '';
    const isAdmin = pathname.startsWith('/admin');
    const [pixelId, setPixelId] = useState<string | null>(null);
    const firstView = useRef(true);

    useEffect(() => {
        if (isAdmin || pixelId) return;
        let cancelled = false;
        fetch('/api/meta/config')
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
            .then((cfg) => {
                if (!cancelled) setPixelId(/^\d+$/.test(cfg?.pixelId || '') ? cfg.pixelId : META_PIXEL_ID);
            });
        return () => {
            cancelled = true;
        };
    }, [isAdmin, pixelId]);

    useEffect(() => {
        if (isAdmin || !pixelId) return;
        // The inline base code already tracked the first PageView.
        if (firstView.current) {
            firstView.current = false;
            return;
        }
        window.fbq?.('track', 'PageView');
    }, [pathname, isAdmin, pixelId]);

    if (isAdmin || !pixelId) return null;

    return (
        <Script id="meta-pixel" strategy="afterInteractive">
            {`
                !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
                n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
                t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
                document,'script','https://connect.facebook.net/en_US/fbevents.js');
                fbq('init', '${pixelId}');
                fbq('track', 'PageView');
            `}
        </Script>
    );
}
