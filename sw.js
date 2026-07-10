/* EcoCash Bundle Builder — Service Worker v1 */
const CACHE = 'ecocash-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/thankyou.html',
  '/assets/econet.png',
  '/assets/ecocash.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800;900&family=JetBrains+Mono:wght@700&display=swap',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if(e.request.method!=='GET') return;
  if(e.request.url.includes('/api/')) return; // never cache API calls
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if(res.ok) caches.open(CACHE).then(c=>c.put(e.request,res.clone()));
        return res;
      }).catch(()=>cached);
      return cached || network;
    })
  );
});
