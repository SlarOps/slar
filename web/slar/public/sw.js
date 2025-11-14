// Service Worker for SLAR PWA
const CACHE_NAME = 'slar-ai-v1';
const RUNTIME_CACHE = 'slar-runtime';

// Files to cache on install
const PRECACHE_URLS = [
  '/ai-agent',
  '/manifest.json',
];

// Install event - cache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  const currentCaches = [CACHE_NAME, RUNTIME_CACHE];
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return cacheNames.filter((cacheName) => !currentCaches.includes(cacheName));
      })
      .then((cachesToDelete) => {
        return Promise.all(
          cachesToDelete.map((cacheToDelete) => {
            return caches.delete(cacheToDelete);
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - network first, fall back to cache
self.addEventListener('fetch', (event) => {
  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Network first strategy for API calls
  if (event.request.url.includes('/api/') || event.request.url.includes('/ws/')) {
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          return new Response('Offline - API not available', { status: 503 });
        })
    );
    return;
  }

  // Cache first for static assets
  if (event.request.url.match(/\.(js|css|png|jpg|jpeg|svg|gif|woff|woff2)$/)) {
    event.respondWith(
      caches.match(event.request)
        .then((response) => {
          if (response) {
            return response;
          }
          return fetch(event.request).then((response) => {
            // Don't cache non-ok responses
            if (!response || response.status !== 200 || response.type === 'error') {
              return response;
            }
            const responseToCache = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => {
              cache.put(event.request, responseToCache);
            });
            return response;
          });
        })
    );
    return;
  }

  // Network first, cache fallback for pages
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Clone the response
        const responseToCache = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return response;
      })
      .catch(() => {
        return caches.match(event.request)
          .then((response) => {
            if (response) {
              return response;
            }
            // Return offline page if available
            return caches.match('/ai-agent');
          });
      })
  );
});

// Message event - for communication with clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
