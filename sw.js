const CACHE='stock-control-v2-20261109-firebase';
const FILES=['./','./index.html','./styles.css','./config.js','./domain.js','./backend-local.js','./backend-firebase.mjs','./firebase-loader.mjs','./app.js','./manifest.webmanifest','./icon.svg',
'./assets/two-stroke-500ml.webp','./assets/two-stroke-20l.webp','./assets/nylon-line.webp',
'./assets/pine-gel-5l.webp','./assets/pine-gel-20l.webp','./assets/non-selective-20l.webp',
'./assets/non-selective-1l.webp','./assets/selective-20l.webp','./assets/selective-5l.webp',
'./assets/bleach-5l.webp','./assets/toilet-paper.webp','./assets/black-bags.webp',
'./assets/rake.webp','./assets/broom.webp','./assets/mop.webp','./assets/broom-sticks.webp'];
// Versioned Firebase SDK files never change, so they are cached on first use for offline start-up.
const SDK_PREFIX='https://www.gstatic.com/firebasejs/13.1.0/';
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  const sdk=url.href.startsWith(SDK_PREFIX);
  // Never cache Firebase API traffic or the Hosting config endpoint; only static app files and the SDK.
  if(!sdk&&(url.origin!==location.origin||url.pathname.startsWith('/__/')))return;
  event.respondWith(caches.match(event.request).then(found=>found||fetch(event.request).then(resp=>{if(resp.ok||resp.type==='opaque'){const copy=resp.clone();caches.open(CACHE).then(c=>c.put(event.request,copy))}return resp})))
});
