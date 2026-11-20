// GSG Convenience Goods & More - Service Worker v2.2
// v2.2: never caches personal data (data API, auth, private storage, API
// routes other than /api/storefront, account/checkout/payment pages); a new
// version waits until the customer taps "Update" instead of reloading pages.
const CACHE_VERSION = 'sl-v2.2';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `dynamic-${CACHE_VERSION}`;
const IMAGE_CACHE = `images-${CACHE_VERSION}`;
const API_CACHE = `api-${CACHE_VERSION}`;

// Core app shell files to pre-cache
const STATIC_ASSETS = [
  '/',
  '/shop',
  '/cart',
  '/wishlist',
  '/categories',
  '/offline',
  '/fgfg.png',
];

// Cache size limits
const DYNAMIC_CACHE_LIMIT = 50;
const IMAGE_CACHE_LIMIT = 100;
const API_CACHE_LIMIT = 30;

// Trim cache to limit
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await cache.delete(keys[0]);
    return trimCache(cacheName, maxItems);
  }
}

// Install: pre-cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing v2.1...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Pre-caching app shell');
        return cache.addAll(STATIC_ASSETS).catch((err) => {
          console.warn('[SW] Some assets failed to cache:', err);
          // Don't fail install if some assets fail
          return Promise.resolve();
        });
      })
  );
  // No skipWaiting() here: the new version takes over only when the customer
  // accepts the update prompt, so a page (e.g. checkout) is never reloaded
  // under them.
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Paths whose responses can hold personal or payment data: never cached.
function isPrivatePath(pathname) {
  if (pathname.startsWith('/rest/v1') || pathname.startsWith('/auth/v1')) return true;
  // Storage: only public object downloads may be cached, never uploads or signed URLs.
  if (pathname.startsWith('/storage/v1') && !pathname.startsWith('/storage/v1/object/public/')) return true;
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/storefront/')) return true;
  return false;
}

// Pages that show one customer's details: always from the network.
const NO_CACHE_PAGES = ['/account', '/auth', '/checkout', '/pay', '/order-success', '/order-tracking', '/returns', '/support', '/admin', '/shopper'];
function isPrivatePage(pathname) {
  return NO_CACHE_PAGES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating v2.1...');
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        return Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== DYNAMIC_CACHE && key !== IMAGE_CACHE && key !== API_CACHE)
            .map((key) => {
              console.log('[SW] Removing old cache:', key);
              return caches.delete(key);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch: smart caching strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension, ws, and other non-http
  if (!url.protocol.startsWith('http')) return;

  // Only this site's own requests are handled (fonts/CDN below excepted).
  const sameOrigin = url.origin === self.location.origin;

  // Personal data, auth and non-storefront API routes: straight to the network.
  if (sameOrigin && isPrivatePath(url.pathname)) return;

  // Admin and other private pages: straight to the network.
  if (sameOrigin && isPrivatePage(url.pathname)) return;

  // Strategy: Images - Cache First (long-lived)
  if (
    request.destination === 'image' ||
    url.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg|ico)$/) ||
    url.pathname.startsWith('/storage/v1/object/public/')
  ) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then((cache) => {
        return cache.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((response) => {
            if (response.ok) {
              cache.put(request, response.clone());
              trimCache(IMAGE_CACHE, IMAGE_CACHE_LIMIT);
            }
            return response;
          }).catch(() => {
            // Return a placeholder for failed images
            return new Response(
              '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect fill="#f3f4f6" width="200" height="200"/><text fill="#9ca3af" font-family="sans-serif" font-size="14" text-anchor="middle" x="100" y="105">Image unavailable</text></svg>',
              { headers: { 'Content-Type': 'image/svg+xml' } }
            );
          });
        });
      })
    );
    return;
  }

  // Strategy: Storefront API (public catalogue) - Network First with cache fallback
  if (sameOrigin && url.pathname.startsWith('/api/storefront/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(API_CACHE).then((cache) => {
              cache.put(request, responseClone);
              trimCache(API_CACHE, API_CACHE_LIMIT);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            return cached || new Response(JSON.stringify({ error: 'Offline' }), {
              headers: { 'Content-Type': 'application/json' }
            });
          });
        })
    );
    return;
  }

  // Strategy: Static assets (JS, CSS, fonts) - Cache First
  if (
    url.pathname.startsWith('/_next/static') ||
    url.pathname.match(/\.(js|css|woff|woff2|ttf|eot)$/) ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' ||
    url.hostname === 'cdn.jsdelivr.net'
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        return cached || fetch(request).then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, responseClone));
          }
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  // Strategy: Pages - Network First with cache fallback
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(DYNAMIC_CACHE).then((cache) => {
              cache.put(request, responseClone);
              trimCache(DYNAMIC_CACHE, DYNAMIC_CACHE_LIMIT);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            return cached || caches.match('/offline');
          });
        })
    );
    return;
  }

  // Everything else: network only (nothing else is stored).
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  console.log('[SW] Sync event:', event.tag);
});

// Push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body || 'New update from GSG Convenience Goods & More',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/',
      dateOfArrival: Date.now(),
    },
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'close', title: 'Dismiss' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(
      data.title || 'GSG Convenience Goods & More',
      options
    )
  );
});

// Notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'close') return;

  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        return clients.openWindow(url);
      })
  );
});

// Periodic background sync (for updates)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'update-content') {
    event.waitUntil(
      caches.open(STATIC_CACHE).then((cache) => {
        return cache.addAll(STATIC_ASSETS).catch(() => { });
      })
    );
  }
});
