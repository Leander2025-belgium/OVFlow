const CACHE='ovflow-8-verified-live-v8';
const FILES=['./','./index.html','./config.js','./styles.css','./app.js','./live.js','./live.html','./core-client.js','./icon.svg','./manifest.webmanifest','./vendor/leaflet.js','./vendor/leaflet.css'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)));self.skipWaiting();});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('ovflow-8-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin)return;e.respondWith(fetch(e.request).then(r=>{if(r.ok){const clone=r.clone();caches.open(CACHE).then(c=>c.put(e.request,clone));}return r;}).catch(()=>caches.match(e.request).then(r=>r||new Response('Offline',{status:503}))));});
