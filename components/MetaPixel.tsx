'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { META_PIXEL_ID } from '@/lib/meta-pixel';

/**
 * Meta Pixel base code. Rendered from the root layout, so it runs on every
 * storefront and Personal Shopper page; skipped on /admin. Fires PageView on
 * the first load and again on every client-side navigation.
 */
export default function MetaPixel() {
    const pathname = usePathname() || '';
    const isAdmin = pathname.startsWith('/admin');
    const firstView = useRef(true);

    useEffect(() => {
        if (isAdmin) return;
        // The inline base code already tracked the first PageView.
        if (firstView.current) {
            firstView.current = false;
            return;
        }
        window.fbq?.('track', 'PageView');
    }, [pathname, isAdmin]);

    if (isAdmin) return null;

    return (
        <>
            <Script id="meta-pixel" strategy="afterInteractive">
                {`
                    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
                    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
                    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
                    document,'script','https://connect.facebook.net/en_US/fbevents.js');
                    fbq('init', '${META_PIXEL_ID}');
                    fbq('track', 'PageView');
                `}
            </Script>
            <noscript>
                <img
                    height="1"
                    width="1"
                    style={{ display: 'none' }}
                    alt=""
                    src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
                />
            </noscript>
        </>
    );
}
