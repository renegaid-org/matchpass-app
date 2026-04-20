/* matchpass-app service worker — shell cache + passthrough for /api.
 *
 * Strategy:
 *   - On install, cache the hashed app shell (index.html + the latest
 *     /assets/*). Navigation requests fall back to cached index.html
 *     when offline, keeping the PWA usable after the first load.
 *   - API requests always hit the network. We do NOT cache /api/gate/
 *     responses — the PWA handles offline queueing in its own IDB.
 *   - Bumping SHELL_VERSION invalidates the cache on next install.
 */
const SHELL_VERSION = 'v1';
const SHELL_CACHE = `matchpass-shell-${SHELL_VERSION}`;
const SHELL_PATHS = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_PATHS))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k.startsWith('matchpass-shell-') && k !== SHELL_CACHE)
        .map(k => caches.delete(k)),
    )),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Let API requests and non-GETs passthrough to the network. Offline
  // queueing is handled explicitly by the app's IDB queue.
  if (url.pathname.startsWith('/api/') || request.method !== 'GET') {
    return;
  }

  // Navigation: network-first with offline fallback to cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/index.html').then(res => res || new Response('offline', { status: 503 })),
      ),
    );
    return;
  }

  // Static asset: cache-first, fall back to network, cache the response.
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        if (res && res.ok && url.origin === self.location.origin) {
          const clone = res.clone();
          caches.open(SHELL_CACHE).then(c => c.put(request, clone)).catch(() => {});
        }
        return res;
      }).catch(() => cached || new Response('offline', { status: 503 }));
    }),
  );
});
