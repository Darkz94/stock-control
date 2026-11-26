const CACHE='stock-control-v7-products';
const FILES=['./','./index.html','./styles.css?v=7','./app.js?v=7','./cloud.js?v=7','./manifest.webmanifest','./icon.svg',
'./assets/two-stroke-500ml.webp','./assets/two-stroke-20l.webp','./assets/nylon-line.webp',
'./assets/pine-gel-5l.webp','./assets/pine-gel-20l.webp','./assets/non-selective-20l.webp',
'./assets/non-selective-1l.webp','./assets/selective-20l.webp','./assets/selective-5l.webp',
'./assets/bleach-5l.webp','./assets/toilet-paper.webp','./assets/black-bags.webp',
'./assets/rake.webp','./assets/broom.webp','./assets/mop.webp','./assets/broom-sticks.webp',
'./assets/broom-head.webp',
'./assets/all-purpose-cleaner-20l.webp',
'./assets/all-purpose-cleaner-5l.webp',
'./assets/tile-cleaner-20l.webp',
'./assets/tile-cleaner-5l.webp',
'./assets/mop-head.webp',
'./assets/dish-washing-liquid-20l.webp',
'./assets/dish-washing-liquid-5l.webp',
'./assets/hand-soap-20l.webp',
'./assets/hand-soap-5l.webp'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('stock-control-') && key !== CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (request.mode === 'navigate') {
      try {
        const response = await fetch(request, {cache: 'no-cache'});
        if (response.ok) return response;
      } catch {
        // Use the bundled shell when the network is unavailable.
      }
      return (await cache.match('./index.html')) || Response.error();
    }
    return (await cache.match(request)) || fetch(request);
  })());
});
