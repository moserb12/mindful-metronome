// ============================================================================
// Minimal, hand-rolled service worker — no vite-plugin-pwa or other build
// dependency, matching the app's lean-dependency philosophy. Two
// deliberately different strategies:
//
//   - /assets/* (Vite's hashed, content-addressed build output): CACHE-
//     FIRST. Safe to cache forever — any real change gets a brand-new
//     filename, so a stale cache entry for one of these URLs is never
//     actually stale content.
//   - Navigation requests (the HTML shell): NETWORK-FIRST, falling back to
//     the cache only when genuinely offline. This is what avoids the
//     stale-forever trap a naive "cache everything" service worker falls
//     into — the shell (which references the CURRENT deploy's hashed
//     asset filenames) is never served stale by default, only as a
//     last-resort offline fallback.
//
// skipWaiting()/clients.claim() take over immediately on update rather
// than waiting for all tabs to close — a reasonable trade-off here since
// the app holds no fragile in-memory state a surprise SW swap could
// corrupt (worst case, a very long-running tab's next network request
// gets served by the new worker mid-visit, which is harmless).
// ============================================================================

const CACHE_NAME = 'mindful-metronome-v1';
const CORE_ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/index.html')))
    );
  }
});
