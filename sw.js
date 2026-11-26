const CACHE='stock-control-v10-stock-rolls';
const FILES=['./','./index.html','./styles.css?v=10','./app.js?v=10','./cloud.js?v=10','./manifest.webmanifest','./icon.svg',
'./assets/two-stroke-500ml.webp','./assets/two-stroke-20l.webp?v=8','./assets/nylon-line.webp','./assets/nylon-line-5m.webp','./assets/toilet-roll-single.webp',
'./assets/pine-gel-5l.webp','./assets/pine-gel-20l.webp','./assets/non-selective-20l.webp?v=8',
'./assets/non-selective-1l.webp?v=8','./assets/selective-20l.webp?v=8','./assets/selective-5l.webp?v=8',
'./assets/bleach-5l.webp?v=8','./assets/toilet-paper.webp?v=9','./assets/black-bags.webp?v=9',
'./assets/rake.webp?v=9','./assets/broom.webp?v=9','./assets/mop.webp?v=9','./assets/broom-sticks.webp?v=9',
'./assets/broom-head.webp',
'./assets/all-purpose-cleaner-20l.webp?v=8',
'./assets/all-purpose-cleaner-5l.webp?v=8',
'./assets/tile-cleaner-20l.webp?v=8',
'./assets/tile-cleaner-5l.webp?v=8',
'./assets/mop-head.webp',
'./assets/dish-washing-liquid-20l.webp?v=8',
'./assets/dish-washing-liquid-5l.webp?v=8',
'./assets/hand-soap-20l.webp?v=8',
'./assets/hand-soap-5l.webp?v=8'];
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
