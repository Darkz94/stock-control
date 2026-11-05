const CACHE='stock-control-v1-20261105-instant-paste';
const FILES=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./icon.svg',
'./assets/two-stroke-500ml.webp','./assets/two-stroke-20l.webp','./assets/nylon-line.webp',
'./assets/pine-gel-5l.webp','./assets/pine-gel-20l.webp','./assets/non-selective-20l.webp',
'./assets/non-selective-1l.webp','./assets/selective-20l.webp','./assets/selective-5l.webp',
'./assets/bleach-5l.webp','./assets/toilet-paper.webp','./assets/black-bags.webp',
'./assets/rake.webp','./assets/broom.webp','./assets/mop.webp','./assets/broom-sticks.webp'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==location.origin)return;event.respondWith(caches.match(event.request).then(found=>found||fetch(event.request).then(resp=>{if(resp.ok){const copy=resp.clone();caches.open(CACHE).then(c=>c.put(event.request,copy))}return resp})))})
