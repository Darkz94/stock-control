const CACHE='stock-control-v12-remember-sign-in';
const FILES=['./','./index.html','./styles.css?v=12','./app.js?v=12','./cloud.js?v=12','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png',
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

const SHARE_CACHE = 'stock-screenshot-inbox';
const SHARE_MAX_AGE = 60 * 60 * 1000;

async function receiveScreenshot(request) {
  const destination = new URL('./index.html', self.registration.scope);
  destination.searchParams.set('shared', 'invalid');
  try {
    const form = await request.formData();
    const files = form.getAll('screenshot');
    const file = files[0];
    if (files.length !== 1 || !(file instanceof Blob) || !/^image\/(png|jpeg|webp)$/.test(file.type)
        || !file.size || file.size > 12 * 1024 * 1024) return Response.redirect(destination, 303);

    const cache = await caches.open(SHARE_CACHE);
    const now = Date.now();
    await Promise.all((await cache.keys()).map(async key => {
      const entry = await cache.match(key);
      if (now - Number(entry?.headers.get('x-stock-shared-at')) > SHARE_MAX_AGE) await cache.delete(key);
    }));
    const id = crypto.randomUUID();
    const imageKey = new URL('./shared-image/' + id, self.registration.scope);
    await cache.put(imageKey, new Response(file, {headers: {
      'Content-Type': file.type, 'x-stock-shared-at': String(now)
    }}));
    destination.searchParams.set('shared', id);
  } catch {
    destination.searchParams.set('shared', 'unavailable');
  }
  return Response.redirect(destination, 303);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method === 'POST' && request.url === new URL('./share-screenshot', self.registration.scope).href) {
    event.respondWith(receiveScreenshot(request));
    return;
  }
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
