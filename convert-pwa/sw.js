/* sw.js — offline support for the PWA.
 *
 * Strategy:
 *   - App shell (same-origin files): cache-first, so the app opens instantly
 *     and works offline once installed.
 *   - CDN libraries (cross-origin): stale-while-revalidate, so they're cached
 *     on first successful load and then available offline.
 */

const CACHE = 'reformat-v2';

const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/config.js',
  './js/converters.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin) {
    // cache-first for our own files
    event.respondWith(
      caches.match(request).then(hit => hit || fetchAndCache(request))
    );
  } else {
    // stale-while-revalidate for CDN assets
    event.respondWith(
      caches.match(request).then(hit => {
        const network = fetchAndCache(request).catch(() => hit);
        return hit || network;
      })
    );
  }
});

function fetchAndCache(request) {
  return fetch(request).then(response => {
    if (response && (response.ok || response.type === 'opaque')) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(request, copy));
    }
    return response;
  });
}
